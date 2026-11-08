// 联调口径确认（team-lead）：扫码后 60s 内桌面端换 WiFi 时，payload 的 addresses 可能是旧 IP、
// CSP connect-src 是新 IP；靠前端「逐个直连 + 4s 建连超时」降级兜住——遍历全部 addresses、
// 单个失败不提前放弃、全部失败才抛错（页面不白屏、不卡死），并覆盖 CSP 拒绝 WebSocket 的情形。
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
function installWebSocket({ failHosts = [], throwHosts = [] }, ctx) {
  const attempts = [];
  class FakeWebSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
    constructor(url) {
      const host = url.replace(/^ws:\/\//, '').split(':')[0];
      attempts.push(host);
      if (throwHosts.includes(host)) throw new Error('blocked by CSP');
      this.onopen = null; this.onerror = null; this.onmessage = null;
      queueMicrotask(() => {
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
    close() { /* noop */ }
  }
  globalThis.WebSocket = FakeWebSocket;
  return attempts;
}

const web = await loadRemoteClient();
const originalWebSocket = globalThis.WebSocket;
test.after(() => { globalThis.WebSocket = originalWebSocket; });

test('逐个直连覆盖全部 addresses：前两个失败后第三个成功', async () => {
  const offer = makeOffer(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  const attempt = web.createPairingAttempt(offer);
  const attempts = installWebSocket({ failHosts: ['10.0.0.1', '10.0.0.2'] }, { offer, attempt });
  const cred = await web.pairWithPc(offer, 'Web', () => {}, attempt);
  assert.deepEqual(attempts, ['10.0.0.1', '10.0.0.2', '10.0.0.3'], '必须逐个尝试全部地址，不能只试第一个');
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

test('源码口径：openSocket 默认 4s 超时、connectAny 遍历全部 addresses', () => {
  const src = readFileSync(path.join(root, 'src/protocol/remote-client.ts'), 'utf8');
  assert.match(src, /timeoutMs\s*=\s*4_000/, '建连超时必须是 4s');
  assert.match(src, /setTimeout\([\s\S]{0,120}timeoutMs\)/, '超时定时器必须用 timeoutMs');
  assert.match(src, /for \(const address of addresses\)/, 'connectAny 必须遍历全部 addresses');
  assert.match(src, /return await openSocket\(address, port\)/, '逐个直连');
  assert.match(src, /lastError = error/, '失败后记录并继续下一个');
  assert.match(src, /throw lastError instanceof Error/, '全部失败才抛错');
});
