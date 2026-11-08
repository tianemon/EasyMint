// 主屏安装链接：把配对凭证编码进 manifest 的 start_url，主屏启动时再读回来。
//
// 这条链路是「iOS 添加到主屏幕后不必重新扫码」的唯一来源（web app 与 Safari 存储分区不同，
// IndexedDB 里的凭证过不去），所以编码/解码必须逐字节自洽，且对篡改要返回 null 而不是抛。

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

async function load() {
  const result = await build({
    stdin: {
      contents: `export { encodeInstallQuery, readInstallCredential } from './src/ui/install-link.ts';
export { extractPairCode } from './src/protocol/pairing.ts';`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'browser',
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const credential = {
  version: 1,
  deviceId: 'web-0123456789abcdef',
  sharedSecret: 'c2VjcmV0LWJ5dGVzLTAxMjM0NTY3OA==',
  pcId: 'pc-42',
  pcName: 'Amon 的 MacBook Pro',
  addresses: ['192.168.1.8', '10.0.0.5'],
  port: 47778,
};

test('凭证编码 / 解码自洽，中文设备名与多地址都能原样还原', async () => {
  const web = await load();
  const query = web.encodeInstallQuery(credential);
  assert.match(query, /^h=[A-Za-z0-9_-]+$/, '必须是单参数、URL 安全字符，不能出现 + / =');
  const back = web.readInstallCredential(`?${query}`);
  assert.ok(back, '应能解出凭证');
  assert.equal(back.deviceId, credential.deviceId);
  assert.equal(back.sharedSecret, credential.sharedSecret);
  assert.equal(back.pcId, credential.pcId);
  assert.equal(back.pcName, credential.pcName, '非 ASCII 设备名必须无损');
  assert.deepEqual(back.addresses, credential.addresses);
  assert.equal(back.port, credential.port);
});

test('没有 h 参数、载荷被篡改、字段缺失都返回 null（绝不抛，首帧不能被它卡住）', async () => {
  const web = await load();
  assert.equal(web.readInstallCredential(''), null);
  assert.equal(web.readInstallCredential('?p=abcdefghij'), null, '#p= 短码不是安装载荷');
  assert.equal(web.readInstallCredential('?h=@@@not-base64@@@'), null);
  const query = web.encodeInstallQuery(credential);
  const tampered = `?${query.slice(0, -6)}AAAAAA`;
  assert.equal(web.readInstallCredential(tampered), null, '截断/篡改必须判为无效');
  const partial = Buffer.from(JSON.stringify({ v: 1, d: 'web-x', k: 'k' })).toString('base64url');
  assert.equal(web.readInstallCredential(`?h=${partial}`), null, '字段不全（缺 pcId/地址/端口）必须拒收');
});

test('短码解析：裸码与整条链接都认，长度不对不认', async () => {
  const web = await load();
  assert.equal(web.extractPairCode('Ab3_xyZ9-0'), 'Ab3_xyZ9-0');
  assert.equal(web.extractPairCode('http://192.168.1.8:47779/#p=Ab3_xyZ9-0'), 'Ab3_xyZ9-0');
  assert.equal(web.extractPairCode('  Ab3_xyZ9-0  '), 'Ab3_xyZ9-0');
  assert.equal(web.extractPairCode('short'), null);
  assert.equal(web.extractPairCode('abcdefghijk'), null);
  assert.equal(web.extractPairCode('http://192.168.1.8:47779/'), null);
});
