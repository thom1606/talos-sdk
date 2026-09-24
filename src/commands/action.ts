import { join } from 'node:path';
import { checkbox, confirm, input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import type { TalosActionDefinition, TalosSettingDefinition, TalosSettingType } from '../index.js';
import { writeJsonFile } from '../lib/json.js';
import { isIdentifier } from '../lib/names.js';
import { type TalosPackageJson, validatePackage } from '../lib/package.js';
import { readProjectPackage } from '../lib/project.js';

const FILE_TYPES = [
  { name: 'Any file or folder', value: 'public.item' },
  { name: 'Folder', value: 'public.folder' },
  { name: 'Image', value: 'public.image' },
  { name: 'Video', value: 'public.movie' },
  { name: 'Audio', value: 'public.audio' },
  { name: 'Plain text', value: 'public.plain-text' },
  { name: 'PDF', value: 'com.adobe.pdf' },
  { name: 'Archive', value: 'public.archive' },
];

export async function runAction(): Promise<void> {
  const root = process.cwd();
  const packageJson = await readProjectPackage(root, 'action');
  const action = await promptForAction();
  await addActionToProject(root, packageJson, action);
  console.log(
    chalk.green('Added action'),
    chalk.bold(action.displayName),
    chalk.dim(`(${action.name})`),
  );
}

async function addActionToProject(
  root: string,
  packageJson: TalosPackageJson,
  action: TalosActionDefinition,
): Promise<void> {
  const packagePath = join(root, 'package.json');
  if (packageJson.commands.some((command) => command.name === action.name)) {
    throw new Error(`An action named "${action.name}" already exists`);
  }

  const updatedPackage: TalosPackageJson = {
    ...packageJson,
    commands: [...packageJson.commands, action],
  };
  validatePackage(updatedPackage);
  await writeJsonFile(packagePath, updatedPackage);
}

async function promptForAction(): Promise<TalosActionDefinition> {
  const name = await input({
    message: 'Action name',
    validate: (value) =>
      isIdentifier(value) ||
      'Use lowercase letters, numbers, and hyphens (starting with a letter).',
  });
  const displayName = await input({
    message: 'Display name',
    default: name
      .split('-')
      .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
      .join(' '),
    validate: (value) => value.trim().length > 0 || 'Enter a display name.',
  });
  const icon = await input({
    message: 'SF Symbol icon (optional)',
  });
  const description = await input({ message: 'Description (optional)' });
  const selectedFileTypes = await checkbox({
    message: 'Supported file types',
    choices: FILE_TYPES,
    required: true,
  });
  const customFileTypes = await input({
    message: 'Additional UTTypes or extensions like .md, separated by commas (optional)',
  });
  const supportedFileTypes = [
    ...selectedFileTypes,
    ...customFileTypes
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ].filter((value, index, values) => values.indexOf(value) === index);

  const settings: TalosSettingDefinition[] = [];
  while (await confirm({ message: 'Add a setting?', default: false })) {
    settings.push(await promptForSetting(settings));
  }

  return {
    name,
    displayName: displayName.trim(),
    ...(icon.trim() ? { icon: icon.trim() } : {}),
    ...(description.trim() ? { description: description.trim() } : {}),
    supportedFileTypes,
    settings,
  };
}

async function promptForSetting(
  existing: TalosSettingDefinition[],
): Promise<TalosSettingDefinition> {
  const name = await input({
    message: 'Setting name',
    validate: (value) => {
      if (!isIdentifier(value)) return 'Use lowercase letters, numbers, and hyphens.';
      return !existing.some((setting) => setting.name === value) || 'That setting already exists.';
    },
  });
  const displayName = await input({
    message: 'Setting display name',
    validate: (value) => value.trim().length > 0 || 'Enter a display name.',
  });
  const type = await select<TalosSettingType>({
    message: 'Setting type',
    choices: [
      { name: 'Text', value: 'text' },
      { name: 'Password', value: 'password' },
      { name: 'Number', value: 'number' },
      { name: 'On/off', value: 'boolean' },
      { name: 'Selection', value: 'select' },
    ],
  });
  const description = await input({ message: 'Setting description (optional)' });
  const placeholder = ['text', 'password', 'number'].includes(type)
    ? await input({ message: 'Placeholder (optional)' })
    : undefined;
  const required = await confirm({ message: 'Required?', default: false });
  const options = type === 'select' ? await promptForOptions() : undefined;
  const defaultValue = await promptForDefault(type, options);

  return {
    name,
    displayName: displayName.trim(),
    type,
    ...(description.trim() ? { description: description.trim() } : {}),
    ...(placeholder?.trim() ? { placeholder: placeholder.trim() } : {}),
    ...(required ? { required: true } : {}),
    ...(defaultValue === undefined ? {} : { defaultValue }),
    ...(options ? { options } : {}),
  };
}

async function promptForOptions(): Promise<string[]> {
  const value = await input({
    message: 'Options, separated by commas',
    validate: (answer) =>
      answer.split(',').some((option) => option.trim()) || 'Enter at least one option.',
  });
  return value
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);
}

async function promptForDefault(
  type: TalosSettingType,
  options?: string[],
): Promise<string | number | boolean | undefined> {
  if (type === 'password') return undefined;
  if (!(await confirm({ message: 'Set a default value?', default: false }))) return undefined;
  if (type === 'boolean') return confirm({ message: 'Default value', default: false });
  if (type === 'select') {
    return select({
      message: 'Default value',
      choices: (options ?? []).map((option) => ({ name: option, value: option })),
    });
  }
  if (type === 'number') {
    const value = await input({
      message: 'Default value',
      validate: (answer) => Number.isFinite(Number(answer)) || 'Enter a number.',
    });
    return Number(value);
  }
  return input({ message: 'Default value' });
}
