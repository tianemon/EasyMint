// 与桌面端 app/main/services/remote-crypto.ts 的字节级互通测试。
// Web 侧用 esbuild 把**本项目真实 src/protocol/crypto.ts / pairing.ts** 打成 ESM 加载；
// PC 侧用 node:crypto（与 remote-crypto.ts 完全相同的算法/参数）。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

async function loadWebProtocol() {
  const result = await build({
    stdin: {
      contents: `export * from './src/protocol/crypto.ts'; export * from './src/protocol/pairing.ts';`,
      resolveDir: root, sourcefile: 'entry.ts', loader: 'ts',
    },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const SALT = Buffer.from('easymint-remote-terminal-v1', 'utf8');
function pcKeys(sharedSecret) {
  const derive = (info) => Buffer.from(crypto.hkdfSync('sha256', sharedSecret, SALT, Buffer.from(info, 'utf8'), 32));
  return { auth: derive('authentication'), c2s: derive('client-to-server'), s2c: derive('server-to-client') };
}

test('加密参数常量与桌面端逐字一致（SALT / info / AAD）', () => {
  const source = readFileSync(path.join(root, 'src/protocol/crypto.ts'), 'utf8');
  assert.match(source, /easymint-remote-terminal-v1/);
  for (const info of ['authentication', 'client-to-server', 'server-to-client']) assert.ok(source.includes(`'${info}'`), `缺 info ${info}`);
  assert.match(source, /1:\$\{direction\}:\$\{connectionId\}:\$\{sequence\}/, 'AAD 模板必须与 remote-crypto.ts 一致');
  assert.match(source, /pair:\$\{token\}/, '配对码 HMAC 输入必须一致');
  assert.match(source, /1_000_000/, '配对码取模基数必须一致');
});

test('HKDF / proof / 配对码：Web 与 PC 字节级一致', async () => {
  const web = await loadWebProtocol();
  const shared = crypto.randomBytes(32);
  const pc = pcKeys(shared);
  const keys = web.deriveKeys(shared);
  assert.deepEqual(Buffer.from(keys.auth), pc.auth);
  assert.deepEqual(Buffer.from(keys.clientToServer), pc.c2s);
  assert.deepEqual(Buffer.from(keys.serverToClient), pc.s2c);

  const value = 'hello:device-1:conn-2:nonce-3';
  const pcProof = crypto.createHmac('sha256', pc.auth).update(value, 'utf8').digest('base64');
  assert.equal(web.proof(keys.auth, value), pcProof);

  const token = 'token-abcdef';
  const digest = crypto.createHmac('sha256', pc.auth).update(`pair:${token}`, 'utf8').digest();
  const pcCode = String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
  assert.equal(web.pairingCode(keys.auth, token), pcCode);
});

test('P-256 ECDH 共享密钥：Web 与 PC 取到同一 32B X 坐标', async () => {
  const web = await loadWebProtocol();
  const pair = web.createPairingKeyPair(); // { secretKey, publicKey(base64, uncompressed) }
  const pcPeer = crypto.createECDH('prime256v1');
  pcPeer.generateKeys();
  const pcPeerPub = pcPeer.getPublicKey('base64');
  const webShared = web.computeSharedSecret(pair.secretKey, pcPeerPub);
  assert.equal(webShared.length, 32, '共享密钥必须是 32B 的 X 坐标');
  const pcShared = pcPeer.computeSecret(Buffer.from(pair.publicKey, 'base64'));
  assert.deepEqual(Buffer.from(webShared), pcShared);
});

test('AES-256-GCM：Web 加密 → PC 解密（c2s），PC 加密 → Web 解密（s2c）', async () => {
  const web = await loadWebProtocol();
  const shared = crypto.randomBytes(32);
  const pc = pcKeys(shared);
  const keys = web.deriveKeys(shared);
  const connectionId = 'conn-42';
  const sequence = 7;
  const plaintext = '{"version":1,"kind":"command","payload":{"command":"session.list"}}';

  // Web → PC（c2s）
  const envelope = web.encrypt(keys.clientToServer, connectionId, sequence, plaintext);
  assert.equal(envelope.sequence, sequence);
  assert.equal(Buffer.from(envelope.iv, 'base64').length, 12, 'IV 必须 12B');
  assert.equal(Buffer.from(envelope.tag, 'base64').length, 16, 'tag 必须 16B');
  const decipher = crypto.createDecipheriv('aes-256-gcm', pc.c2s, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(`1:c2s:${connectionId}:${sequence}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const decoded = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
  assert.equal(decoded, plaintext);

  // PC → Web（s2c）
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', pc.s2c, iv);
  cipher.setAAD(Buffer.from(`1:s2c:${connectionId}:${sequence}`, 'utf8'));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const decodedByWeb = web.decrypt(keys.serverToClient, connectionId, sequence, {
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64'),
  });
  assert.equal(decodedByWeb, plaintext);
});

test('AAD 错一个字节就解密失败（防篡改）', async () => {
  const web = await loadWebProtocol();
  const shared = crypto.randomBytes(32);
  const keys = web.deriveKeys(shared);
  const envelope = web.encrypt(keys.clientToServer, 'cid', 3, 'secret');
  assert.throws(() => web.decrypt(keys.clientToServer, 'cid', 4, envelope));
});

test('#p= 10 位短码解析，且 parsePairingPayload(string) 兼容与 sequence / web- deviceId 契约在位', async () => {
  const web = await loadWebProtocol();
  const offer = { version: 1, token: 'tk', pcId: 'pc1', pcName: 'host.local', addresses: ['192.168.1.5'], port: 47778, publicKey: 'AQID', expiresAt: Date.now() + 60_000 };
  const payload = Buffer.from(JSON.stringify(offer)).toString('base64url');
  assert.equal(web.pairCodeFromHash('#p=Ab3_xyZ9-0'), 'Ab3_xyZ9-0');
  assert.equal(web.pairCodeFromHash('#p=short'), null, '短码不足 10 位');
  assert.equal(web.pairCodeFromHash('#p=abcdefghijk'), null, '短码超过 10 位');
  assert.equal(web.pairCodeFromHash('#pair=legacy'), null, '旧长载荷格式不再识别');
  assert.equal(web.pairCodeFromHash('#other=x'), null);
  assert.deepEqual(web.parsePairingPayload(payload), offer);
  assert.throws(() => web.parsePairingPayload(Buffer.from(JSON.stringify({ ...offer, version: 2 })).toString('base64url')));
  assert.throws(() => web.parsePairingPayload(Buffer.from(JSON.stringify({ ...offer, expiresAt: 1 })).toString('base64url')));

  const client = readFileSync(path.join(root, 'src/protocol/remote-client.ts'), 'utf8');
  assert.match(client, /web-\$\{randomId\(\)\}/, 'Web 设备 deviceId 必须带 web- 前缀');
  assert.match(client, /sequence !== this\.receiveSequence \+ 1/, '接收 sequence 必须严格 === 上一个+1');
  assert.match(client, /close\(1008, 'invalid sequence'\)/, '错序必须关闭连接');
});
