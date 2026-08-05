import { useState } from "react";
import { PinIcon } from "./PinLayer";
import { usePinStore } from "../stores/pin-store";

/** 气泡复制按钮：复制整条文本 */
function CopyBubbleBtn({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };
  return (
    <button
      onClick={handleCopy}
      title="复制消息"
      className="flex items-center justify-center w-6 h-6 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.5 3.5L13 5.5"/></svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2"/></svg>
      )}
    </button>
  );
}

/** 气泡钉住按钮：把整条文本钉为便签；
    已钉状态由 store 驱动（同内容便签存在即显示勾，任何入口钉住/删除都联动） */
function PinBubbleBtn({ text, onPin, sid }: { text: string; onPin: (text: string) => void; sid: string }): JSX.Element {
  const pinned = usePinStore((s) => (s.pinsBySession[sid] || []).some((p) => p.content === text));
  const handlePin = () => {
    if (!text.trim()) return;
    onPin(text);
  };
  return (
    <button
      onClick={handlePin}
      title={pinned ? "已钉为便签" : "钉为便签"}
      className="flex items-center justify-center w-6 h-6 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
    >
      {pinned ? (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.5 3.5L13 5.5"/></svg>
      ) : (
        <PinIcon className="w-[11px] h-[11px]" />
      )}
    </button>
  );
}

/** 气泡操作容器：复制 + 钉住按钮统一挂在一体化工具条中；
    默认隐藏，由消息 hover 状态驱动显隐（visible），隐藏时不可交互 */
export function BubbleActions({ text, onPin, sid, visible }: { text: string; onPin: (text: string) => void; sid: string; visible: boolean }): JSX.Element {
  return (
    <div className={`absolute top-full left-0 mt-1 flex items-center rounded-md border border-border bg-surface-elevated shadow-sm overflow-hidden transition-opacity duration-150 ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
      <CopyBubbleBtn text={text} />
      <PinBubbleBtn text={text} onPin={onPin} sid={sid} />
    </div>
  );
}

// ── 群聊角色头像色板(同一角色固定颜色,需求 4) ─────
const GROUP_AVATAR_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
export function roleColor(role: string): string {
  let h = 0;
  for (let i = 0; i < role.length; i++) h = (h * 31 + role.charCodeAt(i)) >>> 0;
  return GROUP_AVATAR_COLORS[h % GROUP_AVATAR_COLORS.length]!;
}

// ── Doc Icon ────────────────────────────────────────
export function DocIcon({ name }: { name: string }): JSX.Element {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const codeExts = new Set(["ts","tsx","js","jsx","py","rs","go","java","c","cpp","h","hpp","cs","rb","php","swift","kt","scala","sh","bash","zsh","vue","svelte","sql","r","dart","lua","zig","elm","hs","clj","fs","fsx","rkt","scm","ss"]);
  const dataExts = new Set(["csv","xls","xlsx","ods","tsv"]);
  const configExts = new Set(["env","gitignore","dockerfile","cfg","ini","conf","toml","yml","yaml","json","xml","makefile","cmake","gradle","lock","editorconfig","prettierrc","eslintrc"]);
  const docExts = new Set(["md","markdown","txt","pdf","doc","docx","pages","rst","tex","log"]);
  if (docExts.has(ext) || ext === "pdf") {
    return <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 shrink-0"><rect x="3" y="2" width="18" height="20" rx="2" className="fill-file-doc stroke-file-doc" strokeWidth="1.2" style={{ fill: 'var(--color-file-doc-bg)', stroke: 'var(--color-file-doc-stroke)' }}/><text x="12" y="17" textAnchor="middle" fill="var(--color-file-doc-stroke)" fontSize="7" fontWeight="600" fontFamily="system-ui">{ext === "pdf" ? "PDF" : "DOC"}</text></svg>;
  }
  if (codeExts.has(ext)) {
    return <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 shrink-0"><rect x="3" y="2" width="18" height="20" rx="2" className="fill-file-code stroke-file-code" strokeWidth="1.2" style={{ fill: 'var(--color-file-code-bg)', stroke: 'var(--color-file-code-stroke)' }}/><path d="M8 9h8M8 13h6M8 17h4" className="stroke-file-code" strokeWidth="1.3" strokeLinecap="round"/></svg>;
  }
  if (dataExts.has(ext)) {
    return <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 shrink-0"><rect x="3" y="2" width="18" height="20" rx="2" className="fill-file-data stroke-file-data" strokeWidth="1.2" style={{ fill: 'var(--color-file-data-bg)', stroke: 'var(--color-file-data-stroke)' }}/><path d="M7 9h10M7 13h10M7 17h10" className="stroke-file-data" strokeWidth="1.3" strokeLinecap="round"/></svg>;
  }
  if (configExts.has(ext)) {
    return <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 shrink-0"><rect x="3" y="2" width="18" height="20" rx="2" className="fill-file-config stroke-file-config" strokeWidth="1.2" style={{ fill: 'var(--color-file-config-bg)', stroke: 'var(--color-file-config-stroke)' }}/><circle cx="12" cy="11" r="3" className="stroke-file-config" strokeWidth="1.3"/><path d="M12 14v3M10 8l2-3 2 3" className="stroke-file-config" strokeWidth="1.3" strokeLinecap="round"/></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 shrink-0"><rect x="3" y="2" width="18" height="20" rx="2" className="fill-file-other stroke-file-other" strokeWidth="1.2" style={{ fill: 'var(--color-file-other-bg)', stroke: 'var(--color-file-other-stroke)' }}/><path d="M8 9h8M8 13h8M8 17h5" className="stroke-file-other" strokeWidth="1.3" strokeLinecap="round"/></svg>;
}
