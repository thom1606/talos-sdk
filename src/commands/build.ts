import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { ZipArchive } from 'archiver';
import chalk from 'chalk';
import { build } from 'esbuild';
import { readJsonFile, writeJsonFile } from '../lib/json.js';
import { isPathInside } from '../lib/package.js';
import { readProjectPackage } from '../lib/project.js';
import { reactWindows } from '../lib/react-windows.js';
import { validateTranslations } from '../lib/validate-translations.js';
import { reactWindowPage } from '../window-tree.js';

export interface BuildResult {
  outputPath: string;
  bytes: number;
}

export async function buildExtension(directory: string, output?: string): Promise<BuildResult> {
  const root = await realpath(resolve(directory));
  const packageJson = await readProjectPackage(root, 'build');

  const entryPath = resolve(root, packageJson.talos.entry);
  if (!isPathInside(root, entryPath)) throw new Error('talos.entry must stay inside the project');

  const archiveName = `${unscopedName(packageJson.name)}.talos`;
  const outputPath = resolve(output ?? join(root, 'dist', archiveName));
  const stagingDirectory = await mkdtemp(join(tmpdir(), 'talos-build-'));
  const temporaryArchive = join(dirname(outputPath), `.${basename(outputPath)}.${process.pid}.tmp`);

  try {
    await mkdir(dirname(outputPath), { recursive: true });
    await copyLocales(root, stagingDirectory, packageJson.talos.locales);
    const locales = Object.fromEntries(
      await Promise.all(
        Object.entries(packageJson.talos.locales).map(
          async ([language, path]) =>
            [
              language,
              await readJsonFile<Record<string, unknown>>(join(stagingDirectory, path)),
            ] as const,
        ),
      ),
    );
    const extensionPath = join(stagingDirectory, 'extension.mjs');
    const react = reactWindows(root, entryPath);
    const buildResult = await build({
      absWorkingDir: root,
      entryPoints: [entryPath],
      outfile: extensionPath,
      bundle: true,
      platform: 'node',
      // Initialize before any bundled module evaluates, including module-level t() calls.
      banner: {
        js: `Object.defineProperty(globalThis, '__talosLocales', { value: ${JSON.stringify(locales)} });`,
      },
      jsx: 'automatic',
      plugins: [react.plugin],
      target: 'node22',
      format: 'esm',
      sourcemap: false,
      minify: false,
      metafile: true,
      logLevel: 'silent',
    });

    const exportedNames = Object.values(buildResult.metafile.outputs).flatMap(
      (value) => value.exports,
    );
    if (!exportedNames.includes('activate')) {
      throw new Error('The extension must export an activate function');
    }
    if (!exportedNames.includes('deactivate')) {
      throw new Error('The extension must export a deactivate function');
    }

    await buildWindows(
      root,
      stagingDirectory,
      packageJson.talos.windows ?? {},
      locales,
      Object.keys(buildResult.metafile.inputs).map((file) => resolve(root, file)),
      react.modules.size > 0 ||
        entryPath.endsWith('.tsx') ||
        Object.keys(buildResult.metafile.inputs).some((path) =>
          /react[/](jsx|index)|[/]react\.js$/.test(path),
        )
        ? react.browserEntry()
        : undefined,
    );
    await writeJsonFile(join(stagingDirectory, 'package.json'), {
      name: packageJson.name,
      version: packageJson.version,
      ...(packageJson.description ? { description: packageJson.description } : {}),
      type: 'module',
      talos: {
        ...packageJson.talos,
        entry: 'extension.mjs',
      },
      commands: packageJson.commands,
    });

    await createArchive(stagingDirectory, temporaryArchive);
    await rename(temporaryArchive, outputPath);
    const bytes = (await stat(outputPath)).size;
    return { outputPath, bytes };
  } finally {
    await Promise.all([
      rm(stagingDirectory, { recursive: true, force: true }),
      rm(temporaryArchive, { force: true }),
    ]);
  }
}

export async function runBuild(output?: string): Promise<void> {
  const result = await buildExtension(process.cwd(), output);
  console.log(
    chalk.green('Built'),
    chalk.bold(result.outputPath),
    chalk.dim(formatBytes(result.bytes)),
  );
}

