import { memo, useRef, useState, useCallback, useMemo, useEffect } from "react";
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
  /** 点击附件缩略图查看原图(ImageViewer 挂在 ChatPanel 层) */
  onPreviewImage?: (src: string, name: string) => void;
  permissionMode: "standard" | "full";
  onPermissionModeChange: (v: "standard" | "full") => void;
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
          className={`group relative shrink-0 w-16 h-16 rounded-md bg-surface-alt border border-border overflow-hidden ${onPreview ? "cursor-zoom-in" : ""}`}
          
          onClick={() => { if (onPreview && a.dataUrl) onPreview(a.dataUrl, a.name); }}
        >
          <img src={a.dataUrl} className="w-full h-full object-contain transition-opacity group-hover:opacity-85" alt={a.name} />
          <button
            type="button"
            className="absolute top-0 right-0 w-5 h-5 rounded-tr-md border-l border-b border-border bg-surface-alt/95 text-text-secondary hover:text-danger transition-colors flex items-center justify-center text-[length:var(--text-11)] leading-none"
            onClick={(e) => removeAttach(i, e)}
          >✕</button>
        </div>
      ) : (
        // 文档附件:与图片同款 64×64 容器,仅显示文档名(单行截断居中,无图标)
        <div key={i} className="relative shrink-0 w-16 h-16 rounded-md bg-surface-alt border border-border overflow-hidden flex items-center justify-center px-1">
          <span className="truncate w-full text-center text-[length:var(--text-11)] text-text-primary leading-tight">{a.name}</span>
          <button
            type="button"
            className="absolute top-0 right-0 w-5 h-5 rounded-tr-md border-l border-b border-border bg-surface-alt/95 text-text-secondary hover:text-danger transition-colors flex items-center justify-center text-[length:var(--text-11)] leading-none"
            onClick={(e) => removeAttach(i, e)}
          >✕</button>
        </div>
      ))}
    </div>
  );
}
export const AttachPreview = memo(AttachPreview_);

export const ChatInput = memo(function ChatInput({
  projectPath, busy, attaches, setAttaches, onSend, onStop, onPaste,
  imgInputRef, docInputRef, onImgChange, onDocChange, onPreviewImage,
  permissionMode, onPermissionModeChange, chatModel, onModelChange,
  thinkingLevel, thinkingCapped: _thinkingCapped, thinkingLevels, onThinkingLevelChange,
  sessionId, onStatsClick,
}: ChatInputProps & { sessionId: string; onStatsClick: () => void }): JSX.Element {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
  const indicatorOrder = useDelegationStore((s) => s.order);
  const ctxPct = useStatusStore((s) => s.bySession[sessionId]?.ctxPct ?? null);
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
        <div className="absolute inset-0 z-10 rounded-[10px] bg-surface/70 backdrop-blur-[2px] flex items-center justify-center">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-accent animate-spin"><circle cx="8" cy="8" r="6" strokeOpacity="0.3"/><path d="M8 2a6 6 0 015.5 3.5" strokeLinecap="round"/></svg>
            <span className="text-sm text-text-secondary font-medium">正在整理上下文，请稍候…</span>
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
            <div className="absolute bottom-full left-0 mb-1.5 rounded-lg border border-border bg-surface-elevated shadow-xl overflow-hidden z-40 w-max">
              {/* 列表项按钮面积 = 背景面积：容器无 padding，hover 背景与按钮同矩形，不留缝 */}
              <button
                type="button"
                className="flex items-center gap-2.5 px-3 py-2 text-xs whitespace-nowrap text-text-primary hover:bg-surface-hover transition-colors"
                onClick={() => { setAttachMenuOpen(false); imgInputRef.current?.click(); }}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><circle cx="5" cy="6" r="1.2"/><path d="M1.5 11l3.5-3.5 2.5 2.5 3-4 4 5"/></svg>
                <span>图片</span>
              </button>
              <button
                type="button"
                className="flex items-center gap-2.5 px-3 py-2 text-xs whitespace-nowrap text-text-primary hover:bg-surface-hover transition-colors"
                onClick={() => { setAttachMenuOpen(false); docInputRef.current?.click(); }}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 2h7l4 4v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v4h4M6 9h4M6 12h4"/></svg>
                <span>文档</span>
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
          <Tooltip className="shrink-0" tip="含冷启动回合——新会话或长时间未对话后的首轮，供应商缓存已过期属正常开销，同样计费">
            <span className="text-[length:var(--text-3xs)] px-1.5 py-0.5 rounded-full bg-[var(--color-input-field)] text-text-secondary tabular-nums">
              平均缓存命中 {cacheRate}%
            </span>
          </Tooltip>
        )}
        {/* 权限标签:闪电图标(Lucide zap)——替换原「权限」文字;hover 悬浮名称(与缓存命中率一致向上) */}
        <Tooltip tip="权限" className="shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inp-lbl block" style={{ marginRight: -1, marginLeft: 2 }} role="img" aria-label="权限">
            <title>权限</title>
            <path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/>
          </svg>
        </Tooltip>
        <button
          type="button"
          role="switch"
          aria-checked={permissionMode === "full"}
          
          onClick={() => onPermissionModeChange(permissionMode === "full" ? "standard" : "full")}
          className="flex items-center gap-1.5 shrink-0 group"
        >
          <span className={`text-[length:var(--text-xs)] transition-colors ${permissionMode === "full" ? "text-[var(--color-permission-on)]" : "text-text-secondary"}`}>
            {permissionMode === "full" ? "完全访问" : "标准"}
          </span>
          <span className={`relative w-8 h-[18px] rounded-full transition-colors overflow-hidden ${permissionMode === "full" ? "bg-[var(--color-permission-on)] border border-[var(--color-permission-on)]" : "bg-surface-hover border border-border"}`}>
            {/* hover 高亮在圆点上(group-hover):与模型/思考的 hover 同色(surface-hover) */}
            <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-surface-elevated shadow transition-all group-hover:bg-surface-hover ${permissionMode === "full" ? "left-[calc(100%-16px)]" : "left-0.5"}`} />
          </span>
        </button>
        {/* 模型标签:方盒图标(Lucide box)——替换原「模型」文字;hover 悬浮名称(与缓存命中率一致向上) */}
        <Tooltip tip="模型" className="shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inp-lbl block" style={{ marginRight: -1, marginLeft: 2 }} role="img" aria-label="模型">
            <title>模型</title>
            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
            <path d="m3.3 7 8.7 5 8.7-5"/>
            <path d="M12 22V12"/>
          </svg>
        </Tooltip>
        <Select
          value={chatModel}
          onChange={onModelChange}
          options={availableModels.length > 0 ? availableModels.map((m) => ({ value: m, label: m })) : [{ value: "", label: "暂无可选模型" }]}
        />
        {/* 思考等级标签:大脑图标(Lucide brain)——替换原「思考」文字;hover 悬浮名称(与缓存命中率一致向上) */}
        <Tooltip tip="思考等级" className="shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inp-lbl block" style={{ marginRight: -1, marginLeft: 2 }} role="img" aria-label="思考等级">
            <title>思考等级</title>
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
        />
        {/* 上下文使用率环:点击打开统计;百分比 hover 悬浮显示(圈内不常驻数字,悬浮向上与缓存命中率一致) */}
        <Tooltip tip={ctxPct === null ? "上下文使用率" : `上下文使用率 ${Math.round(ctxPct)}%`} className="shrink-0">
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
