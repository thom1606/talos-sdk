import { spawn } from 'node:child_process';
import { operationSignal } from './operation-signal.js';

export interface RunProcessOptions {
  signal?: AbortSignal;
  /** Defaults to 30 seconds. Must be a positive finite number. */
  timeout?: number;
  /** Maximum captured stdout in bytes. Defaults to 1 MiB. */
  maximumOutputBytes?: number;
  cwd?: string;
  /** Optional UTF-8 input written to stdin. */
  input?: string;
}

export interface ProcessOutput {
  stdout: string;
  stderr: string;
  error?: Error;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

/** Run an executable without a shell, with bounded output and cancellation of its process group. */
export async function runProcess(
  executable: string,
  arguments_: readonly string[] = [],
  options: RunProcessOptions = {},
): Promise<string> {
  if (options.timeout === 0) throw new TypeError('Process timeout must be a positive number');
  const result = await executeProcess(executable, arguments_, options);
  if (result.error) throw result.error;
  return result.stdout;
}

/** Shared execution path; AppleScript retains its legacy structured result and zero timeout. */
export async function executeProcess(
  executable: string,
  arguments_: readonly string[] = [],
  options: RunProcessOptions = {},
): Promise<ProcessOutput> {
  const timeout = options.timeout ?? 30_000;
  const maximumOutputBytes = options.maximumOutputBytes ?? 1_048_576;
  if (
    !executable ||
    executable.includes('\0') ||
    !arguments_.every((value) => typeof value === 'string')
  ) {
    throw new TypeError('Provide an executable and an array of string arguments');
  }
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 2_147_483_647) {
    throw new TypeError('Process timeout must be a positive number no greater than 2147483647 ms');
  }
  if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 1) {
    throw new TypeError('maximumOutputBytes must be a positive safe integer');
  }
  const signal = operationSignal(options.signal);
  signal?.throwIfAborted();

  return new Promise<ProcessOutput>((resolve) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(executable, [...arguments_], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      detached: grouped,
      shell: false,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let stderr = Buffer.alloc(0);
    let failure: Error | undefined;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const kill = (kind: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (grouped) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= error as Error;
      }
    };
    const stop = () => {
      kill('SIGTERM');
      killTimer ??= setTimeout(() => kill('SIGKILL'), 250);
    };
    const abort = () => {
      failure ??= new DOMException('The process was aborted', 'AbortError');
      stop();
    };
    const deadline =
      timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            failure ??= new Error(`Process timed out after ${timeout} ms`);
            stop();
          }, timeout)
        : undefined;
    signal?.addEventListener('abort', abort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maximumOutputBytes) {
        failure ??= new Error(`Process output exceeded ${maximumOutputBytes} bytes`);
        stop();
      } else chunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk.subarray(-8192)]).subarray(-8192);
    });
    child.once('error', (error) => {
      failure ??= error;
    });
    // A worker must not outlive the command, even if the main executable exits first.
    child.once('exit', stop);
    child.once('close', (code, exitSignal) => {
      if (deadline) clearTimeout(deadline);
      if (killTimer) clearTimeout(killTimer);
      // Detached descendants may close their pipes but keep running after SIGTERM.
      kill('SIGKILL');
      signal?.removeEventListener('abort', abort);
      if (!failure && code !== 0)
        failure = new Error(stderr.toString('utf8').trim() || `Process exited with code ${code}`);
      resolve({
        stdout: Buffer.concat(chunks).toString('utf8'),
        stderr: stderr.toString('utf8'),
        ...(failure ? { error: failure } : {}),
        exitCode: code,
        signal: exitSignal,
        timedOut,
      });
    });
    if (options.input !== undefined) {
      child.stdin?.once('error', (error) => {
        failure ??= error;
        stop();
      });
      child.stdin?.end(options.input);
    }
    // Cancellation can arrive between spawning and registering the listener.
    if (signal?.aborted) abort();
  });
}
