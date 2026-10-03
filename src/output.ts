import { randomUUID } from 'node:crypto';
import { link, lstat, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import type { TalosFile } from './index.js';
import { operationSignal } from './operation-signal.js';

export interface WriteOutputOptions {
  suffix?: string;
  extension: string;
  signal?: AbortSignal;
}

/** Publish a completed regular file beside an input without replacing existing files. */
export async function writeOutput(
  file: TalosFile,
  options: WriteOutputOptions,
  // biome-ignore lint/suspicious/noConfusingVoidType: Writers may return false to discard or complete without a value.
  generate: (temporaryPath: string) => Promise<boolean | void>,
): Promise<string | null> {
  const { extension, suffix = '' } = options;
  if (
    !isAbsolute(file.path) ||
    file.path.includes('\0') ||
    !file.name ||
    basename(file.name) !== file.name ||
    file.name.includes('\0')
  ) {
    throw new TypeError('Output requires an absolute input path and a valid filename');
  }
  if (!/^[a-z0-9]+$/i.test(extension) || /[/\\\0]/.test(suffix)) {
    throw new TypeError('Output extension and suffix must not contain path separators');
  }
  const signal = operationSignal(options.signal);
  signal?.throwIfAborted();
  const directory = dirname(file.path);
  const staging = await mkdtemp(join(directory, '.talos-output-'));
  const temporary = join(staging, `${randomUUID()}.${extension}`);
  try {
    signal?.throwIfAborted();
    if ((await generate(temporary)) === false) return null;
    signal?.throwIfAborted();
    if (!(await lstat(temporary)).isFile()) throw new Error('Output must be a regular file');
    const stem = basename(file.name, extname(file.name)) + suffix;
    for (let number = 0; number < 10_000; number++) {
      signal?.throwIfAborted();
      const destination = join(directory, `${stem}${number ? `-${number + 1}` : ''}.${extension}`);
      try {
        await link(temporary, destination);
        return destination;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new Error('Could not find an available output filename');
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
