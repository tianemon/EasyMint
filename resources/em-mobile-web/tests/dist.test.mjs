// 产物契约校验：dist/index.html 可被桌面端静态服务直接托管，且满足动态 CSP（契约 C1/C2）。
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const htmlPath = path.join(dist, 'index.html');

test('dist/ 真实存在且 index.html 可静态托管', { skip: !existsSync(htmlPath) && '尚未执行 npm run build' }, () => {
  assert.ok(existsSync(htmlPath));
  assert.ok(readFileSync(htmlPath, 'utf8').includes('<div id="root"></div>'));
});

test('无内联脚本、无内联事件属性、无外部 CDN（CSP script-src/style-src self）', { skip: !existsSync(htmlPath) && '尚未构建' }, () => {
  const html = readFileSync(htmlPath, 'utf8');
  // 所有 <script> 必须只有外部 src，标签体内不能有任何代码
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    assert.equal(match[1].trim(), '', '不得有内联脚本（modulePreload.polyfill 需为 false）');
    assert.match(match[0], /\bsrc=/, '脚本必须是外部文件');
  }
  // 内联事件属性白名单检测
  assert.doesNotMatch(html, /\son(?:click|load|error|change|input|submit|focus|blur|mouseover|mouseout|keydown|keyup|touchstart|touchend|animationend|transitionend)\s*=/i);
  // 不得有内联 <style> 块，也不得引用外链
  assert.doesNotMatch(html, /<style\b[^>]*>[\s\S]+?<\/style>/);
  assert.doesNotMatch(html, /https?:\/\//, '不得引用外部 CDN / 绝对 URL');
  assert.match(html, /viewport-fit=cover/, 'viewport-fit=cover 必须保留');
});

test('资源全部为相对路径且文件真实存在（base: ./）', { skip: !existsSync(htmlPath) && '尚未构建' }, () => {
  const html = readFileSync(htmlPath, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 2, '至少引用 JS 与 CSS');
  for (const ref of refs) {
    assert.ok(ref.startsWith('./'), `资源必须是相对路径：${ref}`);
    assert.ok(!ref.startsWith('//'), `不得协议相对 URL：${ref}`);
    assert.ok(existsSync(path.join(dist, ref)), `引用资源不存在：${ref}`);
  }
  // Worker 产物存在（同源脚本，default-src 'self' 兜底 worker-src）
  const workers = readFileSync(path.join(dist, refs.find((r) => r.endsWith('.js'))), 'utf8');
  assert.ok(workers.length > 1000);
  assert.ok(readFileSync(path.join(dist, refs.find((r) => r.endsWith('.css'))), 'utf8').includes('--accent'));
});

test('产物 JS 不含内联 polyfill 注入痕迹', { skip: !existsSync(htmlPath) && '尚未构建' }, () => {
  const html = readFileSync(htmlPath, 'utf8');
  assert.doesNotMatch(html, /<script[^>]*>[\s\S]*?__vitePreload[\s\S]*?<\/script>/, 'polyfill 不得内联进 HTML');
});

