import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { access, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { defineAction, defineActions } from '../dist/index.js';
import { runProcess, writeOutput } from '../dist/node.js';

async function temporary(run) {
  const directory = await mkdtemp(join(tmpdir(), 'talos-sdk-test-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function waitFor(path) {
  for (let i = 0; i < 100; i++) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      await delay(20);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}
function stopped(pid) {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

test('processes receive literal arguments without a shell and release abort listeners', async () => {
  const controller = new AbortController();
  for (let i = 0; i < 10; i++) {
    const args = ['a b', '$(echo unsafe)', 'héllo'];
    const output = await runProcess(
      process.execPath,
      ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...args],
      { signal: controller.signal },
    );
    assert.deepEqual(JSON.parse(output), args);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
  await assert.rejects(runProcess('/no-such-talos-executable', [], { signal: controller.signal }), {
    code: 'ENOENT',
  });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('output limits count bytes and failures retain a bounded diagnostic', async () => {
  await assert.rejects(
    runProcess(process.execPath, ['-e', "process.stdout.write('é'.repeat(100))"], {
      maximumOutputBytes: 150,
    }),
    /exceeded 150 bytes/,
  );
  await assert.rejects(
    runProcess(process.execPath, [
      '-e',
      "process.stderr.write('x'.repeat(20000)); process.exit(2)",
    ]),
    (error) => error.message.length === 8192,
  );
  await assert.rejects(runProcess(process.execPath, [], { timeout: 0 }), /timeout/);
});

test('abort and timeout stop a resistant process and its descendant before returning', async () => {
  await temporary(async (directory) => {
    for (const mode of ['abort', 'timeout']) {
      const marker = join(directory, mode);
      const controller = new AbortController();
      const source = `const {spawn}=require('node:child_process');const fs=require('node:fs');
        const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
        fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,child.pid]));
        process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
      const running = runProcess(process.execPath, ['-e', source], {
        signal: controller.signal,
        timeout: mode === 'timeout' ? 350 : 5000,
      });
      const rejection = assert.rejects(
        running,
        mode === 'abort' ? { name: 'AbortError' } : /timed out/,
      );
      const pids = JSON.parse(await waitFor(marker));
      if (mode === 'abort') controller.abort();
      await rejection;
      await delay(100); // Let launchd reap a detached grandchild on macOS.
      for (const pid of pids) stopped(pid);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    }
  });
});

test('Node helpers inherit the active invocation cancellation', async () => {
  const controller = new AbortController();
  const key = Symbol.for('talos.activationContext');
  globalThis[key] = () => ({ action: 'example', config: {}, files: [], signal: controller.signal });
  try {
    const running = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
    const rejection = assert.rejects(running, { name: 'AbortError' });
    controller.abort();
    await rejection;
  } finally {
    delete globalThis[key];
  }
});

test('concurrent outputs preserve originals, use unique names and remove staging', async () => {
  await temporary(async (directory) => {
    const file = {
      path: join(directory, 'input.txt'),
      name: 'input.txt',
      contentType: 'public.text',
    };
    await writeFile(file.path, 'original');
    await writeFile(join(directory, 'input-result.txt'), 'existing');
    const paths = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        writeOutput(file, { suffix: '-result', extension: 'txt' }, (path) =>
          writeFile(path, String(i)),
        ),
      ),
    );
    assert.equal(new Set(paths).size, 20);
    assert.deepEqual(
      new Set(await Promise.all(paths.map((path) => readFile(path, 'utf8')))),
      new Set(Array.from({ length: 20 }, (_, i) => String(i))),
    );
    assert.equal(await readFile(file.path, 'utf8'), 'original');
    assert.equal(await readFile(join(directory, 'input-result.txt'), 'utf8'), 'existing');
    assert.ok((await readdir(directory)).every((name) => !name.startsWith('.talos-')));
  });
});

test('cancelled, failed, discarded and symlink outputs are never published', async () => {
  await temporary(async (directory) => {
    const file = {
      path: join(directory, 'input.txt'),
      name: 'input.txt',
      contentType: 'public.text',
    };
    await writeFile(file.path, 'original');
    const options = { suffix: '-result', extension: 'txt' };
    await assert.rejects(
      writeOutput(file, options, async (path) => {
        await writeFile(path, 'partial');
        throw new Error('failed');
      }),
      /failed/,
    );
    const controller = new AbortController();
    await assert.rejects(
      writeOutput(file, { ...options, signal: controller.signal }, async (path) => {
        await writeFile(path, 'partial');
        controller.abort();
      }),
      { name: 'AbortError' },
    );
    assert.equal(await writeOutput(file, options, async () => false), null);
    await assert.rejects(
      writeOutput(file, options, (path) => symlink(file.path, path)),
      /regular file/,
    );
    await assert.rejects(
      writeOutput(file, { ...options, suffix: '/../escape' }, async () => {}),
      /path separators/,
    );
    assert.deepEqual(await readdir(directory), ['input.txt']);
    await access(file.path);
  });
});

test('registered actions reject inherited names and validate config before running', async () => {
  let ran = false;
  const activate = defineActions({
    resize: defineAction(
      (values) => {
        if (typeof values.width !== 'number') throw new TypeError('width must be a number');
        return { width: values.width };
      },
      (context) => {
        assert.equal(context.config.width, 20);
        ran = true;
      },
    ),
  });
  const context = {
    action: 'resize',
    config: { width: 20 },
    files: [],
    signal: new AbortController().signal,
  };
  await activate(context);
  assert.ok(ran);
  ran = false;
  await assert.rejects(activate({ ...context, config: { width: '20' } }), /number/);
  assert.equal(ran, false);
  await assert.rejects(activate({ ...context, action: 'constructor' }), /Unknown Talos action/);
  await assert.rejects(activate({ ...context, signal: AbortSignal.abort() }), {
    name: 'AbortError',
  });
});

test('stdin streams into the process', async () => {
  const input = 'héllo from stdin';
  assert.equal(
    await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input }),
    input,
  );
});

test('AppleScript keeps its structured parser contract', {
  skip: process.platform !== 'darwin',
}, async () => {
  const { talos } = await import('../dist/index.js');
  const output = await talos.runAppleScript('return "héllo"', { parseOutput: (value) => value });
  assert.equal(output.stdout, 'héllo');
  assert.equal(output.exitCode, 0);
  assert.equal(output.error, undefined);
  assert.equal(output.timedOut, false);
  await assert.rejects(talos.runAppleScript('delay 10', { timeout: 100 }), /timed out/);
});
