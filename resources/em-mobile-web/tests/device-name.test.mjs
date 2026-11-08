// 浏览器设备名：电脑上「请求连接」弹窗里显示的那一行。
//
// 只做纯字符串判定（UA 由调用方传入），因为要覆盖的用例是「各种手机的 UA 长什么样」，
// 而不是「本机浏览器是什么」——后者无法在 CI 里构造。

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

async function load() {
  const result = await build({
    stdin: {
      contents: `export { deviceNameFromUserAgent } from './src/core/device-name.ts';`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'browser',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidEdge: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  linuxChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  empty: '',
};

test('手机 UA 拼成「平台 · 浏览器」，电脑上能一眼认出是哪台', async () => {
  const { deviceNameFromUserAgent: name } = await load();
  assert.equal(name(UA.iphoneSafari), 'iPhone · Safari');
  assert.equal(name(UA.iphoneChrome), 'iPhone · Chrome', 'iOS 上的 Chrome 是 CriOS，不能被 Safari/604.1 抢先命中');
  assert.equal(name(UA.androidChrome), 'Android · Chrome');
  assert.equal(name(UA.androidEdge), 'Android · Edge', 'EdgA 必须先于 Chrome 判定');
  assert.equal(name(UA.macChrome), 'Mac · Chrome');
  assert.equal(name(UA.windowsFirefox), 'Windows · Firefox');
  assert.equal(name(UA.linuxChrome), 'Linux · Chrome');
});

test('iPadOS 的桌面模式 UA 靠 maxTouchPoints 认出来', async () => {
  const { deviceNameFromUserAgent: name } = await load();
  // 测试环境 navigator.maxTouchPoints 为 undefined → 按 Mac 处理（桌面端本来就是 Mac）
  assert.equal(name(UA.ipadDesktopMode), 'Mac · Safari');
});

test('UA 缺失或无法识别时给一句能看的中文，不吐空串', async () => {
  const { deviceNameFromUserAgent: name } = await load();
  assert.equal(name(UA.empty), '浏览器');
  assert.equal(name('curl/8.4.0'), '浏览器');
  assert.equal(name('Mozilla/5.0 (Sony PlayStation 5) AppleWebKit/605.1.15 Safari/605.1.15'), 'Safari');
});

test('platformHint 优先于 UA 的模糊匹配', async () => {
  const { deviceNameFromUserAgent: name } = await load();
  assert.equal(name('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'Windows'), 'Windows · Chrome');
});
