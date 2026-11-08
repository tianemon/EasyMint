/** 安装到桌面。
 *  beforeinstallprompt 硬性要求 HTTPS：当前页面跑在 http://<局域网IP>，浏览器不会主动弹安装提示。
 *  这里只做「未来若改用 HTTPS 立刻可用」的渐进兼容；当前 HTTP 下安装按钮不出现，
 *  由 platformHint() 给出手动「添加到主屏幕」的平台指引，绝不谎称能自动弹提示。 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface NavigatorStandalone extends Navigator {
  standalone?: boolean;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

function isStandalone(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as NavigatorStandalone;
  if (nav.standalone === true) return true;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(display-mode: standalone)').matches;
  }
  return false;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event: Event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

/** 已从主屏图标启动时不再提示安装。 */
export function isStandaloneMode(): boolean {
  return isStandalone();
}

export function canPromptInstall(): boolean {
  return deferred !== null && !isStandalone();
}

/** 无 deferred 直接返回 false，不伪造安装流程。 */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  notify();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome === 'accepted';
  } catch {
    return false;
  }
}

export function subscribeInstallAvailability(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** 平台指引：iOS（含 iPadOS 桌面 UA）走 Safari 分享；Android 走 Chrome 菜单；其它走通用菜单。 */
export function platformHint(): string {
  if (isStandalone()) return '';
  if (typeof navigator === 'undefined') return '可通过浏览器菜单把本页添加为快捷方式。';
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua)
    || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  if (iOS) {
    return 'iPhone / iPad：点 Safari 底部「分享」→「添加到主屏幕」；之后从主屏图标打开即为无地址栏全屏。';
  }
  if (/Android/.test(ua)) {
    return 'Android：点 Chrome 右上角菜单 →「添加到主屏幕」。当前是局域网 http 页面，浏览器不会主动弹出安装提示，请手动添加。';
  }
  return '可通过浏览器菜单把本页「添加到主屏幕 / 添加快捷方式」。';
}
