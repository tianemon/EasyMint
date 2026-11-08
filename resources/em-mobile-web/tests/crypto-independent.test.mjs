// 独立的加密互通反向验证（不复用 crypto-interop.test.mjs 的任何辅助代码）。
// PC 侧算法全部用 node:crypto 自行推导；AES-GCM 用 WebCrypto `subtle` 而非 createCipheriv，
// 双向（c2s / s2c）验证 AAD 形状与 tag 拼接，属于与实现者不同证据类型的复核。
import assert from 'node:assert/strict';
import crypto, { webcrypto } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

async function loadWebCrypto() {
  const result = await build({
    stdin: { contents: `export * from './src/protocol/crypto.ts';`, resolveDir: root, sourcefile: 'entry.ts', loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const SALT = Buffer.from('easymint-remote-terminal-v1', 'utf8');
const derive = (ikm, info) => Buffer.from(crypto.hkdfSync('sha256', ikm, SALT, Buffer.from(info, 'utf8'), 32));

const web = await loadWebCrypto();

test('HKDF：auth / c2s / s2c 三把密钥与独立推导逐字节一致', () => {
  const ikm = crypto.randomBytes(32);
  const keys = web.deriveKeys(ikm);
  assert.deepEqual(Buffer.from(keys.auth), derive(ikm, 'authentication'));
  assert.deepEqual(Buffer.from(keys.clientToServer), derive(ikm, 'client-to-server'));
  assert.deepEqual(Buffer.from(keys.serverToClient), derive(ikm, 'server-to-client'));
});

test('proof 与 6 位配对码：Web 结果与独立 HMAC 一致', () => {
  const ikm = Buffer.from('fixed-ikm-for-independent-verification'.padEnd(32, '0').slice(0, 32), 'utf8');
  const auth = derive(ikm, 'authentication');
  const keys = web.deriveKeys(ikm);
  const value = 'hello:web-dev:conn-9:nonce-xyz';
  assert.equal(web.proof(keys.auth, value), crypto.createHmac('sha256', auth).update(value, 'utf8').digest('base64'));

  const token = 'pair-token-independent';
  const digest = crypto.createHmac('sha256', auth).update(`pair:${token}`, 'utf8').digest();
  const expected = String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
  assert.equal(web.pairingCode(keys.auth, token), expected);
});

test('c2s：WebCrypto subtle.decrypt 能解开 Web 加密结果（含正确 AAD）', async () => {
  const ikm = crypto.randomBytes(32);
  const keys = web.deriveKeys(ikm);
  const key = await webcrypto.subtle.importKey('raw', derive(ikm, 'client-to-server'), 'AES-GCM', false, ['decrypt']);
  const cid = 'conn-independent', seq = 23;
  const plaintext = '固定测试向量 · ✓ · {"a":1}';
  const env = web.encrypt(keys.clientToServer, cid, seq, plaintext);
  const combined = Buffer.concat([Buffer.from(env.data, 'base64'), Buffer.from(env.tag, 'base64')]);
  const plain = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(env.iv, 'base64'), tagLength: 128,
      additionalData: Buffer.from(`1:c2s:${cid}:${seq}`, 'utf8') },
    key, combined,
  );
  assert.equal(Buffer.from(plain).toString('utf8'), plaintext);
});

test('c2s：AAD 改一个字节即被 subtle.decrypt 拒绝（防篡改）', async () => {
  const ikm = crypto.randomBytes(32);
  const keys = web.deriveKeys(ikm);
  const key = await webcrypto.subtle.importKey('raw', derive(ikm, 'client-to-server'), 'AES-GCM', false, ['decrypt']);
  const cid = 'conn-independent', seq = 23;
  const env = web.encrypt(keys.clientToServer, cid, seq, 'secret');
  const combined = Buffer.concat([Buffer.from(env.data, 'base64'), Buffer.from(env.tag, 'base64')]);
  await assert.rejects(webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(env.iv, 'base64'), tagLength: 128,
      additionalData: Buffer.from(`1:c2s:${cid}:${seq + 1}`, 'utf8') },
    key, combined,
  ));
});

test('s2c：WebCrypto subtle.encrypt 造的密文能被 Web decrypt 解开（方向独立验证）', async () => {
  const ikm = crypto.randomBytes(32);
  const keys = web.deriveKeys(ikm);
  const key = await webcrypto.subtle.importKey('raw', derive(ikm, 'server-to-client'), 'AES-GCM', false, ['encrypt']);
  const cid = 'conn-independent', seq = 8;
  const plaintext = 'PC → Web 方向 ✓';
  const iv = crypto.randomBytes(12);
  const combined = Buffer.from(await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128, additionalData: Buffer.from(`1:s2c:${cid}:${seq}`, 'utf8') },
    key, Buffer.from(plaintext, 'utf8'),
  ));
  const decoded = web.decrypt(keys.serverToClient, cid, seq, {
    iv: iv.toString('base64'),
    tag: combined.slice(-16).toString('base64'),
    data: combined.slice(0, -16).toString('base64'),
  });
  assert.equal(decoded, plaintext);
});
