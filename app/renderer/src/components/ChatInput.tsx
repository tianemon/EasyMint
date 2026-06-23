import { memo, useRef, useState, useCallback, useEffect } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { useStatusStore } from "../stores/status-store";
import { CommandPalette } from "./CommandPalette";
import { QuickPrompts } from "./QuickPrompts";

interface AttachItem { name: string; path: string; dataUrl?: string; kind: "image" | "doc"; }

interface ChatInputProps {
  busy: boolean;
  attaches: AttachItem[];
  setAttaches: (a: AttachItem[] | ((prev: AttachItem[]) => AttachItem[])) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onPaste: (e: React.ClipboardEvent) => void;
  imgInputRef: React.RefObject<HTMLInputElement | null>;
  docInputRef: React.RefObject<HTMLInputElement | null>;
  onImgChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDocChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  permissionMode: string;
  onPermissionModeChange: (v: string) => void;
  chatModel: string;
  onModelChange: (m: string) => void;
}

function AttachPreview_({ attaches, setAttaches }: { attaches: AttachItem[]; setAttaches: (a: AttachItem[] | ((prev: AttachItem[]) => AttachItem[])) => void }): JSX.Element {
  const removeAttach = useCallback((idx: number) => {
    setAttaches((prev) => prev.filter((_, i) => i !== idx));
  }, [setAttaches]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {attaches.map((a, i) => (
        <div key={i} className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-alt border border-border text-[11px] text-text-primary">
          {a.kind === "image" && a.dataUrl ? (
            <img src={a.dataUrl} className="w-4 h-4 rounded object-cover" alt={a.name} />
          ) : (
            <span className="text-[10px] text-text-secondary">📎</span>
          )}
          <span className="truncate max-w-[120px]">{a.name}</span>
          <button className="text-text-secondary hover:text-danger transition-colors text-[11px]" onClick={() => removeAttach(i)}>✕</button>
        </div>
      ))}
    </div>
  );
}
const AttachPreview = memo(AttachPreview_);

