import { access, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { input } from '@inquirer/prompts';
import chalk from 'chalk';
import { writeJsonFile } from '../lib/json.js';
import { isIdentifier, toBundleId } from '../lib/names.js';
import type { TalosPackageJson } from '../lib/package.js';

export async function initializeProject(
  parentDirectory: string,
  displayName: string,
  bundleId: string,
  sdkVersion: string,
): Promise<string> {
  if (!displayName.trim()) throw new Error('The extension name cannot be empty');
  if (!isIdentifier(bundleId)) {
    throw new Error('The bundle ID must use lowercase letters, numbers, and hyphens');
  }

  const root = resolve(parentDirectory, bundleId);
  await assertDirectoryDoesNotExist(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'locales'), { recursive: true });
  await mkdir(join(root, '.github/workflows'), { recursive: true });

  const packageJson: TalosPackageJson = {
    name: bundleId,
    version: '1.0.0',
    description: `${displayName.trim()} extension for Talos`,
    type: 'module',
    scripts: {
      action: 'talos action',
      build: 'talos build',
      typecheck: 'tsc --noEmit',
    },
    devDependencies: {
      '@thom1606/talos-sdk': `^${sdkVersion}`,
      '@types/react': '^19.2.0',
      '@types/react-dom': '^19.2.0',
      typescript: '^5.9.0',
    },
    dependencies: { react: '^19.2.0', 'react-dom': '^19.2.0' },
    talos: {
      bundleId,
      entry: 'src/index.tsx',
      locales: {
        en: 'locales/en.json',
      },
    },
    commands: [
      {
        name: 'example',
        displayName: 'Example',
        icon: 'sparkles',
        description: 'Runs the example action.',
        supportedFileTypes: ['public.item'],
        settings: [],
      },
    ],
  };

  await Promise.all([
    writeJsonFile(join(root, 'package.json'), packageJson),
    writeJsonFile(join(root, 'locales/en.json'), {
      displayName: displayName.trim(),
      commands: {
        example: {
          displayName: 'Example',
          description: 'Runs the example action.',
        },
      },
    }),
    writeFile(join(root, 'src/index.tsx'), extensionSource(), 'utf8'),
    writeFile(join(root, '.github/workflows/build.yml'), workflowSource(bundleId), 'utf8'),
    writeJsonFile(join(root, 'tsconfig.json'), {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        lib: ['ES2022', 'DOM'],
      },
      include: ['src'],
    }),
    writeFile(join(root, '.gitignore'), 'dist/\nnode_modules/\n', {
      encoding: 'utf8',
      flag: 'wx',
    }),
  ]);

  return root;
}

export async function runInit(sdkVersion: string): Promise<void> {
  const displayName = await input({
    message: 'Extension name',
    default: 'My extension',
    validate: (value) => value.trim().length > 0 || 'Enter an extension name.',
  });
  const bundleId = await input({
    message: 'Bundle ID',
    default: toBundleId(displayName),
    validate: (value) =>
      isIdentifier(value) ||
      'Use lowercase letters, numbers, and hyphens (starting with a letter).',
  });

  const root = await initializeProject(process.cwd(), displayName, bundleId, sdkVersion);
  console.log(chalk.green('Created a Talos extension in'), chalk.bold(root));
  console.log(chalk.dim('Next:'));
  console.log(chalk.dim(`- cd ${bundleId}`));
  console.log(chalk.dim('- npm install'));
  console.log(chalk.dim('- npm build'));
}

async function assertDirectoryDoesNotExist(root: string): Promise<void> {
  try {
    await access(root);
    throw new Error(`Refusing to overwrite existing directory ${root}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Refusing to overwrite')) throw error;
  }
}

function extensionSource(): string {
  return `import type { TalosContext } from '@thom1606/talos-sdk';

/** Called by Talos whenever the user runs one of this extension's actions. */
export async function activate(context: TalosContext): Promise<void> {
  switch (context.action) {
    case 'example':
      await runExample(context);
      return;
    default:
      throw new Error(\`Unknown Talos action: \${context.action}\`);
  }
}

async function runExample(context: TalosContext): Promise<void> {
  console.log('Example action activated', context.config);
}

/** Called before Talos shuts down or removes this extension. */
export async function deactivate(): Promise<void> {
  // Release long-lived resources here.
}
`;
}

function workflowSource(bundleId: string): string {
  return `name: Build Talos extension

on:
  push:
    branches: [main]

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
          package-manager-cache: false
      - name: Install dependencies
        run: |
          if [ -f package-lock.json ]; then
            npm ci
          else
            npm install
          fi
      - run: npm run typecheck
      - run: npm run build
      - name: Read package version
        id: package
        run: echo "version=$(node -p 'require("./package.json").version')" >> "$GITHUB_OUTPUT"
      - uses: actions/upload-artifact@v7
        with:
          name: ${bundleId}-\${{ steps.package.outputs.version }}
          path: dist/${bundleId}.talos
          if-no-files-found: error
      - name: Publish versioned release
        env:
          GH_TOKEN: \${{ github.token }}
          VERSION: \${{ steps.package.outputs.version }}
        run: |
          tag="v\${VERSION}"
          if ! gh release view "$tag" >/dev/null 2>&1; then
            gh release create "$tag" dist/${bundleId}.talos \\
              --target "$GITHUB_SHA" \\
              --title "$tag" \\
              --notes "Built from package.json version \${VERSION}."
          fi
`;
}
