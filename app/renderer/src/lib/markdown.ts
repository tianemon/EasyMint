import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * markdown 渲染管线（聊天消息正文与编辑器预览共用）。
 *
 * 抽成独立模块的原因：两处各写一份必然漂移——净化和链接白名单一旦漏在某一侧，
 * 就等于给渲染路径开了个注入口子，而这种不一致从界面上看不出来。
 */

// 链接渲染:加 target="_blank" rel="noopener"——新窗口打开,
// 主进程 setWindowOpenHandler 拦截后转系统浏览器(否则点击链接窗口内跳走,EM 界面被替换无法返回)
const mdRenderer = new marked.Renderer();

/** HTML 属性值转义(& " < >)——href/title 拼进标签前必须转义,防属性逃逸注入(如 onerror=) */
function escapeHtmlAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** href 协议白名单:http/https/mailto;其余(含 javascript:/data:/vbscript: 与未知协议)→ null(降级纯文本) */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  // 控制字符/空白(如 "java\nscript:")可绕过协议匹配,白名单通过后再拒一次
  if (/[\u0000-\u0020]/.test(trimmed)) return null;
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : null;
}

mdRenderer.link = ({ href, title, tokens }) => {
  const text = tokens.map((t) => t.raw).join("");
  const safe = safeHref(href);
  if (!safe) return text; // 协议不在白名单 → 渲染纯文本,不生成可点击链接
  const titleAttr = title ? ` title="${escapeHtmlAttr(title)}"` : "";
  return `<a href="${escapeHtmlAttr(safe)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
};

/** markdown → 净化后的 HTML。marked 输出统一经 DOMPurify 净化——AI 输出/被读取的项目文件
 *  可含 <script>/<img onerror> 等载荷,直接进 dangerouslySetInnerHTML 会执行 */
export function renderMarkdownToHtml(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { breaks: true, renderer: mdRenderer }) as string);
}

/** markdown 正文容器 class（聊天消息正文与编辑器预览共用一套字号/行距/代码块样式）。
 *  字号由 index.css 的 .chat-messages / .selectable .prose 规则给到 var(--text-body)，
 *  故使用方须让该容器落在这些祖先之下（编辑器预览在滚动容器上挂 selectable） */
export const MARKDOWN_PROSE_CLASS =
  "leading-relaxed prose prose-sm max-w-none break-words [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_h1]:[font-size:1.5em] [&_code]:[font-size:var(--text-detail)] prose-headings:text-text-primary prose-p:text-text-primary prose-strong:text-text-primary prose-a:text-accent prose-li:text-text-primary";
