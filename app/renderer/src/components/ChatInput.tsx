import { memo, useRef, useState, useCallback, useMemo } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { THINKING_LABELS, THINKING_ORDER } from "@shared/thinking-levels";
import { useStatusStore } from "../stores/status-store";
import { useDelegationStore } from "../stores/delegation-store";
import { useThemeStore } from "../stores/theme-store";
import { Select } from "./Select";
import { AgentBar } from "./AgentBar";
import { ShellBar } from "./ShellBar";
import { OrbitGlow } from "./OrbitGlow";
import { SlideGlow } from "./SlideGlow";
import { BreatheGlow } from "./BreatheGlow";

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
  /** 被模型能力裁剪后实际生效的等级（与所选不同时非空，用于向用户说明） */
  thinkingCapped?: string | null;
  /** 当前模型支持的思考等级（只展示这些档位；为空表示未知，展示全部） */
  thinkingLevels?: string[] | null;
  onThinkingLevelChange: (v: string) => void;
}

// 档位名称与顺序见 @shared/thinking-levels（主进程与渲染层共用）

function AttachPreview_({ attaches, setAttaches }: { attaches: AttachItem[]; setAttaches: (a: AttachItem[] | ((prev: AttachItem[]) => AttachItem[])) => void }): JSX.Element {
  const removeAttach = useCallback((idx: number) => {
    setAttaches((prev) => prev.filter((_, i) => i !== idx));
  }, [setAttaches]);
  return (
    <div className="flex flex-wrap items-end gap-1.5">
      {attaches.map((a, i) => a.kind === "image" && a.dataUrl ? (
        // 图片附件:固定 64×64 容器,图片 object-contain 按最长边 64 居中显示(横图限宽/竖图限高,
        // 纵横比保持),删除按钮贴容器右上角
        <div key={i} className="relative shrink-0 w-16 h-16 rounded-md bg-surface-alt border border-border overflow-hidden">
          <img src={a.dataUrl} className="w-full h-full object-contain" alt={a.name} />
          <button
            type="button"
            className="absolute top-0 right-0 w-5 h-5 rounded-tr-md border-l border-b border-border bg-surface-alt/95 text-text-secondary hover:text-danger transition-colors flex items-center justify-center text-[length:var(--text-11)] leading-none"
            onClick={() => removeAttach(i)}
            title="移除图片"
          >✕</button>
        </div>
      ) : (
        // 文档附件:与图片同款 64×64 容器,仅显示文档名(单行截断居中,无图标)
        <div key={i} className="relative shrink-0 w-16 h-16 rounded-md bg-surface-alt border border-border overflow-hidden flex items-center justify-center px-1">
          <span className="truncate w-full text-center text-[length:var(--text-11)] text-text-primary leading-tight">{a.name}</span>
          <button
            type="button"
            className="absolute top-0 right-0 w-5 h-5 rounded-tr-md border-l border-b border-border bg-surface-alt/95 text-text-secondary hover:text-danger transition-colors flex items-center justify-center text-[length:var(--text-11)] leading-none"
            onClick={() => removeAttach(i)}
            title="移除文档"
          >✕</button>
        </div>
      ))}
    </div>
  );
}
export const AttachPreview = memo(AttachPreview_);

