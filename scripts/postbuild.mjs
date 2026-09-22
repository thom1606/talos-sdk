import { chmod } from 'node:fs/promises';

// npm links the package executable directly during local SDK development.
// TypeScript creates a fresh file on every build, so restore its executable bit.
await chmod(new URL('../dist/cli.js', import.meta.url), 0o755);
