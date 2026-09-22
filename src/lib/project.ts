import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readJsonFile } from './json.js';
import { type TalosPackageJson, validatePackage } from './package.js';

export async function readProjectPackage(
  root: string,
  commandName: 'action' | 'build',
): Promise<TalosPackageJson> {
  const projectRoot = resolve(root);
  const packagePath = join(projectRoot, 'package.json');

  try {
    await access(packagePath);
  } catch {
    throw new Error(
      `No package.json found in ${projectRoot}. Run "talos ${commandName}" from the root of a Talos extension.`,
    );
  }

  const packageJson = await readJsonFile<unknown>(packagePath);
  validatePackage(packageJson);
  return packageJson;
}
