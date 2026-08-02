import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildBlocks, ChatBlockView } from "./ChatBlocks";
import { AttachItem, ChatMessage, piBlocksToEntries, mergeConsecutiveText, piEventToEntries, displayToolLabel, mapSessionMessages, getMsgCopyText } from "./chat-utils";
import { chatActions } from "../stores/chat-actions";
import { useSettingsStore } from "../stores/settings-store";
import { useTabStore } from "../stores/tab-store";
import { useChatStore } from "../stores/chat-store";
import { CONFIRM_DEVELOPMENT_PROMPT } from "../../../shared/prompts";

import { useStatusStore } from "../stores/status-store";
import { StatusBar } from "./StatusBar";
import { ProcessBar } from "./ProcessBar";
import { useDelegationStore } from "../stores/delegation-store";
import { PermissionPrompt } from "./PermissionPrompt";
import { ChatInput } from "./ChatInput";
import { SessionStatsPopup } from "./SessionStatsPopup";
import { getWorkspaceDir } from "../lib/getWorkspaceDir";
import { blocksToMarkdown, selectionToBlocks } from "../lib/selection-to-markdown";
import { PinLayer, PinIcon } from "./PinLayer";
import { usePinStore } from "../stores/pin-store";
import { DelegationProgress, type DelegationUiState, type DelegationTaskUi } from "./DelegationProgress";
import { ContextMenu, type ContextMenuData, type ContextMenuItem } from "./ContextMenu";

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
function BubbleActions({ text, onPin, sid, visible }: { text: string; onPin: (text: string) => void; sid: string; visible: boolean }): JSX.Element {
  return (
    <div className={`absolute top-full left-0 mt-1 flex items-center rounded-md border border-border bg-surface-elevated shadow-sm overflow-hidden transition-opacity duration-150 ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
      <CopyBubbleBtn text={text} />
      <PinBubbleBtn text={text} onPin={onPin} sid={sid} />
    </div>
  );
}


// ── Doc Icon ────────────────────────────────────────
function DocIcon({ name }: { name: string }): JSX.Element {
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

interface ChatPanelProps {
  projectPath: string;
  sessionId?: string;
  onSessionCreated?: (sessionId: string) => void;
  onActivity?: () => void;
  onNewProject?: () => void;
}

export function ChatPanel({ projectPath, sessionId: existingSid, onSessionCreated, onActivity, onNewProject }: ChatPanelProps): JSX.Element {
  const tempSidRef = useRef<string | null>(null);
  if (!existingSid && !tempSidRef.current) tempSidRef.current = `__new_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const initialSid = existingSid ?? tempSidRef.current!;
  const [sid, setSid] = useState<string>(initialSid);
  const emptyArr = useRef<ChatMessage[]>([]);
  const rawMsgs = useChatStore((s) => s.messagesBySession[sid]);
  const messages: ChatMessage[] = rawMsgs || (emptyArr.current as ChatMessage[]);
  const [_currentRunId, setCurrentRunId] = useState<string | null>(null);
  const currentChatRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const busyRef = useRef(false);
  const ctxThresholdFiredRef = useRef(0); // 已按阈值触发过主动压缩（防止同轮重复触发）
  const programmaticScrollRef = useRef(false); // 程序性滚动中（handleScroll 跳过 autoScroll 更新）

  // 状态栏独立存储 → 密集更新时只重渲染 StatusBar，不牵连 ChatPanel/消息列表
  // 注意：ChatPanel 不读 s.text，否则每次 statusText 变化都会重渲染整个组件
  const summarizing = useStatusStore((s) => s.summarizing);
  const compacting = useStatusStore((s) => s.compacting);
  const [compactDone, setCompactDone] = useState(false);
  const prevCompacting = useRef(compacting);
  useEffect(() => {
    if (prevCompacting.current && !compacting) setCompactDone(true);
    prevCompacting.current = compacting;
  }, [compacting]);
  useEffect(() => {
    if (!compactDone) return;
    const t = setTimeout(() => setCompactDone(false), 3000);
    return () => clearTimeout(t);
  }, [compactDone]);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [attaches, setAttaches] = useState<AttachItem[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState("auto");
  const storeModel = useSettingsStore((s) => s.model);
  const setStoreModel = useSettingsStore((s) => s.setModel);
  const showThinking = useSettingsStore((s) => s.showThinking);


  const showToolUse = useSettingsStore((s) => s.showToolUse);
  const [chatModel, setChatModel] = useState("");

  const handleModelChange = useCallback(async (m: string) => {
    setChatModel(m); setStoreModel(m);
    const sid = sidRef.current;
    if (sid) { window.electronAPI.agent.setModel(sid, m).catch(() => {}); }
  }, [setStoreModel]);
  const [thinkingLevel, setThinkingLevel] = useState("medium");
  const [showStats, setShowStats] = useState(false);
  const handleThinkingLevelChange = useCallback((level: string) => {
    setThinkingLevel(level);
    const sid = sidRef.current;
    if (sid) window.electronAPI.agent.setThinkingLevel(sid, level).catch(() => {});
  }, []);

  const msgIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  /** 输入框变化处理：检测开头 / 触发命令面板（仅在输入框纯命令上下文下，不影响代码片段） */
  const autoScrollRef = useRef(true);
  // Pi 事件无需 seq 去重（message_update 是累计全文，不是 delta）
  // 当前 turn 的 AI 消息锚点：turn_start 创建空消息并记录 id，message/thinking 帧按 id 全量替换——
  // 与 Proma 的 uuid 方案同思想（帧是完整快照，替换而非拼接），杜绝 fromIdx 不匹配导致的重复
  const curAiMsgIdRef = useRef(0);
  // steer 打断标记
  const steeringRef = useRef(false);
  const sidRef = useRef<string>(initialSid);
  useEffect(() => {
    if (existingSid && sidRef.current !== existingSid) {
      // 新建会话：临时 key → 真实 sessionId，迁移已存入的消息
      const oldKey = sidRef.current;
      const newKey = existingSid;
      sidRef.current = newKey;
      setSid(newKey);
      // 直接迁移（同一个 microtask 内完成，早于下一次渲染）
      const store = useChatStore.getState();
      const oldMsgs = store.messagesBySession[oldKey];
      if (oldMsgs && oldMsgs.length > 0) {
        useChatStore.setState((s) => {
          const next = { ...s.messagesBySession };
          next[newKey] = [...(next[newKey] || []), ...oldMsgs];
          delete next[oldKey];
          const nextId = { ...s.msgIdBySession };
          const maxId = oldMsgs.reduce((max: number, m: { id: number }) => Math.max(max, m.id), 0);
          nextId[newKey] = Math.max(nextId[newKey] || 0, maxId);
          delete nextId[oldKey];
          return { messagesBySession: next, msgIdBySession: nextId };
        });
      }
      usePinStore.getState().migrateSession(oldKey, newKey);
    }
  }, [existingSid]);
  const runningSessions = useTabStore((s) => s.runningSessions);
  const busy = runningSessions.has(sidRef.current);
  const setBusy = (v: boolean) => { useTabStore.getState().setSessionRunning(sidRef.current, v); };

  const scrollToBottom = useCallback((force = false) => {
    if (!containerRef.current) return;
    if (force || autoScrollRef.current) {
      const el = containerRef.current;
      // 程序性滚动标记：滚动动画期间 handleScroll 不更新 autoScroll
      programmaticScrollRef.current = true;
      requestAnimationFrame(() => {
        if (!el) return;
        // 统一瞬时滚动：smooth 动画期间内容持续移动,鼠标相对位置变化
        // 会误触发消息 hover(复制/钉住按钮闪现)
        el.scrollTop = el.scrollHeight;
        setTimeout(() => { programmaticScrollRef.current = false; }, 600);
      });
    }
  }, []);

  const handleScroll = useCallback(() => {
    // 程序性滚动（贴底/流式跟随）动画期间不更新 autoScroll——
    // 动画中途 distFromBottom 必然 >8，会误判为"用户离开底部"，
    // 导致测量完成后的校正贴底被跳过（打开会话停在半路）。
    if (programmaticScrollRef.current) return;
    const el = containerRef.current; if (!el) return;
    // 用户主动滚动：一旦离开底部就立即停止自动跟随（阈值小，轻滑即可解锁），
    // 避免 onStream 的 scrollToBottom 把用户拉回底部导致"滑不动"。
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distFromBottom < 8;
  }, []);

  // 消息列表虚拟化：只渲染可视区 ± overscan 的消息，长对话时 DOM 从数千节点降到 ~30
  // HMR 防御：容器元素用 state 驱动（而非 ref）——DOM 重建时 ref 回调触发 setState，
  // 强制重渲染让 virtualizer 的 _willUpdate 检测到 scrollElement 变化并重新绑定 observer
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const attachScrollRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    setScrollEl(el);
  }, []);
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => 100,
    overscan: 8,
    // measureElement 在 React commit 阶段触发 onChange，默认的 flushSync 会
    // 报 "flushSync was called from inside a lifecycle method"——改走普通调度
    useFlushSync: false,
  });
  // 容器变化时兜底重新测量（HMR 重挂后旧测量数据失效）
  useEffect(() => {
    if (scrollEl) virtualizer.measure();
  }, [scrollEl, virtualizer]);

  // ── Upload helpers ─────────────────────────────────

  const uploadFiles = useCallback(async (files: FileList | File[], kind: "image" | "doc") => {
    const items: AttachItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      try {
        const buf = await file.arrayBuffer();
        const result = await window.electronAPI.file.saveUpload(file.name, new Uint8Array(buf));
        const ext = file.name.split(".").pop()?.toLowerCase();
        const isHeic = ext === "heic" || ext === "heif";
        const isImage = (kind === "image" || file.type.startsWith("image/")) && !isHeic;
        items.push({ name: file.name, path: result.path, dataUrl: isImage ? result.dataUrl : undefined, kind: isImage ? "image" : "doc" });
      } catch (e) { console.error("[upload]", e); }
    }
    if (items.length > 0) setAttaches((prev) => [...prev, ...items]);
  }, []);

  const removeAttach = useCallback((idx: number) => {
    setAttaches((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // ── Paste ──────────────────────────────────────────

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    const docs: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const file = item.getAsFile();
      if (!file) continue;
      e.preventDefault();
      if (item.type.startsWith("image/")) {
        images.push(file);
      } else if (file.type || file.name) {
        // 文档粘贴（从 Finder/资源管理器复制）
        docs.push(file);
      }
    }
    if (images.length > 0) uploadFiles(images, "image");
    if (docs.length > 0) uploadFiles(docs, "doc");
  }, [uploadFiles]);

  // 拖放上传：阻止系统默认行为（否则拖入文件会触发系统打开文件），提取文件走 uploadFiles
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    const docs = files.filter((f) => !f.type.startsWith("image/"));
    if (images.length > 0) uploadFiles(images, "image");
    if (docs.length > 0) uploadFiles(docs, "doc");
  }, [uploadFiles]);

  // ── File inputs ────────────────────────────────────

  const handleImgChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) { uploadFiles(e.target.files, "image"); e.target.value = ""; }
  }, [uploadFiles]);

  const handleDocChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) { uploadFiles(e.target.files, "doc"); e.target.value = ""; }
  }, [uploadFiles]);

  // ── History / stream ───────────────────────────────

  // 新挂载时重置残留状态（防止窗口切换/重开后状态栏显示旧文本）
  useEffect(() => { useStatusStore.getState().reset(); }, []);

  // ── 子 Agent 委派进度卡片 ─────────────────────────
  const [delegation, setDelegation] = useState<DelegationUiState | null>(null);
  // 事件回调内跟踪当前委派状态(副作用必须移出 useState updater——
  // updater 渲染期间执行,调用其他 store 会触发跨组件更新警告)
  const delegationRef = useRef<DelegationUiState | null>(null);

  useEffect(() => {
    const unsub = window.electronAPI.agent.onDelegationProgress((data: DelegationProgressEvent) => {
      // 过滤：只显示当前窗口 chat 的委派
      if (data.chatId && currentChatRef.current && data.chatId !== currentChatRef.current) return;
      const prev = delegationRef.current;
      const task: DelegationTaskUi = {
        index: data.progress.index,
        agent: data.progress.agent,
        task: data.progress.task,
        status: data.progress.status,
      };
      // 首次收到:捕获触发委派的消息 id(最后一条 AI 消息,含 task 工具调用),
      // 卡片固定附着在该消息下方;同时滚动到底让卡片完整可见
      let triggerMsgId: number | undefined;
      if (!prev) {
        const msgs = useChatStore.getState().messagesBySession[sidRef.current] || [];
        const lastAi = msgs.filter((m) => m.role === "ai").pop();
        triggerMsgId = lastAi?.id;
        scrollToBottom(true);
      }
      const tasks = prev && prev.delegationId === data.delegationId ? [...prev.tasks] : [];
      const idx = tasks.findIndex((t) => t.index === task.index);
      if (idx >= 0) tasks[idx] = task; else tasks.push(task);
      const finished = tasks.length > 0 && tasks.every((t) =>
        t.status === "completed" || t.status === "failed" || t.status === "aborted");
      const next: DelegationUiState = {
        delegationId: data.delegationId,
        chatId: data.chatId,
        triggerMsgId: prev?.triggerMsgId ?? triggerMsgId,
        tasks,
        finished,
      };
      delegationRef.current = next;
      // 副作用(事件回调内,合法):委派开始 → 常驻「调用 Agent」;结束 → 清除
      if (!prev) {
        useStatusStore.getState().pushSignal("agent", "调用 Agent");
      }
      if (finished && (!prev || !prev.finished)) {
        useStatusStore.getState().popSignal("agent");
      }
      setDelegation(next);
    });
    return unsub;
  }, []);

  // 委派计数订阅(ProcessBar agent·N 显示 + 任务列表)
  useEffect(() => {
    const unsubCount = window.electronAPI.agent.onDelegationCount((data) => {
      useDelegationStore.getState().setAgentTasks(data.tasks);
    });
    return unsubCount;
  }, []);

  // 委派全部完成 3 秒后自动收起卡片
  useEffect(() => {
    if (!delegation?.finished) return;
    const t = setTimeout(() => setDelegation(null), 3000);
    return () => clearTimeout(t);
  }, [delegation?.finished]);

  useEffect(() => {
    if (!existingSid) return; let cancelled = false;
    const projectDir = projectPath || getWorkspaceDir();
    (async () => {
        const buffered = await window.electronAPI.agent.getBufferedStream(existingSid);
        if (!cancelled && buffered.length > 0) {
          // 缓冲事件：仅全量替换临时显示（streaming 标记）；缓冲内容随后被 conv.messages 覆盖
          for (const raw of buffered) {
            const ev = raw as StreamEvent;
            const entries = mergeConsecutiveText(piEventToEntries(ev));
            if (entries.length > 0) {
              useChatStore.getState().replaceAiEntries(sidRef.current, entries);
            }
          }
        }
      if (cancelled) return; const snapshot = msgIdRef.current;
        let msgs = await window.electronAPI.conv.messages(existingSid, projectDir);
        if (!cancelled && msgs.length === 0) { await new Promise((r) => setTimeout(r, 500)); if (cancelled) return; msgs = await window.electronAPI.conv.messages(existingSid, projectDir); }
        if (!cancelled && msgs.length > 0 && msgIdRef.current <= snapshot) {
          const mapped = mapSessionMessages(msgs);
          // Restore image dataUrls from disk for history display (parallel)
          const loads: Promise<void>[] = [];
          for (const m of mapped) {
            if (m.attaches) {
              for (const a of m.attaches) {
                if (a.kind === "image" && !a.dataUrl && a.path) {
                  loads.push(
                    window.electronAPI.file.readUpload(a.path).then((url) => { a.dataUrl = url || ""; }).catch(() => {})
                  );
                }
              }
            }
          }
          if (loads.length > 0) await Promise.all(loads);
          if (!cancelled && mapped.length > 0) { useChatStore.getState().loadSession(sid, mapped); msgIdRef.current = Math.max(...mapped.map((m) => m.id)); }
        }
    })();
    return () => { cancelled = true; };
  }, [existingSid, projectPath]);

  // showThinking / showToolUse 切换时重新从磁盘加载，使过滤生效
  useEffect(() => {
    if (!existingSid) return;
    const projectDir = projectPath || getWorkspaceDir();
    let cancelled = false;
    (async () => {
      const msgs = await window.electronAPI.conv.messages(existingSid, projectDir);
      if (!cancelled && msgs.length > 0) {
        const mapped = mapSessionMessages(msgs);
        if (mapped.length > 0) useChatStore.getState().loadSession(sidRef.current, mapped);
      }
    })();
    return () => { cancelled = true; };
  }, [showThinking, showToolUse]);

  useEffect(() => {
    const unsub = window.electronAPI.agent.onStream((event: StreamEvent) => {
      if (event.source === "worker") return;
      // Filter by chatId when known
      if (currentChatRef.current) {
        if (!event.runId && !event.chatId) return;
        if (event.runId && event.runId !== currentChatRef.current) return;
        if (event.chatId && event.chatId !== currentChatRef.current) return;
      } else if (existingSid) {
        if (!event.sessionId || event.sessionId !== existingSid) return;
      } else {
        // 没有活跃 chat，也没有已知 session → 拒绝所有外部事件，防止跨窗口污染
        return;
      }
      if (stoppedRef.current) return;
      if (!currentChatRef.current) {
        const cid = event.chatId || event.runId;
        if (cid) { currentChatRef.current = cid; setCurrentRunId(cid); }
      }
      setBusy(true);
      // Pi 新 assistant turn 开始 → 创建空 AI 消息作为本 turn 锚点，
      // 后续 message/thinking 帧按 id 全量替换（每次 turn 一条消息，与磁盘落盘结构一致）
      if (event.type === "turn_start") {
        // 回合开始 → 请求转「正在思考」(同 id 更新,不 pop——Mint 思考阶段状态栏保持显示,
        // 直到首个输出帧/工具调用才结束,否则「正在请求」一闪而过)
        useStatusStore.getState().pushSignal("request", "正在思考...");
        curAiMsgIdRef.current = useChatStore.getState().startAiMessage(sidRef.current);
        steeringRef.current = false;
      }
      // Pi SDK message_update 携带累计全文快照，按锚点 id 全量替换当前 turn 的消息（不拼接）
      if (event.type === "message" && Array.isArray(event.blocks)) {
        const rawEntries = piBlocksToEntries(event.blocks);
        if (rawEntries.length > 0) {
          // Mint 开始输出 → 思考信号结束
          useStatusStore.getState().popSignal("request");
          const entries = mergeConsecutiveText(rawEntries);
          if (!curAiMsgIdRef.current) {
            curAiMsgIdRef.current = useChatStore.getState().startAiMessage(sidRef.current);
          }
          useChatStore.getState().replaceAiEntriesById(sidRef.current, curAiMsgIdRef.current, entries);
          scrollToBottom();
        }
      }
      // tool progress
      if (event.type === "tool_progress" && event.toolName) {
        const label = displayToolLabel(event.toolName, event.toolArgs);
        // 开始执行工具 → 思考信号结束(否则 tool pop 后回退显示「正在思考」)
        useStatusStore.getState().popSignal("request");
        useStatusStore.getState().pushSignal("tool", label);
        useDelegationStore.getState().setShellCount(useDelegationStore.getState().shellCount + 1);
      }
      // tool done — 工具执行结束,pop 工具信号(回退显示「调用 Agent」等次新活跃信号)
      if (event.type === "tool_done") {
        useStatusStore.getState().popSignal("tool");
        useDelegationStore.getState().setShellCount(Math.max(0, useDelegationStore.getState().shellCount - 1));
      }
      // compaction UI — compacting 事件 = 压缩进行中（显示"正在整理会话..."）
      if (event.type === "compacting") {
        useStatusStore.getState().setCompacting(true);
      }
      // compacted = 压缩完成：清除 compacting（触发"会话已整理完毕"提示），
      // 并兜底清除 summarizing（防御轮转总结路径的残留）
      if (event.type === "compacted") {
        useStatusStore.getState().setCompacting(false);
        useStatusStore.getState().setSummarizing(false);
      }
      // error — 插播错误信号,8s 后自动消失(回退次新活跃信号)
      if (event.type === "error") {
        useStatusStore.getState().pushSignal("error", event.message || "出错了", 8000);
      }
      // 系统注入的 user 消息（委派完成通知等）→ 渲染为消息(带 streaming 标记,
      // loadSession 时被磁盘版本替代,不重复)
      if (event.type === "user_message" && event.text) {
        // 按落盘时间戳有序插入——通知发生在过去时刻,append 会跑到之后新消息后面,
        // 与磁盘顺序(重载后位置)不一致
        useChatStore.getState().insertUserMsgAt(sidRef.current, {
          role: "user", text: event.text, timestamp: event.timestamp ?? Date.now(), streaming: true,
        });
        scrollToBottom();
      }
      // context usage update
      if (event.type === "context_usage") {
        useStatusStore.getState().setCtxPct(event.percentage || 0);
      }
    });
    const unsubExit = window.electronAPI.agent.onExit(({ runId }: { runId: string }) => { if (!currentChatRef.current) return; if (runId !== currentChatRef.current) return; curAiMsgIdRef.current = 0; busyRef.current = false; setBusy(false); useStatusStore.getState().popSignal("request"); useStatusStore.getState().popSignal("tool"); onActivity?.(); });
    const unsubSid = window.electronAPI.agent.onChatSession(({ sessionId: realSid, chatId: eventChatId }) => {
      if (currentChatRef.current && eventChatId !== currentChatRef.current) return;
      if (!currentChatRef.current && (!existingSid || realSid !== existingSid)) return;
      if (sidRef.current && sidRef.current !== realSid) {
        // Migrate messages from temp ID to real session ID, then evict temp
        const tempMsgs = useChatStore.getState().messagesBySession[sidRef.current];
        if (tempMsgs) {
          useChatStore.getState().loadSession(realSid, tempMsgs);
          useChatStore.getState().evictSession(sidRef.current);
        }
        // 便签跟随迁移（临时 sid → 真实 sid）；须在 sidRef.current 更新前调用
        usePinStore.getState().migrateSession(sidRef.current, realSid);
        setSid(realSid);
        sidRef.current = realSid;
        useTabStore.getState().setSessionRunning(realSid, true);
        onSessionCreated?.(realSid);
      } else if (!sidRef.current) {
        sidRef.current = realSid;
        setSid(realSid);
        useTabStore.getState().setSessionRunning(realSid, true);
        onSessionCreated?.(realSid);
      }
    });
    // Context rotation events — filter by chatId
    const unsubCtxSum = window.electronAPI.agent.onContextSummarizing(({ chatId: ctxChatId, type }: { chatId: string; type?: string }) => {
      if (!currentChatRef.current) return;
      if (ctxChatId !== currentChatRef.current) return;
      if (type === "done") {
        // 轮转失败兜底：清除总结状态
        useStatusStore.getState().setSummarizing(false);
        useStatusStore.getState().popSignal("summary");
        useStatusStore.getState().popSignal("compact");
        return;
      }
      useStatusStore.getState().pushSignal(type === "compact" ? "compact" : "summary",
        type === "compact" ? "正在整理会话..." : "正在整理并开启新会话...");
      if (type === "compact") {
        useTabStore.getState().setSessionRunning(sidRef.current, true);
        useStatusStore.getState().setCompacting(true);
      } else {
        useStatusStore.getState().setSummarizing(true);
      }
    });
    const unsubCtxUsage = window.electronAPI.agent.onContextUsage(({ chatId: ctxChatId, percentage }) => {
      if (!currentChatRef.current) return;
      if (ctxChatId !== currentChatRef.current) return;
      const pct = Math.round(percentage);
      useStatusStore.getState().setCtxPct(pct);
      if (sidRef.current) {
        window.electronAPI.sessionCache.write(sidRef.current, { contextUsage: pct }).catch(() => {});
      }
      // 主动压缩：使用率达到设置阈值（默认 65%）就提前 compact——
      // 等 Pi 自动压缩时已接近 100%，模型性能在 75% 后明显下降。
      const threshold = useSettingsStore.getState().contextThreshold || 75;
      const st = useStatusStore.getState();
      if (
        pct >= threshold &&
        !st.compacting && !st.summarizing &&
        ctxThresholdFiredRef.current !== threshold &&
        currentChatRef.current
      ) {
        ctxThresholdFiredRef.current = threshold;
        console.log(`[ChatPanel] ctx ${pct}% ≥ ${threshold}% → 主动压缩`);
        window.electronAPI.agent.compact(sidRef.current).catch(() => {});
      }
      // 使用率显著回落（压缩完成）后允许再次触发
      if (pct < threshold - 20) ctxThresholdFiredRef.current = 0;
    });
    return () => { unsub(); unsubExit(); unsubSid(); unsubCtxSum(); unsubCtxUsage(); if (sidRef.current) { useTabStore.getState().setSessionRunning(sidRef.current, false); if (!sidRef.current.startsWith("__new_")) { window.electronAPI.agent.scheduleIdleTimeout(sidRef.current, 10 * 60 * 1000); } } useStatusStore.getState().reset(); };
  }, []);

  // Summarizing timeout — 120s safety net
  useEffect(() => {
    if (!summarizing) return;
    const timer = setTimeout(() => {
      useStatusStore.getState().setSummarizing(false);
      useStatusStore.getState().popSignal("summary");
      useStatusStore.getState().pushSignal("error", "摘要超时，将开新会话继续", 8000);
      console.error("[ChatPanel] summarization timed out after 120s");
    }, 120_000);
    return () => clearTimeout(timer);
  }, [summarizing]);

  // Busy 卡住兜底：30s 无事件时，用 session.isStreaming 核实
  useEffect(() => {
    if (!busy || !existingSid) return;
    const interval = setInterval(async () => {
      try {
        const streaming = await window.electronAPI.agent.isStreaming(sidRef.current);
        if (!streaming) {
          console.log("[ChatPanel] session.isStreaming=false, 清除 busy");
          setBusy(false);
          useStatusStore.getState().popSignal("request");
          useStatusStore.getState().popSignal("tool");
        }
      } catch { /* 网络错误忽略 */ }
    }, 30_000);
    return () => clearInterval(interval);
  }, [busy, existingSid]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // 打开会话（0 → N 条）：scrollToIndex 贴底——库官方 API，
  // 内部处理动态测量，比手动 scrollTop/scrollHeight 可靠。
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    if (messages.length > 0 && prevMsgCountRef.current === 0) {
      // 程序性滚动标记：scrollToIndex 动画期间不污染 autoScroll
      programmaticScrollRef.current = true;
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
      setTimeout(() => { programmaticScrollRef.current = false; }, 600);
    }
    prevMsgCountRef.current = messages.length;
  }, [messages, virtualizer]);

  // 虚拟化测量是异步的：messages 加载后的首次滚动发生在 totalSize 还是估算值时，
  // 测量完成后需再贴底一次（流式增长时总高度变大）
  useEffect(() => {
    if (autoScrollRef.current) scrollToBottom();
  }, [virtualizer.getTotalSize(), scrollToBottom]);

  // ── Session cache ────────────────────────────────
  useEffect(() => {
    if (!existingSid) return;
    window.electronAPI.sessionCache.read(existingSid).then((cache) => {
      if (cache) {
        if (cache.permissionMode) setPermissionMode(cache.permissionMode);
        if (cache.model) setChatModel(cache.model);
        if (cache.contextUsage > 0) useStatusStore.getState().setCtxPct(cache.contextUsage);
      }
    }).catch(() => {});
  }, [existingSid]);

  useEffect(() => {
    if (sidRef.current) {
      window.electronAPI.sessionCache.write(sidRef.current, { permissionMode }).catch(() => {});
    }
  }, [permissionMode]);

  useEffect(() => {
    if (sidRef.current && chatModel) {
      window.electronAPI.sessionCache.write(sidRef.current, { model: chatModel }).catch(() => {});
    }
  }, [chatModel]);

  // ── Send ───────────────────────────────────────────

  const sendText = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg && attaches.length === 0) return;

    // Build agent message with numbered markers
    const parts: string[] = [];
    attaches.forEach((a, i) => {
      const tag = a.kind === "image" ? "Image" : "File";
      parts.push(`[${tag} #${i + 1}: ${a.path}]`);
    });
    if (msg) parts.push(msg);
    const agentText = parts.join("\n");

    const ts = Date.now();
    useChatStore.getState().appendUserMsg(sidRef.current, { role: "user", text: msg || undefined, attaches: [...attaches], timestamp: ts });
    curAiMsgIdRef.current = 0;  // 新用户消息 → 下一帧新建消息锚点（steer 插话不触发 turn_start 时兜底）
    setAttaches([]);
    onActivity?.();
    stoppedRef.current = false; autoScrollRef.current = true; scrollToBottom(true);

    // Mint 输出期间发送消息 → steer 插话，不需新建会话
    if (busy && currentChatRef.current && existingSid) {
      steeringRef.current = true;
      try {
        await window.electronAPI.agent.steer(existingSid, agentText);
      } catch { /* steer 失败不影响 UI */ }
      return;
    }

    busyRef.current = true; setBusy(true); useStatusStore.getState().pushSignal("request", "正在请求...");

    try {
      currentChatRef.current = null;
      // 编码图片附件为 Pi ImageContent 格式
      const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
      for (const a of attaches) {
        if (a.kind === "image" && a.dataUrl) {
          const m = a.dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
          if (m) images.push({ type: "image" as const, data: m[2]!, mimeType: m[1]! });
        }
      }
      const tab = useTabStore.getState().tabs.find(function(t) { return t.sessionId === sid || (!t.sessionId && !existingSid); });
      const effectivePath = projectPath || getWorkspaceDir();
      const result = await window.electronAPI.agent.sendMessage(effectivePath, agentText, { sessionId: existingSid ?? null, permissionMode: permissionMode ?? "auto", isDesigner: tab?.isDesigner, images: images.length > 0 ? images : undefined, thinkingLevel: thinkingLevel ?? "medium" });
      setCurrentRunId(result.chatId); currentChatRef.current = result.chatId;
    } catch { busyRef.current = false; setBusy(false); currentChatRef.current = null; useStatusStore.getState().pushSignal("error", "发送失败，请检查网络后重试", 8000); }
  }, [busy, attaches, projectPath, permissionMode, thinkingLevel]);

  useEffect(() => { chatActions.register((t: string) => sendText(t)); return () => chatActions.unregister(); }, [sendText]);

  const hasMessages = messages.length > 0;

  // Tool-call driven UI actions — Mint calls show_* tools, frontend detects tool_use entries
  const lastToolUses = useMemo(() => {
    if (messages.length === 0) return [];
    const lastAi = messages.filter((m) => m.role === "ai" && m.entries).pop();
    if (!lastAi?.entries) return [];
    return lastAi.entries.filter((e) => e.kind === "tool_use");
  }, [messages]);
  const showConfirmDev = !busy && lastToolUses.some((e) => (e as { name?: string }).name === "show_confirm_dev");
  const showNewProjectBtn = onNewProject && !busy && lastToolUses.some((e) => (e as { name?: string }).name === "show_new_project");

  // ── Attach preview (shared between both positions) ─
  function AttachPreview(): JSX.Element {
    return (
      <div className="flex gap-2 flex-wrap">
        {attaches.map((a, i) => (
          <div key={`attach-${i}`} className={`group relative shrink-0 border border-border ${a.kind === "image" && a.dataUrl ? "w-16 h-16 rounded-lg" : "flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface max-w-[220px]"}`}>
            {a.kind === "image" && a.dataUrl ? (
              <img src={a.dataUrl} alt={a.name} className="w-full h-full object-cover rounded-lg" />
            ) : (
              <DocIcon name={a.name} />
            )}
            {a.kind !== "image" || !a.dataUrl ? <span className="text-xs text-text-primary truncate flex-1 min-w-0">{a.name}</span> : null}
            <button className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500/70 flex items-center justify-center" onClick={() => removeAttach(i)}>
              <svg viewBox="0 0 10 10" fill="none" className="stroke-inverse w-2 h-2" strokeWidth="2" strokeLinecap="round"><path d="M2 2l6 6M8 2L2 8"/></svg>
            </button>
          </div>
        ))}
        <button className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-text-secondary hover:border-accent hover:text-accent transition-colors shrink-0"
          onClick={() => imgInputRef.current?.click()} title="添加文件">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="w-4 h-4"><path d="M7 3v8M3 7h8"/></svg>
        </button>
      </div>
    );
  }

  // ── Render user bubble ─────────────────────────────

  function UserBubble({ msg }: { msg: ChatMessage }): JSX.Element {
    return (
      /* 宽度钳制由外层 relative（shrink-0 max-w-[75%]）负责；
         此处不再设 max-w/w-fit，避免相对 fit-content 层的循环依赖导致短文本被压窄 */
      <div className="flex gap-4 items-start">
        <div className="min-w-0">
          <div className="msg-from text-right">USER</div>
          <div className="msg-bubble-user rounded-[10px] rounded-br-[4px] px-[14px] py-1.5 text-sm leading-[1.55] overflow-hidden min-w-0 [overflow-wrap:anywhere]">
          {msg.attaches && msg.attaches.length > 0 && (
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {msg.attaches.map((a, i) => (
                a.kind === "image" ? (
                  a.dataUrl ? (
                    <img key={`img-${i}`} src={a.dataUrl} alt={a.name} className="max-w-[260px] max-h-[220px] rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setPreviewImage(a.dataUrl || null)} />
                  ) : (
                    <div key={`doc-${i}`} className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/10 max-w-[200px]">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-4 h-4 shrink-0"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><circle cx="5" cy="6" r="1.3"/><path d="M1.5 11l3.5-3.5 2.5 2.5 3-4 4 5"/></svg>
                      <span className="text-[11px] truncate">{a.name}</span>
                    </div>
                  )
                ) : (
                  <div key={`udoc-${i}`} className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/10 max-w-[200px]">
                    <DocIcon name={a.name} />
                    <span className="text-[11px] truncate">{a.name}</span>
                  </div>
                )
              ))}
            </div>
          )}
          {msg.text ? <div className="whitespace-pre-wrap [overflow-wrap:anywhere] min-w-0">{msg.text}</div> : null}
          </div>
        </div>
        <div className="msg-avatar user">U</div>
      </div>
    );
  }

  const userBubble = useCallback((msg: ChatMessage) => (
    <UserBubble msg={msg} />
  ), []);

  const handlePin = useCallback((text: string) => {
    usePinStore.getState().addPin(sidRef.current, text);
  }, []);

  const [ctxMenu, setCtxMenu] = useState<ContextMenuData | null>(null);
  const closeMenu = useCallback(() => setCtxMenu(null), []);
  // 钉住重复提示（2 秒自动消失）
  const [pinToast, setPinToast] = useState<string | null>(null);
  const showPinToast = useCallback((text: string) => {
    setPinToast(text);
    setTimeout(() => setPinToast(null), 2000);
  }, []);

  // 消息右键菜单：有选区时复制/钉住选区（markdown 还原），无选区时复制/钉住全文
  const handleMsgContextMenu = useCallback((msg: ChatMessage, e: React.MouseEvent) => {
    e.preventDefault();
    const container = e.currentTarget as HTMLElement;
    const sel = window.getSelection();
    const hasSel = !!sel && !sel.isCollapsed && !!sel.toString().trim();
    const selInMsg = hasSel && sel.rangeCount > 0 && container.contains(sel.getRangeAt(0).commonAncestorContainer);
    const selText = selInMsg ? sel!.toString() : "";
    const copyText = getMsgCopyText(msg);
    // 选区快照：菜单打开期间用户可能改变选区（如 Ctrl+A），钉住用快照而非重读 live Selection
    const pinRange = selInMsg ? sel.getRangeAt(0).cloneRange() : null;

    const items: ContextMenuItem[] = [
      { label: "复制", onClick: () => { navigator.clipboard.writeText(selInMsg ? selText : copyText).catch((err: unknown) => console.error("[copy]", err)); } },
      { label: "全选", onClick: () => {
        const bubbleEl = container.querySelector(".msg-bubble-agent, .msg-bubble-user");
        if (!bubbleEl) return;
        const range = document.createRange();
        range.selectNodeContents(bubbleEl);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(range);
      } },
      { label: "钉住", onClick: () => {
        let ok: boolean;
        if (pinRange) {
          ok = usePinStore.getState().addPin(sidRef.current, blocksToMarkdown(selectionToBlocks(pinRange)));
          window.getSelection()?.removeAllRanges();
        } else {
          ok = usePinStore.getState().addPin(sidRef.current, copyText);
        }
        if (!ok) showPinToast("该内容已钉为便签");
      } },
    ];
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col" onDragOver={handleDragOver} onDrop={handleDrop}>
      <div ref={attachScrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden pb-2">
        {!hasMessages ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <h1 className="chat-empty-title">开始对话</h1>
            <p className="chat-empty-desc">有什么想法，跟Mint聊聊吧</p>
          </div>
        ) : (
          <div className="px-8 py-4">
            {/* 虚拟化消息列表：absolute 定位 + translateY，测量高度撑起滚动空间 */}
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const msg = messages[vi.index]!;
                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
                    className="pb-8"
                  >
                    <MemoChatMessage
                      msg={msg}
                      showThinking={showThinking}
                      showToolUse={showToolUse}
                      busy={vi.index === messages.length - 1 && busy}
                      userBubble={userBubble}
                      onPin={handlePin}
                      onContextMenu={handleMsgContextMenu}
                      sid={sid}
                    />
                    {/* 委派进度卡片：固定附着在触发消息气泡下方(左对齐气泡) */}
                    {delegation && delegation.triggerMsgId === msg.id && (
                      <div className="flex gap-4 items-start" style={{ padding: "0 var(--s8)" }}>
                        <div style={{ width: 34, flexShrink: 0 }} />
                        <DelegationProgress delegation={delegation} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {showNewProjectBtn && (
              <div className="flex justify-center pb-3">
                <button
                  onClick={onNewProject}
                  className="px-6 py-2.5 rounded-xl bg-accent text-text-inverse text-sm font-medium hover:bg-accent-hover transition-colors shadow-sm"
                >
                  新建项目
                </button>
              </div>
            )}
            {showConfirmDev && (
              <div className="flex justify-center pb-3">
                <button
                  onClick={() => sendText(CONFIRM_DEVELOPMENT_PROMPT)}
                  className="px-6 py-2.5 rounded-[10px] bg-accent text-text-inverse text-sm font-semibold border-none cursor-pointer transition-all duration-200 hover:bg-accent-hover hover:-translate-y-px active:translate-y-0"
                >
                  确认开发
                </button>
              </div>
            )}
            {/* Compact 完成提示 */}
            {compactDone && (
              <div className="flex justify-center py-3">
                <span className="text-[11px] text-text-secondary bg-surface-alt px-3 py-1 rounded-full border border-border/50">会话已整理完毕</span>
              </div>
            )}

          </div>
        )}
      </div>

      {/* 后台进程条:agent·N / shell·N */}
      <ProcessBar />
      {/* 状态栏:独立于输入区,渲染在输入容器上方 */}
      <StatusBar sessionId={sidRef.current} />
      <PermissionPrompt />

      {/* Attach preview — above thinking when busy */}
      {busy && attaches.length > 0 && (
        <div className="px-4 py-2 bg-surface-alt/30 border-t border-border/50 shrink-0"><AttachPreview /></div>
      )}

      <ChatInput
        busy={busy}
        attaches={attaches}
        setAttaches={setAttaches}
        onSend={sendText}
        onStop={() => { stoppedRef.current = true; busyRef.current = false; const rid = currentChatRef.current; if (rid) window.electronAPI.agent.abort(rid); setBusy(false); }}
        onPaste={handlePaste}
        imgInputRef={imgInputRef}
        docInputRef={docInputRef}
        onImgChange={handleImgChange}
        onDocChange={handleDocChange}
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
        chatModel={chatModel || storeModel}
        onModelChange={handleModelChange}
        thinkingLevel={thinkingLevel}
        onThinkingLevelChange={handleThinkingLevelChange}
        sessionId={sidRef.current}
        onStatsClick={() => setShowStats(true)}
      />
      {showStats && (
        <SessionStatsPopup
          sessionId={sidRef.current}
          projectPath={projectPath || getWorkspaceDir()}
          onClose={() => setShowStats(false)}
        />
      )}
      {/* 内容便签悬浮层：仅当前会话可见，随 tab 显隐 */}
      <PinLayer sessionId={sid} />
      <ContextMenu menu={ctxMenu} onClose={closeMenu} />
      {/* 钉住提示 */}
      {pinToast && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg bg-surface-elevated border border-border shadow-lg text-xs text-text-primary pointer-events-none">
          {pinToast}
        </div>
      )}
      {/* Image lightbox */}
      {previewImage && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center outline-none"
          onClick={() => setPreviewImage(null)}
          onKeyDown={(e) => { if (e.key === "Escape") setPreviewImage(null); }}
          tabIndex={-1} ref={(el) => el?.focus()}>
          <img src={previewImage} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()} />
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
            onClick={(e) => { e.stopPropagation(); setPreviewImage(null); }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5"><path d="M4 4l8 8M12 4L4 12"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Memo message item: avoids re-rendering all messages on each stream event ──

interface MemoChatMessageProps {
  msg: ChatMessage;
  showThinking: boolean;
  showToolUse: boolean;
  busy: boolean;
  userBubble: (msg: ChatMessage) => JSX.Element;
  onPin: (text: string) => void;
  onContextMenu: (msg: ChatMessage, e: React.MouseEvent) => void;
  sid: string;
}

const MemoChatMessage = memo(function MemoChatMessage({ msg, showThinking, showToolUse, busy, userBubble, onPin, onContextMenu, sid }: MemoChatMessageProps) {
  const visible = useMemo(() => {
    if (!msg.entries) return [];
    return msg.entries.filter((e) => {
      if (e.kind === "text") return true;
      if (e.kind === "thinking") return showThinking;
      return showToolUse;
    });
  }, [msg.entries, showThinking, showToolUse]);

  const blocks = useMemo(() =>
    visible.length > 0 ? buildBlocks(visible, String(msg.id)) : [],
    [visible, msg.id],
  );

  // 气泡全文：所有 text entry 合并（不含思考/工具）
  const copyText = useMemo(() => getMsgCopyText(msg), [msg]);

  // 操作条显隐：hover 消息立即显示；离开消息后 1s 缓冲（期间鼠标移到按钮上则继续显示）
  const [actionsVisible, setActionsVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const showActions = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setActionsVisible(true);
  }, []);
  const scheduleHideActions = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setActionsVisible(false), 1000);
  }, []);
  useEffect(() => () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); }, []);

  if (msg.role === "user") {
    // 系统消息：子 Agent 委派完成 → 绿色结果气泡;通用系统消息 → 居中灰字胶囊
    const text = typeof msg.text === "string" ? msg.text : "";
    if (text.startsWith("[系统消息]-[Agent执行结果]")) {
      const body = text.replace(/^\[系统消息\]-\[Agent执行结果\]\s*/, "");
      const rows = body.split("\n").filter((l) => l.startsWith("● "));
      return (
        <div className="flex gap-4 items-start" style={{ padding: "0 var(--s8)" }}>
          <div style={{ width: 34, flexShrink: 0 }} />
          {/* 普通气泡样式(text-sm 与其他消息一致),状态用圆点颜色区分:绿=完成,黄=人为打断,红=意外中断 */}
          <div className="w-fit max-w-[75%] my-1 rounded-[10px] rounded-bl-[4px] border border-border bg-surface-elevated px-[14px] py-1.5 text-sm leading-[1.55]">
            {rows.map((row, i) => {
              const m = row.match(/^● (.+?) — (完成|失败|中止)(?: · (\d+)s)?$/);
              // 中止=人为打断(黄),失败=意外中断(红),完成=绿
              const status = m?.[2];
              const dotColor = status === "中止" ? "text-warning" : status === "失败" ? "text-danger" : "text-success";
              return (
                <div key={i} className="flex items-center gap-2 py-0.5">
                  <svg className={`shrink-0 ${dotColor}`} width="9" height="9" viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="5.5" fill="currentColor" />
                  </svg>
                  {m ? (
                    <>
                      <span className="text-text-primary">{m[1]}</span>
                      <span className={`${dotColor}`}>— {m[2]}</span>
                      {m[3] && <span className="text-text-secondary/70 tabular-nums">· {m[3]}s</span>}
                    </>
                  ) : (
                    <span className="text-text-secondary">{row.slice(2)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    if (text.startsWith("[系统消息]")) {
      return (
        <div className="flex justify-center py-1.5">
          <span className="text-[11px] text-text-secondary bg-surface-alt px-3 py-1 rounded-full border border-border/50 max-w-[80%] text-center whitespace-pre-wrap [overflow-wrap:anywhere]">
            {text.replace(/^\[系统消息\]\s*/, "")}
          </span>
        </div>
      );
    }
    return (
      <div className="msg-in" onMouseEnter={showActions} onMouseLeave={scheduleHideActions} onContextMenu={(e) => onContextMenu(msg, e)}>
        <div className="flex justify-end">
          {/* shrink-0：flex 子项不被压缩（中文 min-content 是单字，压缩会逐字换行）；
             max-w-[75%]：超长文本钳制宽度后由内部 overflow-wrap 换行 */}
          <div className="relative shrink-0 max-w-[75%] min-w-0">
            {userBubble(msg)}
            <BubbleActions text={copyText} onPin={onPin} sid={sid} visible={actionsVisible} />
          </div>
        </div>
      </div>
    );
  }

  if (visible.length === 0) return null;

  return (
    <div className="msg-in" onMouseEnter={showActions} onMouseLeave={scheduleHideActions} onContextMenu={(e) => onContextMenu(msg, e)}>
      <div className="flex gap-4 items-start max-w-[75%]">
        <div className="msg-avatar agent">M</div>
        <div className="min-w-0 relative">
          <div className="msg-from">Mint</div>
          <div className="msg-bubble-agent rounded-[10px] rounded-bl-[4px] px-[14px] py-1.5 overflow-hidden">
            {blocks.map((block, i) => (
              <ChatBlockView key={`blk-${msg.id}-${i}`} block={block} streaming={busy} />
            ))}
          </div>
          <BubbleActions text={copyText} onPin={onPin} sid={sid} visible={actionsVisible} />
        </div>
      </div>
    </div>
  );
});
