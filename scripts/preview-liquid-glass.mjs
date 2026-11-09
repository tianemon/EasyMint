import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'design-assets/labs/liquid-glass');
// Serve only demos/. The internal guide is deliberately outside the HTTP root.
const out = path.join(root, 'private_docs/design/液态玻璃/demos');
fs.mkdirSync(out, { recursive: true });
async function bundlePage(name, entry) {
  const dir = path.join(source, name), destination = path.join(out, name);
  const bundle = await build({ entryPoints: [path.join(dir, entry)], bundle: true, platform: 'browser', format: 'iife', write: false, legalComments: 'eof' });
  let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  if (html.includes('href="lab.css"')) html = html.replace(/<link rel="stylesheet" href="lab.css">/, () => '<style>' + fs.readFileSync(path.join(dir, 'lab.css'), 'utf8') + '</style>');
  const escaped = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  html = html.replace(/<script type="module" src="(?:\.\/)?lab\.(?:js|mjs)"><\/script>/, () => '<script>' + escaped + '</script>');
  if (/<script[^>]+src=|<link[^>]+rel="stylesheet"/.test(html)) throw Error(`Unbundled demo: ${name}`);
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'index.html'), html);
}
await bundlePage('webgl', 'lab.js');
await bundlePage('dom-mirror', 'lab.mjs');
await bundlePage('android', 'lab.js');

const code = await build({ stdin: { resolveDir: root, contents: `
import {createVisualSpec} from './app/shared/visual-design/spec';
import {renderVisualDocument,VISUAL_STYLE_FILES} from './app/shared/visual-design/document';
export {VISUAL_STYLE_FILES};
export function page(css,device){return renderVisualDocument(createVisualSpec({styleId:'liquid-glass',effect:'subtle',locale:'zh-CN'}),{css,runtime:''},{layout:'showcase',device,title:'Em 液态玻璃正式模板'});}
` }, bundle: true, platform: 'node', format: 'esm', write: false });
const template = await import('data:text/javascript;base64,' + Buffer.from(code.outputFiles[0].text).toString('base64'));
const css = template.VISUAL_STYLE_FILES.map(file => fs.readFileSync(path.join(root, 'resources/visual-design', file), 'utf8')).join('\n');
fs.mkdirSync(path.join(out, 'template'), { recursive: true });
for (const device of ['web', 'mobile']) fs.writeFileSync(path.join(out, 'template', `${device}.html`), template.page(css, device));
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>液态玻璃 · 已确认方案</title><style>*{box-sizing:border-box}body{margin:0;padding:40px 22px;background:#e8eeed;color:#263c35;font:15px/1.65 system-ui,sans-serif}main{max-width:760px;margin:auto}h1{font-size:30px;margin:0}p{color:#647c71}section{display:grid;gap:14px;margin-top:28px}article{padding:22px;background:#ffffffa8;border:1px solid #fff9;border-radius:20px}h2{font-size:18px;margin:0 0 5px}a{display:inline-block;color:#285f4b;margin-right:20px;padding:6px 0}small{color:#72847c}</style></head><body><main><h1>液态玻璃 · 已确认方案</h1><p>按实际背景来源选择实现。液态材质中的磨砂与折射叠加，文字和操作控件保持清晰。</p><section>
<article><h2>WebGL 光谱演示</h2><small>视觉已确认 · Canvas 背景实时采样 · RGB / 8 / 12 波段</small><p>圆角矩形与圆形，保留水滴边缘、细明暗轮廓和光谱调节。</p><a href="webgl/">打开演示 →</a></article>
<article><h2>DOM 镜像长列表</h2><small>演示视觉已确认 · 手机 Web 业务接入待真机验收</small><p>160 条混合内容，只镜像玻璃附近的可见内容；液态与液态＋磨砂可切换。</p><a href="dom-mirror/">打开演示 →</a></article>
<article><h2>Em 正式 WebGL 模板</h2><small>模板材质已确认 · 使用模板预设</small><p>实际音乐场景及其交互，独立验证 DOM 背景采样和滚动。</p><a href="template/mobile.html">手机布局 →</a><a href="template/web.html">桌面布局 →</a></article>
<article><h2>Android App 参数对照</h2><small>App 参数已确认 · 本页使用 WebGL 近似原生着色器</small><p>从共享 App 预设和材质生成，用于调参；Android 真机仍运行原生 AGSL。iOS 使用系统玻璃。</p><a href="android/">打开参数对照 →</a></article>
</section></main></body></html>`);
console.log(`Unified previews: ${out}/index.html`);
