// 液态玻璃「原生近似」的真实浏览器像素验证。
//
// 不做 CSS.supports 语法检测就宣称效果成立：这里
//  1. 用 esbuild 导入产物模块 src/ui/glass-lens.ts 的 LENS_FILTER_MARKUP / LENS_BACKDROP，
//     保证「被测 SVG 滤镜」与「线上注入的滤镜」是同一份；
//  2. 测试页直接内联 src/styles/tokens.css + app.css，复用真实线上 CSS 规则与真实 class 结构；
//  3. 用本机 Chrome 无头分别截图「无 lens 层」「有 lens 层」「只有 blur 的 lens 层」三种状态，
//     用 Node 内置 zlib 手写 PNG 解码，按与 team-lead 探针一致的判据逐像素比较：
//     RGB 绝对差之和 > 12 记为变化，距卡片边 < 28px 记 rim、其余记 center。
//       - 核心断言：四条边缘带 vs 无 lens 层，rim 有显著差异、center 无差异；
//       - 与「只有 blur」对照相比仍要有明显 rim 差异，证明 feDisplacementMap 位移确实生效，
//         而不只是 backdrop-filter: blur(3px) 带来的模糊。
//  Chrome 不存在时明确 skip 并打印原因，不恒绿。

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.EM_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_MISSING = !existsSync(CHROME);
const W = 360;
const H = 260;

