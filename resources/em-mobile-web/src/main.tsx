import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { detectPlatform } from './core/platform';
import './styles/tokens.css';
import './styles/app.css';

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
let restingViewportHeight = window.visualViewport?.height ?? window.innerHeight;
let restingViewportWidth = window.visualViewport?.width ?? window.innerWidth;
function syncViewport(): void {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  const focused = document.activeElement instanceof HTMLElement
    && (document.activeElement.matches('input, textarea, [contenteditable="true"]'));
  if (viewport && Math.abs(viewport.width - restingViewportWidth) > 80) {
    restingViewportWidth = viewport.width;
    restingViewportHeight = viewport.height;
  }
  if (viewport && !focused) restingViewportHeight = viewport.height;
  const keyboard = !!viewport && (window.innerHeight - viewport.height > 120
    || (focused && restingViewportHeight - viewport.height > 120));
  if (keyboard && viewport) {
    root.style.setProperty('--vvh', `${viewport.height}px`);
    root.dataset.keyboard = 'open';
  } else {
    root.style.removeProperty('--vvh');
    delete root.dataset.keyboard;
  }
}
syncViewport();
window.visualViewport?.addEventListener('resize', syncViewport);
// 软键盘弹出时页面可能被平移而只触发 scroll，同样重算 --vvh，避免输入卡错位。
window.visualViewport?.addEventListener('scroll', syncViewport);
window.addEventListener('resize', syncViewport);
document.addEventListener('focusin', syncViewport);
document.addEventListener('focusout', syncViewport);

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
