// 静态契约校验（真玻璃 / 安装到桌面）。
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
const install = read('src/ui/install.ts');
const glass = read('src/ui/components/Glass.tsx');
const ambient = read('src/ui/components/AmbientBackground.tsx');
const main = read('src/main.tsx');
const platform = read('src/core/platform.ts');

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
  match(html, /interactive-widget=resizes-visual/, '键盘必须缩小可视区域，避免遮住输入卡');
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

test('手机 Web 仅使用普通磨砂且保留降低透明度回退', () => {
  match(css, /\.glass-frosted\.is-blur\s*\{[^}]*backdrop-filter:\s*blur/, '移除磨砂');
  match(css, /prefers-reduced-transparency/, '移除降低透明度回退');
  noMatch(glass, /registerLiquidGlass|glass-dom-mirror/, '恢复液态渲染器');
});

test('tokens.css：四个变量块都补齐方向性暗线，且不再有环境细线变量', () => {
  must((tokens.match(/--liquid-dark-rim\s*:/g) ?? []).length === 4, '漏改亮/深/高对比某一个变量块');
  must((tokens.match(/--ambient-lines-opacity\s*:/g) ?? []).length === 0, '环境细线已删除，变量不应再存在');
  match(tokens, /--liquid-dark-rim:\s*rgba\(0,0,0,0\.22\)/, '把亮色暗线强度改错');
  match(tokens, /--liquid-dark-rim:\s*rgba\(0,0,0,0\.42\)/, '把深色暗线强度改错');
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

test('main.tsx：visualViewport 同时监听 resize 与 scroll', () => {
  match(main, /visualViewport\?\.addEventListener\('resize'/, '删掉 visualViewport.resize 监听');
  match(main, /visualViewport\?\.addEventListener\('scroll'/, '删掉 visualViewport.scroll 监听（键盘平移会错位）');
  match(main, /window\.addEventListener\('resize'/, '删掉 window.resize 兜底');
});


test('平台适配：data-platform 标记 + iOS 高度 + 安卓/鸿蒙输入卡材质', () => {
  // 少了这个标记，iOS 的 100vh 与安卓的材质都不会生效（两端继续按同一套走）
  match(main, /dataset\.platform\s*=/, '删掉 data-platform 标记');
  match(main, /detectPlatform\(/, '平台判定要收在 core/platform.ts，方便用例覆盖各端 UA');
  // 鸿蒙必须能被单独认出来，否则 ArkWeb（UA 里没有 Android）会掉进 desktop 分支
  match(platform, /OpenHarmony\|ArkWeb/, '删掉鸿蒙 NEXT（ArkWeb / OpenHarmony）判定');
  match(platform, /HarmonyOS/, '删掉鸿蒙 2–4（安卓底座）判定');
  // iOS 主屏首帧 dvh 偏小 → 底部黑边，滑动才补；standalone 下 100vh 才是稳定值
  match(css, /html\[data-platform="ios"\]\s+\.app\s*\{[^}]*100vh/, 'iOS 回退到 dvh（首帧会留黑边）');
  noMatch(glass, /supportsLens/, '不应恢复按 UA 禁用材质');
  // 顶部渐隐的 mask 会把标题栏里那截正文抹掉，iOS 模糊后按钮跟着忽明忽暗 —— 已经删掉，别加回来
  noMatch(css, /\.message-scroll\s*\{[^}]*mask-image/, '给消息滚动区加回顶部渐隐 mask（iOS 上按钮会忽明忽暗）');

});

test('设置关于只显示版本号', () => {
  const settings = read('src/ui/screens/SettingsScreen.tsx');
  const about = settings.split('<div className="settings-group-label">关于</div>')[1]?.split('</Glass>')[0];
  assert.ok(about); match(about, /__EM_VERSION__/, '缺少版本号');
  noMatch(about, /BUILD_STAMP|毛玻璃|平台|构建|navigator\.userAgent/, '关于区出现版本号以外的调试信息');
});

test('设置和归档入口保留点击区域但不包玻璃容器', () => {
  for (const [file, label] of [['src/ui/screens/HomeScreen.tsx', '设置'], ['src/ui/screens/SessionsScreen.tsx', '归档会话']]) {
    const source = read(file); const button = source.match(new RegExp(`<button[^>]*aria-label="${label}"[\\s\\S]*?</button>`))?.[0];
    assert.ok(button, `找不到${label}按钮`); match(button, /header-pill-hit/, '丢失点击区域'); noMatch(button, /<Glass/, '按钮仍包着玻璃容器');
  }
});