// ---- 最小 PNG 解码器：8bit RGB/RGBA，filter 0..4，纯 Node 内置 zlib ----
function decodePng(buf) {
  let p = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!ch || bitDepth !== 8) throw new Error(`不支持的 PNG：colorType=${colorType} bitDepth=${bitDepth}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y += 1) {
    const f = raw[rp++];
    for (let x = 0; x < stride; x += 1) {
      const v = raw[rp++];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= ch && y > 0) ? out[(y - 1) * stride + x - ch] : 0;
      let r;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + x] = r & 255;
    }
  }
  return { width, height, ch, data: out };
}

/**
 * 与 team-lead 探针一致的判据：卡片区域内逐像素算 RGB 绝对差之和 > 12 记为「变化」，
 * 距卡片边 < 28px 记 rim、其余记 center。核心证据是「rim 有显著差异、center 无差异」。
 */
function rimCenterDiff(a, b) {
  const card = { x0: 50, y0: 60, x1: 310, y1: 200 };
  const rimWidth = 28;
  let rim = 0;
  let center = 0;
  let rimTotal = 0;
  let centerTotal = 0;
  for (let y = card.y0; y < card.y1; y += 1) {
    for (let x = card.x0; x < card.x1; x += 1) {
      const i = (y * a.width + x) * a.ch;
      const d = Math.abs(a.data[i] - b.data[i])
        + Math.abs(a.data[i + 1] - b.data[i + 1])
        + Math.abs(a.data[i + 2] - b.data[i + 2]);
      const dx = Math.min(x - card.x0, card.x1 - 1 - x);
      const dy = Math.min(y - card.y0, card.y1 - 1 - y);
      if (dx < rimWidth || dy < rimWidth) {
        rimTotal += 1;
        if (d > 12) rim += 1;
      } else {
        centerTotal += 1;
        if (d > 12) center += 1;
      }
    }
  }
  return { rim, rimTotal, center, centerTotal };
}

async function loadShippedLens() {
  const result = await build({
    stdin: {
      contents: `export { LENS_FILTER_MARKUP, LENS_FILTER_ID, LENS_BACKDROP } from './src/ui/glass-lens.ts';`,
      resolveDir: root,
      sourcefile: 'entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

// 测试页：真实线上 CSS（tokens + app.css）+ 真实线上 SVG filter 标记 + 真实线上 class 结构。
// 只额外覆盖测试用的条纹背景与卡片几何，玻璃内部规则完全来自 app.css。
function page(mode, lens) {
  const tokens = readFileSync(path.join(root, 'src/styles/tokens.css'), 'utf8');
  const app = readFileSync(path.join(root, 'src/styles/app.css'), 'utf8');
  const lensValue = JSON.stringify(lens.LENS_BACKDROP);
  const apply = {
    // 无 lens 层：四条边缘带全隐藏（等价 Glass.tsx 不挂载折射层）
    off: `bands.forEach(function(b){b.style.display='none';});`,
    // 有 lens 层：与 applyLens() 一样用 CSSOM 给四条边缘带设置 backdrop-filter
    on: `bands.forEach(function(b){b.style.backdropFilter=${lensValue};b.style.setProperty('-webkit-backdrop-filter',${lensValue});});`,
    // 对照组：同样有 lens 层，但只有 blur/saturate、没有 url(#SVG) 位移
    blur: `bands.forEach(function(b){b.style.backdropFilter='blur(3px) saturate(1.7)';b.style.setProperty('-webkit-backdrop-filter','blur(3px) saturate(1.7)');});`,
  }[mode];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>${tokens}\n${app}</style>
<style>
  html,body,#root{margin:0;height:100%}
  body{background:#fff}
  .test-bg{position:absolute;inset:0;background:
      repeating-linear-gradient(90deg,#111 0 3px,transparent 3px 26px),
      repeating-linear-gradient(0deg,#0a0 0 1px,transparent 1px 22px)}
  .test-bg b{display:block;padding-left:8px;font-size:18px;letter-spacing:2px;color:#c00;font-family:monospace}
  /* 与 .composer-wrap 一致：position + z-index 的包裹层 */
  .test-wrap{position:relative;z-index:1}
  .glass.test-card{position:absolute;left:50px;top:60px;width:260px;height:140px;border-radius:24px}
</style></head><body>
<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs>${lens.LENS_FILTER_MARKUP}</defs></svg>
<div class="test-bg">
  <b>ABCDEFGHIJ 0123456789</b><b>KLMNOPQRST UVWXYZABCD</b><b>EFGHIJKLMN OPQRSTUVWX</b>
  <b>YZ01234567 89ABCDEFGH</b><b>IJKLMNOPQR STUVWXYZ01</b><b>23456789AB CDEFGHIJKL</b>
</div>
<div class="test-wrap">
  <div class="glass glass-liquid has-lens test-card">
    <div class="glass-frost" aria-hidden="true"></div>
    <div class="glass-lens glass-lens-t" data-lens-band="" aria-hidden="true"></div>
    <div class="glass-lens glass-lens-b" data-lens-band="" aria-hidden="true"></div>
    <div class="glass-lens glass-lens-l" data-lens-band="" aria-hidden="true"></div>
    <div class="glass-lens glass-lens-r" data-lens-band="" aria-hidden="true"></div>
    <div class="glass-content"></div>
  </div>
</div>
<script>
var bands=Array.prototype.slice.call(document.querySelectorAll('[data-lens-band]'));
var lensId=${JSON.stringify(lens.LENS_FILTER_ID)};
void lensId;
${apply}
</script></body></html>`;
}

