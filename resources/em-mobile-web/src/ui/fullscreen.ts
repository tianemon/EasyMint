/** 网页全屏能力封装：纯 TS，不引第三方。
 *  iOS Safari 普通元素不支持 Fullscreen API（仅 <video>），因此 iOS 上会返回 false。 */

interface FullscreenDocument extends Document {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

function fsDocument(): FullscreenDocument {
  return document as FullscreenDocument;
}

/** 是否有可用的全屏 API（同时检查开关与 requestFullscreen 入口）。 */
export function isFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const d = fsDocument();
  const enabled = d.fullscreenEnabled === true || d.webkitFullscreenEnabled === true;
  if (!enabled) return false;
  const el = d.documentElement as FullscreenElement;
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

export function isFullscreenActive(): boolean {
  if (typeof document === 'undefined') return false;
  const d = fsDocument();
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}

/** 必须在用户手势内调用；捕获 reject（例如被浏览器策略拒绝）并返回 false。 */
export async function toggleFullscreen(): Promise<boolean> {
  if (!isFullscreenSupported()) return false;
  const d = fsDocument();
  try {
    if (isFullscreenActive()) {
      if (typeof d.exitFullscreen === 'function') await d.exitFullscreen();
      else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
      else return false;
    } else {
      const el = d.documentElement as FullscreenElement;
      if (typeof el.requestFullscreen === 'function') await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** 订阅 fullscreenchange（含 webkit 前缀），返回取消函数。 */
export function subscribeFullscreen(cb: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const onChange = (): void => cb();
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  return () => {
    document.removeEventListener('fullscreenchange', onChange);
    document.removeEventListener('webkitfullscreenchange', onChange);
  };
}