export const ChatInput = memo(function ChatInput({
  busy, attaches, setAttaches, onSend, onStop, onPaste,
  imgInputRef, docInputRef, onImgChange, onDocChange,
  permissionMode, onPermissionModeChange, chatModel, onModelChange,
}: ChatInputProps): JSX.Element {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [paletteQuery, setPaletteQuery] = useState<string | null>(null);
  const availableModels = useSettingsStore((s) => s.availableModels);
  const ctxPct = useStatusStore((s) => s.ctxPct);
  const summarizing = useStatusStore((s) => s.summarizing);
  const [balanceText, setBalanceText] = useState("");
  const refreshBalance = useCallback(async () => {
    try {
      const data = await window.electronAPI.settings.fetchBalance();
      if (data?.balance_infos?.length) setBalanceText(data.balance_infos[0]!.total_balance);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshBalance(); const t = setInterval(refreshBalance, 5 * 60 * 1000); return () => clearInterval(t); }, [refreshBalance]);

  // 输入历史导航
  const HISTORY_KEY = "easymint_input_history";
  const inputHistoryRef = useRef<string[]>(
    (() => { try { const v = localStorage.getItem(HISTORY_KEY); return v ? JSON.parse(v) : []; } catch { return []; } })()
  );
  const historyPosRef = useRef(-1);
  const savedInputRef = useRef("");

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    if (value.startsWith("/") && !value.includes("\n") && !value.includes(" ")) {
      setPaletteQuery(value);
    } else {
      setPaletteQuery(null);
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (paletteQuery !== null && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter" || e.key === "Escape")) return;
    // ↑↓ 历史导航
    if (e.key === "ArrowUp" && !e.shiftKey) {
      e.preventDefault();
      const hist = inputHistoryRef.current;
      if (hist.length === 0) return;
      if (historyPosRef.current === -1) savedInputRef.current = input;
      const next = historyPosRef.current + 1;
      if (next < hist.length) {
        historyPosRef.current = next;
        setInput(hist[next]!);
      }
    } else if (e.key === "ArrowDown" && !e.shiftKey) {
      e.preventDefault();
      const prev = historyPosRef.current - 1;
      if (prev >= 0) {
        historyPosRef.current = prev;
        setInput(inputHistoryRef.current[prev]!);
      } else if (prev === -1) {
        historyPosRef.current = -1;
        setInput(savedInputRef.current);
      }
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (input.trim() || attaches.length > 0) {
        // 存历史
        const msg = input.trim();
        if (msg) {
          const hist = inputHistoryRef.current;
          if (msg !== hist[0]) { hist.unshift(msg); if (hist.length > 100) hist.pop(); }
          try { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist)); } catch { /* */ }
          historyPosRef.current = -1;
        }
        onSend(input); setInput(""); textareaRef.current?.focus();
      }
    }
  }, [paletteQuery, input, attaches, onSend]);

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface shrink-0">
        <input ref={imgInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml" multiple className="hidden" onChange={onImgChange} />
        <input ref={docInputRef} type="file" multiple className="hidden" onChange={onDocChange} accept=".pdf,.doc,.docx,.md,.txt,.csv,.xls,.xlsx,.ts,.tsx,.js,.jsx,.py,.java,.json,.yaml,.yml,.toml,.html,.css,.sh,.env,.cfg" />
        <button className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-accent transition-colors" title="上传图片" onClick={() => imgInputRef.current?.click()}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><circle cx="5" cy="6" r="1.2"/><path d="M1.5 11l3.5-3.5 2.5 2.5 3-4 4 5"/></svg>
        </button>
        <button className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-accent transition-colors" title="上传文档" onClick={() => docInputRef.current?.click()}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M3 2h7l4 4v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v4h4M6 9h4M6 12h4"/></svg>
        </button>
        <button className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-accent transition-colors" title="快捷命令（输入 / 也能触发）" onClick={() => setPaletteQuery("")}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M2.5 4l3 4-3 4"/><path d="M7 12h6.5"/></svg>
        </button>
        <div className="flex-1" />
        <select value={permissionMode} onChange={(e) => onPermissionModeChange(e.target.value)} className="text-[11px] px-2 py-1 rounded-md bg-surface border border-border text-text-primary outline-none focus:border-accent cursor-pointer">
          <option value="auto">智能判断</option><option value="plan">只读</option><option value="acceptEdits">手动确认</option><option value="bypassPermissions">完全自主</option>
        </select>
        <span className="text-[10px] text-text-secondary hidden sm:inline">权限</span>
        <select value={chatModel} onChange={(e) => onModelChange(e.target.value)} className="text-[11px] px-2 py-1 rounded-md bg-surface border border-border text-text-primary outline-none focus:border-accent cursor-pointer max-w-[200px]" title="切换模型">
          {availableModels.map((m) => (<option key={m} value={m}>{m}</option>))}
        </select>
        {balanceText && <span className="text-[10px] text-text-secondary cursor-pointer hover:text-accent transition-colors" onClick={refreshBalance} title="账户余额，点击刷新">{balanceText}</span>}
        <span className="text-[10px] text-text-secondary" title="上下文使用率，可设置阈值">{ctxPct}%</span>
      </div>

      {/* Input area */}
      <div className="border-t border-border p-3 pt-2 shrink-0 relative">
        {paletteQuery !== null && (
          <CommandPalette
            initialQuery={paletteQuery}
            onClose={() => setPaletteQuery(null)}
            onPick={(text) => { setInput(text); setPaletteQuery(null); textareaRef.current?.focus(); }}
          />
        )}
        {!busy && attaches.length > 0 && <div className="mb-2"><AttachPreview attaches={attaches} setAttaches={setAttaches} /></div>}
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={onPaste}
            placeholder={summarizing ? "正在进行会话摘要..." : "输入消息，Enter 发送，Shift+Enter 换行，粘贴或拖入图片..."}
            rows={3}
            disabled={summarizing}
            className="chat-input flex-1 min-h-[90px] resize-none bg-surface border border-border rounded-[10px] px-[14px] py-[10px] text-[13px] text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-inset disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <div className="flex flex-col gap-1.5 shrink-0">
            {!summarizing && (
              <QuickPrompts onFill={(text) => { setInput(text); textareaRef.current?.focus(); }} />
            )}
            {summarizing ? (
              <div className="w-9 h-9 rounded-md bg-surface-alt border border-border flex items-center justify-center opacity-40 cursor-not-allowed">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M1 1l14 7-14 7 4-7-4-7z"/></svg>
              </div>
            ) : busy ? (
              <button onClick={onStop} className="w-9 h-9 rounded-md bg-danger-bg text-danger flex items-center justify-center hover:bg-danger-bg transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>
              </button>
            ) : (
              <button
                className="w-9 h-9 rounded-md bg-accent text-text-inverse flex items-center justify-center hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                disabled={!input.trim() && attaches.length === 0}
                onClick={() => { onSend(input); setInput(""); textareaRef.current?.focus(); }}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M1 1l14 7-14 7 4-7-4-7z"/></svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
});
