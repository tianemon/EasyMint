import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './styles/tokens.css';
import './styles/app.css';

/**
 * 只在**软键盘**弹出时把可视高度写进 --vvh，输入卡才不会被键盘顶飞。
 *
 * 不能无条件用 visualViewport.height 当布局高度：浏览器工具栏收起/展开时它也会变，
 * 于是页面比屏幕矮一截，底部露出一条 html 底色（深色下就是一道 #141414 横带），
 * 安装到主屏后又因为那次采样停留在旧值而一直短 48px。没有键盘时交给 100vh，
 * 它等于「工具栏收起后的整屏高度」，与主屏全屏一致。
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
