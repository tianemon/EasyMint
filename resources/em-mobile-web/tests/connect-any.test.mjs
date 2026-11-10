// 联调口径确认（team-lead）：扫码后 60s 内桌面端换 WiFi 时，payload 的 addresses 可能是旧 IP、
// CSP connect-src 是新 IP；靠前端错峰尝试地址和 4s 单地址建连超时兜住——遍历全部 addresses、
// 单个失败不提前放弃、全部失败才抛错（页面不白屏、不卡死），并覆盖 CSP 拒绝 WebSocket 的情形。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

async function loadRemoteClient() {
  const result = await build({
    stdin: { contents: `export * from './src/protocol/remote-client.ts';`, resolveDir: root, sourcefile: 'entry.ts', loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function makeOffer(addresses) {
  const pc = crypto.createECDH('prime256v1');
  pc.generateKeys();
  return {
    version: 1, token: 'tok-connect', pcId: 'pc-connect', pcName: 'host',
    addresses, port: 47778, publicKey: pc.getPublicKey('base64'), expiresAt: Date.now() + 60_000,
  };
}

/** failHosts=onerror（含 CSP 拒绝的常见表现）；throwHosts=构造时同步抛（CSP 拒绝的强形式）。 */
function installWebSocket({ failHosts = [], throwHosts = [], stallHosts = [], closed = [] }, ctx) {
  const attempts = [];
  class FakeWebSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
    constructor(url) {
      const host = url.replace(/^ws:\/\//, '').split(':')[0];
      this.host = host;
      attempts.push(host);
      if (throwHosts.includes(host)) throw new Error('blocked by CSP');
      this.onopen = null; this.onerror = null; this.onmessage = null;
      queueMicrotask(() => {
        if (stallHosts.includes(host)) return;
        if (failHosts.includes(host)) this.onerror?.(new Error('down'));
        else this.onopen?.();
      });
    }
    send(data) {
      if (JSON.parse(data).type !== 'mobile-pair-init') return;
      const proof = crypto.createHmac('sha256', Buffer.from(ctx.attempt.keys.auth))
        .update(`pair-accepted:${ctx.offer.token}:${ctx.attempt.deviceId}`, 'utf8').digest('base64');
      queueMicrotask(() => this.onmessage?.({
        data: JSON.stringify({ type: 'mobile-pair-accepted', pcId: ctx.offer.pcId, proof }),
      }));
    }
    close() { closed.push(hostForSocket(this)); }
  }
  function hostForSocket(socket) { return socket.host; }
  globalThis.WebSocket = FakeWebSocket;
  return attempts;
}

const web = await loadRemoteClient();
const originalWebSocket = globalThis.WebSocket;
test.after(() => { globalThis.WebSocket = originalWebSocket; });

test('前两个地址失败后第三个地址成功', async () => {
  const offer = makeOffer(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  const attempt = web.createPairingAttempt(offer);
  const attempts = installWebSocket({ failHosts: ['10.0.0.1', '10.0.0.2'] }, { offer, attempt });
  const cred = await web.pairWithPc(offer, 'Web', () => {}, attempt);
  assert.deepEqual(attempts, ['10.0.0.1', '10.0.0.2', '10.0.0.3'], '必须尝试备用地址，不能只试第一个');
  assert.equal(cred.pcId, offer.pcId);
});

test('全部地址失败才抛错（不提前放弃），且验证码仍先于失败回调', async () => {
  const offer = makeOffer(['10.0.0.1', '10.0.0.2']);
  const attempt = web.createPairingAttempt(offer);
  const attempts = installWebSocket({ failHosts: ['10.0.0.1', '10.0.0.2'] }, { offer, attempt });
  const codes = [];
  await assert.rejects(web.pairWithPc(offer, 'Web', (code) => codes.push(code), attempt), /无法连接/);
  assert.deepEqual(attempts, ['10.0.0.1', '10.0.0.2']);
  assert.deepEqual(codes, [attempt.code]);
});

test('CSP 同步拒绝 WebSocket 也不中断降级，继续尝试下一个地址', async () => {
  const offer = makeOffer(['10.0.0.1', '10.0.0.2']);
  const attempt = web.createPairingAttempt(offer);
  const attempts = installWebSocket({ throwHosts: ['10.0.0.1'] }, { offer, attempt });
  const cred = await web.pairWithPc(offer, 'Web', () => {}, attempt);
  assert.deepEqual(attempts, ['10.0.0.1', '10.0.0.2'], 'CSP 抛错也必须继续下一个地址');
  assert.equal(cred.pcId, offer.pcId);
});

test('卡住的首地址不阻塞备用地址，成功后关闭未完成的连接', async () => {
  const offer = makeOffer(['10.0.0.1', '10.0.0.2']);
  const attempt = web.createPairingAttempt(offer);
  const closed = [];
  const attempts = installWebSocket({ stallHosts: ['10.0.0.1'], closed }, { offer, attempt });
  const started = Date.now();
  await web.pairWithPc(offer, 'Web', () => {}, attempt);
  assert.deepEqual(attempts, ['10.0.0.1', '10.0.0.2']);
  assert.ok(Date.now() - started < 2000);
  assert.ok(closed.includes('10.0.0.1'));
});
