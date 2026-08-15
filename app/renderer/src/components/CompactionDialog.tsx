import { useState } from "react";

/**
 * 上下文压缩确认弹层 — 自动触发(阈值)与手动(统计弹窗按钮)共用。
 * 选项(用户定稿排序): ① 立即压缩(系统自动总结) ④ 输入指令压缩
 * ③ 写交接提示词(不压缩,Mint 总结供复制,为开启新会话做准备)
 * ② 下次回复完触发(回复结束重新询问,同样流程)
 */
export function CompactionDialog({
  title,
  onImmediate,
  onWithInstructions,
  onWriteHandoff,
  onDefer,
  onClose,
}: {
  title: string;
  onImmediate: () => void;
  onWithInstructions: (instructions: string) => void;
  onWriteHandoff: () => void;
  onDefer: () => void;
  onClose: () => void;
}): JSX.Element {
  const [instructions, setInstructions] = useState("");
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-xl p-5 max-w-md w-full shadow-2xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium text-text-primary">{title}</div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary shrink-0">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M3 3l8 8M11 3L3 11"/></svg>
          </button>
        </div>
        <p className="text-xs text-text-secondary mb-3">压缩会整理对话上下文、释放空间；写交接提示词则不压缩，由 Mint 总结供你复制。</p>
        <div className="space-y-1">
          <button
            type="button"
            onClick={onImmediate}
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-hover text-xs text-text-primary transition-colors"
          >
            是，立即压缩（系统自动总结）
          </button>
          <button
            type="button"
            onClick={onWriteHandoff}
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-hover text-xs text-text-primary transition-colors"
          >
            否，开启新会话，帮我写交接提示词
          </button>
          <button
            type="button"
            onClick={onDefer}
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-hover text-xs text-text-primary transition-colors"
          >
            否，Mint 下次回复完触发
          </button>
        </div>
        {/* 分隔线 + 输入指令区 */}
        <div className="border-t border-border/60 my-3" />
        <div className="flex items-center gap-2">
          <input
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onWithInstructions(instructions.trim()); }}
            placeholder="输入压缩指令，例如保留某个上下文信息…"
            autoFocus
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface-alt text-xs text-text-primary outline-none placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={() => onWithInstructions(instructions.trim())}
            className="px-3 py-1.5 rounded-lg bg-accent text-text-inverse text-xs font-medium hover:bg-accent-hover transition-colors shrink-0"
          >
            是，输入指令
          </button>
        </div>
      </div>
    </div>
  );
}
