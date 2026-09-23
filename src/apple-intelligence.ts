/** A JavaScript tool Apple's on-device model can call while answering. */
export interface AppleIntelligenceTool {
  name: string;
  description: string;
  /** Receives a text argument and returns up to 8 KB of text. */
  call(input: string): string | Promise<string>;
}

/** Controls a single on-device Foundation Models session. */
export interface AppleIntelligenceOptions {
  /** Instructions for this session, separate from the user's prompt. */
  instructions?: string;
  tools?: readonly AppleIntelligenceTool[];
  /** Model randomness, between 0 and 1. */
  temperature?: number;
  /** Maximum tokens to generate, between 1 and 4096. */
  maximumResponseTokens?: number;
  /** Use the model tuned for short classification tasks. */
  useCase?: 'general' | 'contentTagging';
  /** Cancels the native request when aborted. */
  signal?: AbortSignal;
}

type RequestOptions = AppleIntelligenceOptions & { stream?: boolean };
type ModelRequest = (
  prompt: string,
  options: RequestOptions,
) => Promise<string> | AsyncIterable<string>;

/** Returns the complete answer. An array of tools remains accepted for compatibility. */
export function respondWithAppleIntelligence(
  prompt: string,
  options: AppleIntelligenceOptions | readonly AppleIntelligenceTool[] = {},
): Promise<string> {
  const settings = validate(prompt, options);
  return request()(prompt, settings) as Promise<string>;
}

/** Yields the latest complete text as it changes. Replace displayed text on each update. */
export function streamAppleIntelligence(
  prompt: string,
  options: AppleIntelligenceOptions = {},
): AsyncIterable<string> {
  const settings = validate(prompt, options);
  return request()(prompt, { ...settings, stream: true }) as AsyncIterable<string>;
}

function request(): ModelRequest {
  const handler = (globalThis as typeof globalThis & { [key: symbol]: ModelRequest | undefined })[
    Symbol.for('talos.modelRequest')
  ];
  if (!handler) throw new Error('Apple Intelligence requires a newer Talos app');
  return handler;
}

function validate(
  prompt: string,
  options: AppleIntelligenceOptions | readonly AppleIntelligenceTool[],
): AppleIntelligenceOptions {
  if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 16_384) {
    throw new TypeError('Model prompt must contain at most 16 KB of text');
  }
  const settings: AppleIntelligenceOptions = Array.isArray(options)
    ? { tools: options }
    : (options as AppleIntelligenceOptions);
  const tools = settings.tools ?? [];
  if (
    tools.length > 5 ||
    tools.some(
      (tool) =>
        !/^[a-z][a-zA-Z0-9]{0,63}$/.test(tool.name) ||
        typeof tool.description !== 'string' ||
        !tool.description.trim() ||
        Buffer.byteLength(tool.description) > 500 ||
        typeof tool.call !== 'function',
    ) ||
    new Set(tools.map((tool) => tool.name)).size !== tools.length
  )
    throw new TypeError('Invalid Apple Intelligence tools');
  if (
    settings.instructions !== undefined &&
    (typeof settings.instructions !== 'string' ||
      !settings.instructions.trim() ||
      Buffer.byteLength(settings.instructions) > 4096)
  ) {
    throw new TypeError('Model instructions must contain at most 4 KB of text');
  }
  if (
    settings.temperature !== undefined &&
    (!Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 1)
  ) {
    throw new TypeError('Model temperature must be between 0 and 1');
  }
  if (
    settings.maximumResponseTokens !== undefined &&
    (!Number.isInteger(settings.maximumResponseTokens) ||
      settings.maximumResponseTokens < 1 ||
      settings.maximumResponseTokens > 4096)
  ) {
    throw new TypeError('Maximum response tokens must be between 1 and 4096');
  }
  if (
    settings.useCase !== undefined &&
    settings.useCase !== 'general' &&
    settings.useCase !== 'contentTagging'
  ) {
    throw new TypeError('Invalid Apple Intelligence use case');
  }
  if (settings.signal !== undefined && !(settings.signal instanceof AbortSignal)) {
    throw new TypeError('Model signal must be an AbortSignal');
  }
  return settings;
}
