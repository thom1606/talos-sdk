import { spawn } from 'node:child_process';
import type { ReactNode } from 'react';
import { activationContext } from './activation-context.js';
import { reactWindowPage, serializeWindowTree } from './window-tree.js';

/** A native preview window containing Markdown or React components. */
export interface TalosWindowOptions {
  title: string;
  /** JSX containing imported .tsx components and serializable props. */
  children?: ReactNode;
  /** Markdown rendered with native typography. Use children for interactive React content. */
  content?: string;
  /** @deprecated Use children with an imported React component. */
  page?: string;
  /** @deprecated Pass props to children; activation data is available through useTalos(). */
  data?: unknown;
  width?: number;
  height?: number;
}

interface RuntimeMessage {
  protocol: 'talos';
  version: 1;
  method: 'loading' | 'toast' | 'success' | 'failed' | 'done' | 'openWindow';
  parameters: Record<string, unknown>;
}

export interface RunAppleScriptOutput {
  stdout: string;
  stderr: string;
  error?: Error;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  command: string;
}

export interface RunAppleScriptOptions<Result = string> {
  humanReadableOutput?: boolean;
  language?: 'AppleScript' | 'JavaScript';
  signal?: AbortSignal;
  timeout?: number;
  parseOutput?: (output: RunAppleScriptOutput) => Result;
}

/** Show a loading toast until another toast state replaces it. */
export function loading(message: string): void {
  sendToastMessage('loading', message);
}

/** Show a short informational toast just above the Dock. */
export function toast(message: string): void {
  sendToastMessage('toast', message);
}

/** Replace the active toast with a successful result. */
export function success(message: string): void {
  sendToastMessage('success', message);
}

/** Replace the active toast with a failed result. */
export function failed(message: string): void {
  sendToastMessage('failed', message);
}

/** Dismiss the active toast without showing a final state. */
export function done(): void {
  sendRuntimeMessage({
    protocol: 'talos',
    version: 1,
    method: 'done',
    parameters: {},
  });
}

/** Open a native preview window with React children or Markdown content. */
export function openWindow(options: TalosWindowOptions): void {
  requireNonEmpty(options.title, 'Window title');
  const hasChildren = options.children !== undefined;
  if (
    hasChildren &&
    (options.page !== undefined || options.content !== undefined || options.data !== undefined)
  ) {
    throw new Error('Use children with component props, or page/content with data, not both');
  }
  const tree = hasChildren ? serializeWindowTree(options.children) : undefined;
  if (hasChildren) {
    // The builder supplies the browser entrypoint automatically.
  } else if (options.page !== undefined) {
    if (!/^[a-z][a-z0-9-]*$/.test(options.page)) throw new Error('Invalid window page name');
    if (options.content !== undefined) throw new Error('Use page or content, not both');
  } else {
    requireNonEmpty(options.content ?? '', 'Window content');
  }
  validateDimension(options.width, 'Window width');
  validateDimension(options.height, 'Window height');
  const context = activationContext();

  sendRuntimeMessage({
    protocol: 'talos',
    version: 1,
    method: 'openWindow',
    parameters: {
      title: options.title,
      content: options.content,
      page: hasChildren ? reactWindowPage : options.page,
      width: options.width,
      height: options.height,
      dataJSON: JSON.stringify(hasChildren ? { tree } : (options.data ?? null)),
      contextJSON: JSON.stringify(context),
      filePaths: context.files.map((file) => file.path),
    },
  });
}

