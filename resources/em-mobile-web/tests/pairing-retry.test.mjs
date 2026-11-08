// 配对体验回归（P2）：验证码必须先于连接算出、连接失败后保留、重试复用同一份配对材料。
// 这里用 esbuild 加载**本项目真实 src/protocol/remote-client.ts**，注入可控的 WebSocket stub，
// 走真实运行时路径（不复用 crypto-interop.test.mjs 的任何辅助代码）。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

async function loadRemoteClient() {
  const result = await build({
    stdin: {
      contents: `export * from './src/protocol/remote-client.ts';`,
      resolveDir: root, sourcefile: 'entry.ts', loader: 'ts',
    },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/** 造一个带合法 P-256 公钥的 offer（PC 侧公钥，手机用它算 sharedSecret）。 */
function makeOffer() {
  const pc = crypto.createECDH('prime256v1');
  pc.generateKeys();
  return {
    version: 1, token: 'tok-unit', pcId: 'pc-unit', pcName: 'host.local',
    addresses: ['192.168.1.50'], port: 47778,
    publicKey: pc.getPublicKey('base64'),
    expiresAt: Date.now() + 60_000,
  };
}

/**
 * 安装 WebSocket stub：
 *  - unreachable：建连立刻 onerror，模拟「WS 不可达 / 先开手机后开电脑」
 *  - accept：建连成功，并在收到 mobile-pair-init 后回一个 proof 正确的 mobile-pair-accepted
 */
function installWebSocket(mode, ctx) {
  const sent = [];
  class FakeWebSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) {
      this.url = url; this.readyState = 0;
      this.onopen = null; this.onerror = null; this.onmessage = null; this.onclose = null;
      queueMicrotask(() => {
        if (mode === 'unreachable') { this.readyState = 3; this.onerror?.(new Error('down')); }
        else { this.readyState = 1; this.onopen?.(); }
      });
    }
    send(data) {
      const message = JSON.parse(data);
      sent.push(message);
      if (mode === 'accept' && message.type === 'mobile-pair-init') {
        const proof = crypto.createHmac('sha256', Buffer.from(ctx.attempt.keys.auth))
          .update(`pair-accepted:${ctx.offer.token}:${ctx.attempt.deviceId}`, 'utf8')
          .digest('base64');
        queueMicrotask(() => this.onmessage?.({
          data: JSON.stringify({ type: 'mobile-pair-accepted', pcId: ctx.offer.pcId, proof }),
        }));
      }
    }
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = FakeWebSocket;
  return sent;
}

const web = await loadRemoteClient();
const originalWebSocket = globalThis.WebSocket;
test.after(() => { globalThis.WebSocket = originalWebSocket; });

test('createPairingAttempt：验证码是 6 位数字、deviceId 带 web- 前缀、公钥非空', () => {
  const attempt = web.createPairingAttempt(makeOffer());
  assert.match(attempt.code, /^\d{6}$/, '验证码必须是 6 位数字');
  assert.match(attempt.deviceId, /^web-/, 'deviceId 必须带 web- 前缀');
  assert.ok(attempt.publicKey.length > 0);
  assert.equal(attempt.sharedSecret.length, 32);
});

test('WS 不可达：验证码在连接失败之前就已回调（页面能先显示码）', async () => {
  const offer = makeOffer();
  const attempt = web.createPairingAttempt(offer);
  installWebSocket('unreachable', { offer, attempt });
  const codes = [];
  await assert.rejects(
    web.pairWithPc(offer, 'Web', (code) => codes.push(code), attempt),
    /无法连接|电脑/,
  );
  assert.deepEqual(codes, [attempt.code], '连接失败前必须已把验证码交给 UI');
});

test('重试复用同一 attempt：验证码恒定、init 的 deviceId/公钥不变、凭证一致', async () => {
  const offer = makeOffer();
  const attempt = web.createPairingAttempt(offer);
  const ctx = { offer, attempt };

  const firstSent = installWebSocket('accept', ctx);
  const firstCodes = [];
  const firstCred = await web.pairWithPc(offer, 'Web', (c) => firstCodes.push(c), attempt);

  const secondSent = installWebSocket('accept', ctx);
  const secondCodes = [];
  const secondCred = await web.pairWithPc(offer, 'Web', (c) => secondCodes.push(c), attempt);

  assert.equal(firstCodes[0], attempt.code);
  assert.equal(secondCodes[0], firstCodes[0], '重试不得改变验证码（PC 端人工比对的是同一个码）');
  const init1 = firstSent.find((m) => m.type === 'mobile-pair-init');
  const init2 = secondSent.find((m) => m.type === 'mobile-pair-init');
  assert.ok(init1 && init2, '两次都应发出 mobile-pair-init');
  assert.equal(init2.deviceId, init1.deviceId, '重试必须复用同一 deviceId');
  assert.equal(init2.publicKey, init1.publicKey, '重试必须复用同一手机公钥');
  assert.equal(secondCred.sharedSecret, firstCred.sharedSecret, '凭证里的共享密钥必须一致');
});

test('不同 attempt 生成不同验证码/公钥（反向证明必须复用）', () => {
  const offer = makeOffer();
  const a = web.createPairingAttempt(offer);
  const b = web.createPairingAttempt(offer);
  assert.notEqual(a.deviceId, b.deviceId);
  assert.notEqual(a.publicKey, b.publicKey);
});

test('App：配对失败路径保留验证码，并接出可重试入口', () => {
  const app = readFileSync(path.join(root, 'src/ui/App.tsx'), 'utf8');
  const runPairCatch = /const runPair = useCallback[\s\S]*?catch \(e\) \{([\s\S]*?)\} finally/.exec(app)?.[1] ?? '';
  assert.ok(runPairCatch, '应能定位 runPair 的 catch 块');
  assert.doesNotMatch(runPairCatch, /setPairCode\(''\)/, '配对失败绝不能清空验证码');
  assert.match(runPairCatch, /setPairError/, '失败应给出错误提示');
  assert.match(app, /pairWithPc\(offer, 'EasyMint Web', \(code\) => setPairCode\(code\), attempt\)/, '必须复用同一 attempt');
  assert.match(app, /onRetry=\{pairError && pairCode \? retryPair : undefined\}/, '必须接出重试入口');

  const guide = readFileSync(path.join(root, 'src/ui/screens/PairGuideScreen.tsx'), 'utf8');
  assert.match(guide, /onRetry &&/, '配对引导页应渲染重试按钮');
  assert.match(guide, /className="pair-retry"/, '重试按钮类名存在');
});
