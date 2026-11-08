// 静态契约校验（真玻璃 / 全屏 / 安装到桌面）。
// 每条断言都带「破坏后应失败」说明：这些说明不是注释装饰，而是用来反向验证测试不恒绿——
// 实证见本轮工作记录：临时改坏 manifest.display、删掉 apple meta，对应断言确实变红后精确改回。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(path.join(root, p), 'utf8');

/** 带「破坏后应失败」说明的断言包装；缺一条说明就说明该断言可能恒绿。 */
const must = (cond, breakHint) => assert.ok(cond, `破坏后应失败：${breakHint}`);
const match = (str, re, breakHint) => assert.match(str, re, `破坏后应失败：${breakHint}`);
const noMatch = (str, re, breakHint) => assert.doesNotMatch(str, re, `破坏后应失败：${breakHint}`);

const html = read('index.html');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const css = read('src/styles/app.css');
const tokens = read('src/styles/tokens.css');
const fullscreen = read('src/ui/fullscreen.ts');
const install = read('src/ui/install.ts');
const lens = read('src/ui/glass-lens.ts');
const glass = read('src/ui/components/Glass.tsx');
const ambient = read('src/ui/components/AmbientBackground.tsx');
const main = read('src/main.tsx');

test('index.html：安装入口齐全且仍满足 CSP / 相对路径契约', () => {
  match(html, /<link[^>]+rel="manifest"[^>]+href="\.\/manifest\.webmanifest"/, '删掉或改名 manifest link');
  match(html, /rel="apple-touch-icon"[^>]+href="\.\/apple-touch-icon\.png"/, '删掉 apple-touch-icon link');
  match(html, /rel="icon"[^>]+href="\.\/icon-192\.png"/, '删掉 icon link 或改成绝对 URL');
  for (const [name, value] of [
    ['apple-mobile-web-app-capable', 'yes'],
    ['mobile-web-app-capable', 'yes'],
    // black-translucent：内容延伸到状态栏下方，由 env(safe-area-inset-top) 留白。
    // （default 会让 iOS 在状态栏下方硬切一条底色，主屏上看就是「顶部没适配」。）
    ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
    ['apple-mobile-web-app-title', 'EasyMint'],
  ]) {
    match(html, new RegExp(`<meta name="${name}" content="${value}"`), `删掉 <meta name="${name}">`);
  }
  match(html, /<meta name="theme-color" content="#141414" media="\(prefers-color-scheme: dark\)"/, '删掉深色 theme-color 变体');
  match(html, /interactive-widget=overlays-content/, '删掉 interactive-widget（Android 软键盘会压缩布局）');
  noMatch(html, /https?:\/\//, '引入一个外部 CDN / 绝对 URL');
  noMatch(html, /\son(?:click|load|error|change|input|submit|focus|blur)\s*=/i, '加一个内联事件属性');
  noMatch(html, /<script\b[^>]*>[\s\S]+?<\/script>/, '往 HTML 里塞内联脚本或 SVG defs');
});

test('manifest：display / start_url / scope / id / icons 合法', () => {
  must(manifest.display === 'standalone', '把 display 改成 browser');
  // 不写 start_url：iOS 会用它覆盖「添加时的当前 URL」，把 #p= 短码丢掉；
  // 缺省时浏览器（含 iOS）用文档地址作为启动地址，主屏打开才会带着扫码时的参数。
  must(!('start_url' in manifest), '写回 start_url（主屏启动会丢掉 #p= 短码）');
  must(manifest.scope === './', '把 scope 改成绝对路径');
  must(manifest.id === './', '把 id 改成绝对路径');
  must(manifest.name === 'EasyMint' && manifest.short_name === 'EasyMint', '改掉 name / short_name');
  must(manifest.orientation === 'any', '把 orientation 改成 portrait');
  must(Array.isArray(manifest.icons) && manifest.icons.length >= 2, '删掉一项 icon');
  for (const icon of manifest.icons) {
    match(icon.src, /^\.\//, '把某个 icon.src 改成绝对 URL');
    must(icon.type === 'image/png', '把某个 icon.type 改掉');
    match(icon.sizes, /^\d+x\d+$/, '把某个 icon.sizes 改坏');
    // 满版品牌图给 any；Android 主屏那套另给 maskable（同色底 + 78% 内容）。
    // 两者不能合成 "any maskable"：同一个文件同时当满版和 maskable，安全区一裁就露馅。
    must(icon.purpose === 'any' || icon.purpose === 'maskable', '把 purpose 改回 any maskable（满版图会被裁）');
  }
});

test('app.css：磨砂 / 液态折射 / 方向性轮廓 / 降级真实存在', () => {
  must(!/backdrop-filter/.test(css.match(/\.glass-frosted\s*\{([^}]*)\}/)?.[1] ?? ''),
    '给 .glass-frosted 默认加回 blur（App 默认不模糊）');
  match(css, /\.glass-frosted\.is-blur\s*\{[^}]*blur\(18px\)\s*saturate\(1\.1\)/, '删掉 .glass-frosted.is-blur 的 backdrop-filter');
  match(css, /\.glass-liquid\.has-lens\s*\{[^}]*backdrop-filter:\s*none/, '删掉 has-lens 关掉父层整体模糊的规则');
  match(css, /\.glass-liquid\.has-lens\s+\.glass-frost\s*\{[^}]*blur\(18px\)\s*saturate\(1\.4\)/, '删掉中心磨砂层的 blur(18px)');
  // 磨砂层必须盖满整张卡：一旦内缩（inset: var(--lens-band)），Safari 上边缘那圈既没有位移
  // 也没有模糊，卡片看起来就是「只模糊了中间输入框那一块」。
  match(css, /\.glass-liquid\.has-lens\s+\.glass-frost\s*\{[^}]*inset:\s*0[;}]/,
    '把磨砂层内缩回 inset: var(--lens-band)（边缘会露出一圈清晰的边）');
  must((css.match(/\.glass-lens-[tbrl]\s*\{/g) ?? []).length === 4, '删掉一条边缘带 CSS');
  must((css.match(/\.glass-lens-[tbrl]\s*\{[^}]*mask-image:\s*linear-gradient/g) ?? []).length === 4,
    '删掉边缘带向内的线性渐隐 mask');
  noMatch(css, /\.glass-lens\s*\{[^}]*radial-gradient/, '改回「整块 lens + 径向 mask」（会把滤镜整个裁没）');
  match(css, /\.glass-liquid::after\s*\{[\s\S]*?linear-gradient\(to bottom, var\(--glass-rim\)/, '把上下亮线改回只亮左上的 radial-gradient');
  match(css, /\.glass-liquid::after\s*\{[\s\S]*?linear-gradient\(to right, var\(--liquid-dark-rim\)/, '把左右暗线删掉');
  noMatch(css, /conic-gradient/, '加一圈 conic 彩虹环');
  must((css.match(/\.glass-liquid::before\s*\{/g) ?? []).length === 1, '加第二层 inset 白边 / 第二处高光');
  noMatch(css, /\.ambient-lines/, '恢复 App 没有的环境细线层');
  match(css, /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?backdrop-filter:\s*none\s*!important/, '删掉 reduced-transparency 降级');
  match(css, /@media \(prefers-reduced-motion: reduce\)/, '删掉 reduced-motion 规则');
  match(css, /\.glass-content\s*\{[^}]*z-index:\s*1/, '删掉 .glass-content 的前景层级');
});

test('tokens.css：四个变量块都补齐方向性暗线，且不再有环境细线变量', () => {
  must((tokens.match(/--liquid-dark-rim\s*:/g) ?? []).length === 4, '漏改亮/深/高对比某一个变量块');
  must((tokens.match(/--ambient-lines-opacity\s*:/g) ?? []).length === 0, '环境细线已删除，变量不应再存在');
  match(tokens, /--liquid-dark-rim:\s*rgba\(0,0,0,0\.22\)/, '把亮色暗线强度改错');
  match(tokens, /--liquid-dark-rim:\s*rgba\(0,0,0,0\.42\)/, '把深色暗线强度改错');
});

test('fullscreen.ts：能力检测 / 切换 / 订阅齐全且不引第三方', () => {
  match(fullscreen, /fullscreenEnabled/, '删掉 fullscreenEnabled 检测（iOS 会误判为支持）');
  match(fullscreen, /requestFullscreen/, '删掉 requestFullscreen 调用');
  match(fullscreen, /exitFullscreen/, '删掉退出全屏分支');
  match(fullscreen, /fullscreenchange/, '删掉 fullscreenchange 订阅');
  match(fullscreen, /webkitfullscreenchange/, '删掉 webkit 前缀订阅');
  match(fullscreen, /catch\s*\{/, '去掉 reject 捕获（失败时会抛异常）');
  noMatch(fullscreen, /from\s+['"][^'".]/, '引入一个第三方依赖');
});

test('install.ts：渐进兼容 + 平台指引，不谎称能自动弹安装提示', () => {
  match(install, /beforeinstallprompt/, '删掉 beforeinstallprompt 监听');
  match(install, /event\.preventDefault\(\)/, '删掉 preventDefault（浏览器会自己弹原生横幅）');
  match(install, /maxTouchPoints/, '去掉 iPadOS 桌面 UA 判定');
  match(install, /standalone/, '去掉 navigator.standalone 判定（已启动仍提示）');
  match(install, /promptInstall/, '删掉 promptInstall 导出');
  match(install, /浏览器不会主动弹出安装提示/, '把 Android 文案改成「会自动弹出安装提示」');
  match(install, /分享.*添加到主屏幕|添加到主屏幕.*分享/, '删掉 iOS 分享→添加到主屏幕指引');
  match(install, /Chrome 右上角菜单/, '删掉 Android 菜单指引');
  noMatch(install, /from\s+['"][^'".]/, '引入一个第三方依赖');
});

test('main.tsx：visualViewport 同时监听 resize 与 scroll，全屏切换派发 resize', () => {
  match(main, /visualViewport\?\.addEventListener\('resize'/, '删掉 visualViewport.resize 监听');
  match(main, /visualViewport\?\.addEventListener\('scroll'/, '删掉 visualViewport.scroll 监听（键盘平移会错位）');
  match(main, /window\.addEventListener\('resize'/, '删掉 window.resize 兜底');
  match(main, /fullscreenchange/, '删掉全屏切换后的 --vvh 重算');
});

test('glass-lens.ts / Glass.tsx / AmbientBackground.tsx：折射层真实接线', () => {
  match(lens, /feTurbulence/, '删掉 feTurbulence');
  match(lens, /feDisplacementMap/, '删掉 feDisplacementMap（只剩模糊，不是折射）');
  match(lens, /createElementNS\(/, '把 SVG 改成 innerHTML 字符串或写进 HTML');
  match(lens, /http:\/\/www\.w3\.org\/2000\/svg/, '把 SVG 命名空间改错');
  match(lens, /ensureLensDefs/, '删掉幂等注入函数');
  match(lens, /supportsLens/, '删掉能力门槛');
  match(lens, /applyLens/, '删掉 CSSOM 应用函数');
  match(lens, /\.style\.backdropFilter\s*=/, '改回内联 style 属性（CSP 不允许）');
  match(lens, /LENS_FILTER_MARKUP/, '删掉供像素测试复用的滤镜标记导出');
  noMatch(lens, /feImage/, '加 feImage / data URI（移动端 Safari 兼容差）');
  noMatch(lens, /xmlns=/, '在注入的 SVG 上写 xmlns 属性');
  must((glass.match(/className="glass-lens glass-lens-[tbrl]"/g) ?? []).length === 4,
    '删掉或合并 liquid 变体的四条边缘带 div');
  match(glass, /data-lens-band/, '删掉四条边缘带的 CSSOM 标记');
  match(glass, /className="glass-frost"/, '删掉中心磨砂层');
  match(glass, /className="glass-content"/, '删掉前景内容层');
  match(glass, /ref=\{rootRef\}/, '删掉根节点 ref（applyLens 找不到边缘带）');
  match(glass, /ensureLensDefs\(\)/, '删掉 useEffect 里的 defs 注入');
  match(glass, /applyLens\(rootRef\.current\)/, '删掉 useEffect 里对四条带的 CSSOM 应用');
  noMatch(ambient, /ambient-lines/, '恢复 App 没有的环境细线层');
  match(ambient, /ambient-green[\s\S]*ambient-blue[\s\S]*ambient-cool/, '删掉三团环境柔光');
});
