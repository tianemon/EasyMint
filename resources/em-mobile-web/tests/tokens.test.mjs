// 主题 token 校验：亮/深两套键集必须与手机 App theme/tokens.ts 一致（81 色键）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const css = readFileSync(path.join(root, 'src/styles/tokens.css'), 'utf8');

function varsOf(marker) {
  const start = css.indexOf(marker);
  assert.ok(start >= 0, `找不到 ${marker}`);
  const open = css.indexOf('{', start);
  let depth = 0, end = open;
  for (; end < css.length; end += 1) {
    if (css[end] === '{') depth += 1;
    else if (css[end] === '}') { depth -= 1; if (depth === 0) break; }
  }
  const body = css.slice(open + 1, end);
  return new Map([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const light = varsOf(':root {');
const dark = varsOf(':root[data-theme="dark"] {');
const COLOR_PREFIXES = /^--(?:accent|success|warning|danger|info|done|interrupt|fail|permission|diff|text|surface|content|card|elevated|input|border|divider|black|chat|thinking|cmd|code|tool|dot|user|system|log|project|chip|ask|input|ambient|glass|liquid|segment|floating|frosted|sheet|overlay|selected|scan|shortcut|section)/;

test('亮/深键集完全一致', () => {
  assert.deepEqual([...light.keys()].sort(), [...dark.keys()].sort());
});

test('至少 81 个色键，且亮深取值确有差异', () => {
  const colorKeys = [...light.keys()].filter((key) => COLOR_PREFIXES.test(key));
  assert.ok(colorKeys.length >= 81, `色键数量 ${colorKeys.length} < 81`);
  const different = colorKeys.filter((key) => light.get(key) !== dark.get(key));
  assert.ok(different.length > 40, `亮深差异键过少：${different.length}`);
});

test('跟随系统与页内深色覆盖都存在，且尺寸/字号变量齐全', () => {
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.match(css, /:root:not\(\[data-theme\]\)/);
  assert.match(css, /:root\[data-theme="light"\]/);
  for (const key of ['--chat-inset', '--radius-lg', '--radius-full', '--fs-body', '--fs-display', '--s4']) {
    assert.ok(light.has(key), `缺 ${key}`);
  }
  assert.equal(light.get('--chat-inset'), '16px');
});
