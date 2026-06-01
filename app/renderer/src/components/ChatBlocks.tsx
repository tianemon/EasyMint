import { useState } from "react";
import type { StreamEntry } from "./StreamPanel";

// ── Block types ──────────────────────────────────────

interface TextBlock {
  kind: "text";
  text: string;
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

export function buildBlocks(entries: StreamEntry[]): Block[] {
  const blocks: Block[] = [];
  let textBuf = "";
  let thinkBuf = "";
  let toolBuf: ToolItem[] = [];
  let sysBuf = "";

  const flushText = () => { if (textBuf) { blocks.push({ kind: "text", text: textBuf.trim() }); textBuf = ""; } };
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

function TextBlockView({ block }: { block: TextBlock }): JSX.Element {
  return <div className="text-sm leading-relaxed whitespace-pre-wrap">{block.text}</div>;
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
        <svg className="w-3.5 h-3.5 text-purple-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 5h5l-4 3 1.5 5-4-3-4 3 1.5-5-4-3h5L12 2z"/></svg>
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
        <span className="text-[10px]">{open ? "▼" : "▶"}</span>
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
