declare module 'archiver' {
  import { Transform } from 'node:stream';
  import type { ZlibOptions } from 'node:zlib';

  export class ZipArchive extends Transform {
    constructor(options?: { zlib?: ZlibOptions });
    directory(sourceDirectory: string, destinationDirectory: string | false): this;
    finalize(): Promise<void>;
  }
}
