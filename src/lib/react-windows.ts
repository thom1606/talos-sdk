import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';

/** A .tsx import in action code is a browser boundary; its implementation stays in WebKit. */
export function reactWindows(root: string, entryPath: string) {
  const modules = new Map<string, { id: string; exports: string[] }>();
  const plugin: Plugin = {
    name: 'talos-react-windows',
    setup(builder) {
      builder.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
        if (path === entryPath || path.includes('/node_modules/')) return undefined;
        const result = await build({
          stdin: { contents: await readFile(path, 'utf8'), loader: 'tsx', sourcefile: path },
          bundle: false,
          write: false,
          format: 'esm',
          metafile: true,
          logLevel: 'silent',
          jsx: 'automatic',
        });
        const exports = Object.values(result.metafile.outputs).flatMap((output) => output.exports);
        const id = createHash('sha256').update(relative(root, path)).digest('hex').slice(0, 20);
        modules.set(path, { id, exports });
        return {
          loader: 'js',
          contents: exports
            .map(
              (name, index) => `
          const component${index} = Object.assign(function() { throw new Error('Window components only render in Talos windows'); },
            { [Symbol.for('talos.window.component')]: ${JSON.stringify(`${id}:${name}`)} });
          export { component${index} as ${JSON.stringify(name)} };`,
            )
            .join('\n'),
        };
      });
    },
  };
  function browserEntry(): string {
    const imports: string[] = [];
    const entries = ['"talos:Text": Text', '"talos:Button": Button'];
    let index = 0;
    for (const [path, module] of modules) {
      const binding = `window${index++}`;
      imports.push(`import * as ${binding} from ${JSON.stringify(path)};`);
      for (const name of module.exports)
        entries.push(
          `${JSON.stringify(`${module.id}:${name}`)}: ${binding}[${JSON.stringify(name)}]`,
        );
    }
    return `import { createRoot } from 'react-dom/client';
      import { Button, Text } from '@thom1606/talos-sdk/react';
      import { windowRoot } from ${JSON.stringify(fileURLToPath(new URL('../window-renderer.js', import.meta.url)))};
      ${imports.join('\n')}
      createRoot(document.getElementById('root')).render(windowRoot({${entries.join(',')}}));`;
  }
  return { plugin, modules, browserEntry };
}
