import { uiText, useUiLocale } from "../lib/i18n";
import { memo, useRef, useState, useCallback, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useSettingsStore } from "../stores/settings-store";
import { THINKING_LABELS, THINKING_ORDER } from "@shared/thinking-levels";
import { useStatusStore } from "../stores/status-store";
import { useChatStore } from "../stores/chat-store";
import { useDelegationStore } from "../stores/delegation-store";
import { useThemeStore } from "../stores/theme-store";
import { Select } from "./Select";
import { Tooltip } from "./ui/Tooltip";
import { TodoButton } from "./TodoButton";
import { AgentBar } from "./AgentBar";
import { ShellBar } from "./ShellBar";
import { OrbitGlow } from "./OrbitGlow";
import { SlideGlow } from "./SlideGlow";
import { BreatheGlow } from "./BreatheGlow";
import { ModelGlyph } from "./ModelGlyph";
import { formatTokenWindow } from "../lib/token-format";

interface AttachItem { name: string; path: string; dataUrl?: string; kind: "image" | "doc"; }

/** 空消息数组常量（selector 缺省用——避免每次渲染新建引用触发 zustand 快照循环） */
const EMPTY_MSGS: unknown[] = [];

interface ChatInputProps {
  projectPath: string;
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
  /** 点击附件缩略图查看原图(ImageViewer 挂载在页面层，状态在 viewer-store) */
  onPreviewImage?: (src: string, name: string) => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (v: PermissionMode) => void;
  chatModel: string;
  onModelChange: (m: string) => void;
  thinkingLevel: string;
  /** 被模型能力裁剪后实际生效的等级（与所选不同时非空，用于向用户说明） */
  thinkingCapped?: string | null;
  /** 当前模型支持的思考等级（只展示这些档位；为空表示未知，展示全部） */
  thinkingLevels?: string[] | null;
  onThinkingLevelChange: (v: string) => void;
}

/** 权限三档（主进程 PermissionMode 在渲染层的副本；三档定义见 permission/execution-context.ts） */
export type PermissionMode = "readonly" | "standard" | "full";

/** 档位文案：下拉菜单展示每档边界，避免用户把“标准”与“完全访问”混为一谈。 */
const PERMISSION_LABEL: Record<PermissionMode, { text: string; tip: string; description: string }> = {
  readonly: {
    get text() { return uiText("ui.ChatInput.readOnly"); },
    get tip() { return uiText("ui.ChatInput.readOnlyInspectOrdinaryProjectContentExcluding"); },
    get description() { return uiText("ui.ChatInput.readProjectContentWithoutCommandsChangesOr"); },
  },
  standard: {
    get text() { return uiText("ui.ChatInput.standard"); },
    get tip() { return uiText("ui.ChatInput.standardRunInTheOsSandboxWrites"); },
    get description() { return uiText("ui.ChatInput.recommendedDevelopInsideTheOsSandbox"); },
  },
  full: {
    get text() { return uiText("ui.ChatInput.fullAccess"); },
    get tip() { return uiText("ui.ChatInput.fullAccessNoSandboxOrWorkspaceRestriction"); },
    get description() { return uiText("ui.ChatInput.noSandboxOrWorkspaceRestrictionForOrdinary"); },
  },
};

const PERMISSION_MODES: PermissionMode[] = ["readonly", "standard", "full"];

function PermissionShieldIcon({ mode, className }: { mode: PermissionMode; className?: string }): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      {mode === "full" ? (
        <><path d="M12 8v4" /><path d="M12 16h.01" /></>
      ) : mode === "readonly" ? (
        <><rect x="9" y="11" width="6" height="5" rx="1" /><path d="M10.5 11V9.5a1.5 1.5 0 0 1 3 0V11" /></>
      ) : (
        <path d="m9 12 2 2 4-4" />
      )}
    </svg>
  );
}

