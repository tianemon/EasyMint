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
