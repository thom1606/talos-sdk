import { readFile, writeFile } from 'node:fs/promises';

export async function readJsonFile<T>(path: string): Promise<T> {
  let contents: string;

  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Could not read ${path}`, { cause: error });
  }

  try {
    return JSON.parse(contents) as T;
  } catch (error) {
    throw new Error(`${path} does not contain valid JSON`, { cause: error });
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
