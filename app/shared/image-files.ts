/**
 * 图片文件的判定口径（主进程与渲染层共用）。
 *
 * 为什么要共享：渲染层要据此把点击分流到图片查看器（而不是开编辑器 tab），
 * 主进程要据此决定 file:readImage 放行哪些文件——两处各写一份必然漂移，
 * 出现「界面按图片打开、主进程拒绝读取」这类前后端不一致。
 */

/** 支持的图片扩展名（小写，不带点） */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg", "ico",
]);

/** 路径是否指向图片文件（大小写不敏感；只看扩展名，不代表文件一定存在） */
export function isImagePath(p: string): boolean {
  if (!p) return false;
  const base = p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  // dot <= 0：无扩展名，或形如 ".png" 的点文件（无文件名主干）——都不当作图片
  if (dot <= 0 || dot === base.length - 1) return false;
  return IMAGE_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}
