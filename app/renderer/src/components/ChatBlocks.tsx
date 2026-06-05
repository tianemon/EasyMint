import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { StreamEntry } from "./StreamPanel";

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
}

interface ToolGroupBlock {
  kind: "tool-group";
  items: ToolItem[];
}

interface SystemBlock {
  kind: "system";
  message: string;
}

type Block = TextBlock | ThinkingBlock | ToolGroupBlock | SystemBlock;

// ── buildBlocks: merge consecutive events of the same type ──

export function buildBlocks(entries: StreamEntry[], keyPrefix = ""): Block[] {
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
    else if (e.kind === "tool_result") { /* skip, results are attached inline */ }
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
      <pre className="px-4 py-3 overflow-x-auto text-xs leading-relaxed font-mono text-text-primary whitespace-pre" style={{ background: 'var(--color-code-block-bg)' }}>
        <code>{children}</code>
      </pre>
    </div>
  );
}

function TextBlockView({ block }: { block: TextBlock }): JSX.Element {
  return (
    <div className="text-sm leading-relaxed prose prose-sm max-w-none prose-headings:text-text-primary prose-p:text-text-primary prose-strong:text-text-primary prose-code:before:content-none prose-code:after:content-none prose-a:text-accent prose-li:text-text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const isBlock = String(children).includes("\n");
            if (isBlock && match) {
              return <CodeBlock language={match[1]}>{String(children).replace(/\n$/, "")}</CodeBlock>;
            }
            if (isBlock) {
              return <CodeBlock>{String(children).replace(/\n$/, "")}</CodeBlock>;
            }
            // inline code
            return <code className="px-1 py-0.5 rounded text-xs bg-surface-alt text-accent font-mono" {...props}>{children}</code>;
          },
        }}
      >
        {block.text}
      </ReactMarkdown>
    </div>
  );
}

function ThinkingBlockView({ block }: { block: ThinkingBlock }): JSX.Element {
  const [open, setOpen] = useState(false);
  const preview = block.text.slice(0, 140);
  return (
    <div className="my-1 rounded-md border border-purple-500/20 bg-purple-500/[0.04]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-purple-500/[0.06] transition-colors"
      >
        <span className="text-[11px] text-purple-300/80 uppercase tracking-wider font-semibold">思考中</span>
        <span className="text-[11px] text-text-secondary italic truncate flex-1">{open ? "" : preview}{!open && block.text.length > 140 ? "…" : ""}</span>
        <span className="text-[10px] text-text-secondary">{open ? "▲" : "▼"}</span>
      </button>
      {open && <pre className="px-3 pb-2 text-[11px] text-text-secondary font-mono whitespace-pre-wrap leading-relaxed border-t border-purple-500/10">{block.text}</pre>}
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

function SingleToolCard({ item, compact }: { item: ToolItem; compact?: boolean }): JSX.Element {
  const [showInput, setShowInput] = useState(false);
  const inputStr = typeof item.input === "string" ? item.input : JSON.stringify(item.input, null, 2);
  return (
    <div className={compact ? "text-[11px]" : "border border-border rounded-md overflow-hidden"}>
      <button
        onClick={() => setShowInput((o) => !o)}
        className={`flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors ${compact ? "py-0.5" : "w-full px-3 py-1.5 bg-surface-alt hover:bg-surface-hover text-xs"}`}
      >
        <span className="text-[10px]">{showInput ? "▼" : "▶"}</span>
        <span>{item.name}</span>
        {compact && <span className="text-text-secondary truncate text-[10px]">{inputStr.slice(0, 60)}</span>}
      </button>
      {showInput && (
        <pre className={`text-[10px] text-text-secondary font-mono overflow-x-auto bg-surface border-t border-border ${compact ? "px-3 py-1" : "px-3 py-2"}`}>
          {inputStr}
        </pre>
      )}
    </div>
  );
}

function SystemBlockView({ block }: { block: SystemBlock }): JSX.Element {
  const isError = block.message.startsWith("✗") || block.message.startsWith("⚠");
  return (
    <div className={`text-xs px-2 py-1 rounded ${isError ? "text-danger bg-danger-bg" : block.message.startsWith("✓") ? "text-success bg-success-bg" : "text-text-secondary bg-surface-alt"}`}>
      {block.message}
    </div>
  );
}

// ── Exported render function ──────────────────────────

export function ChatBlockView({ block, streaming }: { block: Block; streaming?: boolean }): JSX.Element | null {
  switch (block.kind) {
    case "text": return <TextBlockView block={block} />;
    case "thinking": return <ThinkingBlockView block={block} />;
    case "tool-group": return <ToolGroupView block={block} />;
    case "system": return null;
  }
}