/** Execute AppleScript or JavaScript for Automation on macOS. */
function runAppleScript<Result = string>(
  script: string,
  options?: RunAppleScriptOptions<Result>,
): Promise<Result>;
function runAppleScript<Result = string>(
  script: string,
  arguments_: string[],
  options?: RunAppleScriptOptions<Result>,
): Promise<Result>;
async function runAppleScript<Result = string>(
  script: string,
  argumentsOrOptions: string[] | RunAppleScriptOptions<Result> = {},
  providedOptions: RunAppleScriptOptions<Result> = {},
): Promise<Result> {
  requireNonEmpty(script, 'AppleScript');

  const arguments_ = Array.isArray(argumentsOrOptions) ? argumentsOrOptions : [];
  const options = Array.isArray(argumentsOrOptions) ? providedOptions : argumentsOrOptions;
  if (!arguments_.every((argument) => typeof argument === 'string')) {
    throw new TypeError('AppleScript arguments must be strings');
  }

  const timeout = options.timeout ?? 10_000;
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new TypeError('AppleScript timeout must be zero or a positive number');
  }

  const language = options.language ?? 'AppleScript';
  if (language !== 'AppleScript' && language !== 'JavaScript') {
    throw new TypeError('AppleScript language must be AppleScript or JavaScript');
  }

  const output = await executeAppleScript(script, arguments_, {
    humanReadableOutput: options.humanReadableOutput ?? true,
    language,
    ...(options.signal ? { signal: options.signal } : {}),
    timeout,
  });

  if (options.parseOutput) {
    return options.parseOutput(output);
  }
  if (output.error) {
    throw output.error;
  }

  return output.stdout as Result;
}

/** Native Talos presentation APIs available to an activated extension. */
export const talos = Object.freeze({
  loading,
  toast,
  success,
  failed,
  done,
  openWindow,
  runAppleScript,
});

interface AppleScriptExecutionOptions {
  humanReadableOutput: boolean;
  language: 'AppleScript' | 'JavaScript';
  signal?: AbortSignal;
  timeout: number;
}

function executeAppleScript(
  script: string,
  arguments_: string[],
  options: AppleScriptExecutionOptions,
): Promise<RunAppleScriptOutput> {
  const executable = '/usr/bin/osascript';
  const outputStyle = options.humanReadableOutput ? 'h' : 's';
  const processArguments = ['-l', options.language, '-s', outputStyle, '-', ...arguments_];

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }

    const child = spawn(executable, processArguments, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let bufferExceeded = false;
    let settled = false;
    const maximumOutputLength = 1_048_576;

    const appendOutput = (current: string, chunk: string): string => {
      const output = current + chunk;
      if (output.length > maximumOutputLength) {
        bufferExceeded = true;
        child.kill('SIGTERM');
      }
      return output;
    };

    child.stdout.on('data', (chunk: string) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = appendOutput(stderr, chunk);
    });

    const timeoutHandle =
      options.timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
          }, options.timeout)
        : undefined;

    const handleAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
    };
    options.signal?.addEventListener('abort', handleAbort, { once: true });

    const finish = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      processError?: Error,
    ) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      options.signal?.removeEventListener('abort', handleAbort);

      const cleanStdout = stripFinalNewline(stdout);
      const cleanStderr = stripFinalNewline(stderr);
      let error = processError;
      if (!error && aborted) {
        error = abortError();
      } else if (!error && timedOut) {
        error = new Error(`AppleScript execution timed out after ${options.timeout}ms`);
      } else if (!error && bufferExceeded) {
        error = new Error('AppleScript output exceeded 1 MB');
      } else if (!error && exitCode !== 0) {
        error = new Error(cleanStderr || `AppleScript exited with code ${exitCode ?? 'unknown'}`);
      }

      resolve({
        stdout: cleanStdout,
        stderr: cleanStderr,
        ...(error ? { error } : {}),
        exitCode,
        signal,
        timedOut,
        command: executable,
      });
    };

    child.once('error', (error) => finish(null, null, error));
    child.once('close', (exitCode, signal) => finish(exitCode, signal));
    child.stdin.end(script);
  });
}

function sendRuntimeMessage(message: RuntimeMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendToastMessage(
  method: 'loading' | 'toast' | 'success' | 'failed',
  message: string,
): void {
  requireNonEmpty(message, 'Toast message');

  sendRuntimeMessage({
    protocol: 'talos',
    version: 1,
    method,
    parameters: { message },
  });
}

function requireNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} cannot be empty`);
}

function validateDimension(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`${label} must be a positive number`);
  }
}

function stripFinalNewline(value: string): string {
  return value.endsWith('\r\n') ? value.slice(0, -2) : value.replace(/\n$/, '');
}

function abortError(): Error {
  const error = new Error('AppleScript execution was aborted');
  error.name = 'AbortError';
  return error;
}
