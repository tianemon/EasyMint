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
import { useDelegationStore } from "../stores/delegation-store";
import { normalizeApiError } from "../../../shared/api-errors";
import { PermissionPrompt } from "./PermissionPrompt";
import { ChatInput } from "./ChatInput";
import { SessionStatsPopup } from "./SessionStatsPopup";
import { getWorkspaceDir } from "../lib/getWorkspaceDir";
import { blocksToMarkdown, selectionToBlocks } from "../lib/selection-to-markdown";
import { PinLayer } from "./PinLayer";
import { usePinStore } from "../stores/pin-store";
import { DelegationProgress, type DelegationUiState, type DelegationTaskUi } from "./DelegationProgress";
import { ContextMenu, type ContextMenuData, type ContextMenuItem } from "./ContextMenu";
import { BubbleActions, roleColor, DocIcon } from "./ChatBubbleActions";


interface ChatPanelProps {
  projectPath: string;
  sessionId?: string;
  /** 设计会话标记(tab 直传,避免多新 tab 反查错配导致用错 Mint-D/Mint 模板) */
  isDesigner?: boolean;
  /** 群聊会话 ID(需求 4:多 Agent 同一会话,type === "group" 的 tab 传入) */
  groupId?: string;
  onSessionCreated?: (sessionId: string) => void;
  onActivity?: () => void;
  onNewProject?: () => void;
}

/** 系统消息 kind → 头部标签(系统卡片统一形态的辨识信息) */
const SYSTEM_KIND_LABELS: Record<string, string> = {
  delegation: "子 Agent 委派",
  shell: "后台命令",
  "project-created": "项目初始化",
  flow: "流程指令",
  handoff: "会话交接",
  summary: "上下文摘要",
};