test('产物 JS：配对走页面内签发 /pair/new.json，手输仍保留 pair/<code>.json', { skip: !existsSync(htmlPath) && '尚未构建' }, () => {
  const html = readFileSync(htmlPath, 'utf8');
  const jsRefs = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  const js = jsRefs.map((ref) => readFileSync(path.join(dist, ref), 'utf8')).join('\n');
  // 主路径：页面自己向电脑端要一份材料（不依赖 URL 里的短码）
  assert.match(js, /pair\/new\.json/, '页面内签发路径必须进产物');
  // 兜底路径：手输 10 位码仍走同源查表
  assert.match(js, /pair\//, '同源查表路径 ./pair/ 必须进产物');
  assert.match(js, /\.json/, '查表 .json 后缀必须进产物');
  assert.match(js, /二维码已过期，请在电脑上重新生成/, '短码失效文案必须进产物');
  assert.doesNotMatch(js, /#pair=/, '不得残留旧 #pair= 长载荷解析');
});

test('首包构造 module Worker 且 Worker 产物真实存在（走 Worker 而非降级直连）', { skip: !existsSync(htmlPath) && '尚未构建' }, () => {
  const html = readFileSync(htmlPath, 'utf8');
  const jsRefs = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  const js = jsRefs.map((ref) => readFileSync(path.join(dist, ref), 'utf8')).join('\n');
  assert.match(js, /new Worker\(/, '首包必须构造 Worker（否则就是降级到主线程直连的路径）');
  assert.match(js, /type:\s*[`'"']module[`'"']/, '必须是 type: module 的 Worker');
  const workerRefs = new Set([...js.matchAll(/worker-[A-Za-z0-9_-]+\.js/g)].map((m) => m[0]));
  assert.ok(workerRefs.size >= 1, '首包必须引用 Worker 产物文件');
  // 服务端 CSP 无显式 worker-src，回退到 script-src 'self'：Worker 产物必须同源且真实存在。
  for (const ref of workerRefs) {
    assert.ok(existsSync(path.join(dist, 'assets', ref)), `Worker 产物不存在：${ref}`);
  }
});

test('安装到桌面契约：manifest / apple meta / icon 齐全且产物含新能力', { skip: !existsSync(htmlPath) && '尚未构建' }, () => {
  const html = readFileSync(htmlPath, 'utf8');
  // 所有 link 都是 ./ 相对路径且文件真实存在（上面的通用断言也会覆盖这些，这里再点名一次）。
  assert.match(html, /<link[^>]+rel="manifest"[^>]+href="\.\/manifest\.webmanifest"/, '缺 manifest link');
  assert.ok(existsSync(path.join(dist, 'manifest.webmanifest')), 'dist 缺 manifest.webmanifest');
  assert.match(html, /rel="apple-touch-icon"[^>]+href="\.\/apple-touch-icon\.png"/, '缺 apple-touch-icon link');
  assert.ok(existsSync(path.join(dist, 'apple-touch-icon.png')), 'dist 缺 apple-touch-icon.png');
  assert.match(html, /rel="icon"[^>]+href="\.\/icon-192\.png"/, '缺 icon link');
  assert.ok(existsSync(path.join(dist, 'icon-192.png')), 'dist 缺 icon-192.png');
  assert.ok(existsSync(path.join(dist, 'icon-512.png')), 'dist 缺 icon-512.png');
  // apple / theme meta 齐备；深色 theme-color 取 tokens.css 的 --content 深色值。
  const metas = [
    ['apple-mobile-web-app-capable', 'yes'],
    ['mobile-web-app-capable', 'yes'],
    // 主屏内容要延伸到状态栏下方（再用 safe-area 留白）；default 会在顶部切一条硬底色带
    ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
    ['apple-mobile-web-app-title', 'EasyMint'],
  ];
  for (const [name, content] of metas) {
    assert.match(html, new RegExp(`<meta name="${name}" content="${content}"`), `缺 meta ${name}`);
  }
  assert.match(html, /<meta name="theme-color" content="#141414" media="\(prefers-color-scheme: dark\)"/, '缺深色 theme-color');
  assert.doesNotMatch(html, /https?:\/\//, 'HTML 不得出现外部绝对 URL');
  // manifest 关键字段合法，icons 指向真实存在的相对 PNG。
  const manifest = JSON.parse(readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'EasyMint', 'manifest.name');
  assert.equal(manifest.short_name, 'EasyMint', 'manifest.short_name');
  assert.equal(manifest.display, 'standalone', 'manifest.display 必须 standalone');
  // 不写 start_url：iOS 主屏启动会用它覆盖当前 URL，把 #p= 短码丢掉
  assert.ok(!('start_url' in manifest), 'manifest 不应包含 start_url');
  assert.equal(manifest.scope, './', 'manifest.scope 必须 ./');
  assert.equal(manifest.id, './', 'manifest.id 必须 ./');
  assert.equal(manifest.orientation, 'any', 'manifest.orientation 必须 any');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'manifest.icons 至少两项');
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\.\//, `icon.src 必须相对路径：${icon.src}`);
    assert.ok(existsSync(path.join(dist, icon.src)), `icon 文件不存在：${icon.src}`);
    assert.equal(icon.type, 'image/png', `icon.type：${icon.src}`);
    assert.match(icon.sizes, /^\d+x\d+$/, `icon.sizes 非法：${icon.src}`);
    // any = 满版图；maskable = 安卓主屏（同色底 + 内容缩在安全区里）
    assert.ok(['any', 'maskable'].includes(icon.purpose), `icon.purpose 非法：${icon.src}`);
    if (icon.purpose === 'maskable') assert.ok(existsSync(path.join(dist, icon.src)), `maskable 图标不存在：${icon.src}`);
  }
  const manifestIcons = JSON.parse(readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8')).icons ?? [];
  assert.ok(manifestIcons.some((icon) => icon.purpose === 'maskable'), '产物 manifest 缺 maskable 图标');
  // 产物 JS/CSS 含本轮新能力（构建后真实存在，不靠源码语法检测）。
  const jsRefs = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  const js = jsRefs.map((ref) => readFileSync(path.join(dist, ref), 'utf8')).join('\n');
  assert.match(js, /requestFullscreen/, '产物 JS 必须含 Fullscreen API 调用');
  assert.match(js, /beforeinstallprompt/, '产物 JS 必须含 beforeinstallprompt 兼容');
  const cssRefs = [...html.matchAll(/href="([^"]+\.css)"/g)].map((m) => m[1]);
  const css = cssRefs.map((ref) => readFileSync(path.join(dist, ref), 'utf8')).join('\n');
  assert.match(css, /backdrop-filter/, '产物 CSS 必须含 backdrop-filter');
  assert.match(css, /prefers-reduced-transparency/, '产物 CSS 必须含 prefers-reduced-transparency 降级');
});
