import type { TalosFile } from './index.js';

/** Read a byte range instead of loading an entire large input. Offsets are in bytes. */
export interface ReadFileOptions {
  offset?: number;
  length?: number;
}

interface WindowBridge {
  data: unknown;
  context: { files: TalosFile[] };
  request(message: Record<string, unknown>): Promise<unknown>;
}
interface FileInfo {
  name: string;
  type: string;
  size: number;
}
const chunkSize = 1024 * 1024;

function bridge(): WindowBridge {
  const value = (globalThis as typeof globalThis & { __talosWindow?: WindowBridge }).__talosWindow;
  if (!value) throw new Error('This page must be opened in a Talos window');
  return value;
}

function byteCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative safe integer`);
  return value;
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export const talosWindow = Object.freeze({
  /** @deprecated Pass React props and use useTalos() for activation context. */
  data<T = unknown>(): T {
    return bridge().data as T;
  },
  /** Read any activation file as a standard browser File, optionally limited to a byte range. */
  async readFile(file: TalosFile, options: ReadFileOptions = {}): Promise<File> {
    const host = bridge();
    const index = host.context.files.findIndex((input) => input.path === file.path);
    if (index < 0) throw new Error('This file was not supplied to the window');
    const offset = byteCount(options.offset ?? 0, 'offset');
    if (options.length !== undefined) byteCount(options.length, 'length');
    const info = (await host.request({ method: 'fileInfo', index })) as unknown as FileInfo;
    const length = Math.min(options.length ?? info.size, Math.max(0, info.size - offset));
    const parts: Uint8Array<ArrayBuffer>[] = [];
    for (let read = 0; read < length; ) {
      const count = Math.min(chunkSize, length - read);
      const base64 = await host.request({
        method: 'readFile',
        index,
        offset: offset + read,
        length: count,
        size: info.size,
      });
      const binary = atob(base64 as string);
      if (binary.length !== count) throw new Error('The input file changed while reading');
      parts.push(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
      read += count;
    }
    return new File(parts, info.name, { type: info.type });
  },
  /** Save any Blob/File through a native save sheet. Cancellation resolves to null. */
  async saveFile(data: Blob, suggestedName: string): Promise<string | null> {
    if (!(data instanceof Blob)) throw new Error('saveFile requires a Blob or File');
    byteCount(data.size, 'file size');
    const host = bridge();
    const id = await host.request({
      method: 'beginSave',
      suggestedName,
      type: data.type,
      size: data.size,
    });
    if (id === null) return null;
    try {
      for (let offset = 0; offset < data.size; offset += chunkSize) {
        const bytes = new Uint8Array(await data.slice(offset, offset + chunkSize).arrayBuffer());
        await host.request({ method: 'writeFile', id, offset, bytes: encode(bytes) });
      }
      return (await host.request({ method: 'finishSave', id })) as string;
    } catch (error) {
      await host.request({ method: 'cancelSave', id }).catch(() => {});
      throw error;
    }
  },
  async close(): Promise<void> {
    await bridge().request({ method: 'close' });
  },
});

export type { TextParameters } from './localization.js';
export { t } from './localization.js';
