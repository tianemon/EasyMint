import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './styles/tokens.css';
import './styles/app.css';

/** 100dvh + visualViewport.resize：软键盘弹出时把可视高度写进 --vvh，输入卡不会被顶飞。 */
function syncViewport(): void {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--vvh', `${height}px`);
}
syncViewport();
window.visualViewport?.addEventListener('resize', syncViewport);
window.addEventListener('resize', syncViewport);

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
