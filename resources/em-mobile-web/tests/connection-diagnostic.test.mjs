import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const result = await build({ stdin: { contents: "export * from './src/core/connection-diagnostic.ts'", resolveDir: root, sourcefile: 'entry.ts', loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const { measureConnection, captureChatFrames } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('按需测量三次请求，只返回耗时', async () => {
  let calls = 0;
  const samples = await measureConnection(async () => { calls++; return { privateData: 'ignored' }; });
  assert.equal(calls, 3);
  assert.equal(samples.length, 3);
  assert.ok(samples.every(value => Number.isFinite(value) && value >= 0));
});

test('请求失败时停止检测并向调用方报告', async () => {
  let calls = 0;
  await assert.rejects(measureConnection(async () => { calls++; throw new Error('offline'); }), /offline/);
  assert.equal(calls, 1);
});

test('只统计聊天可见期间的帧，并记录超过 50ms 的间隔', async () => {
  const oldRaf = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  let next, visible = false;
  globalThis.requestAnimationFrame = cb => { next = cb; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    captureChatFrames(() => visible, finish, 20);
    next(0); visible = true; next(10); next(26); next(106); visible = false; next(200);
    const result = await done;
    assert.equal(result.frames, 2);
    assert.equal(result.slowFrames, 1);
    assert.equal(result.seconds, 0.096);
  } finally { globalThis.requestAnimationFrame = oldRaf; globalThis.cancelAnimationFrame = oldCancel; }
});
