import { useState, useMemo, useEffect } from "react";
import { marked } from "marked";
import type { StreamEntry } from "./StreamPanel";
import { inferLang, tokenizeLines } from "../lib/diff-highlight";

// ── Block types ──────────────────────────────────────

interface TextBlock {
  kind: "text";
  text: string;
  keyPrefix?: string;
}

interface ThinkingBlock {
  kind: "thinking";
  text: string;
}

interface ToolItem {
  name: string;
  input: unknown;
  id?: string;
  /** 工具执行结果(由 tool_result 事件按 toolUseId 关联;edit 的返回含 diff) */
  result?: string;
  /** 结果是否错误(tool_result 的 is_error) */
  resultError?: boolean;
}

interface ToolGroupBlock {
  kind: "tool-group";
  items: ToolItem[];
}

interface SystemBlock {
  kind: "system";
  message: string;
}

/** 工具结果独立块(工具调用被隐藏/未显示时的结果,如 edit diff) */
interface ToolResultOnlyBlock {
  kind: "tool-result-only";
  content: string;
  isError?: boolean;
  /** 工具名(edit → "编辑" 标签,其他 → 工具名) */
  name?: string;
  /** 关联工具调用的文件路径(语言推断用) */
  filePath?: string;
  /** 关联工具调用的 input(工具调用被过滤时,取 path/command 做精简显示) */
  input?: Record<string, unknown>;
}

type Block = TextBlock | ThinkingBlock | ToolGroupBlock | SystemBlock | ToolResultOnlyBlock;

// ── buildBlocks: merge consecutive events of the same type ──

export function buildBlocks(
  entries: StreamEntry[],
  keyPrefix = "",
  toolInputs?: Map<string, Record<string, unknown>>,
): Block[] {
  const blocks: Block[] = [];
  let textBuf = "";
  let thinkBuf = "";
  let toolBuf: ToolItem[] = [];
  let sysBuf = "";

  const flushText = () => { if (textBuf) { blocks.push({ kind: "text", text: textBuf.trim(), keyPrefix }); textBuf = ""; } };
  const flushThink = () => { if (thinkBuf) { blocks.push({ kind: "thinking", text: thinkBuf.trim() }); thinkBuf = ""; } };
  const flushTool = () => { if (toolBuf.length) { blocks.push({ kind: "tool-group", items: [...toolBuf] }); toolBuf = []; } };
  const flushSys = () => { if (sysBuf) { blocks.push({ kind: "system", message: sysBuf.trim() }); sysBuf = ""; } };

  for (const e of entries) {
    if (e.kind === "text") { flushThink(); flushTool(); flushSys(); textBuf += (textBuf ? "\n" : "") + e.text; }
    else if (e.kind === "thinking") { flushText(); flushTool(); flushSys(); thinkBuf += (thinkBuf ? "\n" : "") + e.text; }
    else if (e.kind === "system") { flushText(); flushThink(); flushTool(); sysBuf += (sysBuf ? "\n" : "") + e.message; }
    else if (e.kind === "tool_use") { flushText(); flushThink(); flushSys(); toolBuf.push({ name: e.name, input: e.input, id: e.id }); }
    else if (e.kind === "tool_result") {
      // 按 toolUseId 关联结果到对应工具调用块;无匹配(工具调用被过滤/未显示)时单独渲染
      const target = [...toolBuf].reverse().find((t) => t.id === e.toolUseId);
      if (target) {
        target.result = e.content;
        target.resultError = e.isError;
      } else {
        flushText(); flushThink(); flushTool();
        // 工具调用被过滤:从完整 input 查找表取 file_path(语言推断)
        const inp = toolInputs?.get(e.toolUseId);
        const fp = inp ? (inp.file_path ?? inp.path) : undefined;
        blocks.push({
          kind: "tool-result-only",
          content: e.content,
          isError: e.isError,
          name: e.name,
          filePath: typeof fp === "string" ? fp : undefined,
          input: inp,
        });
      }
    }
    else if (e.kind === "error") { flushText(); flushThink(); flushTool(); blocks.push({ kind: "system", message: e.data }); }
    else if (e.kind === "exit") { flushAll(); /* suppress — user doesn't need to see process exit code */ }
    else { flushAll(); }
  }
  flushAll();

  function flushAll() { flushText(); flushThink(); flushTool(); flushSys(); }

  return blocks;
}

