import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const assets=fileURLToPath(new URL('../dist/assets/',import.meta.url));
test('production frosted CSS retains the standard property alongside the Safari prefix', { skip: !existsSync(assets) && '先 build 后验证实际 CSS 产物' },()=>{
  const css=readdirSync(assets).filter(f=>f.endsWith('.css')).map(f=>readFileSync(path.join(assets,f),'utf8')).join('\n');
  const rule=css.match(/\.glass-frosted\.is-blur\{([^}]+)\}/)?.[1];
  assert.ok(rule,'缺少实际磨砂样式');
  assert.match(rule,/blur\(6px\)/,'所有磨砂应统一为 6px');
  assert.doesNotMatch(css,/is-blur-tuned/,'不应存在单独覆盖的模糊强度');
  assert.match(rule,/(?<!-)backdrop-filter:/,'压缩后丢失标准属性，Chromium 磨砂会失效');
  assert.match(rule,/-webkit-backdrop-filter:/,'缺少旧版 Safari 兼容属性');
});