export function ChatPanel({ projectPath, sessionId: existingSid, isDesigner, groupId, onSessionCreated, onActivity, onNewProject }: ChatPanelProps): JSX.Element {
  // 群聊模式:消息以 groupId 为存储 key(各 Agent 事件注入 agentRole 标注来源),
  // 不做临时→真实 sessionId 迁移、不加载 conv 历史(群聊由 group-sessions.json 管理)
  const isGroup = !!groupId;
  const tempSidRef = useRef<string | null>(null);
  if (!existingSid && !groupId && !tempSidRef.current) tempSidRef.current = `__new_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const initialSid = groupId ?? existingSid ?? tempSidRef.current!;
  const [sid, setSid] = useState<string>(initialSid);
  const emptyArr = useRef<ChatMessage[]>([]);
  const rawMsgs = useChatStore((s) => s.messagesBySession[sid]);
  const messages: ChatMessage[] = rawMsgs || (emptyArr.current as ChatMessage[]);

  const [_currentRunId, setCurrentRunId] = useState<string | null>(null);
  const currentChatRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const busyRef = useRef(false);
  const ctxThresholdFiredRef = useRef(0); // 已按阈值触发过主动压缩（防止同轮重复触发）
  // 当前输出段块(assistant 消息)id:Pi 每条输出段消息有独立 message_start/update/end
  // 生命周期(磁盘逐条落盘);块 piTs = 消息对象创建时间戳,通知按 ts 插到块之间
  // → UI 顺序 = jsonl 顺序(不依赖广播到达顺序)
  // 新消息气泡:用户滚离底部时显示(常驻)——busy 中=圆圈箭头图标;输出结束=「新消息」胶囊带箭头;
  // 点击回底或手动滚回底部消失
  const [showNewMsg, setShowNewMsg] = useState(false); // 输出结束且不在底部的"新消息"状态
  const showNewMsgRef = useRef(false); // 与 state 同步(handleScroll 空依赖闭包读 ref)
  const [awayFromBottom, setAwayFromBottom] = useState(false); // 用户是否离开底部(渲染驱动)
  const awayFromBottomRef = useRef(false); // 跨阈值去重(滚动高频时只在边界变化时 setState)

  const imgInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [attaches, setAttaches] = useState<AttachItem[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState("auto");
  const storeModel = useSettingsStore((s) => s.model);
  const setStoreModel = useSettingsStore((s) => s.setModel);
  const showThinking = useSettingsStore((s) => s.showThinking);
  // 全局聊天思考等级:仅作为新会话的初始默认(方案 B,聊天下拉可临时改)
  const globalThinkingLevel = useSettingsStore((s) => s.chatThinkingLevel);
  const [thinkingLevel, setThinkingLevel] = useState(globalThinkingLevel || "medium");
  // 用户是否手动切过思考等级:手动切过后不再跟随全局变化(方案 B)
  const userChangedThinkingRef = useRef(false);

  const showToolUse = useSettingsStore((s) => s.showToolUse);
  const [chatModel, setChatModel] = useState("");
  // 会话绑定的供应商 piId(需求 5:不同会话不同供应商)
  const [chatProvider, setChatProvider] = useState<string>("");

  const handleModelChange = useCallback(async (m: string) => {
    setChatModel(m); setStoreModel(m);
    const sid = sidRef.current;
    if (sid) { window.electronAPI.agent.setModel(sid, m).catch(() => {}); }
  }, [setStoreModel]);
  const [showStats, setShowStats] = useState(false);
  const handleThinkingLevelChange = useCallback((level: string) => {
    userChangedThinkingRef.current = true;
    setThinkingLevel(level);
    const sid = sidRef.current;
    if (sid) window.electronAPI.agent.setThinkingLevel(sid, level).catch(() => {});
  }, []);

  // 加固(启动竞态):store 异步加载完成前,新会话可能拿到默认 medium。
  // 全局值变化且用户未手动切过时,同步本地值;手动切过后不再跟随(方案 B)。
  useEffect(() => {
    if (globalThinkingLevel && !userChangedThinkingRef.current) {
      setThinkingLevel(globalThinkingLevel);
    }
  }, [globalThinkingLevel]);

  const msgIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  /** 输入框变化处理：检测开头 / 触发命令面板（仅在输入框纯命令上下文下，不影响代码片段） */
  const autoScrollRef = useRef(true);
  // 最新回合输出块 id:thinking/tool 块归入目标(不做文本 diff,流式临时内容)
  const latestAiIdRef = useRef(0);
  // steer 打断标记
  const steeringRef = useRef(false);
  const sidRef = useRef<string>(initialSid);
  // 按会话读压缩/摘要状态(须在 sidRef 声明后——useStatusStore selector 渲染期执行)
  const summarizing = useStatusStore((s) => s.bySession[sidRef.current]?.summarizing ?? false);
  const compacting = useStatusStore((s) => s.bySession[sidRef.current]?.compacting ?? false);
  const [compactDone, setCompactDone] = useState(false);
  const prevCompacting = useRef(false);
  useEffect(() => {
    if (prevCompacting.current && !compacting) setCompactDone(true);
    prevCompacting.current = compacting;
  }, [compacting]);
  useEffect(() => {
    if (!compactDone) return;
    const t = setTimeout(() => setCompactDone(false), 3000);
    return () => clearTimeout(t);
  }, [compactDone]);
  useEffect(() => {
    if (isGroup) return; // 群聊无临时→真实 sessionId 迁移
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

  // 新消息气泡触发(简化):回合输出完全结束(busy true→false)后,用户不在底部 → 「新消息」状态。
  // 流式中(用户滚离底部)由 awayFromBottom 驱动显示圆圈箭头(常驻)
  const prevBusyRef = useRef(false);
  useEffect(() => {
    if (prevBusyRef.current && !busy) {
      if (awayFromBottomRef.current) {
        setShowNewMsg(true);
        showNewMsgRef.current = true;
      }
    }
    prevBusyRef.current = busy;
  }, [busy]);

  // 滚动状态机(最终版:用户意图用"输入时间窗"判定):
  // - 任何用户输入(wheel/touch/mousedown)后 500ms 内的 scroll 变化 = 用户滚动意图——
  //   覆盖滚轮/触摸板/触屏/滚动条拖动;程序性贴底/测量增长(无用户输入)的 scroll 永不误判
  // - autoScrollRef=false:用户滚离底部(dist>8);恢复:滚回底部(dist<8) → 跟随 + 隐藏气泡
  const lastUserInputRef = useRef(0); // 最近一次用户输入时间(判定窗口)
  const markUserInput = useCallback(() => { lastUserInputRef.current = Date.now(); }, []);
  const handleScroll = useCallback(() => {
    // 程序性贴底/测量调整(无用户输入)不参与判定——彻底消除误判,不需要保护窗口
    if (Date.now() - lastUserInputRef.current > 500) return;
    const el = containerRef.current; if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom < 8;
    if (atBottom) {
      autoScrollRef.current = true; // 滚回底部 → 恢复自动跟随
      // 气泡消失(用户已看到新消息);跨阈值时更新渲染 state
      if (showNewMsgRef.current) setShowNewMsg(false);
      if (awayFromBottomRef.current) {
        awayFromBottomRef.current = false;
        setAwayFromBottom(false);
      }
    } else {
      autoScrollRef.current = false; // 用户滚离底部 → 停止跟随(气泡触发条件之一)
      if (!awayFromBottomRef.current) {
        awayFromBottomRef.current = true;
        setAwayFromBottom(true);
      }
    }
  }, []);
  // 用户输入标记(wheel/touch/mousedown——滚动条拖动/触屏都覆盖;判定统一在 handleScroll)
  const handleUserInput = useCallback(() => {
    markUserInput();
  }, [markUserInput]);

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
    // 正规手段(替代手写贴底链):anchorTo: "end" 是库原生聊天列表机制——
    // 用户在底部时内容测量变化(流式增长)自动保持贴底;用户滚动离开自动停止跟随。
    // scrollToIndex 的 scrollState 在测量变化时持续校正对齐直到稳定(官方处理估算→实测)
    anchorTo: "end",
    // measureElement 在 React commit 阶段触发 onChange，默认的 flushSync 会
    // 报 "flushSync was called from inside a lifecycle method"——改走普通调度
    useFlushSync: false,
  });
  // 贴底(发送消息/气泡点击):virtualizer.scrollToIndex 官方 API。
  // rAF 延迟:事件处理中 virtualizer 的 count 还是旧值(React 渲染时才 setOptions 更新),
  // scrollToIndex 内部 clamp 到 count-1——发送消息同步插入用户消息后立即调用会滚到
  // 旧最后一条(AI 消息);rAF 时 React 已重渲染,count 更新,定位到用户消息
  const scrollToBottom = useCallback((_force = false) => {
    const msgs = useChatStore.getState().messagesBySession[sidRef.current] || [];
    const target = msgs.length - 1;
    if (target < 0) return;
    autoScrollRef.current = true; // 程序性回底 = 恢复自动跟随
    // 气泡立即消失:handleScroll 只在用户输入后 500ms 内判定,程序性贴底(点击/发送)不触发
    if (awayFromBottomRef.current) {
      awayFromBottomRef.current = false;
      setAwayFromBottom(false);
    }
    if (showNewMsgRef.current) {
      showNewMsgRef.current = false;
      setShowNewMsg(false);
    }
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(target, { align: "end" });
    });
  }, [virtualizer]);

  // 内容增长跟随:totalSize 变化(流式输出/打开会话的测量推进)时,若用户没滚离底部 → 贴底。
  // 这是 anchorTo: "end" 的替代——库的 wasAtEnd 用 totalSize-based 距离判定,与 DOM 实际
  // 高度有偏差(估算混合),贴底后内容增长时判定失效(实测 dist 0→125);本方案用
  // autoScrollRef(DOM 判定 + wheel 输入)直接控制,可靠
  useEffect(() => {
    if (autoScrollRef.current && messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
    }
  }, [virtualizer.getTotalSize(), messages.length, virtualizer]);

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

  // 新挂载时重置本会话残留状态(防止窗口切换/重开后状态栏显示旧文本;按会话隔离,不影响其他 tab)
  useEffect(() => { useStatusStore.getState().reset(sidRef.current); }, []);

  // ── 子 Agent 委派进度卡片 ─────────────────────────
  const [delegation, setDelegation] = useState<DelegationUiState | null>(null);
  // 事件回调内跟踪当前委派状态(副作用必须移出 useState updater——
  // updater 渲染期间执行,调用其他 store 会触发跨组件更新警告)
  const delegationRef = useRef<DelegationUiState | null>(null);

  // 委派任务清单订阅：委派创建即初始化全部任务行(pending,含并发排队未启动的)
  useEffect(() => {
    const unsubInit = window.electronAPI.agent.onDelegationInit((data: {
      chatId?: string;
      delegationId: string;
      tasks: Array<{
        index: number;
        agent: string;
        status: "pending" | "running" | "completed" | "failed" | "aborted";
        task: string;
        title?: string;
        description?: string;
        prompt?: string;
      }>;
    }) => {
      if (!currentChatRef.current) return;
      if (data.chatId && data.chatId !== currentChatRef.current) return;
      // 初始化:delegationId 对应的全部任务行(pending);后续 progress 事件按 index 更新
      const tasks: DelegationTaskUi[] = data.tasks.map((t) => ({
        index: t.index,
        agent: t.agent,
        task: t.task,
        title: t.description || t.title,
        detail: t.prompt,
        status: "pending",
      }));
      const next: DelegationUiState = {
        delegationId: data.delegationId,
        chatId: data.chatId,
        triggerMsgId: undefined,
        tasks,
        finished: false,
        startedAt: Date.now(),
      };
      delegationRef.current = next;
      setDelegation(next);
    });
    return unsubInit;
  }, []);

  useEffect(() => {
    const unsub = window.electronAPI.agent.onDelegationProgress((data: DelegationProgressEvent) => {
      // 过滤:仅显示当前窗口 chat 的委派;currentChatRef 未初始化(非主会话 tab)→ 拒绝,
      // 否则 A 会话的委派进度穿透到所有打开的会话 tab(后台任务通知跨会话显示)
      if (!currentChatRef.current) return;
      if (data.chatId && data.chatId !== currentChatRef.current) return;
      const prev = delegationRef.current;
      const task: DelegationTaskUi = {
        index: data.progress.index,
        agent: data.progress.agent,
        task: data.progress.task,
        // 折叠行显示原始 description(缺失回退 task 首行),展开显示原始 prompt
        title: data.progress.description || (data.progress.task.split("\n")[0] ?? "").replace(/^##\s*任务[:：]\s*/, "").slice(0, 60),
        detail: data.progress.prompt,
        status: data.progress.status,
      };
      // 新委派(首次或 delegationId 变化):捕获触发委派的消息 id
      // (最后一条 AI 消息,含 task 工具调用),卡片固定附着在该消息下方;
      // 同一委派的进度更新沿用原 triggerMsgId(不随新气泡移动)
      const isNewDelegation = !prev || prev.delegationId !== data.delegationId;
      // triggerMsgId 缺失时补捕获(init 预初始化未设,首次 progress 补上附着点)。
      // 委派由 Mint 主动发起时消息可能未落盘——由下方 effect 监听消息流补捕获固定
      const needTriggerMsg = isNewDelegation || !prev?.triggerMsgId;
      let triggerMsgId: number | undefined;
      if (needTriggerMsg) {
        const msgs = useChatStore.getState().messagesBySession[sidRef.current] || [];
        const lastAi = msgs.filter((m) => m.role === "ai").pop();
        triggerMsgId = lastAi?.id;
        if (isNewDelegation) scrollToBottom(true);
      }
      const tasks = prev && prev.delegationId === data.delegationId ? [...prev.tasks] : [];
      const idx = tasks.findIndex((t) => t.index === task.index);
      if (idx >= 0) tasks[idx] = task; else tasks.push(task);
      const finished = tasks.length > 0 && tasks.every((t) =>
        t.status === "completed" || t.status === "failed" || t.status === "aborted");
      const next: DelegationUiState = {
        delegationId: data.delegationId,
        chatId: data.chatId,
        triggerMsgId: isNewDelegation ? triggerMsgId : prev?.triggerMsgId,
        tasks,
        finished,
        // 委派开始时间:首次事件记录,卡片计时用(同一委派沿用)
        startedAt: isNewDelegation ? Date.now() : prev?.startedAt ?? Date.now(),
      };
      delegationRef.current = next;
      // 副作用(事件回调内,合法):委派开始 → 常驻「调用 Agent」;结束 → 清除
      if (!prev) {
        useStatusStore.getState().pushSignal(sidRef.current, "agent", "调用 Agent");
      }
      if (finished && (!prev || !prev.finished)) {
        useStatusStore.getState().popSignal(sidRef.current, "agent");
      }
      // taskId 关联:委派实时状态写 delegation-store(TaskPanel 行实时视图)
      if (data.progress.taskId) {
        useDelegationStore.getState().setTaskExecution(data.progress.taskId, {
          status: data.progress.status,
          durationMs: data.progress.durationMs,
        });
      }
      // 子会话 jsonl 路径回填(AgentBar 查看过程弹层定位;onDelegationCount 广播不含此字段)
      if (data.progress.sessionFile) {
        useDelegationStore.getState().setSessionFile(data.delegationId, data.progress.index, data.progress.sessionFile);
      }
      setDelegation(next);
    });
    return unsub;
  }, []);

  // 委派/shell 状态订阅已移至 App.tsx 全局常驻(所有 tab 关闭时也要保持 store 新鲜);
  // 此处组件直接读 useDelegationStore 按会话过滤显示

  // 委派触发消息落盘后固定附着点：Mint 主动发起时回合未结束消息未落盘,
  // progress 事件捕获不到 triggerMsgId——消息流更新后补捕获并固定,
  // 卡片不再随"最后一条 AI 消息"漂移(委派完成/打断时 Mint 输出会追加新消息)
  useEffect(() => {
    if (!delegation || delegation.triggerMsgId || delegation.finished) return;
    const aiMsgs = messages.filter((m) => m.role === "ai");
    const lastAi = aiMsgs[aiMsgs.length - 1];
    if (!lastAi?.id) return;
    const fixed: DelegationUiState = { ...delegation, triggerMsgId: lastAi.id };
    delegationRef.current = fixed;
    setDelegation(fixed);
  }, [messages, delegation]);

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

  // 群聊模式:从群聊记录文件加载历史(8.8,按 piTs 排序,角色头像渲染)
  useEffect(() => {
    if (!groupId || !projectPath) return;
    let cancelled = false;
    const projectDir = projectPath || getWorkspaceDir();
    (async () => {
      const rec = await window.electronAPI.group.messages(projectDir, groupId);
      if (cancelled || !rec?.messages?.length) return;
      const mapped = rec.messages
        .slice()
        .sort((a, b) => a.piTs - b.piTs)
        .map((m, i) => ({
          id: i + 1,
          role: m.agentRole === "user" ? ("user" as const) : ("ai" as const),
          text: m.text,
          timestamp: m.piTs,
          piTs: m.piTs,
          agentRole: m.agentRole,
          forwardedFrom: m.forwardedFrom,
          // ai 消息渲染依赖 entries,把纯结论包成 text entry
          entries: m.agentRole === "user" ? undefined : [{ kind: "text" as const, text: m.text, timestamp: m.piTs }],
        }));
      if (mapped.length > 0) useChatStore.getState().loadSession(groupId, mapped);
    })();
    return () => { cancelled = true; };
  }, [groupId, projectPath]);

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
      // 群聊模式:按 groupId 过滤(所有 Agent 事件注入统一 groupId)
      if (groupId) {
        if (event.groupId !== groupId) return;
      } else if (currentChatRef.current) {
        // Filter by chatId when known
        if (!event.runId && !event.chatId) return;
        if (event.runId && event.runId !== currentChatRef.current) return;
        if (event.chatId && event.chatId !== currentChatRef.current) return;
      } else if (existingSid) {
        if (!event.sessionId || event.sessionId !== existingSid) return;
      } else {
        // 没有活跃 chat，也没有已知 session → 拒绝所有外部事件，防止跨窗口污染
        return;
      }
      // 打断后:只丢弃被打断回合的残留内容帧;通知(新注入)正常渲染,
      // 新回合(turn_start,如打断后的 Mint 总结)开始 → 恢复渲染。
      // (原实现 return 丢弃一切——打断通知/总结回合全被吞,磁盘有而 UI 无)
      if (stoppedRef.current) {
        if (event.type === "turn_start") {
          stoppedRef.current = false;
        } else if (event.type !== "custom_event") {
          return;
        }
      }
      if (!currentChatRef.current && !groupId) {
        const cid = event.chatId || event.runId;
        if (cid) { currentChatRef.current = cid; setCurrentRunId(cid); }
      }
      setBusy(true);
      // 输出段块(assistant 消息)内容帧处理:无当前块 → 按消息对象创建时间戳插入新块,
      // 有当前块 → 全量替换内容(帧是累计全文快照)。块 piTs 固定于创建时刻,通知按
      // 各自 ts 插到块之间,UI 顺序 = jsonl 落盘顺序(不依赖广播到达顺序)
      const handleBlocks = (blocks: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; content?: unknown; thinking?: string }>, frameTs: number) => {
        const rawEntries = piBlocksToEntries(blocks);
        if (rawEntries.length === 0) return;
        const hasText = rawEntries.some((e) => e.kind === "text");
        const hasThinking = rawEntries.some((e) => e.kind === "thinking");
        // 仅实际文本输出时结束「思考中」;thinking 流式帧保持「思考中」活跃——
        // 思考块还在增长说明 Mint 仍在思考,若信号曾被 tool 等路径 pop,这里恢复
        if (hasText) {
          useStatusStore.getState().popSignal(sidRef.current, "request");
        } else if (hasThinking && busyRef.current) {
          useStatusStore.getState().pushSignal(sidRef.current, "request", "正在思考...");
        }
        const entries = mergeConsecutiveText(rawEntries);
        if (latestAiIdRef.current) {
          useChatStore.getState().replaceAiEntriesById(sidRef.current, latestAiIdRef.current, entries);
        } else {
          latestAiIdRef.current = useChatStore.getState().insertUserMsgAt(sidRef.current, {
            role: "ai" as const, entries, timestamp: Date.now(), streaming: true,
            agentRole: event.agentRole, forwarded: event.forwarded, forwardedFrom: event.forwardedFrom,
          }, frameTs);
        }
        // 贴底跟随由 virtualizer anchorTo: "end" 原生处理(在底部时测量变化自动保持)
      };
      // Pi 新 assistant turn 开始 → 重置输出段块状态
      // (turn_start 不创建消息——磁盘上无空消息;首个内容帧才创建块)
      if (event.type === "turn_start") {
        // 回合开始 → 请求转「正在思考」(同 id 更新,不 pop——Mint 思考阶段状态栏保持显示,
        // 直到首个输出帧/工具调用才结束,否则「正在请求」一闪而过)
        useStatusStore.getState().pushSignal(sidRef.current, "request", "正在思考...");
        latestAiIdRef.current = 0;
        steeringRef.current = false;
      }
      // message_start = 新输出段消息(磁盘逐条 assistant)开始:下个内容帧创建新块;
      // 非流式消息(message_start 携带完整内容)直接渲染
      if (event.type === "message_start") {
        latestAiIdRef.current = 0;
        if (Array.isArray(event.blocks) && event.blocks.length > 0) {
          handleBlocks(event.blocks, event.timestamp ?? Date.now());
        }
      }
      // Pi SDK message_update/end:帧 = 当前输出段消息的累计全文快照(替换不拼接)。
      // 块 piTs = 消息对象创建时间戳 → 通知按 ts 插到块之间,UI 顺序 = jsonl 顺序
      if (event.type === "message" && Array.isArray(event.blocks)) {
        handleBlocks(event.blocks, event.timestamp ?? Date.now());
      }
      // tool progress — 状态栏工具信号;shell 计数由后台命令事件驱动(agent:shell-count),
      // 不再按工具事件累加(前台瞬时工具不计入 shell•N)
      if (event.type === "tool_progress" && event.toolName) {
        const label = displayToolLabel(event.toolName, event.toolArgs);
        // 开始执行工具 → 思考信号结束(否则 tool pop 后回退显示「正在思考」);
        // 按 toolCallId 区分信号——连续工具互不干扰(前一个 tool_done 不误 pop 后一个)
        useStatusStore.getState().popSignal(sidRef.current, "request");
        useStatusStore.getState().pushSignal(sidRef.current, `tool:${event.toolCallId ?? "?"}`, label);
      }
      // tool done — 工具执行结束,pop 自己的工具信号;
      // 回合仍在 → 恢复「正在思考」,消除工具执行完到下一步输出之间的状态栏空档
      if (event.type === "tool_done") {
        useStatusStore.getState().popSignal(sidRef.current, `tool:${event.toolCallId ?? "?"}`);
        if (busyRef.current) useStatusStore.getState().pushSignal(sidRef.current, "request", "正在思考...");
      }
      // tool_result — 工具执行结果(主进程 event-bridge 转发 toolResult 消息):
      // 按 toolCallId 追加 tool_result entry,渲染时关联到对应工具块显示结果
      if (event.type === "tool_result" && event.toolCallId) {
        const resultEntry = {
          kind: "tool_result" as const,
          toolUseId: event.toolCallId,
          name: event.toolName,
          content: event.content ?? "",          isError: event.isError ?? false,
          timestamp: event.timestamp ?? Date.now(),
          source: "chat" as const,
        };
        const msgs = useChatStore.getState().messagesBySession[sidRef.current] || [];
        const target = msgs.find((m) => m.id === latestAiIdRef.current);
        if (target && target.role === "ai") {
          // 幂等:同 toolUseId 已存在则替换(防重复到达导致重复追加)
          const existingIdx = target.entries.findIndex((e: { kind: string; toolUseId?: string }) => e.kind === "tool_result" && e.toolUseId === event.toolCallId);
          const merged = existingIdx >= 0
            ? target.entries.map((e: { kind: string; toolUseId?: string }, i: number) => i === existingIdx ? resultEntry : e)
            : [...target.entries, resultEntry];
          useChatStore.getState().replaceAiEntriesById(sidRef.current, target.id, merged);
        }
      }
      // compaction UI — compacting 事件 = 压缩进行中（显示"正在整理会话..."）
      if (event.type === "compacting") {
        useStatusStore.getState().setCompacting(sidRef.current, true);
      }
      // compacted = 压缩完成：清除 compacting（触发"会话已整理完毕"提示），
      // 并兜底清除 summarizing（防御轮转总结路径的残留）
      if (event.type === "compacted") {
        useStatusStore.getState().setCompacting(sidRef.current, false);
        useStatusStore.getState().setSummarizing(sidRef.current, false);
        // 压缩后 Pi 重发的帧是摘要内容 → 作为新输出段块处理
        latestAiIdRef.current = 0;
      }
      // 群聊回合结束 → 清 busy(群聊不广播 agent:exit,不能靠 onExit 清;
      // 若触发转发,下一 Agent 回合 turn_start 会重新 setBusy)
      if (event.type === "turn_end" && groupId) {
        latestAiIdRef.current = 0;
        busyRef.current = false; setBusy(false);
        useStatusStore.getState().popSignal(sidRef.current, "request");
        useStatusStore.getState().popSignalsByPrefix(sidRef.current, "tool:");
      }
      // error — 插播错误信号,8s 后自动消失(回退次新活跃信号)
      if (event.type === "error") {
        // 归一化上游错误(503/429/超时)为友好提示,状态栏不显示原始 JSON
        useStatusStore.getState().pushSignal(sidRef.current, "error", normalizeApiError(event.message) || "出错了", 8000);
      }
      // custom 系统消息(委派完成/后台 shell/流程指令)→ 独立即时显示:
      // triggerTurn: false 注入,立即落盘 + 立即事件(带 streaming 标记,
      // loadSession 时被磁盘版本替代,不重复)
      if (event.type === "custom_event" && event.text) {
        // 幂等:多 tab 的 ChatPanel 同时挂载都处理此事件——同一条通知
        // (同 Pi 落盘时间戳 + 同文本)只插入一次,防重复渲染
        const sysTs = event.timestamp ?? Date.now();
        const msgs = useChatStore.getState().messagesBySession[sidRef.current] || [];
        const dup = msgs.some((m) => m.customType === event.customType && m.text === event.text && m.sysTs === sysTs);
        if (!dup) {
          // 通知不开回合:仅当没有进行中的回合(无输出块)时恢复 idle——
          // 回合内到达的通知(用户消息触发的回合)保持 busy 不打断
          if (!latestAiIdRef.current) setBusy(false);
          // 按 Pi 落盘时间戳有序插入:通知插到其时间点之后的第一条消息前,
          // 与 jsonl 落盘顺序一致(广播到达顺序 ≠ 落盘顺序,不能 append)
          useChatStore.getState().insertUserMsgAt(sidRef.current, {
            role: "user" as const, text: event.text, timestamp: Date.now(), streaming: true,
            customType: event.customType, details: event.details, sysTs,
          }, sysTs);
        }
        // 贴底跟随由 virtualizer anchorTo: "end" 原生处理
      }
      // context usage update
      if (event.type === "context_usage") {
        useStatusStore.getState().setCtxPct(sidRef.current, event.percentage || 0);
      }
    });
    const unsubExit = window.electronAPI.agent.onExit(({ runId }: { runId: string }) => { if (!currentChatRef.current) return; if (runId !== currentChatRef.current) return; latestAiIdRef.current = 0; busyRef.current = false; setBusy(false); useStatusStore.getState().popSignal(sidRef.current, "request"); useStatusStore.getState().popSignalsByPrefix(sidRef.current, "tool:"); onActivity?.(); });
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
    // 兜底模型降级提示(需求 1):主模型不可用切换兜底时,状态栏 8s 提示
    const unsubFallback = window.electronAPI.agent.onFallbackUsed(() => {
      useStatusStore.getState().pushSignal(sidRef.current, "error", "⚠ 主模型不可用，已切换兜底模型", 8000);
    });
    // Context rotation events — filter by chatId
    const unsubCtxSum = window.electronAPI.agent.onContextSummarizing(({ chatId: ctxChatId, type }: { chatId: string; type?: string }) => {
      if (!currentChatRef.current) return;
      if (ctxChatId !== currentChatRef.current) return;
      if (type === "done") {
        // 轮转失败兜底：清除总结状态
        useStatusStore.getState().setSummarizing(sidRef.current, false);
        useStatusStore.getState().popSignal(sidRef.current, "summary");
        useStatusStore.getState().popSignal(sidRef.current, "compact");
        return;
      }
      useStatusStore.getState().pushSignal(sidRef.current, type === "compact" ? "compact" : "summary",
        type === "compact" ? "正在整理会话..." : "正在整理并开启新会话...");
      if (type === "compact") {
        useTabStore.getState().setSessionRunning(sidRef.current, true);
        useStatusStore.getState().setCompacting(sidRef.current, true);
      } else {
        useStatusStore.getState().setSummarizing(sidRef.current, true);
      }
    });
    const unsubCtxUsage = window.electronAPI.agent.onContextUsage(({ chatId: ctxChatId, percentage }) => {
      if (!currentChatRef.current) return;
      if (ctxChatId !== currentChatRef.current) return;
      const pct = Math.round(percentage);
      useStatusStore.getState().setCtxPct(sidRef.current, pct);
      if (sidRef.current) {
        window.electronAPI.sessionCache.write(sidRef.current, { contextUsage: pct }).catch(() => {});
      }
      // 主动压缩：使用率达到设置阈值（默认 65%）就提前 compact——
      // 等 Pi 自动压缩时已接近 100%，模型性能在 75% 后明显下降。
      const threshold = useSettingsStore.getState().contextThreshold || 75;
      const sid = sidRef.current;
      const st = useStatusStore.getState().bySession[sid];
      if (
        pct >= threshold &&
        !st?.compacting && !st?.summarizing &&
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
    return () => { unsub(); unsubExit(); unsubSid(); unsubFallback(); unsubCtxSum(); unsubCtxUsage(); if (sidRef.current) { useTabStore.getState().setSessionRunning(sidRef.current, false); if (!sidRef.current.startsWith("__new_")) { window.electronAPI.agent.scheduleIdleTimeout(sidRef.current, 10 * 60 * 1000); } } useStatusStore.getState().reset(sidRef.current); };
  }, [groupId]);

  // Summarizing timeout — 120s safety net
  useEffect(() => {
    if (!summarizing) return;
    const timer = setTimeout(() => {
      useStatusStore.getState().setSummarizing(sidRef.current, false);
      useStatusStore.getState().popSignal(sidRef.current, "summary");
      useStatusStore.getState().pushSignal(sidRef.current, "error", "摘要超时，将开新会话继续", 8000);
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
          setBusy(false);
          useStatusStore.getState().popSignal(sidRef.current, "request");
          useStatusStore.getState().popSignalsByPrefix(sidRef.current, "tool:");
        }
      } catch { /* 网络错误忽略 */ }
    }, 30_000);
    return () => clearInterval(interval);
  }, [busy, existingSid]);

  // 打开会话（0 → N 条）贴底：virtualizer.scrollToIndex 官方 API——
  // scrollState 在测量变化时持续校正对齐直到稳定(库原生处理估算→实测,正规手段)。
  // 流式跟随由 anchorTo: "end" 自动处理(在底部时内容增长保持贴底),不再手动贴底。
  // 依赖 scrollEl:首次渲染时 scrollEl 为 null,scrollToIndex 会 no-op(找不到滚动元素),
  // 等 attachScrollRef 绑定后(state 更新触发重渲染)再贴
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    if (messages.length > 0 && prevMsgCountRef.current === 0 && scrollEl) {
      // 打开会话:先滚到估算底,后续测量推进由上方 totalSize effect 自动贴底跟进
      // (每次 totalSize 变化都贴,测量多久都最终精确——不再等收敛/多点贴底)
      autoScrollRef.current = true;
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
      prevMsgCountRef.current = messages.length;
    }
    // scrollEl 未就绪时不更新 prevMsgCountRef——等就绪后 effect 重跑再贴底
  }, [messages, virtualizer, scrollEl]);

  // ── Session cache ────────────────────────────────
  useEffect(() => {
    if (!existingSid) return;
    window.electronAPI.sessionCache.read(existingSid).then((cache) => {
      if (cache) {
        if (cache.permissionMode) setPermissionMode(cache.permissionMode);
        if (cache.model) setChatModel(cache.model);
        if (cache.provider) setChatProvider(cache.provider);
        if (cache.contextUsage > 0) useStatusStore.getState().setCtxPct(sidRef.current, cache.contextUsage);
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
    // 新用户消息 → 重置输出段块状态(steer 插话不触发 turn_start 时兜底)
    latestAiIdRef.current = 0;
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

    busyRef.current = true; setBusy(true); useStatusStore.getState().pushSignal(sidRef.current, "request", "正在请求...");

    try {
      // 群聊发送:主进程 @提及路由到目标 Agent;事件按 groupId 过滤回显
      if (groupId) {
        await window.electronAPI.group.send(groupId, agentText);
        return;
      }
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
      const result = await window.electronAPI.agent.sendMessage(effectivePath, agentText, { sessionId: existingSid ?? null, permissionMode: permissionMode ?? "auto", isDesigner: isDesigner ?? tab?.isDesigner, images: images.length > 0 ? images : undefined, thinkingLevel: thinkingLevel ?? "medium", preferredProvider: chatProvider || undefined });
      setCurrentRunId(result.chatId); currentChatRef.current = result.chatId;
    } catch { busyRef.current = false; setBusy(false); currentChatRef.current = null; useStatusStore.getState().pushSignal(sidRef.current, "error", "发送失败，请检查网络后重试", 8000); }
  }, [busy, attaches, projectPath, permissionMode, thinkingLevel, chatProvider, groupId]);

  useEffect(() => { chatActions.register((t: string) => sendText(t)); return () => chatActions.unregister(); }, [sendText]);

  const hasMessages = messages.length > 0;

  // Tool-call driven UI actions — Mint calls show_* tools, frontend detects tool_use entries
  const lastToolUses = useMemo(() => {
    if (messages.length === 0) return [];
    const lastAi = messages.filter((m) => m.role === "ai" && m.entries).pop();
    if (!lastAi?.entries) return [];
    return lastAi.entries.filter((e) => e.kind === "tool_use");
  }, [messages]);
  // 工具广播直连:Mint 调 show_confirm_dev/show_new_project 时立即显示(不受 busy 影响);
  // 点击按钮消费后从消息中移除 show_* 条目,推断分支不再命中(打断/回合结束不会复活)。
  // 消息推断(lastToolUses)保留作历史恢复兜底。
  const [confirmDevFlag, setConfirmDevFlag] = useState(false);
  const [newProjectFlag, setNewProjectFlag] = useState(false);
  useEffect(() => {
    const off1 = window.electronAPI.agent.onConfirmDev(() => setConfirmDevFlag(true));
    const off2 = window.electronAPI.agent.onNewProject(() => setNewProjectFlag(true));
    return () => { off1(); off2(); };
  }, []);
  // 点击消费:清 flag + 从最后一条 AI 消息移除 show_* 工具条目(防止推断复活)
  const consumeShowTools = () => {
    const store = useChatStore.getState();
    const msgs = store.messagesBySession[sidRef.current] || [];
    const lastAi = msgs.filter((m) => m.role === "ai" && m.entries).pop();
    if (lastAi && lastAi.id != null) {
      const kept = (lastAi.entries as Array<{ kind?: string; name?: string }>).filter(
        (e) => !(e.kind === "tool_use" && e.name?.startsWith("show_")),
      );
      store.replaceAiEntriesById(sidRef.current, lastAi.id as number, kept);
    }
  };
  const showConfirmDev = confirmDevFlag || (!busy && lastToolUses.some((e) => (e as { name?: string }).name === "show_confirm_dev"));
  const showNewProjectBtn = onNewProject && (newProjectFlag || (!busy && lastToolUses.some((e) => (e as { name?: string }).name === "show_new_project")));

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
          <div className="msg-bubble-user rounded-[10px] rounded-br-[4px] px-[14px] py-1.5 leading-[1.55] overflow-hidden min-w-0 [overflow-wrap:anywhere]">
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
      <div
        ref={attachScrollRef}
        onScroll={handleScroll}
        onWheel={handleUserInput}
        onTouchStart={handleUserInput}
        onTouchMove={handleUserInput}
        onMouseDown={handleUserInput}
        className="chat-messages flex-1 overflow-y-auto overflow-x-hidden pb-2"
        style={{ fontSize: "var(--chat-bubble-size)" }}
      >
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
                    {/* 委派进度卡片：固定附着在触发消息气泡下方(左对齐气泡)；
                        triggerMsgId 缺失(委派由 Mint 主动发起,消息未落盘时捕获不到)时
                        挂在最后一条 AI 消息下兜底 */}
                    {(delegation && delegation.triggerMsgId === msg.id) ||
                      (delegation && !delegation.triggerMsgId && vi.index === messages.length - 1 && msg.role === "ai") ? (
                      <div className="flex gap-4 items-start" style={{ padding: "0 var(--s8)" }}>
                        <div style={{ width: 34, flexShrink: 0 }} />
                        <DelegationProgress delegation={delegation} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {showNewProjectBtn && (
              <div className="flex justify-center pb-3">
                <button
                  onClick={() => { setNewProjectFlag(false); consumeShowTools(); onNewProject?.(); }}
                  className="px-6 py-2.5 rounded-xl bg-accent text-text-inverse text-sm font-medium hover:bg-accent-hover transition-colors shadow-sm"
                >
                  新建项目
                </button>
              </div>
            )}
            {showConfirmDev && (
              <div className="flex justify-center pb-3">
                <button
                  onClick={() => { setConfirmDevFlag(false); consumeShowTools(); sendText(CONFIRM_DEVELOPMENT_PROMPT); }}
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

      {/* 状态栏:独立于输入区,渲染在输入容器上方 */}
      <StatusBar sessionId={sidRef.current} />
      <PermissionPrompt />

      {/* Attach preview — above thinking when busy */}
      {busy && attaches.length > 0 && (
        <div className="px-4 py-2 bg-surface-alt/30 border-t border-border/50 shrink-0"><AttachPreview /></div>
      )}

      {/* 气泡锚点容器:仅用于气泡悬浮定位(独立于输入卡片 DOM,悬浮在卡片上方) */}
      <div className="relative shrink-0">
        <ChatInput
          busy={busy}
          attaches={attaches}
          setAttaches={setAttaches}
          onSend={sendText}
          onStop={() => { stoppedRef.current = true; busyRef.current = false; const rid = currentChatRef.current; if (rid) window.electronAPI.agent.abort(rid); setBusy(false); /* 仅停当前回合残留帧;打断通知/总结回合在 onStream 中按 turn_start 恢复渲染 */ }}
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
        {/* 回底/新消息气泡:悬浮在输入卡片上方居中,不属于卡片 DOM。
            只要滚离底部就常驻显示(正常浏览历史也显示)——圆圈箭头=回底部;
            输出结束且有新内容时=「新消息」胶囊带箭头 */}
        {awayFromBottom && (
          <button
            className={`new-msg-bubble${showNewMsg ? "" : " new-msg-bubble--icon"}`}
            onClick={() => {
              autoScrollRef.current = true;
              setShowNewMsg(false);
              showNewMsgRef.current = false;
              scrollToBottom();
            }}
            title={showNewMsg ? "查看最新消息" : "回到底部"}
          >
            {showNewMsg && <span>新消息</span>}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v9M4.5 8.5L8 12l3.5-3.5"/></svg>
          </button>
        )}
      </div>
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
      // 工具结果(edit diff 等)始终显示——即使隐藏工具调用,结果仍可见
      if (e.kind === "tool_result") return true;
      return showToolUse;
    });
  }, [msg.entries, showThinking, showToolUse]);

  // 工具 input 查找表(toolUseId → input):隐藏工具调用时,tool-result-only 块仍能取 file_path 做语言高亮
  const toolInputs = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const e of msg.entries ?? []) {
      if (e.kind === "tool_use" && e.id) {
        const input = typeof e.input === "object" && e.input !== null ? e.input as Record<string, unknown> : undefined;
        if (input) m.set(e.id, input);
      }
    }
    return m;
  }, [msg.entries]);

  const blocks = useMemo(() =>
    visible.length > 0 ? buildBlocks(visible, String(msg.id), toolInputs) : [],
    [visible, msg.id, toolInputs],
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
    // 系统消息:统一左侧系统卡片(系统图标 + kind 标签 + 内容),
    // 区别于 assistant(Mint 头像气泡)与 user(右侧气泡)
    const text = typeof msg.text === "string" ? msg.text : "";
    const kind = msg.customType === "system_message" ? (msg.details as { kind?: string } | undefined)?.kind : undefined;
    if (kind) {
      const body = text
        .replace(/^\[系统消息\]-\[Agent执行结果\]\s*/, "")
        .replace(/^\[系统消息\]\s*/, "");
      // 委派/后台 shell 结果:解析 ⏺ 摘要行(红绿灯三色);其他 kind:纯文本
      const isResult = kind === "delegation" || kind === "shell";
      const rows = isResult ? body.split("\n").filter((l) => l.startsWith("⏺ ")) : [];
      return (
        <div
          className="flex gap-4 items-start"
          style={{ padding: "0 var(--s8)" }}
          onContextMenu={(e) => onContextMenu(msg, e)}
        >
          <div style={{ width: 34, flexShrink: 0 }} />
          <div className="relative w-fit max-w-[75%] min-w-0 my-1" onMouseEnter={showActions} onMouseLeave={scheduleHideActions}>
            <div className="rounded-[10px] rounded-bl-[4px] border border-border bg-surface-elevated overflow-hidden">
              {/* 头部:系统图标 + kind 标签(区别于 assistant 的 Mint 头像气泡) */}
              <div className="flex items-center gap-1.5 px-[14px] pt-1.5 text-[11px] text-text-secondary">
                <svg className="shrink-0 text-info" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M8 7.5V11" />
                  <path d="M8 5h.01" />
                </svg>
                <span>{SYSTEM_KIND_LABELS[kind] ?? "系统消息"}</span>
              </div>
              {/* 内容区 */}
              <div className="px-[14px] pb-1.5 leading-[1.55]">
                {isResult ? (
                  rows.map((row, i) => {
                    const m = row.match(/^⏺ (.+?) — (完成|失败|中止)(?: · (\d+)s)?$/);
                    // 中止=人为打断(黄),失败=意外中断(红),完成=绿——原生 ⏺ 字符
                    const status = m?.[2];
                    const dotColor = status === "中止" ? "text-interrupt" : status === "失败" ? "text-fail" : "text-done";
                    return (
                      <div key={i} className="flex items-center gap-2 py-0.5">
                        <span className={`${dotColor} shrink-0 text-[10px] leading-none`}>⏺</span>
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
                  })
                ) : (
                  <div className="whitespace-pre-wrap [overflow-wrap:anywhere] text-text-primary">{body}</div>
                )}
              </div>
            </div>
            {/* 与其他气泡一致:复制完整文本 + 钉住(悬停显示) */}
            <BubbleActions text={body} onPin={onPin} sid={sid} visible={actionsVisible} />
          </div>
        </div>
      );
    }
    return (
      <div className="msg-in" onContextMenu={(e) => onContextMenu(msg, e)}>
        <div className="flex justify-end">
          {/* shrink-0：flex 子项不被压缩（中文 min-content 是单字，压缩会逐字换行）；
             max-w-[75%]：超长文本钳制宽度后由内部 overflow-wrap 换行 */}
          <div className="relative shrink-0 max-w-[75%] min-w-0" onMouseEnter={showActions} onMouseLeave={scheduleHideActions}>
            {userBubble(msg)}
            <BubbleActions text={copyText} onPin={onPin} sid={sid} visible={actionsVisible} />
          </div>
        </div>
      </div>
    );
  }

  if (visible.length === 0) return null;

  // 群聊消息:按 agentRole 标注角色(头像首字符 + 角色名 + 转发来源标记)
  const role = msg.agentRole;
  const avatarChar = role ? role.charAt(0).toUpperCase() : "M";
  const displayName = role ?? "Mint";

  return (
    <div className="msg-in" onContextMenu={(e) => onContextMenu(msg, e)}>
      <div className="flex gap-4 items-start max-w-[75%]">
        <div className="msg-avatar agent" style={role ? { backgroundColor: roleColor(role), color: "#fff" } : undefined}>{avatarChar}</div>
        <div className="min-w-0 relative" onMouseEnter={showActions} onMouseLeave={scheduleHideActions}>
          <div className="msg-from">
            {displayName}
            {role && msg.forwarded && (
              <span className="text-text-secondary/60 ml-1.5 text-[10px] font-normal">· {msg.forwardedFrom ? `来自 ${msg.forwardedFrom}` : "来自转发"}</span>
            )}
          </div>
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
