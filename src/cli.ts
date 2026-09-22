#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { Command } from 'commander';
import { runAction } from './commands/action.js';
import { runBuild } from './commands/build.js';
import { runInit } from './commands/init.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as {
  version: string;
};

const program = new Command()
  .name('talos')
  .description('Create and build TypeScript extensions for Talos')
  .version(packageJson.version)
  .showHelpAfterError('(run talos help for usage)')
  .helpCommand('help [command]', 'Show help for Talos or a specific command');

program
  .command('init')
  .description('Create a new Talos extension project')
  .action(async () => runInit(packageJson.version));

program
  .command('build')
  .description('Build a Talos extension into an importable .talos file')
  .option('-o, --output <file>', 'write the .talos file to this path')
  .action(async (options: { output?: string }) => runBuild(options.output));

program
  .command('action')
  .description('Add an action to an extension package.json')
  .action(async () => runAction());

try {
  await program.parseAsync();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red('Error:'), message);
  process.exitCode = 1;
}
