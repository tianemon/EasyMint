import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { detectPlatform } from './core/platform';
import { BUILD_STAMP } from './core/build-info';
import './styles/tokens.css';
import './styles/app.css';

/** 构建标记也挂到 <html>，远程调试/排查「手机跑的是哪一次构建」时不用点进设置页。 */
document.documentElement.dataset.build = BUILD_STAMP;

/**
 * 顶部安全区兜底：刘海机在主屏 web app 里 `env(safe-area-inset-top)` 正常是 47/59，
 * 但个别启动路径（从主屏恢复、旧版 WebKit、某些套壳浏览器）会返回 0 —— 那时标题栏直接
 * 顶到状态栏下面，观感就是「返回按钮被上方的东西盖住、顶部一片渐隐」。
 * 这里量一次真实值：真的取不到才用 47 兜底，取到就什么都不做（不改现有布局）。
 */
function syncSafeTop(): void {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top);'
    + 'visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const inset = probe.getBoundingClientRect().height;
  probe.remove();
  if (inset > 0) return;
  const standalone = (window.matchMedia?.('(display-mode: standalone)').matches ?? false)
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const notched = /iPhone|iPod/.test(navigator.userAgent) && window.screen.height >= 780;
  if (standalone && notched) document.documentElement.style.setProperty('--safe-top', '47px');
}
syncSafeTop();

/**
 * 平台标记仅用于视口与安装指引；各平台统一使用浏览器磨砂
 * （Safari 与 Chrome 报的能力几乎一样）。
 *  - ios：主屏 standalone 首帧的 100dvh 会偏小一圈（底部留黑边，滑动一次才补齐，
 *    不滚动的页面永远补不上），要用 100vh；
 *  - android / harmony：地址栏会变，必须用 dvh；玻璃能力不按 UA 排除。判定细节见 core/platform.ts。
 */
document.documentElement.dataset.platform = detectPlatform(
  navigator.userAgent, navigator.maxTouchPoints ?? 0,
);

/**
 * 只在**软键盘**弹出时把可视高度写进 --vvh，输入卡才不会被键盘顶飞。
 *
 * 不能无条件用 visualViewport.height 当布局高度：浏览器工具栏收起/展开时它也会变，
 * 于是页面比屏幕矮一截，底部露出一条 html 底色（深色下就是一道 #141414 横带），
 * 安装到主屏后又因为那次采样停留在旧值而一直短 48px。没有键盘时交给 CSS
 * （iOS 100vh / 其它 dvh，见 app.css 的 html[data-platform] 规则）。
 */
function syncViewport(): void {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  const keyboard = !!viewport && window.innerHeight - viewport.height > 120;
  if (keyboard && viewport) root.style.setProperty('--vvh', `${viewport.height}px`);
  else root.style.removeProperty('--vvh');
}
syncViewport();
window.visualViewport?.addEventListener('resize', syncViewport);
// 软键盘弹出时页面可能被平移而只触发 scroll，同样重算 --vvh，避免输入卡错位。
window.visualViewport?.addEventListener('scroll', syncViewport);
window.addEventListener('resize', syncViewport);

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
