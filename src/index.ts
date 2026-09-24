export type TalosConfigValue = string | number | boolean;

/** Values configured by a user in Talos for a specific action tile. */
export type TalosConfig = Record<string, TalosConfigValue>;

/** Data Talos passes to an extension whenever an action is activated. */
export interface TalosContext<Config extends Record<keyof Config, TalosConfigValue> = TalosConfig> {
  action: string;
  config: Config;
  /** Files dropped on the wheel for this invocation. */
  files: TalosFile[];
}

export interface TalosFile {
  path: string;
  name: string;
  contentType: string;
}

export type Activate<Config extends Record<keyof Config, TalosConfigValue> = TalosConfig> = (
  context: TalosContext<Config>,
) => void | Promise<void>;

export type Deactivate = () => void | Promise<void>;

declare global {
  /** Show a native Talos alert and wait until the user dismisses it. */
  function alert(message?: unknown): Promise<void>;

  /** Show a native Talos confirmation and resolve with the user's choice. */
  function confirm(message?: unknown): Promise<boolean>;
}

export type TalosSettingType = 'text' | 'password' | 'number' | 'boolean' | 'select';

export interface TalosSettingDefinition {
  name: string;
  displayName: string;
  type: TalosSettingType;
  description?: string;
  /** Hint shown in an empty text, password, or number field; never saved as its value. */
  placeholder?: string;
  required?: boolean;
  defaultValue?: string | number | boolean;
  options?: string[];
}

export interface TalosActionDefinition {
  name: string;
  displayName: string;
  /** SF Symbol name used to represent this action in Talos. */
  icon?: string;
  description?: string;
  /** UTType identifiers, filename extensions such as ".md", or "*" for all files. */
  supportedFileTypes: string[];
  /** Command names shown as a wheel submenu. Referenced commands are hidden from the root palette. */
  subcommands?: string[];
  settings?: TalosSettingDefinition[];
}

export interface TalosPackageConfiguration {
  bundleId: string;
  entry: string;
  locales: Record<string, string>;
  /** @deprecated Import .tsx components and pass children to openWindow instead. */
  windows?: Record<string, string>;
}

export type { TextParameters } from './localization.js';
export { t } from './localization.js';
export type {
  AppleIntelligenceOptions,
  AppleIntelligenceTool,
  RunAppleScriptOptions,
  RunAppleScriptOutput,
  TalosWindowOptions,
} from './runtime.js';
export {
  done,
  failed,
  loading,
  openWindow,
  respondWithAppleIntelligence,
  streamAppleIntelligence,
  success,
  talos,
  toast,
} from './runtime.js';