test('产物滤镜标记含真实折射原语（不依赖 Chrome，先证明测的是同一份滤镜）', async () => {
  const lens = await loadShippedLens();
  assert.match(lens.LENS_FILTER_MARKUP, /<filter id="em-liquid-lens"/, '缺少线上 filter id');
  assert.match(lens.LENS_FILTER_MARKUP, /feTurbulence[^>]*fractalNoise/, '缺少 feTurbulence 噪声源');
  assert.match(lens.LENS_FILTER_MARKUP, /feDisplacementMap[^>]*SourceGraphic/, '缺少 feDisplacementMap 位移');
  assert.match(lens.LENS_FILTER_MARKUP, /xChannelSelector="R"/, '位移通道不对');
  assert.match(lens.LENS_BACKDROP, /url\(#em-liquid-lens\)/, 'LENS_BACKDROP 没引用线上 filter');
  assert.doesNotMatch(lens.LENS_FILTER_MARKUP, /feImage/, '不应使用 feImage / data URI');
});

test('Chrome 中 supportsLens() 门槛为真（线上页面确实会挂载折射层，而非只在测试里强制开启）', {
  skip: CHROME_MISSING && `未找到 Chrome：${CHROME}`,
}, async () => {
  const result = await build({
    stdin: {
      contents: `import { supportsLens } from './src/ui/glass-lens.ts';
document.body.setAttribute('data-lens-gate', String(supportsLens()));`,
      resolveDir: root,
      sourcefile: 'gate.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'em-lens-gate-'));
  try {
    const htmlPath = path.join(tmp, 'gate.html');
    writeFileSync(htmlPath, `<!doctype html><html><body><script>${result.outputFiles[0].text}</script></body></html>`);
    const dom = execFileSync(CHROME, [
      '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
      '--virtual-time-budget=1000', '--dump-dom', `file://${htmlPath}`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    assert.match(dom, /data-lens-gate="true"/,
      'supportsLens() 在 Chrome 返回 false：线上 Glass.tsx 不会挂载折射层');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Chrome 像素验证：四边缘带 rim 显著变化 / center 无差异，url() 位移确有贡献', {
  skip: CHROME_MISSING && `未找到 Chrome：${CHROME}（跳过真实渲染验证，不恒绿）`,
}, async (t) => {
  const lens = await loadShippedLens();
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'em-glass-render-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));

  const shoot = (mode) => {
    const htmlPath = path.join(tmp, `${mode}.html`);
    const pngPath = path.join(tmp, `${mode}.png`);
    writeFileSync(htmlPath, page(mode, lens));
    execFileSync(CHROME, [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--allow-file-access-from-files',
      `--window-size=${W},${H}`,
      '--virtual-time-budget=2000',
      `--screenshot=${pngPath}`,
      `file://${htmlPath}`,
    ], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 });
    return decodePng(readFileSync(pngPath));
  };

  const off = shoot('off');
  const on = shoot('on');
  const blur = shoot('blur');

  assert.equal(off.width, W, '截图宽度不符');
  assert.equal(off.height, H, '截图高度不符');
  assert.equal(on.width, off.width, '两次截图尺寸不一致，无法逐像素比较');
  assert.equal(blur.width, off.width, '对照截图尺寸不一致');
  assert.equal(off.ch, on.ch, '两次截图通道数不一致');

  const fmt = (d) => `rim ${d.rim}/${d.rimTotal} (${(100 * d.rim / d.rimTotal).toFixed(1)}%)` +
    `，center ${d.center}/${d.centerTotal}`;

  // 核心断言（能推翻实现的证据）：四条边缘带 vs 无 lens 层 → rim 显著、center 无差异。
  const offOn = rimCenterDiff(off, on);
  // 隔离 url() 位移：与「只有 blur」对照相比边缘仍明显不同 + center 稳定，
  // 证明差异来自 feDisplacementMap 折射而非 backdrop-filter 的 blur(3px)。
  const blurOn = rimCenterDiff(blur, on);

  t.diagnostic(`四条边缘带 vs 无 lens 层：${fmt(offOn)}`);
  t.diagnostic(`只有 blur vs 完整 url 折射（隔离 url 贡献）：${fmt(blurOn)}`);
  t.diagnostic(`PNG：${off.width}x${off.height}，${off.ch} 通道，zlib 手写解码；判据 RGB 和>12 / rim<28px`);

  assert.equal(offOn.center, 0, `折射层改变了中心像素，违反「中心稳定」：${fmt(offOn)}`);
  assert.ok(offOn.rim >= offOn.rimTotal * 0.30, `边缘像素变化不足：${fmt(offOn)}`);
  assert.equal(blurOn.center, 0, `对照实验中中心不稳定：${fmt(blurOn)}`);
  assert.ok(blurOn.rim >= blurOn.rimTotal * 0.15,
    `url(#SVG) 位移对边缘几乎无贡献，疑似只有 blur 生效：${fmt(blurOn)}`);
});
