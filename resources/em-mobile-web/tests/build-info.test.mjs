// 构建自检的纯逻辑回归：从 index.html 里取入口脚本，用来判断「手机手里的文档是不是旧的」。
// 这段逻辑的价值全在「抓得到真实产物里的写法」——抓不到就永远返回 false，自检恒绿。
import assert from 'node:assert/strict';
import test from 'node:test';

import { entryScriptFromHtml } from '../src/core/build-info.ts';

test('入口脚本：认得 vite 产物与属性顺序颠倒的写法', () => {
  // vite 实际产物（dist/index.html）
  assert.equal(
    entryScriptFromHtml('<script type="module" crossorigin src="./assets/index-CFSweJPa.js"></script>'),
    './assets/index-CFSweJPa.js',
    '破坏后应失败：认不出 vite 产物里的入口脚本（自检恒返回「不是旧包」）',
  );
  assert.equal(
    entryScriptFromHtml('<script crossorigin src="./assets/index-a.js" type="module"></script>'),
    './assets/index-a.js',
    '破坏后应失败：只认 type 在 src 前面的写法',
  );
});

test('入口脚本：看起来像但不是入口的标签不能被误认', () => {
  assert.equal(entryScriptFromHtml('<link rel="stylesheet" href="./assets/index-a.css" />'), null,
    '破坏后应失败：把样式表当入口脚本（比对永远不一致 → 一直报有新版本）');
  assert.equal(entryScriptFromHtml('<script src="./assets/worker.js"></script>'), null,
    '破坏后应失败：把普通脚本当 module 入口');
  assert.equal(entryScriptFromHtml(''), null, '破坏后应失败：空文档返回了非 null');
});
