import { useEffect, useMemo, useRef } from "react";
import { MARKDOWN_PROSE_CLASS, renderMarkdownToHtml } from "../lib/markdown";
import { resolveRelativePath } from "../lib/markdown-path";

interface MarkdownViewProps {
  text: string;
  /** md 文件所在目录：相对路径图片据此解析成绝对路径，经 file:readImage 读为 dataUrl 显示。
   *  没有磁盘上下文时（如聊天消息）不传，此时只渲染 HTML、不动图片 */
  baseDir?: string;
  className?: string;
}

/** 读不到图（非图片扩展名 / 文件不存在 / 超过体积上限）时的中性占位——
 *  留着原始 src 会显示裂图图标，占位至少能说明是什么丢了 */
function replaceWithPlaceholder(img: HTMLImageElement, label: string): void {
  const span = document.createElement("span");
  span.className = "inline-flex items-baseline bg-surface-alt text-text-muted rounded-[var(--radius-lg)] px-2 py-0.5";
  span.style.fontSize = "var(--text-caption)";
  span.textContent = `图片无法显示：${label}`;
  span.title = label;
  img.replaceWith(span);
}

/**
 * markdown 渲染视图（编辑器预览用）。
 * 正文容器复用聊天消息那套 prose class（见 lib/markdown 的 MARKDOWN_PROSE_CLASS）：
 * 字号/行距/正文排版与聊天一致——聊天里围栏代码块另走带复制按钮的 CodeBlock 组件，预览不参与那层替换
 */
export function MarkdownView({ text, baseDir, className }: MarkdownViewProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdownToHtml(text), [text]);

  // 相对路径图片：磁盘图片不能直接给 file:// 路径（dev 下页面源是 http，Chromium 会拦），
  // 必须经主进程读成 dataUrl。外链/data: 一律不碰，保持渲染层原有行为。
  useEffect(() => {
    const root = ref.current;
    if (!root || !baseDir) return;
    // 图片通道由 preload 注入；浏览器直开渲染层（无 Electron）时没有它，跳过而不是抛错
    const readImage = window.electronAPI?.file?.readImage;
    if (!readImage) return;
    let cancelled = false;
    for (const img of Array.from(root.querySelectorAll("img"))) {
      const src = img.getAttribute("src") ?? "";
      const abs = resolveRelativePath(baseDir, src);
      if (!abs) continue;
      readImage(abs)
        .then((dataUrl) => {
          if (cancelled) return;
          if (dataUrl) img.src = dataUrl;
          else replaceWithPlaceholder(img, src);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          console.error("读取预览图片失败:", abs, e);
          replaceWithPlaceholder(img, src);
        });
    }
    // 卸载 / 内容变化：在途回调作废，避免写到已被 React 重建的 DOM 上
    return () => { cancelled = true; };
  }, [html, baseDir]);

  return (
    // 外层挂 selectable：index.css 的 `.selectable .prose` 给正文 var(--text-body) 字号，
    // 同时恢复正文可选（应用根是 user-select: none）
    <div ref={ref} className={className ? `selectable ${className}` : "selectable"}>
      <div className={MARKDOWN_PROSE_CLASS} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
