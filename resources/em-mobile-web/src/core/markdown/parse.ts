import { marked } from 'marked';
import type { Token } from 'marked';

/**
 * markdown 解析层（纯函数，无 RN 依赖）。
 *
 * 手机端没有 DOM，不能用桌面端那套 `marked → HTML → dangerouslySetInnerHTML` 管线，
 * 改为 `marked.lexer` 出 token 树后自绘 RN 组件（见 MarkdownView.tsx）。本文件只做
 * 「文本 → 可渲染片段」的切分与文本级工具，便于单独推理流式行为。
 */

/** 代码块语言 → 准确显示名；表内没有或无法准确识别 → TEXT（与桌面端 ChatBlocks 的 LANG_LABELS 同表） */
const LANG_LABELS: Record<string, string> = {
  js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX',
  ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX',
  py: 'Python', python: 'Python',
  sh: 'Shell', shell: 'Shell', bash: 'Bash', zsh: 'Zsh',
  dart: 'Dart',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML', ini: 'INI',
  c: 'C', cpp: 'C++', 'c++': 'C++', 'c#': 'C#', cs: 'C#', 'objective-c': 'Objective-C',
  go: 'Go', golang: 'Go',
  java: 'Java',
  kotlin: 'Kotlin', kt: 'Kotlin',
  swift: 'Swift',
  rust: 'Rust', rs: 'Rust',
  ruby: 'Ruby', rb: 'Ruby',
  php: 'PHP',
  sql: 'SQL',
  markdown: 'Markdown', md: 'Markdown',
  vue: 'Vue', svelte: 'Svelte',
  dockerfile: 'Dockerfile', makefile: 'Makefile',
  plaintext: 'Plain Text', text: 'Text',
};

/** 语言标识的兜底值：不把「识别不出的语言名」当标签展示（会误导用户） */
export const UNKNOWN_LANG = 'TEXT';

export function languageLabel(info: string | undefined): string {
  const key = (info ?? '').trim().toLowerCase();
  return key ? LANG_LABELS[key] ?? UNKNOWN_LANG : UNKNOWN_LANG;
}

/**
 * 链接协议白名单：只放行 http/https/mailto，其余（javascript:/data:/未知协议）返回 null，
 * 由调用方降级为纯文本——与桌面端 lib/markdown.ts 的 safeHref 同口径。
 * 先拒控制字符与空白：`java\nscript:` 这类写法能骗过协议正则。
 */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/[\u0000-\u0020]/.test(trimmed)) return null;
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

/** marked 的 text token 里 `<`/`&` 已被转义（`&lt;`、`&amp;`），RN 没有 HTML 解析器，需自己还原 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match: string, name: string) => {
    if (name.startsWith('#')) {
      const hex = name[1] === 'x' || name[1] === 'X';
      const code = parseInt(hex ? name.slice(2) : name.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? match;
  });
}

/**
 * HTML 降级成纯文本。
 *
 * 桌面端能把内联 HTML 真渲染出来（`MarkdownHtml` 用 DOMPurify + innerHTML）；RN 没有 HTML 渲染能力，
 * 直接把原文铺出来会让用户看到 `<details><summary>` 这种标签文本（比丢内容还糟）。
 * 这里按块级标签换行、行内标签剥壳，保留可读的文字与换行——信息量对齐桌面端，形式降级。
 */
export function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|details|summary|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── 流式尾部渐隐 ─────────────────────────────────────
/** 渐隐覆盖的可见字符数（与桌面端 tail-fade.ts 的 TAIL_FADE_CHARS 同值） */
export const TAIL_FADE_CHARS = 4;
/** 末字符保留的可见度（桌面端 2026-09-15 拍板值：再浅看不出、再深像被切断） */
export const TAIL_FADE_MIN_OPACITY = 0.25;

interface GraphemeSegmenter {
  segment(input: string): Iterable<{ segment: string }>;
}

type GraphemeSegmenterCtor = new (locales?: string, options?: { granularity: 'grapheme' }) => GraphemeSegmenter;

/**
 * Hermes 不保证实现 Intl.Segmenter（缺失时构造即抛），缺了退化为按码点切。
 * 退化的代价只是「ZWJ 组合 emoji 可能被拆开几个字渐隐」，比按 UTF-16 码元切
 * （必然把代理对剪成半个字符、渲染出乱码框）好得多——与桌面端 tail-fade.ts 的取舍一致。
 */
