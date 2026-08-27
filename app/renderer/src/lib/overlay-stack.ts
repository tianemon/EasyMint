/**
 * 弹窗分层检测 — 全局 portal 弹窗注册表。
 * 点击分层语义：点击上层（打开的弹窗）不关闭下层（抽屉等 document 级关闭监听），
 * 点击下层/空白才关闭。弹窗挂载时注册根元素，卸载时注销。
 */

const overlays = new Set<HTMLElement>();

/** 注册弹窗根元素，返回注销函数（组件卸载时调用） */
export function registerOverlay(el: HTMLElement | null): () => void {
  if (el) overlays.add(el);
  return () => { if (el) overlays.delete(el); };
}

/** 点击目标是否在任一打开的弹窗内（用于下层关闭监听的放行判断） */
export function isInsideOverlay(target: Node | null): boolean {
  if (!target) return false;
  for (const el of overlays) {
    if (el.contains(target)) return true;
  }
  return false;
}