export const ChatInput = memo(function ChatInput({
  busy, attaches, setAttaches, onSend, onStop, onPaste,
  imgInputRef, docInputRef, onImgChange, onDocChange,
  permissionMode, onPermissionModeChange, chatModel, onModelChange,
  thinkingLevel, thinkingCapped, thinkingLevels, onThinkingLevelChange,
  sessionId, onStatsClick,
}: ChatInputProps & { sessionId: string; onStatsClick: () => void }): JSX.Element {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const availableModels = useSettingsStore((s) => s.availableModels);
  const indicatorOrder = useDelegationStore((s) => s.order);
  const ctxPct = useStatusStore((s) => s.bySession[sessionId]?.ctxPct ?? null);
  const summarizing = useStatusStore((s) => s.bySession[sessionId]?.summarizing ?? false);
  const compacting = useStatusStore((s) => s.bySession[sessionId]?.compacting ?? false);
  const inputDisabled = summarizing || compacting;
  // 状态指示光效配置
  const glowEffect = useSettingsStore((s) => s.glowEffect);
  const glowColorMode = useSettingsStore((s) => s.glowColorMode);
  const glowColorLight = useSettingsStore((s) => s.glowColorLight);
  const glowColorDark = useSettingsStore((s) => s.glowColorDark);
  const glowGroupsLight = useSettingsStore((s) => s.glowGroupsLight);
  const glowGroupsDark = useSettingsStore((s) => s.glowGroupsDark);
  const activeGlowGroupLight = useSettingsStore((s) => s.activeGlowGroupLight);
  const activeGlowGroupDark = useSettingsStore((s) => s.activeGlowGroupDark);
  // 流光环绕动画活跃:回合进行 ∪ 子 Agent 运行 ∪ 后台 shell 运行(替代状态栏常驻符号动画)
  const agentActive = useDelegationStore((s) => s.agentTasks.some((t) => !t.sessionId || t.sessionId === sessionId));
  const shellActive = useDelegationStore((s) => s.shellTasks.some((t) => !t.sessionId || t.sessionId === sessionId));
  const glowActive = busy || agentActive || shellActive;
  // 按主题取亮/暗配置;单色模式用单色填满,多色模式用启用组的色彩组合
  const isDark = useThemeStore((s) => s.effective) === "dark";
  const glowColors = useMemo(() => {
    if (glowColorMode === "solid") {
      const single = isDark ? glowColorDark : glowColorLight;
      return [single || "#16a34a"];
    }
    const groups = isDark ? glowGroupsDark : glowGroupsLight;
    const activeId = isDark ? activeGlowGroupDark : activeGlowGroupLight;
    const active = groups.find((g) => g.id === activeId);
    const colors = active?.colors && active.colors.length > 0 ? active.colors : ["#16a34a"];
    return colors;
  }, [glowColorMode, isDark, glowColorLight, glowColorDark, glowGroupsLight, glowGroupsDark, activeGlowGroupLight, activeGlowGroupDark]);


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
      {/* 状态指示光效(活跃=bussy||agentActive||shellActive):三预设全 canvas 绘制,组件挂载即动画;
          参数固定(粗细/速度/拖尾为组件内部常量,仅颜色可改) */}
      {glowActive && glowEffect !== "off" && (glowEffect === "orbit" ? (
        <OrbitGlow colors={glowColors} />
      ) : glowEffect === "slide" ? (
        <SlideGlow colors={glowColors} />
      ) : (
        <BreatheGlow colors={glowColors} />
      ))}
      {/* Compact 蒙版 */}
      {compacting && (
        <div className="absolute inset-0 z-10 rounded-[10px] bg-surface/70 backdrop-blur-[2px] flex items-center justify-center">
          <span className="text-sm text-text-secondary font-medium">正在整理上下文，请稍候…</span>
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
          placeholder={compacting ? "正在整理上下文，请稍候" : summarizing ? "正在进行会话摘要..." : "Enter 发送，Shift+Enter 换行，可粘贴或拖入图片"}
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
        {/* 后台指示器胶囊:agent/shell 按出现顺序排列,谁先出现谁靠左;按会话过滤(委派是主会话发起的) */}
        <div className="flex items-center gap-2 shrink-0">
          {indicatorOrder.map((k) => (k === "agent" ? <AgentBar key="agent" sessionId={sessionId} /> : <ShellBar key="shell" sessionId={sessionId} />))}
        </div>
        <span className="inp-gap" />
        <span className="inp-lbl">权限</span>
        <button
          type="button"
          role="switch"
          aria-checked={permissionMode === "full"}
          title={permissionMode === "full"
            ? "完全访问：可读写当前项目之外的文件（用户目录仍禁止写入；系统核心与凭据目录禁止访问）"
            : "标准：可读写当前项目内文件，可读取项目外普通位置（系统核心与凭据目录禁止访问，用户目录禁止写入）"}
          onClick={() => onPermissionModeChange(permissionMode === "full" ? "standard" : "full")}
          className="flex items-center gap-1.5 shrink-0 group"
        >
          <span className={`text-[length:var(--text-xs)] transition-colors ${permissionMode === "full" ? "text-[var(--color-permission-on)]" : "text-text-secondary"}`}>
            {permissionMode === "full" ? "完全访问" : "标准"}
          </span>
          <span className={`relative w-8 h-[18px] rounded-full transition-colors overflow-hidden ${permissionMode === "full" ? "bg-[var(--color-permission-on)] border border-[var(--color-permission-on)]" : "bg-surface-hover border border-border"}`}>
            <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-surface-elevated shadow transition-all ${permissionMode === "full" ? "left-[calc(100%-16px)]" : "left-0.5"}`} />
          </span>
        </button>
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
          title={thinkingCapped ? `当前模型实际按「${THINKING_LABELS[thinkingCapped] ?? thinkingCapped}」运行（所选档位该模型不支持）` : "思考深度"}
          options={(thinkingLevels && thinkingLevels.length > 0 ? THINKING_ORDER.filter((l) => thinkingLevels.includes(l)) : THINKING_ORDER)
            .map((l) => ({ value: l, label: THINKING_LABELS[l] ?? l }))}
        />
        <div className="ctx-ring" title={ctxPct === null ? "上下文使用率未知（压缩后待新回复）" : `上下文使用率 ${Math.round(ctxPct)}%`} onClick={onStatsClick} style={{ cursor: "pointer" }}>
          <svg width="20" height="20" viewBox="0 0 20 20">
            <circle className="ctx-ring-track" cx="10" cy="10" r="8"/>
            <circle className="ctx-ring-fill" cx="10" cy="10" r="8"
              strokeDasharray="50.27" strokeDashoffset={ctxPct === null ? 50.27 : 50.27 * (1 - ctxPct / 100)}/>
          </svg>
          <span className="ctx-ring-pct">{ctxPct === null ? "—" : `${Math.round(ctxPct)}%`}</span>
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
