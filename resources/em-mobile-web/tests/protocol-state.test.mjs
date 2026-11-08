// 会话级状态与接收序号的最小输入回归（清单1/2/8）。
// · 用真实 RemoteClient.handleMessage 构造「错序 / 回退 / 非整数」序号，证明会 close(1008)；
// · 用 esbuild + react stub 加载真实 useRemoteEvents.ts，注入两个会话交错事件，
//   证明 patchRuntime 一律按事件自己的 sessionId 落格、不按「当前会话」过滤；
// · 用真实 snapshotMessagesWithBuffer 证明 eventSequence 游标补齐与同序号去重。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { snapshotMessagesWithBuffer } from '../src/core/messages.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

async function bundle(entry, plugins = []) {
  const result = await build({
    stdin: { contents: `export * from './${entry}';`, resolveDir: root, sourcefile: 'entry.ts', loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', plugins,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

// ── 接收序号 ──────────────────────────────────────────────────────────────
const { RemoteClient } = await bundle('src/protocol/remote-client.ts');

function clientWithSequence(receiveSequence) {
  const client = new RemoteClient({
    version: 1, pcId: 'pc', pcName: 'host', addresses: ['127.0.0.1'], port: 47778,
    deviceId: 'web-unit', deviceName: 'Web', sharedSecret: Buffer.alloc(32, 7).toString('base64'),
  });
  client.connectionId = 'conn-unit';
  client.receiveSequence = receiveSequence;
  const closes = [];
  client.socket = { readyState: 1, close: (code, reason) => closes.push({ code, reason }) };
  return { client, closes };
}

function encrypted(sequence) {
  return { data: JSON.stringify({ type: 'mobile-encrypted', sequence, iv: '', tag: '', data: '' }) };
}

test('接收序号跳跃（2 而期望 1）→ close(1008, invalid sequence)', () => {
  const { client, closes } = clientWithSequence(0);
  client.handleMessage(encrypted(2));
  assert.deepEqual(closes, [{ code: 1008, reason: 'invalid sequence' }]);
});

test('接收序号回退（重复 5）→ close(1008, invalid sequence)', () => {
  const { client, closes } = clientWithSequence(5);
  client.handleMessage(encrypted(5));
  assert.deepEqual(closes, [{ code: 1008, reason: 'invalid sequence' }]);
});

test('接收序号非整数 → close(1008, invalid sequence)', () => {
  const { client, closes } = clientWithSequence(0);
  client.handleMessage(encrypted('nope'));
  assert.deepEqual(closes, [{ code: 1008, reason: 'invalid sequence' }]);
});

test('正确序号不会因「序号」被关闭（会走到解密失败，而非 invalid sequence）', () => {
  const { client, closes } = clientWithSequence(0);
  client.handleMessage(encrypted(1));
  assert.equal(closes.length, 1);
  assert.notEqual(closes[0].reason, 'invalid sequence', '序号合法时不应触发序号关闭');
  assert.equal(client.receiveSequence, 0, '解密失败不得推进接收序号');
});

// ── 两个会话交错事件：只按事件自己的 sessionId 落格 ────────────────────────
const reactStub = `
export function useRef(init) { return { current: init }; }
export function useLayoutEffect(fn) { fn(); }
export function useEffect(fn) { return fn(); }
`;
const stubPlugin = {
  name: 'react-stub',
  setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react-stub', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: reactStub, loader: 'js' }));
  },
};
const { useRemoteEvents } = await bundle('src/core/useRemoteEvents.ts', [stubPlugin]);

test('两会话交错事件：patchRuntime 一律按事件自己的 sessionId 落格', () => {
  let emit = null;
  const client = { onEvent: (cb) => { emit = cb; return () => { emit = null; }; } };
  const patched = [];
  const statuses = [];
  const store = {
    patchRuntime: (sid, patch) => patched.push({ sid, patch }),
    setMintStatus: (sid, value) => statuses.push({ sid, value }),
    syncBackground: () => undefined,
    emitShellChunk: () => undefined,
  };
  useRemoteEvents({
    client, deviceId: 'web-unit', page: 'chat', project: { id: 'p', name: 'P', status: 'development' },
    session: { sessionId: 'sA', title: 'A', createdAt: 0, updatedAt: 0 }, // 当前显示的是 sA
    streamMessageIds: { current: {} }, activeTurn: { current: {} },
    refreshHome: () => undefined, refreshProjects: () => undefined, refreshSessions: () => undefined,
    store,
  });
  assert.equal(typeof emit, 'function', '应注册到 client.onEvent');

  // 交错：A、B、B、A。若实现按「当前会话」写，这四条都会落进 sA。
  emit({ channel: 'agent:context-usage', data: { percentage: 11 } }, { sessionId: 'sA' });
  emit({ channel: 'agent:context-usage', data: { percentage: 22 } }, { sessionId: 'sB' });
  emit({ channel: 'agent:stream', data: { type: 'turn_start' } }, { sessionId: 'sB' });
  emit({ channel: 'agent:context-usage', data: { percentage: 33 } }, { sessionId: 'sA' });

  assert.deepEqual(patched.map((p) => p.sid), ['sA', 'sB', 'sB', 'sA'],
    '写入目标必须是事件自己的会话 id，不得被当前显示会话覆盖');
  assert.deepEqual(patched[1].patch, { contextUsage: { percent: 22, maxTokens: undefined } });
  assert.deepEqual(patched[3].patch, { contextUsage: { percent: 33, maxTokens: undefined } });
  // status 也按会话分开：turn_start 属于 sB，不应出现在 sA 的状态格里
  assert.deepEqual(statuses.map((s) => s.sid), ['sB']);

  // 没有 sessionId 的会话级事件必须丢弃，宁可不动也不写错会话
  const before = patched.length;
  emit({ channel: 'agent:context-usage', data: { percentage: 99 } }, {});
  assert.equal(patched.length, before, '无 sessionId 的事件不得落格');
});

// ── 快照按 eventSequence 补齐 ─────────────────────────────────────────────
test('snapshotMessagesWithBuffer：只补游标之后的实时帧', () => {
  const snap = {
    messages: [], pendingAsks: [], bufferedEvents: [], session: { title: 'x' }, status: 'running',
    eventSequence: 10, thinking: { level: 'medium' }, cache: {},
  };
  const during = [
    { type: 'message', eventSequence: 9, blocks: [{ type: 'text', text: 'STALE' }], partial: false },
    { type: 'message', eventSequence: 11, blocks: [{ type: 'text', text: 'FRESH' }], partial: true },
  ];
  const { messages } = snapshotMessagesWithBuffer(snap, during);
  assert.equal(messages.length, 1, '游标 10 之前的帧（9）必须被丢弃');
  assert.equal(messages[0].blocks[0].text, 'FRESH');
  assert.ok(!JSON.stringify(messages).includes('STALE'));
});

test('snapshotMessagesWithBuffer：buffered 与实时流同一 eventSequence 去重', () => {
  const frame = { type: 'message', eventSequence: 11, blocks: [{ type: 'text', text: 'DUP' }], partial: true };
  const snap = {
    messages: [], pendingAsks: [], bufferedEvents: [frame], session: { title: 'x' }, status: 'running',
    eventSequence: 10, thinking: { level: 'medium' }, cache: {},
  };
  const { messages } = snapshotMessagesWithBuffer(snap, [{ ...frame }]);
  assert.equal(messages.length, 1, '同一应用事件序号只保留一份，避免重复气泡');
});

test('snapshotMessagesWithBuffer：对端不带 bufferedEvents 时不白屏', () => {
  const snap = { messages: [], pendingAsks: [], session: { title: 'x' }, status: 'idle', eventSequence: 3 };
  const { messages, running } = snapshotMessagesWithBuffer(snap, []);
  assert.deepEqual(messages, []);
  assert.equal(running, false);
});
