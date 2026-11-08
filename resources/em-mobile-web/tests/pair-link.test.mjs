// 短码查表契约（S1/S2）回归：
// · 真实加载 src/protocol/pairing.ts，注入 fetch stub 验证 #p= 短码解析、同源查表、404/过期/字段校验；
// · 静态读取 src/ui/App.tsx，验证「刷新后 fragment 仍在、仅配对成功后清除」及 handlePair 走查表。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

async function loadPairing() {
  const result = await build({
    stdin: {
      contents: `export * from './src/protocol/pairing.ts';`,
      resolveDir: root, sourcefile: 'entry.ts', loader: 'ts',
    },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const web = await loadPairing();

const FUTURE = Date.now() + 60_000;
const CODE = 'Ab3_xyZ9-0';
function makeOffer(overrides = {}) {
  return {
    version: 1, token: 'tk', pcId: 'pc1', pcName: 'host.local',
    addresses: ['192.168.1.5'], port: 47778, publicKey: 'AQID', expiresAt: FUTURE, ...overrides,
  };
}

/** 装一个 fetch stub，跑完（含异常）恢复，避免污染同进程其他用例。 */
async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = original; }
}
const okJson = (value) => async () => ({ ok: true, status: 200, json: async () => value });

// ── 短码格式 ──────────────────────────────────────────────────────────────
test('pairCodeFromHash：只认 10 位 [A-Za-z0-9_-] 短码 #p=', () => {
  assert.equal(web.pairCodeFromHash(`#p=${CODE}`), CODE);
  assert.equal(web.pairCodeFromHash('  #p=aZ09_-bX2q  '), 'aZ09_-bX2q', '允许首尾空白');
  assert.equal(web.pairCodeFromHash('#p=short'), null, '不足 10 位');
  assert.equal(web.pairCodeFromHash('#p=abcdefghijk'), null, '超过 10 位');
  assert.equal(web.pairCodeFromHash('#p=abc!efghij'), null, '非法字符');
  assert.equal(web.pairCodeFromHash('#p=Ab3_xyZ9-0&x=1'), null, '多段 query 不接受');
  assert.equal(web.pairCodeFromHash('#pair=legacy'), null, '旧 #pair= 长载荷不识别');
  assert.equal(web.pairCodeFromHash('#other=x'), null);
  assert.equal(web.pairCodeFromHash(''), null);
});

// ── 同源短码查表 ──────────────────────────────────────────────────────────
test('fetchPairingPayload：同源相对路径 ./pair/<code>.json + no-store + 成功解析对象', async () => {
  const offer = makeOffer();
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push({ url, init });
    return okJson(offer)();
  }, async () => {
    assert.deepEqual(await web.fetchPairingPayload(CODE), offer);
  });
  assert.deepEqual(calls.map((c) => c.url), [`./pair/${CODE}.json`]);
  assert.equal(calls[0].init.cache, 'no-store');
});

test('fetchPairingPayload：404 / 网络错误 → 「二维码已过期，请在电脑上重新生成」', async () => {
  await withFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }), async () => {
    await assert.rejects(web.fetchPairingPayload(CODE), /二维码已过期，请在电脑上重新生成/);
  });
  await withFetch(async () => { throw new Error('network down'); }, async () => {
    await assert.rejects(web.fetchPairingPayload(CODE), /二维码已过期，请在电脑上重新生成/);
  });
});

test('fetchPairingPayload / parsePairingObject：过期、字段缺失、空地址 → 中文文案', async () => {
  assert.deepEqual(web.parsePairingObject(makeOffer()), makeOffer());
  assert.throws(() => web.parsePairingObject(null), /配对二维码内容不完整/);
  assert.throws(() => web.parsePairingObject('not-object'), /配对二维码内容不完整/);
  assert.throws(() => web.parsePairingObject(makeOffer({ version: 2 })), /配对二维码内容不完整/);
  assert.throws(() => web.parsePairingObject(makeOffer({ port: 1.5 })), /配对二维码内容不完整/);
  assert.throws(() => web.parsePairingObject(makeOffer({ addresses: ['x', 3] })), /配对二维码内容不完整/);
  assert.throws(() => web.parsePairingObject(makeOffer({ addresses: [] })), /电脑没有可用的局域网地址/);
  // 200 但 body 过期 / 字段错：走 parsePairingObject 的文案
  await withFetch(okJson(makeOffer({ expiresAt: 1 })), async () => {
    await assert.rejects(web.fetchPairingPayload(CODE), /配对二维码已过期/);
  });
  await withFetch(okJson({ version: 2 }), async () => {
    await assert.rejects(web.fetchPairingPayload(CODE), /配对二维码内容不完整/);
  });
  await withFetch(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }), async () => {
    await assert.rejects(web.fetchPairingPayload(CODE), /配对二维码内容不完整/);
  });
});

test('parsePairingPayload(string) 旧长载荷兼容仍在', () => {
  const offer = makeOffer();
  const payload = Buffer.from(JSON.stringify(offer)).toString('base64url');
  assert.deepEqual(web.parsePairingPayload(payload), offer);
  assert.throws(() => web.parsePairingPayload('!!!'), /配对二维码内容不完整/);
});

// ── App 配对入口（静态源码断言，无 DOM 环境） ─────────────────
test('App：配对改由页面内签发，不再依赖 URL 里的 #p=', () => {
  const app = readFileSync(path.join(root, 'src/ui/App.tsx'), 'utf8');
  // iOS 从主屏启动会丢掉 #p=：只要配对依赖它，主屏那一次就永远配不上
  assert.doesNotMatch(app, /pairCodeFromHash/, '不应再从 hash 读短码');
  assert.match(app, /requestPairingPayload\(\)/, '「开始配对」要现场向电脑端要材料');
  assert.doesNotMatch(app, /pairPayloadFromHash|#pair=/, '不得残留旧长载荷解析');

  // 手输那条路仍然走短码查表
  assert.match(app, /await fetchPairingPayload\(code\)/, 'handlePair 先查表再 createPairingAttempt');

  // 配对成功后清掉残留的 fragment（扫码打开时 URL 里仍带着 #p=）
  const runPair = /const runPair = useCallback[\s\S]*?\n  \}, \[\]\);/.exec(app)?.[0] ?? '';
  assert.ok(runPair, '应能定位 runPair 块');
  const success = /try \{([\s\S]*?)\} catch/.exec(runPair)?.[1] ?? '';
  assert.match(success, /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/, '成功分支清掉残留 fragment');
});
