import { memo, useRef, useState, useCallback } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { useStatusStore } from "../stores/status-store";
import { useDelegationStore } from "../stores/delegation-store";
import { Select } from "./Select";
import { AgentBar } from "./AgentBar";
import { ShellBar } from "./ShellBar";

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
  thinkingLevel: string;
  onThinkingLevelChange: (v: string) => void;
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
  thinkingLevel, onThinkingLevelChange,
  sessionId, onStatsClick,
}: ChatInputProps & { sessionId: string; onStatsClick: () => void }): JSX.Element {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const availableModels = useSettingsStore((s) => s.availableModels);
  const indicatorOrder = useDelegationStore((s) => s.order);
  const ctxPct = useStatusStore((s) => s.ctxPct);
  const summarizing = useStatusStore((s) => s.summarizing);
  const compacting = useStatusStore((s) => s.compacting);
  const inputDisabled = summarizing || compacting;
  // 余额显示 v3 已隐藏（原型未展示），代码保留注释不删除
  // const [balanceText, setBalanceText] = useState("");
  // const refreshBalance = useCallback(async () => {
  //   try {
  //     const data = await window.electronAPI.settings.fetchBalance();
  //     if (data?.balance_infos?.length) setBalanceText(data.balance_infos[0]!.total_balance);
  //   } catch { /* ignore */ }
  // }, []);
  // useEffect(() => { refreshBalance(); const t = setInterval(refreshBalance, 5 * 60 * 1000); return () => clearInterval(t); }, [refreshBalance]);

  // 输入历史导航
  const HISTORY_KEY = "easymint_input_history";
  const inputHistoryRef = useRef<string[]>(
    (() => { try { const v = localStorage.getItem(HISTORY_KEY); return v ? JSON.parse(v) : []; } catch { return []; } })()
  );
  const historyPosRef = useRef(-1);
  const savedInputRef = useRef("");

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
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
      // busy 时允许发送 = 插话打断（走 steer,对齐 cc interrupt 语义）；仅 inputDisabled 拦截
      if (inputDisabled) return;
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
  }, [input, attaches, onSend, busy, inputDisabled]);

  return (
    <div className="input-card">
      {/* Compact 蒙版 */}
      {compacting && (
        <div className="absolute inset-0 z-10 rounded-[10px] bg-surface/70 backdrop-blur-[2px] flex items-center justify-center">
          <span className="text-sm text-text-secondary font-medium">Mint 正在总结对话，请稍后…</span>
        </div>
      )}
      {/* 上半：输入框 */}
      <div className="input-top">
        {!busy && attaches.length > 0 && <AttachPreview attaches={attaches} setAttaches={setAttaches} />}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          placeholder={compacting ? "Mint正在总结对话，请稍后" : summarizing ? "正在进行会话摘要..." : "Enter 发送，Shift+Enter 换行，可粘贴或拖入图片"}
          rows={4}
          disabled={inputDisabled}
          className="chat-input"
        />
      </div>
      {/* 下半：工具栏 */}
      <div className="input-bar">
        <input ref={imgInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml" multiple className="hidden" onChange={onImgChange} />
        <input ref={docInputRef} type="file" multiple className="hidden" onChange={onDocChange} accept=".pdf,.doc,.docx,.md,.txt,.csv,.xls,.xlsx,.ts,.tsx,.js,.jsx,.py,.java,.json,.yaml,.yml,.toml,.html,.css,.sh,.env,.cfg" />
        <button className="inp-icon-btn" title="上传图片" onClick={() => imgInputRef.current?.click()}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><circle cx="5" cy="6" r="1.2"/><path d="M1.5 11l3.5-3.5 2.5 2.5 3-4 4 5"/></svg>
        </button>
        <button className="inp-icon-btn" title="上传文档" onClick={() => docInputRef.current?.click()}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 2h7l4 4v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v4h4M6 9h4M6 12h4"/></svg>
        </button>
        {sessionId && !sessionId.startsWith("__new_") && (
          <button className="inp-icon-btn" title="会话统计" onClick={onStatsClick}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="1.5" width="13" height="13" rx="2"/><path d="M5 11V7M8 11V5M11 11V9"/></svg>
          </button>
        )}
        {/* 后台指示器胶囊:agent/shell 按出现顺序排列,谁先出现谁靠左 */}
        <div className="flex items-center gap-2 shrink-0">
          {indicatorOrder.map((k) => (k === "agent" ? <AgentBar key="agent" /> : <ShellBar key="shell" />))}
        </div>
        <span className="inp-gap" />
        <span className="inp-lbl">权限</span>
        <Select
          value={permissionMode}
          onChange={onPermissionModeChange}
          title="权限模式"
          options={[
            { value: "auto", label: "智能判断" },
            { value: "plan", label: "只读" },
            { value: "acceptEdits", label: "手动确认" },
            { value: "bypassPermissions", label: "完全自主" },
          ]}
        />
        <span className="inp-lbl">模型</span>
        <Select
          value={chatModel}
          onChange={onModelChange}
          title="切换模型"
          options={availableModels.length > 0 ? availableModels.map((m) => ({ value: m, label: m })) : [{ value: "", label: "暂无可选模型" }]}
        />
        <span className="inp-lbl">思考</span>
        <Select
          value={thinkingLevel}
          onChange={onThinkingLevelChange}
          title="思考深度"
          options={[
            { value: "off", label: "关闭(off)" },
            { value: "minimal", label: "极简(minimal)" },
            { value: "low", label: "低(low)" },
            { value: "medium", label: "中(medium)" },
            { value: "high", label: "高(high)" },
            { value: "xhigh", label: "超高(xhigh)" },
            { value: "max", label: "最大(max)" },
          ]}
        />
        {/* 余额显示原型未展示，隐藏不删除（v3 原则 2） */}
        {/* <span className="inp-val">{balanceText}</span> */}
        <div className="ctx-ring" title="上下文使用率">
          <svg width="20" height="20" viewBox="0 0 20 20">
            <circle className="ctx-ring-track" cx="10" cy="10" r="8"/>
            <circle className="ctx-ring-fill" cx="10" cy="10" r="8"
              strokeDasharray="50.27" strokeDashoffset={50.27 * (1 - ctxPct / 100)}/>
          </svg>
          <span className="ctx-ring-pct">{Math.round(ctxPct)}%</span>
        </div>
        {inputDisabled ? (
          <button className="send-btn" disabled><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1l14 7-14 7 4-7-4-7z"/></svg></button>
        ) : busy && !input.trim() && attaches.length === 0 ? (
          // 忙碌且无输入 → 打断按钮；有输入 → 发送按钮（插话打断）
          <button onClick={onStop} className="stop-btn"><svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg></button>
        ) : (
          <button
            className="send-btn"
            disabled={!input.trim() && attaches.length === 0}
            onClick={() => { onSend(input); setInput(""); textareaRef.current?.focus(); }}
          ><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1l14 7-14 7 4-7-4-7z"/></svg></button>
        )}
      </div>
    </div>
  );
});