// ── Tool family grouping ─────────────────────────────

function toolFamily(name: string): string {
  if (/^(Edit|Write|Read)$/i.test(name)) return "file";
  if (/^Bash$/i.test(name)) return "bash";
  if (/^(Glob|Grep)$/i.test(name)) return "search";
  if (/^(WebSearch|WebFetch)$/i.test(name)) return "web";
  return "other";
}

const FAMILY_LABELS: Record<string, string> = { file: "文件操作", bash: "命令执行", search: "搜索", web: "网络", other: "工具" };

// ── Block rendering ──────────────────────────────────

function CodeBlock({ language, children }: { language?: string; children: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };
  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border" style={{ background: 'var(--color-code-block-header)' }}>
        <span className="text-[10px] text-text-muted uppercase tracking-wider">{language || "code"}</span>
        <button onClick={handleCopy} className="text-[10px] text-text-secondary hover:text-text-primary transition-colors">
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="px-4 py-3 overflow-x-auto text-[13px] leading-relaxed font-mono text-text-primary whitespace-pre" style={{ background: 'var(--color-code-block-bg)' }}>
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function TextBlockView({ block }: { block: TextBlock }): JSX.Element {
  const html = useMemo(() => {
    // Extract fenced code blocks before html rendering, handle them separately
    const parts: Array<{ type: "html" | "code"; content: string; lang?: string }> = [];
    const codeRegex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = codeRegex.exec(block.text)) !== null) {
      if (match.index > lastIdx) {
        parts.push({ type: "html", content: block.text.slice(lastIdx, match.index) });
      }
      parts.push({ type: "code", lang: match[1] || undefined, content: match[2]!.replace(/\n$/, "") });
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < block.text.length) {
      parts.push({ type: "html", content: block.text.slice(lastIdx) });
    }
    return parts;
  }, [block.text]);

  return (
    <div className="leading-relaxed prose prose-sm max-w-none break-words [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_code]:text-[13px] prose-headings:text-text-primary prose-p:text-text-primary prose-strong:text-text-primary prose-a:text-accent prose-li:text-text-primary">
      {html.map((part, i) => {
        const k = `${block.keyPrefix || "md"}-${i}`;
        if (part.type === "code") {
          return <CodeBlock key={k} language={part.lang}>{part.content}</CodeBlock>;
        }
        return (
          <div
            key={k}
            dangerouslySetInnerHTML={{
              __html: marked.parse(part.content, { breaks: true }) as string,
            }}
          />
        );
      })}
    </div>
  );
}

function ThinkingBlockView({ block }: { block: ThinkingBlock }): JSX.Element {
  const [open, setOpen] = useState(false);
  const preview = block.text.slice(0, 140);
  // 双主题变量:亮色淡绿(EM 品牌绿系),暗色保留紫——见 index.css --thinking-*
  return (
    <div className="my-1 rounded-md border border-[var(--thinking-border)] bg-[var(--thinking-bg)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--thinking-hover)] transition-colors"
      >
        <span className="text-[11px] text-[var(--thinking-label)] uppercase tracking-wider font-semibold">思考过程</span>
        <span className="text-text-secondary italic truncate flex-1" style={{ fontSize: "var(--chat-detail-size)" }}>{open ? "" : preview}{!open && block.text.length > 140 ? "…" : ""}</span>
        <span className="text-[10px] text-text-secondary">{open ? "▲" : "▼"}</span>
      </button>
      {open && <pre className="px-3 pb-2 text-text-secondary font-mono whitespace-pre-wrap leading-relaxed border-t border-[var(--thinking-border)]" style={{ fontSize: "var(--chat-detail-size)" }}>{block.text}</pre>}
    </div>
  );
}

