/**
 * 选区 DOM → Markdown 还原
 *
 * selection.toString() 是纯文本丢格式；从 Range.cloneContents() 的 DOM 结构
 * 提取 block 级结构，还原为 Markdown 文本（列表/标题/代码/引用/inline 强调）。
 * blocksToMarkdown / inlineToMd 为纯函数（可单测）；selectionToBlocks 依赖 DOM，仅浏览器运行。
 */

export interface SelBlock {
  type: "para" | "heading" | "list" | "code" | "quote";
  level?: number;    // heading 1-6；list 1=无序 2=有序
  items?: string[];  // list 条目 / code 行
  text?: string;     // para/quote/heading 文本
}

/** inline 标签 → markdown 符号（text 已含子元素展开） */
export function inlineToMd(tag: string, text: string): string {
  switch (tag) {
    case "strong": return `**${text}**`;
    case "em": return `*${text}*`;
    case "code": return `\`${text}\``;
    default: return text;
  }
}

/** block 结构 → markdown 文本 */
export function blocksToMarkdown(blocks: SelBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "heading": return `${"#".repeat(Math.min(Math.max(b.level || 1, 1), 6))} ${b.text}`;
        case "list": return (b.items || []).map((it) => `${b.level === 2 ? "1." : "-"} ${it}`).join("\n");
        case "code": return "```\n" + (b.items || []).join("\n") + "\n```";
        case "quote": return `> ${b.text}`;
        default: return b.text || "";
      }
    })
    .join("\n");
}

/** 元素文本：子节点展开 inline 强调符号 */
function elText(el: Element): string {
  let out = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent || "";
    else if (n.nodeType === Node.ELEMENT_NODE) {
      const c = n as Element;
      const t = c.tagName.toLowerCase();
      out += t === "br" ? "\n" : inlineToMd(t, c.textContent || "");
    }
  });
  return out;
}

/** 块级容器标签：递归提取文本；其余（strong/em/code/span 等）按 inline 包符号 */
const BLOCK_TAGS = new Set(["div", "p", "section", "article", "main", "header", "footer", "aside", "table", "thead", "tbody", "tr", "td", "th"]);

/** Range → block 结构（浏览器 DOM，测试环境不可用） */
export function selectionToBlocks(range: Range): SelBlock[] {
  const frag = range.cloneContents();
  const blocks: SelBlock[] = [];
  let textBuf = "";

  const flushText = () => {
    if (textBuf.trim()) blocks.push({ type: "para", text: textBuf.trim() });
    textBuf = "";
  };

  frag.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      textBuf += node.textContent || "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      flushText();
      blocks.push({ type: "heading", level: Number(tag[1]), text: elText(el) });
    } else if (tag === "ul" || tag === "ol") {
      flushText();
      const items = Array.from(el.querySelectorAll(":scope > li")).map((li) => elText(li));
      blocks.push({ type: "list", level: tag === "ol" ? 2 : 1, items });
    } else if (tag === "li") {
      // 选区覆盖部分列表项时 fragment 顶层是 li（无 ul 包装）
      flushText();
      blocks.push({ type: "list", level: 1, items: [elText(el)] });
    } else if (tag === "pre") {
      flushText();
      blocks.push({ type: "code", items: [el.textContent?.replace(/\n$/, "") || ""] });
    } else if (tag === "blockquote") {
      flushText();
      blocks.push({ type: "quote", text: elText(el) });
    } else if (tag === "br") {
      textBuf += "\n";
    } else if (BLOCK_TAGS.has(tag)) {
      flushText();
      blocks.push({ type: "para", text: elText(el) });
    } else {
      // inline 元素（strong/em/code 等）：包符号并入文本缓冲，保持与相邻文本同一段
      textBuf += inlineToMd(tag, el.textContent || "");
    }
  });
  flushText();
  return blocks;
}