const segmenter = ((): GraphemeSegmenter | undefined => {
  const ctor = (Intl as unknown as { Segmenter?: GraphemeSegmenterCtor }).Segmenter;
  if (typeof ctor !== 'function') return undefined;
  try {
    return new ctor('en', { granularity: 'grapheme' });
  } catch {
    return undefined;
  }
})();

/** 按「用户感知的字符」（grapheme cluster）切分，保证不在 emoji 中间切开 */
export function graphemes(text: string): string[] {
  if (!segmenter) return Array.from(text);
  const out: string[] = [];
  for (const piece of segmenter.segment(text)) out.push(piece.segment);
  return out;
}

/**
 * 把一段文本拆成 [不渐隐的前段, 逐个渐隐的末尾字符, 末尾空白]。
 * 末尾空白单独摘出来：渐隐是给「正在写的字」用的，若末尾刚好是换行/空格，
 * 拿它做淡出等于什么都没淡（视觉上突兀地整段消失）。
 */
export function splitFadeTail(text: string, count = TAIL_FADE_CHARS): { head: string; tail: string[]; trailing: string } {
  const match = /^(.*?)(\s*)$/s.exec(text);
  const body = match?.[1] ?? text;
  const trailing = match?.[2] ?? '';
  if (count <= 0 || !body) return { head: '', tail: [], trailing: text };
  // 只对末尾一小段做 grapheme 切分。
  // 渐隐只关心最后 count 个字，而 body 可能是几万字的思考全文——每帧对全文切一次
  // 是流式卡顿的主因之一（Intl.Segmenter 建几万个对象 + 紧跟的 GC）。
  // 取 8 倍余量：一个 grapheme 通常 ≤ 2 个 UTF-16 码元，emoji 序列更长。
  let start = body.length - count * 8;
  if (start > 0 && body.charCodeAt(start) >= 0xDC00 && body.charCodeAt(start) <= 0xDFFF) start -= 1; // 不切在代理对中间
  const slice = body.slice(Math.max(0, start));
  const units = graphemes(slice);
  if (units.length <= count) {
    // 末尾这一段本身就是全部尾部（说明 body 极短）——头部是 body 去掉这段，不能整个丢掉
    return { head: body.slice(0, body.length - slice.length), tail: units, trailing };
  }
  const tail = units.slice(units.length - count);
  return { head: body.slice(0, body.length - tail.join('').length), tail, trailing };
}

/** 第 index 个渐隐字符的不透明度：线性衰减到 TAIL_FADE_MIN_OPACITY（等效 CSS 横向渐变） */
export function fadeOpacity(index: number, total: number): number {
  if (total <= 1) return TAIL_FADE_MIN_OPACITY;
  return 1 - (1 - TAIL_FADE_MIN_OPACITY) * ((index + 1) / total);
}

// ── 围栏代码块切分 ───────────────────────────────────

export type MarkdownPart =
  | { kind: 'markdown'; text: string }
  | { kind: 'code'; lang: string; code: string };

/**
 * 已闭合的围栏：开围栏与闭围栏都要求在行首（≤3 空格缩进），info string 允许任意非反引号字符。
 * 比桌面端那条「任意位置 + info 限 \w+#-」的正则更贴近 CommonMark：
 * ① 行首锚定 → 正文里偶尔出现的 ``` 不会把整段文字误切成代码块；
 * ② info string 放宽 → ```未知语言 这类写法的围栏仍然被识别，语言标识才能回落 TEXT（否则连代码块都识别不出）。
 */
