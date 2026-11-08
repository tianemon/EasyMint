// 配对被电脑端撤销后的行为回归。
//
// 用户报的现象：桌面端删掉配对后，手机浏览器仍然认为「已配对」，打开就进设备列表，
// 什么都没法用，而且不会自己退回配对页。根因是连接层把「服务端 1008 拒绝」当成普通
// 断线，无限重连；本地凭证永远不清。
//
// 这里用真实的 src/protocol/remote-client.ts + 可控 WebSocket stub 跑真实路径。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const web = await loadRemoteClient();
const originalWebSocket = globalThis.WebSocket;
test.after(() => { globalThis.WebSocket = originalWebSocket; });

function credential() {
  return {
    version: 1,
    pcId: 'pc-1',
    pcName: 'Mac',
    addresses: ['127.0.0.1'],
    port: 47778,
    deviceId: 'web-abc',
    deviceName: 'iPhone · Safari',
    sharedSecret: crypto.randomBytes(32).toString('base64'),
  };
}

/** hello 发出后由服务端拒绝：code/reason 可配，模拟撤销与「通道被关」两种 close。 */
function installStub(code, reason) {
  let created = 0;
  class FakeWebSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor() {
      created += 1;
      this.readyState = 0;
      this.onopen = null; this.onerror = null; this.onmessage = null; this.onclose = null;
      queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
    }
    send(data) {
      const message = JSON.parse(data);
      if (message.type !== 'mobile-hello') return;
      queueMicrotask(() => {
        this.readyState = 3;
        this.onclose?.({ code, reason, wasClean: false });
      });
    }
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = FakeWebSocket;
  return () => created;
}

test('电脑端撤销设备（1008 unknown device）→ 上报 revoked 并停止重连', async () => {
  const created = installStub(1008, 'unknown device');
  const client = new web.RemoteClient(credential());
  let revoked = 0;
  client.onPairingRevoked(() => { revoked += 1; });

  try {
    await assert.rejects(
      () => client.connect(),
      (error) => error instanceof web.PairingRevokedError,
      '撤销必须抛 PairingRevokedError，上层才知道要清凭证',
    );
    assert.equal(revoked, 1, '必须通知上层一次（清凭证 + 回配对页）');
    // 撤销后不该再排重连：等过一次重连窗口，仍然只有最开始那一个连接
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    assert.equal(created(), 1, '撤销后仍在重连（会一直撞 1008）');
  } finally {
    // 断言失败时也必须收掉重连定时器，否则 node --test 会挂住不退
    client.close();
  }
});

test('只是关掉通道（1008 channel disabled）不算撤销：不清凭证，但要继续重连', async () => {
  const created = installStub(1008, 'channel disabled');
  const client = new web.RemoteClient(credential());
  let revoked = 0;
  client.onPairingRevoked(() => { revoked += 1; });

  try {
    await assert.rejects(() => client.connect());
    assert.equal(revoked, 0, '用户可能只是关了开关，凭证仍然有效，不能删');
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    assert.ok(created() >= 2, '通道关闭只是暂时的，应继续重连');
  } finally {
    client.close();
  }
});