/** 输入栏权限选择器：用清晰的三项菜单替代循环开关，且固定定位避免被聊天容器裁切。 */
function PermissionModePicker({ value, onChange }: { value: PermissionMode; onChange: (mode: PermissionMode) => void }): JSX.Element {
  useUiLocale();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  const openMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // 与模型选择器一致：默认向下展开；只有贴近窗口底部时才翻到上方。
    // left 保存触发器中心点，菜单通过 translateX(-50%) 与它水平居中。
    setPosition({ left: rect.left + rect.width / 2, top: rect.bottom + 4, above: false });
    setOpen(true);
  }, []);

  const toggle = useCallback(() => {
    if (open) close();
    else openMenu();
  }, [close, open, openMenu]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  // 菜单实际尺寸只在挂载后可得：钳制左右边距，窗口底部空间不足时改为向上展开。
  useEffect(() => {
    if (!open || !position || !panelRef.current || !triggerRef.current) return;
    const panel = panelRef.current.getBoundingClientRect();
    const trigger = triggerRef.current.getBoundingClientRect();
    const enoughRoomBelow = trigger.bottom + panel.height + 4 <= window.innerHeight;
    const nextAbove = !enoughRoomBelow;
    const nextLeft = Math.max(panel.width / 2 + 8, Math.min(trigger.left + trigger.width / 2, window.innerWidth - panel.width / 2 - 8));
    const nextTop = nextAbove ? trigger.top - 4 : trigger.bottom + 4;
    if (nextLeft !== position.left || nextTop !== position.top || nextAbove !== position.above) {
      setPosition({ left: nextLeft, top: nextTop, above: nextAbove });
    }
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = PERMISSION_MODES.indexOf(value);
    requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
  }, [open, value]);

  const moveFocus = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowDown" ? 1 : -1) + PERMISSION_MODES.length) % PERMISSION_MODES.length;
    optionRefs.current[next]?.focus();
  };

  const current = PERMISSION_LABEL[value];
  const color = value === "full" ? "text-[var(--color-permission-on)]" : "text-text-secondary";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openMenu();
          }
        }}
        className={`permission-mode-trigger ${color}`}
        aria-label={uiText("ui.ChatInput.permissionMode", { v0: current.text })}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <PermissionShieldIcon mode={value} />
        <span className="permission-mode-trigger-label">{current.text}</span>
        <svg className={`permission-mode-chevron ${open ? "rotate-180" : ""}`} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
      </button>
      {open && position && createPortal(
        <div
          ref={panelRef}
          role="menu"
          aria-label={uiText("ui.ChatInput.choosePermissionMode")}
          className="permission-mode-menu"
          style={{ left: position.left, top: position.top, transform: position.above ? "translate(-50%, -100%)" : "translateX(-50%)" }}
        >
          {PERMISSION_MODES.map((mode, index) => {
            const item = PERMISSION_LABEL[mode];
            const selected = mode === value;
            return (
              <button
                key={mode}
                ref={(node) => { optionRefs.current[index] = node; }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`permission-mode-option ${selected ? "is-selected" : ""} ${mode === "full" ? "is-full" : ""}`}
                onClick={() => { onChange(mode); close(); }}
                onKeyDown={(event) => moveFocus(event, index)}
              >
                <span className={`permission-mode-option-icon ${mode === "full" ? "text-[var(--color-permission-on)]" : "text-text-secondary"}`}><PermissionShieldIcon mode={mode} /></span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="permission-mode-option-title">{item.text}{mode === "standard" && <span className="permission-mode-default">{uiText("ui.AskUserCard.recommended")}</span>}</span>
                  <span className="permission-mode-option-description">{item.description}</span>
                </span>
                {selected && <svg className="shrink-0 text-accent" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label={uiText("ui.ChatInput.selected")}><path d="m5 12 4 4L19 6" /></svg>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

// 档位名称与顺序见 @shared/thinking-levels（主进程与渲染层共用）

interface AttachPreviewProps {
  attaches: AttachItem[];
  setAttaches: (a: AttachItem[] | ((prev: AttachItem[]) => AttachItem[])) => void;
  /** 点击图片缩略图查看原图(自实现 ImageViewer,非系统预览);不传则缩略图不可点 */
  onPreview?: (src: string, name: string) => void;
}

function AttachPreview_({ attaches, setAttaches, onPreview }: AttachPreviewProps): JSX.Element {
  const removeAttach = useCallback((idx: number, e: React.MouseEvent) => {
    e.stopPropagation(); // ✕ 在缩略图点击层之上,阻止冒泡误触查看原图
    setAttaches((prev) => prev.filter((_, i) => i !== idx));
  }, [setAttaches]);
  return (
    <div className="flex flex-wrap items-end gap-1.5">
      {attaches.map((a, i) => a.kind === "image" && a.dataUrl ? (
        // 图片附件:固定 64×64 容器,图片 object-contain 按最长边 64 居中显示(横图限宽/竖图限高,
        // 纵横比保持),删除按钮贴容器右上角;点击缩略图(✕ 除外)查看原图
        <div
          key={i}
          className={`group relative shrink-0 w-16 h-16 rounded-[var(--radius-lg)] bg-surface-alt border border-border overflow-hidden ${onPreview ? "cursor-zoom-in" : ""}`}
          
          onClick={() => { if (onPreview && a.dataUrl) onPreview(a.dataUrl, a.name); }}
        >
          <img src={a.dataUrl} className="w-full h-full object-contain transition-opacity group-hover:opacity-85" alt={a.name} />
          <button
            type="button"
            className="absolute top-0 right-0 w-5 h-5 rounded-tr-[var(--radius-lg)] bg-surface-alt/95 text-text-secondary hover:text-danger transition-colors flex items-center justify-center text-[length:var(--text-11)] leading-none"
            onClick={(e) => removeAttach(i, e)}
          >✕</button>
        </div>
      ) : (
        // 文档附件:与图片同款 64×64 容器,仅显示文档名(单行截断居中,无图标)
        <div key={i} className="relative shrink-0 w-16 h-16 rounded-[var(--radius-lg)] bg-surface-alt border border-border overflow-hidden flex items-center justify-center px-1">
          <span className="truncate w-full text-center text-[length:var(--text-11)] text-text-primary leading-tight">{a.name}</span>
          <button
            type="button"
            className="absolute top-0 right-0 w-5 h-5 rounded-tr-[var(--radius-lg)] bg-surface-alt/95 text-text-secondary hover:text-danger transition-colors flex items-center justify-center text-[length:var(--text-11)] leading-none"
            onClick={(e) => removeAttach(i, e)}
          >✕</button>
        </div>
      ))}
    </div>
  );
}
export const AttachPreview = memo(AttachPreview_);

/** 使用率环的悬浮文案：始终带上当前模型的实际窗口，改参数后一眼能看出是否生效 */
function ctxTip(pct: number | null, windowTokens: number | null): string {
  if (windowTokens === null) return pct === null ? uiText("ui.ChatInput.contextUsage") : uiText("ui.ChatInput.contextUsage2", { v0: Math.round(pct) });
  return pct === null
    ? uiText("ui.ChatInput.contextWindow", { v0: formatTokenWindow(windowTokens) })
    : uiText("ui.ChatInput.contextWindowUsed", { v0: formatTokenWindow(windowTokens), v1: Math.round(pct) });
}

export const ChatInput = memo(function ChatInput({
  projectPath, busy, attaches, setAttaches, onSend, onStop, onPaste,
  imgInputRef, docInputRef, onImgChange, onDocChange, onPreviewImage,
  permissionMode, onPermissionModeChange, chatModel, onModelChange,
  thinkingLevel, thinkingCapped: _thinkingCapped, thinkingLevels, onThinkingLevelChange,
  sessionId, onStatsClick,
}: ChatInputProps & { sessionId: string; onStatsClick: () => void }): JSX.Element {
  useUiLocale();
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 上下文窗口是模型静态属性(无需会话/网络):打开页面或切模型时主动查一次并填上,
  // 这样即使没有会话、也没有 usage 广播,圆环 hover 也能显示窗口
  useEffect(() => {
    if (!chatModel || !sessionId) return;
    let alive = true;
    window.electronAPI?.agent?.getModelInfo?.(chatModel)
      .then((info) => {
        if (alive && info?.contextWindow) {
          useStatusStore.getState().setCtxPct(sessionId, undefined, info.contextWindow);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [chatModel, sessionId]);
  // 附件菜单（回形针按钮弹出：图片/文档二选一）
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!attachMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) setAttachMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAttachMenuOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [attachMenuOpen]);
  const availableModels = useSettingsStore((s) => s.availableModels);
  // 自添加模型用名称展示(值 = 请求标识),官方模型显示目录 name
  const modelLabels = useSettingsStore((s) => s.modelLabels);
  const indicatorOrder = useDelegationStore((s) => s.order);
  const ctxPct = useStatusStore((s) => s.bySession[sessionId]?.ctxPct ?? null);
  const ctxWindow = useStatusStore((s) => s.bySession[sessionId]?.ctxWindow ?? null);
  const summarizing = useStatusStore((s) => s.bySession[sessionId]?.summarizing ?? false);
  // 本会话平均缓存命中率：全部消息 usage 累加（缓存读 / 全部输入 = 未缓存 + 缓存读 + 缓存写）——口径同单条显示。
  // selector 直接返回 store 引用（不建新数组——zustand 快照比较要求引用稳定，否则无限循环）
  const sessionMsgsRaw = useChatStore((s) => s.messagesBySession[sessionId]);
  const sessionMsgs = sessionMsgsRaw ?? EMPTY_MSGS;
  const cacheRate = useMemo(() => {
    let read = 0, uncached = 0, write = 0;
    for (const m of sessionMsgs) {
      const u = m.usage;
      if (u?.cacheReadTokens) read += u.cacheReadTokens;
      if (u?.cacheWriteTokens) write += u.cacheWriteTokens;
      if (u?.inputTokens) uncached += u.inputTokens;
    }
    const total = read + uncached + write;
    return total > 0 ? ((read / total) * 100).toFixed(2) : null;
  }, [sessionMsgs]);
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
        <div className="absolute inset-0 z-float rounded-[var(--radius-lg)] bg-surface/70 backdrop-blur-[2px] flex items-center justify-center">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-accent animate-spin"><circle cx="8" cy="8" r="6" strokeOpacity="0.3"/><path d="M8 2a6 6 0 015.5 3.5" strokeLinecap="round"/></svg>
            <span className="text-sm text-text-secondary font-medium">{uiText("ui.ChatInput.compactingContextPleaseWait")}</span>
          </div>
        </div>
      )}
      {/* 上半：输入框 */}
      <div className="input-top">
        {!busy && attaches.length > 0 && <AttachPreview attaches={attaches} setAttaches={setAttaches} onPreview={onPreviewImage} />}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          placeholder={compacting ? uiText("ui.ChatInput.compactingContextPleaseWait2") : summarizing ? uiText("ui.ChatInput.summarizingSession") : uiText("ui.ChatInput.enterToSendShiftEnterForA")}
          rows={4}
          disabled={inputDisabled}
          className="chat-input"
        />
      </div>
      {/* 下半：工具栏 */}
      <div className="input-bar">
        <input ref={imgInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml" multiple className="hidden" onChange={onImgChange} />
        <input ref={docInputRef} type="file" multiple className="hidden" onChange={onDocChange} accept=".pdf,.doc,.docx,.md,.txt,.csv,.xls,.xlsx,.ts,.tsx,.js,.jsx,.py,.java,.json,.yaml,.yml,.toml,.html,.css,.sh,.env,.cfg" />
        <div className="relative" ref={attachMenuRef}>
          <button
            className="inp-icon-btn"
            aria-expanded={attachMenuOpen}
            onClick={() => setAttachMenuOpen((v) => !v)}
          >
            {/* 回形针 */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          </button>
          {attachMenuOpen && (
            <div className="absolute bottom-full left-0 mb-1.5 rounded-[var(--radius-lg)] border border-border bg-surface-elevated shadow-xl overflow-hidden z-dropdown w-max">
              {/* 列表项按钮面积 = 背景面积：容器无 padding，hover 背景与按钮同矩形，不留缝 */}
              <button
                type="button"
                className="flex items-center gap-2.5 px-3 py-2 text-xs whitespace-nowrap text-text-primary hover:bg-surface-hover transition-colors"
                onClick={() => { setAttachMenuOpen(false); imgInputRef.current?.click(); }}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><circle cx="5" cy="6" r="1.2"/><path d="M1.5 11l3.5-3.5 2.5 2.5 3-4 4 5"/></svg>
                <span>{uiText("ui.ChatInput.image")}</span>
              </button>
              <button
                type="button"
                className="flex items-center gap-2.5 px-3 py-2 text-xs whitespace-nowrap text-text-primary hover:bg-surface-hover transition-colors"
                onClick={() => { setAttachMenuOpen(false); docInputRef.current?.click(); }}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 2h7l4 4v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v4h4M6 9h4M6 12h4"/></svg>
                <span>{uiText("ui.ChatInput.document")}</span>
              </button>
            </div>
          )}
        </div>
        {/* 用户待办：想法与计划清单（.easymint/todos.json）——与 Mint 执行追踪(session-todos)是两套 */}
        <TodoButton projectPath={projectPath} />
        {/* 后台指示器胶囊:agent/shell 按出现顺序排列,谁先出现谁靠左;按会话过滤(委派是主会话发起的) */}
        {/* ml-[7px]:补偿左侧 TodoButton 角标 badge 的向右溢出(5px+ring 2px)——胶囊与角标视觉间距对齐其他按钮的 8px */}
        {/* gap-3:胶囊之间(agent/shell 并排)间距 12px,对称生效与排列顺序无关 */}
        <div className="flex items-center gap-3 shrink-0 ml-[7px]">
          {indicatorOrder.map((k) => (k === "agent" ? <AgentBar key="agent" sessionId={sessionId} /> : <ShellBar key="shell" sessionId={sessionId} />))}
        </div>
        <span className="inp-gap" />
        {cacheRate !== null && (
          <Tooltip className="shrink-0" tip={uiText("ui.ChatInput.includesColdStartTurnsProviderCachesMay")}>
            <span className="text-[length:var(--text-3xs)] px-1.5 py-0.5 rounded-full bg-[var(--color-input-field)] text-text-secondary tabular-nums">
              {uiText("ui.ChatInput.averageCacheHitRate")}{cacheRate}%
            </span>
          </Tooltip>
        )}
        <PermissionModePicker value={permissionMode} onChange={onPermissionModeChange} />
        {/* 模型标签:神经网络节点图标(三点互联,带三点聚拢动效)——组件见 ModelGlyph;hover 悬浮名称(与缓存命中率一致向上) */}
        <Tooltip tip={uiText("settings.providers")} className="shrink-0">
          <ModelGlyph label={uiText("settings.providers")} className="inp-lbl block" style={{ marginRight: -1, marginLeft: 2 }} />
        </Tooltip>
        <Select
          value={chatModel}
          onChange={onModelChange}
          options={availableModels.length > 0 ? availableModels.map((m) => ({ value: m, label: modelLabels[m] ?? m })) : [{ value: "", label: uiText("ui.ChatInput.noModelsAvailable") }]}
          align="center"
          borderless
        />
        {/* 思考等级标签:大脑图标(Lucide brain)——替换原「思考」文字;hover 悬浮名称(与缓存命中率一致向上) */}
        <Tooltip tip={uiText("ui.ChatInput.thinkingLevel")} className="shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inp-lbl block" style={{ marginRight: -1, marginLeft: 2 }} role="img" aria-label={uiText("ui.ChatInput.thinkingLevel")}>
            <title>{uiText("ui.ChatInput.thinkingLevel")}</title>
            <path d="M12 18V5"/>
            <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/>
            <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/>
            <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/>
            <path d="M18 18a4 4 0 0 0 2-7.464"/>
            <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/>
            <path d="M6 18a4 4 0 0 1-2-7.464"/>
            <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/>
          </svg>
        </Tooltip>
        <Select
          value={thinkingLevel}
          onChange={onThinkingLevelChange}
          options={(thinkingLevels && thinkingLevels.length > 0 ? THINKING_ORDER.filter((l) => thinkingLevels.includes(l)) : THINKING_ORDER)
            .map((l) => ({ value: l, label: THINKING_LABELS[l] ?? l }))}
          align="center"
          borderless
        />
        {/* 上下文使用率环:点击打开统计;百分比 hover 悬浮显示(圈内不常驻数字,悬浮向上与缓存命中率一致) */}
        <Tooltip tip={ctxTip(ctxPct, ctxWindow)} className="shrink-0">
          <div className="ctx-ring" onClick={onStatsClick} style={{ cursor: "pointer" }}>
            <svg width="20" height="20" viewBox="0 0 20 20">
              <circle className="ctx-ring-track" cx="10" cy="10" r="8"/>
              <circle className="ctx-ring-fill" cx="10" cy="10" r="8"
                strokeDasharray="50.27" strokeDashoffset={ctxPct === null ? 50.27 : 50.27 * (1 - ctxPct / 100)}/>
            </svg>
          </div>
        </Tooltip>
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