const FENCE = /^ {0,3}```([^\n`]*)\n([\s\S]*?)^ {0,3}```[ \t]*$/gm;
/** 未闭合的围栏（流式进行中）：同上口径，不强求闭合 */
const OPEN_FENCE = /^ {0,3}```([^\n`]*)\n([\s\S]*)$/m;

/**
 * 把正文切成「markdown 段」与「围栏代码块」交替的片段。
 *
 * 代码块单独成段有两个作用：① RN 侧用专门的组件渲染（语言标识/复制/横向滚动）；
 * ② 段落内**不含**围栏，后续按空行切「已完成的块」时不会切进代码块内部。
 *
 * streaming=true 时顺带处理**未闭合的围栏**：模型刚打出 ```lang 就按代码块渲染，
 * 避免闭合瞬间整段内容跳变（用户感知的「闪一下」）——与桌面端同做法。
 */
export function splitMarkdownParts(text: string, streaming: boolean): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  let lastIndex = 0;
  FENCE.lastIndex = 0;
  let match = FENCE.exec(text);
  while (match) {
    if (match.index > lastIndex) parts.push({ kind: 'markdown', text: text.slice(lastIndex, match.index) });
    parts.push({ kind: 'code', lang: languageLabel(match[1]), code: trimCodeBody(match[2] ?? '') });
    lastIndex = match.index + match[0].length;
    match = FENCE.exec(text);
  }
  const rest = text.slice(lastIndex);
  if (!rest) return parts;
  if (streaming) {
    // 循环已吃掉所有闭合围栏，故 rest 里若还有行首围栏，只能是正在写的那个
    const open = OPEN_FENCE.exec(rest);
    if (open) {
      if (open.index > 0) parts.push({ kind: 'markdown', text: rest.slice(0, open.index) });
      parts.push({ kind: 'code', lang: languageLabel(open[1]), code: trimCodeBody(open[2] ?? '') });
      return parts;
    }
  }
  parts.push({ kind: 'markdown', text: rest });
  return parts;
}

/** 去掉围栏体首尾空行：避免代码块顶部/底部出现一段空白 */
export function trimCodeBody(code: string): string {
  return code.replace(/^\n+/, '').replace(/\n+$/, '');
}

// ── 流式：已完成块的切分 ─────────────────────────────

/** 无序/有序列表项起始（缩进 0-3 个空格内） */
const LIST_MARKER = /^ {0,3}(?:[-+*]|\d{1,9}[.)])\s/;
/** 只认顶格（第 0 列）行的块起始：缩进行可能属于上层列表项，在那里切会切散结构 */
const ATX_HEADING = /^#{1,6}\s/;
const BLOCK_QUOTE = /^>/;
const THEMATIC_BREAK = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;

/**
 * 找出所有「可以安全冻结的块边界」偏移（升序，均指向某一行的行首）。
 *
 * 冻结的口径与桌面端 ChatBlocks 的 findStableEnd 一致：只在**块已完结**处切，
 * 且两侧不会合成同一块（松列表可跨空行延续——空行后跟列表项/缩进续行时不能切），
 * 这样切出来的前缀无论后面再追加什么内容都不会变，才能长期复用解析结果。
 * 本函数收的是不含围栏的正文段（围栏已在 splitMarkdownParts 里摘走），故无需再判围栏状态。
 */
export function blockBoundaries(text: string): number[] {
  const bounds: number[] = [];
  let inList = false;
  let candidate = -1; // 最近一个空行之后的内容行起点 = 冻结候选
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    if (nl === -1) break; // 末行尚未换行 → 内容可能还没写完，不在这里设边界
    const line = text.slice(pos, nl);
    if (line.trim() === '') {
      candidate = nl + 1;
    } else if (ATX_HEADING.test(line) || BLOCK_QUOTE.test(line) || THEMATIC_BREAK.test(line)) {
      // 标题/引用/分割线在 CommonMark 里可以打断段落，行首必然是新的块
      bounds.push(pos);
      candidate = -1;
      inList = false;
    } else {
      if (candidate >= 0) {
        const continuesList = inList && (LIST_MARKER.test(line) || /^\s{2,}/.test(line));
        if (!continuesList) bounds.push(candidate);
        candidate = -1;
      }
      if (LIST_MARKER.test(line)) inList = true;
      else if (!/^\s{2,}/.test(line)) inList = false;
    }
    pos = nl + 1;
  }
  return bounds;
}

/**
 * 把一段正文切成「已经写完的块」+「正在增长的尾块」（最后一项）。
 *
 * 这是流式重解析的规避手段：调用方对每个块单独 memo（内容字符串不变就不重跑 marked），
 * 于是历史块只在**下一条边界出现的那一帧**多解析一次，此后彻底不参与解析；
 * 每帧真正重新解析的只有最后那个还在长的块。
 */
export function splitStableBlocks(text: string): string[] {
  const bounds = blockBoundaries(text);
  if (bounds.length === 0) return [text];
  const groups: string[] = [];
  const first = bounds[0] ?? 0;
  if (first > 0) groups.push(text.slice(0, first));
  bounds.forEach((start, index) => groups.push(text.slice(start, bounds[index + 1] ?? text.length)));
  return groups;
}

/**
 * 单段正文 → 块级 token 树。
 * breaks: true 与桌面端一致（单个换行即换行，不要求行尾两个空格）——手机端模型输出里
 * 单换行的换行意图很常见，不跟随会让两端显示不一致。
 */
export function lexMarkdown(text: string): Token[] {
  return marked.lexer(text, { breaks: true, gfm: true });
}
