// 未认证连接上的拒绝不能证明电脑身份，不能删除本地配对。
//
// 已认证连接被撤销仍应通知界面；未认证的关闭信息不能用于删除凭证。
// 这里用真实客户端和可控 WebSocket 跑真实路径。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

async function loadRemoteClient() {
  const result = await build({
    stdin: {
      contents: `export * from './src/protocol/remote-client.ts'; export * from './src/protocol/crypto.ts';`,
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

test('未认证的 unknown device 不删除凭证，允许稍后重连', async () => {
  const created = installStub(1008, 'unknown device');
  const client = new web.RemoteClient(credential());
  let revoked = 0;
  client.onPairingRevoked(() => { revoked += 1; });

  try {
    await assert.rejects(() => client.connect());
    assert.equal(revoked, 0);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    assert.ok(created() >= 2);
  } finally {
    // 断言失败时也必须收掉重连定时器，否则 node --test 会挂住不退
    client.close();
  }
});

test('较快的错误电脑拒绝时继续验证真实电脑，保留凭证并报告实际地址', async () => {
  const cred = { ...credential(), addresses: ['10.0.0.1', '10.0.0.2'] };
  const keys = web.deriveKeys(Uint8Array.from(Buffer.from(cred.sharedSecret, 'base64')));
  const opened = [];
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) {
      this.host = new URL(url).hostname; this.readyState = 0;
      setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; opened.push(this.host); this.onopen?.(); }, this.host.endsWith('.1') ? 350 : 0);
    }
    send(data) {
      const message = JSON.parse(data);
      if (this.host.endsWith('.2')) queueMicrotask(() => this.onclose?.({ code: 1008, reason: 'unknown device' }));
      else queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'mobile-hello-ack', connectionId: message.connectionId,
        proof: web.proof(keys.auth, `hello-ack:${cred.deviceId}:${message.connectionId}:${message.nonce}`) }) }));
    }
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = FakeWebSocket;
  const client = new web.RemoteClient(cred);
  const addresses = []; let revoked = 0;
  client.onAddress(address => addresses.push(address));
  client.onPairingRevoked(() => revoked++);
  try {
    await client.connect();
    assert.deepEqual(opened, ['10.0.0.2', '10.0.0.1']);
    assert.equal(revoked, 0);
    assert.equal(addresses.at(-1), '10.0.0.1');
  } finally { client.close(); }
});

test('可信连接建立后收到撤销仍通知界面，重复 connect 不创建第二条连接', async () => {
  const cred = credential();
  const keys = web.deriveKeys(Uint8Array.from(Buffer.from(cred.sharedSecret, 'base64')));
  let socket, count = 0;
  class FakeWebSocket {
    static OPEN = 1;
    constructor() { count++; socket = this; this.readyState = 0; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(data) {
      const message = JSON.parse(data);
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'mobile-hello-ack', connectionId: message.connectionId,
        proof: web.proof(keys.auth, `hello-ack:${cred.deviceId}:${message.connectionId}:${message.nonce}`) }) }));
    }
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = FakeWebSocket;
  const client = new web.RemoteClient(cred); let revoked = 0;
  client.onPairingRevoked(() => revoked++);
  try {
    await Promise.all([client.connect(), client.connect()]);
    assert.equal(count, 1);
    socket.onclose({ code: 1008, reason: 'device revoked' });
    assert.equal(revoked, 1);
  } finally { client.close(); }
});

test('认证等待时关闭客户端会取消连接，不会在后台重新连上', async () => {
  let created = 0, socket;
  class FakeWebSocket {
    static OPEN = 1;
    constructor() { created++; socket = this; this.readyState = 0; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send() {}
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = FakeWebSocket;
  const client = new web.RemoteClient(credential());
  const pending = client.connect();
  await new Promise(resolve => setTimeout(resolve, 30));
  client.close();
  await assert.rejects(pending);
  assert.equal(socket.readyState, 3);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(created, 1);
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