/** Build browser code separately so Node APIs cannot accidentally enter a web page. */
async function buildWindows(
  root: string,
  staging: string,
  windows: Record<string, string>,
  locales: Record<string, Record<string, unknown>>,
  actionInputs: string[],
  reactEntry: string | undefined,
): Promise<void> {
  await validateTranslations(
    actionInputs.filter(
      (file) =>
        isPathInside(root, file) && !file.includes('/node_modules/') && /\.tsx?$/.test(file),
    ),
    locales.en ?? {},
  );
  if (windows[reactWindowPage]) throw new Error(`${reactWindowPage} is reserved for React windows`);
  // Resolve one React installation for the page, including symlinked SDK development.
  const require = createRequire(join(root, 'package.json'));
  const reactAliases = reactEntry
    ? Object.fromEntries(
        ['react', 'react-dom'].map((name) => [
          name,
          dirname(require.resolve(`${name}/package.json`)),
        ]),
      )
    : undefined;
  for (const [name, entry] of Object.entries({
    ...windows,
    ...(reactEntry ? { [reactWindowPage]: '' } : {}),
  })) {
    const entryPath = resolve(root, entry);
    if (!isPathInside(root, entryPath))
      throw new Error(`Window ${name} must stay inside the project`);
    const directory = join(staging, 'windows', name);
    await mkdir(directory, { recursive: true });
    const result = await build({
      absWorkingDir: root,
      ...(name === reactWindowPage && reactEntry
        ? {
            stdin: { contents: reactEntry, resolveDir: root, sourcefile: 'talos-window-entry.js' },
          }
        : { entryPoints: [entryPath] }),
      outfile: join(directory, 'app.js'),
      bundle: true,
      platform: 'browser',
      ...(name === reactWindowPage && reactAliases ? { alias: reactAliases } : {}),
      target: 'safari26',
      format: 'iife',
      jsx: 'automatic',
      minify: true,
      metafile: true,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' },
    });
    await validateTranslations(
      Object.keys(result.metafile.inputs)
        .map((file) => resolve(root, file))
        .filter(
          (file) =>
            isPathInside(root, file) && !file.includes('/node_modules/') && /\.tsx?$/.test(file),
        ),
      locales.en ?? {},
    );
    await copyFile(
      new URL('../../assets/window.css', import.meta.url),
      join(directory, 'talos.css'),
    );
    await writeFile(
      join(directory, 'locales.js'),
      `Object.defineProperty(globalThis, '__talosLocales', { value: ${JSON.stringify(locales)} });`,
    );
    const hasCSS = Object.values(result.metafile.outputs).some((output) => output.cssBundle);
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<link rel="stylesheet" href="talos.css">
${hasCSS ? '<link rel="stylesheet" href="app.css">' : ''}</head>
<body><div id="root"></div><script src="locales.js"></script><script src="app.js"></script></body></html>`,
    );
  }
}

async function copyLocales(
  root: string,
  stagingDirectory: string,
  locales: Record<string, string>,
): Promise<void> {
  for (const [language, relativePath] of Object.entries(locales)) {
    if (typeof relativePath !== 'string') {
      throw new Error(`Locale ${language} must point to a JSON file`);
    }
    const sourcePath = resolve(root, relativePath);
    if (!isPathInside(root, sourcePath) || extname(sourcePath) !== '.json') {
      throw new Error(`Locale ${language} must be a JSON file inside the project`);
    }
    const locale = await readJsonFile<unknown>(sourcePath);
    if (typeof locale !== 'object' || locale === null || Array.isArray(locale)) {
      throw new Error(`Locale ${language} must contain a JSON object`);
    }

    const destinationPath = resolve(stagingDirectory, relativePath);
    if (!isPathInside(stagingDirectory, destinationPath)) {
      throw new Error(`Locale ${language} has an unsafe destination path`);
    }
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }
}

async function createArchive(sourceDirectory: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const output = createWriteStream(outputPath, { flags: 'wx' });
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.once('close', resolvePromise);
    output.once('error', rejectPromise);
    archive.once('error', rejectPromise);
    archive.pipe(output);
    archive.directory(sourceDirectory, false);
    void archive.finalize();
  });
}

function unscopedName(packageName: string): string {
  const name = packageName.includes('/')
    ? packageName.slice(packageName.lastIndexOf('/') + 1)
    : packageName;
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!safeName) throw new Error('The package name cannot be used as a filename');
  return safeName;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `(${bytes} B)`;
  if (bytes < 1_000_000) return `(${(bytes / 1_000).toFixed(1)} kB)`;
  return `(${(bytes / 1_000_000).toFixed(1)} MB)`;
}
