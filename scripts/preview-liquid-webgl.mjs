import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'private_docs/design/liquid-glass-webgl');
fs.mkdirSync(out, { recursive: true });
const result = await build({ stdin: { resolveDir: root, contents: `
import {createVisualSpec} from './app/shared/visual-design/spec';
import {renderVisualDocument,VISUAL_STYLE_FILES} from './app/shared/visual-design/document';
export {VISUAL_STYLE_FILES};
export function page(css,device){return renderVisualDocument(createVisualSpec({styleId:'liquid-glass',effect:'subtle',locale:'zh-CN'}),{css,runtime:''},{layout:'showcase',device,title:'Em 液态玻璃 WebGL'});}
` }, bundle: true, platform: 'node', format: 'esm', write: false });
const module = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const css = module.VISUAL_STYLE_FILES.map(file => fs.readFileSync(path.join(root, 'resources/visual-design', file), 'utf8')).join('\n');
for (const device of ['web', 'mobile']) fs.writeFileSync(path.join(out, device === 'mobile' ? 'showcase-mobile.html' : 'showcase.html'), module.page(css,device));
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Em WebGL 模板正式预设</title><style>*{box-sizing:border-box}body{margin:0;background:#eef2ee;color:#24322b;font:14px/1.7 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}header{max-width:1050px;margin:24px auto;padding:0 22px}h1{font-size:22px;margin:0}p{color:#627160;margin:6px 0}main{max-width:1050px;margin:auto;display:grid;grid-template-columns:minmax(320px,540px) 300px;gap:32px;padding:0 22px 28px}iframe{display:block;width:100%;height:min(820px,calc(100dvh - 140px));min-height:500px;border:0;border-radius:18px;background:#f7f7fa;box-shadow:0 12px 38px #20352716}aside{background:white;padding:20px;border:1px solid #dae2d8;border-radius:12px;height:fit-content}a{color:#365d3e}strong{font-size:16px}dl{display:grid;grid-template-columns:1fr auto;gap:12px;font-size:12px}dd{margin:0;font-family:monospace}@media(max-width:760px){main{grid-template-columns:1fr;max-width:520px}iframe{height:720px}}</style><header><h1>Em 液态玻璃 WebGL 模板</h1><p>第 2 份参数作为正式模板预设。下方运行实际导出的手机 HTML。</p></header><main><iframe src="showcase-mobile.html" title="Em WebGL 音乐模板"></iframe><aside><strong>模板参数 2</strong><dl><dt>背景模糊</dt><dd>0.2</dd><dt>折射率</dt><dd>1.5</dd><dt>基础范围</dt><dd>1.36</dd><dt>左右范围</dt><dd>1.30</dd><dt>水滴边缘偏移</dt><dd>0.23</dd><dt>左右暗边</dt><dd>0.26</dd><dt>上下亮边</dt><dd>0.24</dd></dl><p><a href="showcase-mobile.html" target="_blank">打开独立手机页</a></p><p><a href="showcase.html" target="_blank">打开独立桌面页</a></p><p>滚动内容，检查背景像素穿过玻璃边缘时的连续变形。导航、搜索、播放器均保留原有交互。</p></aside></main></html>`);
console.log(out);