function ToolGroupView({ block }: { block: ToolGroupBlock }): JSX.Element {
  const [open, setOpen] = useState(false);
  const items = block.items;
  if (items.length === 1) {
    return <SingleToolCard item={items[0]!} />;
  }
  // Group by family for summary
  const families = new Map<string, number>();
  for (const item of items) { const f = toolFamily(item.name); families.set(f, (families.get(f) || 0) + 1); }
  const summary = Array.from(families.entries()).map(([f, c]) => `${FAMILY_LABELS[f] || f} ×${c}`).join(", ");

  return (
    <div className="my-1 border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-surface-alt hover:bg-surface-hover transition-colors text-left"
      >
        <span className="text-[10px]">{open
          ? <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5"><path d="M2 3.5l3 3 3-3"/></svg>
          : <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5"><path d="M3.5 2l3 3-3 3"/></svg>
        }</span>
        <span className="text-xs text-text-secondary">{summary}</span>
      </button>
      <div className={`grid transition-all ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="border-t border-border px-3 py-1.5 space-y-1">
            {items.map((item, i) => (
              <SingleToolCard key={i} item={item} compact />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** diff 行渲染:以 - 开头的行红、+ 开头绿、@@/上下文中性;红绿只做背景+加减号,文字保持语法高亮色(对齐 cc) */
function DiffLine({ line, lang, segments, lineNoWidth }: { line: string; lang?: string; segments?: Array<{ text: string; color?: string }> | null; lineNoWidth?: number }): JSX.Element {
  if (line.startsWith("+")) {
    return (
      <div className="bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)] px-2 -mx-2">
        <HighlightedCode code={line.slice(1)} lang={lang} segments={segments} prefix="+" prefixClass="text-success" lineNoWidth={lineNoWidth} />
      </div>
    );
  }
  if (line.startsWith("-")) {
    return (
      <div className="bg-[color-mix(in_oklab,var(--color-danger)_12%,transparent)] px-2 -mx-2">
        <HighlightedCode code={line.slice(1)} lang={lang} segments={segments} prefix="-" prefixClass="text-danger" lineNoWidth={lineNoWidth} />
      </div>
    );
  }
  if (line.startsWith("@@")) {
    return <div className="text-text-muted px-2 -mx-2">{line}</div>;
  }
  // 上下文行:行号右对齐 + 中性色(不做语言高亮,对齐 cc)
  const ctxM = /^(\s*)(\d+)\s+(.*)$/.exec(line);
  if (ctxM && lineNoWidth) {
    const lineNo = ctxM[2]!.padStart(lineNoWidth);
    return <div className="px-2 -mx-2">{lineNo} <span className="text-text-muted">{ctxM[3]}</span></div>;
  }
  return <div className="px-2 -mx-2">{line}</div>;
}

/**
 * 变更行的 token 级高亮。
 * segments 已由 DiffView 批量 tokenize 传入;未传时(无语言)回退纯文本。
 * Pi 格式行首带行号(可含前导空格,"25 code" 或 " 6 code"),高亮时剥离;行号右对齐显示在加减号前。
 * 显示格式对齐 cc:"行号 + code"(行号灰色,加减号后跟空格)。
 */
function HighlightedCode({ code, lang, segments, prefix, prefixClass, lineNoWidth }: { code: string; lang?: string; segments?: Array<{ text: string; color?: string }> | null; prefix: string; prefixClass?: string; lineNoWidth?: number }): JSX.Element {
  // Pi 行号剥离:形如 "25 code" / " 6 code"(可含前导空格)
  const m = /^\s*(\d+)\s+(.*)$/.exec(code);
  const lineNo = m?.[1] ?? "";
  const bodyCode = m?.[2] ?? code;
  const lineNoPad = lineNoWidth && lineNo ? lineNo.padStart(lineNoWidth) : lineNo;
  const prefixEl = <span className={prefixClass}>{prefix}</span>;
  if (!lang || !segments) return <>{lineNoPad && <span className="text-text-muted">{lineNoPad}</span>} {prefixEl} {bodyCode}</>;
  return (
    <>
      {lineNoPad && <span className="text-text-muted">{lineNoPad}</span>} {prefixEl}{" "}
      {segments.map((s, i) => s.color
        ? <span key={i} style={{ color: s.color }}>{s.text}</span>
        : <span key={i}>{s.text}</span>)}
    </>
  );
}

// ── cc 风格 diff 渲染:标题行 + 变更统计 + hunk(多 hunk 每块 3 行上下文 + 省略号) ──

const DIFF_CONTEXT_LINES = 3;

interface DiffHunk {
  lines: string[];
}

/** 解析 diff 文本为 hunk 列表;Pi 格式的 ... 行保留为内容行(不参与分段);返回 null 表示非标准(回退完整渲染) */
function parseDiff(text: string): DiffHunk[] | null {
  const lines = text.split("\n");
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (current) hunks.push(current);
      current = { lines: [line] };
    } else {
      if (!current) current = { lines: [] };
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);
  // 过滤纯空 hunk(整个 diff 无 @@ 且内容为空)
  return hunks.length > 0 ? hunks : null;
}

/** 统计 hunk 中新增/删除行数 */
function diffStats(hunks: DiffHunk[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith("+") && !l.startsWith("+++")) added++;
      else if (l.startsWith("-") && !l.startsWith("---")) removed++;
    }
  }
  return { added, removed };
}

/** 裁剪 hunk:单 hunk 全量;多 hunk 每块仅保留变更行 + 前后 3 行上下文(对齐 cc CONTEXT_LINES) */
function trimHunk(hunk: DiffHunk, singleHunk: boolean): string[] {
  if (singleHunk) return hunk.lines;
  const lines = hunk.lines;
  const changeIdx = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.startsWith("+") || l.startsWith("-"));
  if (changeIdx.length === 0) return lines;
  const first = changeIdx[0]!.i;
  const last = changeIdx[changeIdx.length - 1]!.i;
  const from = Math.max(0, first - DIFF_CONTEXT_LINES);
  const to = Math.min(lines.length - 1, last + DIFF_CONTEXT_LINES);
  return lines.slice(from, to + 1);
}

/** diff 视图(SubagentProcessView 弹层复用):统计可导出,hunk 直接渲染 */
export function DiffView({ text, filePath: fp }: { text: string; filePath?: string }): JSX.Element {
  // 提取 "变更内容:" 后的 diff 体
  const body = text.includes("变更内容:") ? text.split("变更内容:")[1] ?? "" : text;
  const hunks = parseDiff(body);
  // 语言推断:优先用工具 input 的 file_path(可靠),其次从 diff 文本的 ---/+++ 行
  let filePath = fp || "";
  if (!filePath) {
    for (const l of body.split("\n")) {
      if (l.startsWith("+++ b/") || l.startsWith("--- a/")) {
        filePath = l.replace(/^(--- a\/|\+\+\+ b\/)/, "").trim();
        break;
      }
    }
  }
  const lang = filePath ? inferLang(filePath) : undefined;

  // 渲染单元:标准 @@ 多 hunk 之间插 ... 分隔符;Pi 格式整体一段(... 已是内容行)
  const renderUnits = hunks
    ? hunks.map((h) => ({
        sep: (h.lines[0] ?? "").startsWith("@@"),
        lines: (h.lines[0] ?? "").startsWith("@@") ? trimHunk(h, hunks.length === 1) : h.lines,
      }))
    : [{ sep: false, lines: body.split("\n") }];

  // 行号列宽:所有行行号的最大位数,右对齐(对齐 cc gutter)
  const lineNoWidth = renderUnits.reduce((w, u) => {
    for (const l of u.lines) {
      if (l.startsWith("+") || l.startsWith("-")) {
        const m = /^[+-]\s*(\d+)/.exec(l);
        if (m?.[1]) w = Math.max(w, m[1].length);
      } else {
        const m = /^\s*(\d+)/.exec(l);
        if (m?.[1]) w = Math.max(w, m[1].length);
      }
    }
    return w;
  }, 0);

  // 批量 tokenize 全部变更行(一次 warmup,消除逐行闪烁);剥离行号(Pi 格式可含前导空格)
  const [segmentsByLine, setSegmentsByLine] = useState<Array<Array<{ text: string; color?: string }> | null> | null>(null);
  const allCodes = renderUnits.flatMap((u) =>
    u.lines.map((l) => (l.startsWith("+") || l.startsWith("-") ? l.slice(1).replace(/^\s*\d+\s+/, "") : "")),
  );
  const hasHighlight = !!lang && allCodes.some((c) => c);
  const codesKey = allCodes.join("|");
  useEffect(() => {
    if (!hasHighlight) { setSegmentsByLine(null); return; }
    let cancelled = false;
    tokenizeLines(allCodes, lang!).then((res) => {
      if (!cancelled) setSegmentsByLine(res);
    });
    return () => { cancelled = true; };
  }, [codesKey, lang, hasHighlight]);

  let lineIdx = 0;
  return (
    <div className="font-mono text-[11px] leading-relaxed">
      {renderUnits.map((u, i) => (
        <div key={i}>
          {i > 0 && u.sep && <div className="px-2 -mx-2 text-text-muted">...</div>}
          {u.lines.map((l) => {
            const idx = lineIdx++;
            return (
              <DiffLine
                key={idx}
                line={l}
                lang={lang}
                segments={segmentsByLine?.[idx]}
                lineNoWidth={lineNoWidth}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** diff 变更统计(add/remove 行数) */
export function diffCount(text: string): { added: number; removed: number } {
  const body = text.includes("变更内容:") ? text.split("变更内容:")[1] ?? "" : text;
  const hunks = parseDiff(body);
  if (!hunks) return { added: 0, removed: 0 };
  return diffStats(hunks);
}

/** 从工具 input 提取文件路径(Pi edit 参数是 path,兼容 file_path) */
function editFilePath(item: ToolItem): string | undefined {
  const input = item.input;
  if (typeof input === "object" && input !== null) {
    const rec = input as Record<string, unknown>;
    const fp = rec.file_path ?? rec.path;
    if (typeof fp === "string") return fp;
  }
  return undefined;
}

/** 技术日志结果截断:超过 maxLines 只显示尾部 keep 行(完整输出见日志)——读文件等长输出是噪音,不铺给用户 */
function truncateResult(text: string, maxLines = 30, keep = 20): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(-keep).join("\n") + `\n\n[输出过长，仅显示尾部 ${keep} 行。完整输出见日志]`;
}

function SingleToolCard({ item, compact }: { item: ToolItem; compact?: boolean }): JSX.Element {
  // 默认折叠——虚拟化重挂时不再因"已有结果"误展开
  const [showInput, setShowInput] = useState(false);
  // edit diff / 失败结果 → 自动展开(可理解的结果必显、需看到的问题醒目)
  useEffect(() => {
    if (item.result && (item.result.includes("变更内容:") || item.resultError)) {
      setShowInput(true);
    }
  }, [item.result]);

  const isPathTool = item.name === "edit" || item.name === "write" || item.name === "read";
  const isDiffResult = !!item.result && item.result.includes("变更内容:");
  const diffStats_ = isDiffResult ? diffCount(item.result!) : null;
  // 人话摘要(标题行):bash→命令,文件工具→路径;用户只看"AI 在做什么",技术参数/JSON 不展示
  const summary = item.name === "bash"
    ? (typeof item.input === "string" ? item.input : ((item.input as Record<string, unknown>)?.command as string | undefined))
    : isPathTool ? editFilePath(item)
    : undefined;
  const label = item.name === "edit" ? "编辑" : item.name === "read" ? "读取" : item.name === "write" ? "写入" : item.name;

  return (
    <div className={compact ? "text-[11px]" : `border rounded-md overflow-hidden ${item.resultError ? "border-danger/40" : "border-border"}`}>
      <button
        onClick={() => setShowInput((o) => !o)}
        className={`flex items-center gap-1.5 ${item.resultError ? "text-danger hover:text-danger" : "text-text-secondary hover:text-text-primary"} transition-colors ${compact ? "py-0.5" : "w-full px-3 py-1.5 bg-surface-alt hover:bg-surface-hover"}`}
        style={{ fontSize: "var(--chat-detail-size)" }}
      >
        <span className="text-[10px]">{showInput ? "▼" : "▶"}</span>
        <span>{label}</span>
        {summary && <span className="text-text-secondary truncate font-mono">{summary}</span>}
        {item.result && !compact && (
          diffStats_ && (diffStats_.added > 0 || diffStats_.removed > 0) ? (
            <span className={`ml-auto text-[10px] shrink-0 normal-case tracking-normal ${item.resultError ? "text-danger" : "text-text-muted"}`}>
              {diffStats_.added > 0 && <span className="text-success">+{diffStats_.added}</span>}
              {diffStats_.added > 0 && diffStats_.removed > 0 && " · "}
              {diffStats_.removed > 0 && <span className="text-danger">-{diffStats_.removed}</span>}
            </span>
          ) : (
            <span className={`ml-auto text-[10px] shrink-0 ${item.resultError ? "text-danger" : "text-text-muted"}`}>
              {item.resultError ? "失败" : "完成"}
            </span>
          )
        )}
      </button>
      {showInput && item.result && (
        <div className="bg-surface border-t border-border">
          {isDiffResult ? (
            <div className="px-3 py-2"><DiffView text={item.result} filePath={editFilePath(item)} /></div>
          ) : (
            <pre className={`text-text-secondary font-mono overflow-x-auto px-3 py-2 whitespace-pre-wrap ${item.resultError ? "text-danger" : ""}`} style={{ fontSize: "var(--chat-detail-size)" }}>
              {truncateResult(item.result)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Exported render function ──────────────────────────

export function ChatBlockView({ block, streaming: _streaming }: { block: Block; streaming?: boolean }): JSX.Element | null {
  switch (block.kind) {
    case "text": return <TextBlockView block={block} />;
    case "thinking": return <ThinkingBlockView block={block} />;
    case "tool-group": return <ToolGroupView block={block} />;
    case "system": return null;
    case "tool-result-only": return <ToolResultOnlyView block={block} />;
  }
}

/** 工具结果独立显示(工具调用隐藏时):edit 显示 diff;read/write/bash 路径/命令显示在标题行;其他显示结果 */
function ToolResultOnlyView({ block }: { block: ToolResultOnlyBlock }): JSX.Element | null {
  const isDiff = block.content.includes("变更内容:");
  // 标签:工具原名(与工具卡片一致);缺省"工具结果"
  const label = block.name || "工具结果";
  const stats = isDiff ? diffCount(block.content) : null;
  // 精简显示:read/write → 路径;bash → 命令(显示在标题行,不占内容区)
  const inp = block.input;
  const summary =
    (block.name === "read" || block.name === "write") && typeof inp?.path === "string" ? inp.path
    : block.name === "bash" && typeof inp?.command === "string" ? inp.command
    : undefined;
  return (
    <div className={`my-1 rounded-md border overflow-hidden ${block.isError ? "border-danger/40" : "border-border"}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-surface-alt text-[10px] text-text-muted uppercase tracking-wider font-semibold border-b border-border">
        <span className="shrink-0">{label}</span>
        {summary && (
          <span className="normal-case tracking-normal font-normal text-text-secondary font-mono truncate">{summary}</span>
        )}
        {stats && (stats.added > 0 || stats.removed > 0) && (
          <span className="normal-case tracking-normal font-normal shrink-0">
            {stats.added > 0 && <span className="text-success">+{stats.added}</span>}
            {stats.added > 0 && stats.removed > 0 && " · "}
            {stats.removed > 0 && <span className="text-danger">-{stats.removed}</span>}
          </span>
        )}
      </div>
      {isDiff && (
        <div className="bg-surface px-3 py-2">
          <DiffView text={block.content} filePath={block.filePath} />
        </div>
      )}
      {!isDiff && !summary && (
        <div className="bg-surface px-3 py-2">
          <pre className={`text-text-secondary font-mono whitespace-pre-wrap text-[11px] ${block.isError ? "text-danger" : ""}`}>{truncateResult(block.content)}</pre>
        </div>
      )}
    </div>
  );
}
