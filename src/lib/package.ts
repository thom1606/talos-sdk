import { isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  TalosActionDefinition,
  TalosPackageConfiguration,
  TalosSettingDefinition,
} from '../index.js';
import { isIdentifier } from './names.js';

export interface TalosPackageJson {
  name: string;
  version: string;
  description?: string;
  type?: string;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  talos: TalosPackageConfiguration;
  commands: TalosActionDefinition[];
}

export function isPathInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function validatePackage(packageJson: unknown): asserts packageJson is TalosPackageJson {
  if (!isRecord(packageJson)) throw new Error('package.json must contain an object');
  if (!nonEmptyString(packageJson.name)) throw new Error('package.json needs a name');
  if (!nonEmptyString(packageJson.version)) throw new Error('package.json needs a version');
  if (!isRecord(packageJson.talos)) throw new Error('package.json needs a talos object');
  if (!nonEmptyString(packageJson.talos.bundleId) || !isIdentifier(packageJson.talos.bundleId)) {
    throw new Error('talos.bundleId must use lowercase letters, numbers, and hyphens');
  }
  if (!nonEmptyString(packageJson.talos.entry) || !/\.tsx?$/.test(packageJson.talos.entry)) {
    throw new Error('talos.entry must point to a TypeScript file');
  }
  if (!isRecord(packageJson.talos.locales) || !nonEmptyString(packageJson.talos.locales.en)) {
    throw new Error('talos.locales must contain an English locale');
  }
  if (!Array.isArray(packageJson.commands) || packageJson.commands.length === 0) {
    throw new Error('package.json needs at least one command');
  }

  if (packageJson.talos.windows !== undefined) {
    if (!isRecord(packageJson.talos.windows)) throw new Error('talos.windows must be an object');
    for (const [name, entry] of Object.entries(packageJson.talos.windows)) {
      if (!isIdentifier(name) || !nonEmptyString(entry) || !/\.tsx?$/.test(entry)) {
        throw new Error('Window entries need an identifier and a TypeScript or TSX entrypoint');
      }
    }
  }
  const commandNames = new Set<string>();
  for (const command of packageJson.commands) validateCommand(command, commandNames);
  const commands = packageJson.commands as TalosActionDefinition[];
  function visit(command: TalosActionDefinition, ancestors: Set<string>) {
    if (ancestors.has(command.name) || ancestors.size >= 8)
      throw new Error('Subcommands must not contain cycles or exceed eight levels');
    for (const name of command.subcommands ?? []) {
      const child = commands.find((candidate) => candidate.name === name);
      if (!child) throw new Error(`Unknown subcommand: ${name}`);
      visit(child, new Set([...ancestors, command.name]));
    }
  }
  for (const command of commands) visit(command, new Set());
}

function validateCommand(
  value: unknown,
  commandNames: Set<string>,
): asserts value is TalosActionDefinition {
  if (!isRecord(value)) throw new Error('Every command must be an object');
  if (!nonEmptyString(value.name) || !isIdentifier(value.name)) {
    throw new Error('Command names must use lowercase letters, numbers, and hyphens');
  }
  if (commandNames.has(value.name)) throw new Error(`Duplicate command name: ${value.name}`);
  commandNames.add(value.name);
  if (!nonEmptyString(value.displayName))
    throw new Error(`Command ${value.name} needs a displayName`);
  if (value.icon !== undefined && !nonEmptyString(value.icon)) {
    throw new Error(`Command ${value.name} has an invalid SF Symbol icon`);
  }
  if (!Array.isArray(value.supportedFileTypes) || value.supportedFileTypes.length === 0) {
    throw new Error(`Command ${value.name} needs at least one supported file type`);
  }
  if (!value.supportedFileTypes.every(nonEmptyString)) {
    throw new Error(`Command ${value.name} has an invalid supported file type`);
  }

  if (
    value.subcommands !== undefined &&
    (!Array.isArray(value.subcommands) ||
      !value.subcommands.length ||
      !value.subcommands.every(nonEmptyString) ||
      new Set(value.subcommands).size !== value.subcommands.length)
  ) {
    throw new Error(
      `Command ${value.name} subcommands must be a non-empty list of unique command names`,
    );
  }
  if (value.settings !== undefined && !Array.isArray(value.settings)) {
    throw new Error(`Command ${value.name} settings must be an array`);
  }
  const settingNames = new Set<string>();
  for (const setting of value.settings ?? []) validateSetting(setting, value.name, settingNames);
}

function validateSetting(
  value: unknown,
  commandName: string,
  settingNames: Set<string>,
): asserts value is TalosSettingDefinition {
  if (!isRecord(value)) throw new Error(`Command ${commandName} contains an invalid setting`);
  if (!nonEmptyString(value.name) || !isIdentifier(value.name)) {
    throw new Error(
      `Setting names in ${commandName} must use lowercase letters, numbers, and hyphens`,
    );
  }
  if (settingNames.has(value.name))
    throw new Error(`Duplicate setting name in ${commandName}: ${value.name}`);
  settingNames.add(value.name);
  if (!nonEmptyString(value.displayName))
    throw new Error(`Setting ${value.name} needs a displayName`);
  if (!['text', 'password', 'number', 'boolean', 'select'].includes(String(value.type))) {
    throw new Error(`Setting ${value.name} has an unsupported type`);
  }
  if (value.required !== undefined && typeof value.required !== 'boolean') {
    throw new Error(`Setting ${value.name} required must be true or false`);
  }
  if (value.type === 'select') {
    if (
      !Array.isArray(value.options) ||
      value.options.length === 0 ||
      !value.options.every(nonEmptyString)
    ) {
      throw new Error(`Select setting ${value.name} needs at least one option`);
    }
    if (new Set(value.options).size !== value.options.length) {
      throw new Error(`Select setting ${value.name} contains duplicate options`);
    }
  } else if (value.options !== undefined) {
    throw new Error(`Only select settings can define options (${value.name})`);
  }
  if (value.defaultValue !== undefined && !defaultMatchesType(value)) {
    throw new Error(`Setting ${value.name} has a default value with the wrong type`);
  }
}

function defaultMatchesType(setting: Record<string, unknown>): boolean {
  switch (setting.type) {
    case 'number':
      return typeof setting.defaultValue === 'number' && Number.isFinite(setting.defaultValue);
    case 'boolean':
      return typeof setting.defaultValue === 'boolean';
    case 'select':
      return (
        typeof setting.defaultValue === 'string' &&
        Array.isArray(setting.options) &&
        setting.options.includes(setting.defaultValue)
      );
    case 'text':
    case 'password':
      return typeof setting.defaultValue === 'string';
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
