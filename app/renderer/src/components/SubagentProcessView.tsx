import { uiText, useUiLocale } from "../lib/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage, mapSessionMessages, followDecision, USER_INPUT_WINDOW_MS } from "./chat-utils";
import { useDelegationStore } from "../stores/delegation-store";
import { Modal } from "./ui/Modal";
import { SubagentTranscript } from "./SubagentTranscript";
import { applySubagentEvent, mergeSubagentHistory, updateSubagentActivity, type SubagentActivity } from "./subagent-transcript";

/**
 * 子 Agent 过程查看弹层 — 精简只读聊天视图。
 * 数据三层(对齐规划):
 *  1. 打开时加载已落盘 jsonl 历史(mapSessionMessages)
 *  2. 运行中订阅 agent:subagent-stream 实时追加(executor 转发子会话事件)
 *  3. 每 3s 重载磁盘兜底(防流丢帧),终态停止
 */
export function SubagentProcessView({
  delegationId,
  index,
  title,
  running,
  onClose,
}: {
  delegationId: string;
  index: number;
  title: string;
  running: boolean;
  onClose: () => void;
}): JSX.Element {
  useUiLocale();
  const sessionFile = useDelegationStore((s) => s.sessionFiles[`${delegationId}:${index}`]);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [activity, setActivity] = useState<SubagentActivity>({ tools: [] });
  const nextIdRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true); // 流式输出是否自动贴底(用户滚动时停止)
  const lastUserInputRef = useRef(0); // 最近一次用户输入时间(滚动意图判定窗口)
  /** 内容高度观察器（实例复用；观察目标每帧重挂，见下方贴底 effect） */
  const roRef = useRef<ResizeObserver | null>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false); // 回底按钮显示开关

  const pinToBottom = (): void => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // 用户输入(wheel/touch/mousedown)标记——500ms 内的 scroll 变化视为用户滚动意图
  const handleUserInput = (): void => { lastUserInputRef.current = Date.now(); };
  const handleScroll = (): void => {
    const el = scrollRef.current; if (!el) return;
    // 判定与聊天页 ChatPanel 完全一致：只看「用户输入后 500ms 内的变化」
    // （详见 chat-utils 的 followDecision 注释——别再加"自己贴底"的保护窗口，那会吞掉用户滚动）
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const decision = followDecision({
      distFromBottom,
      msSinceUserInput: Date.now() - lastUserInputRef.current,
    });
    if (decision === undefined) return;
    autoScrollRef.current = decision; // 滚回底部恢复跟随,滚离底部停止
    setAwayFromBottom(!decision);
  };
  const scrollToBottom = (): void => {
    pinToBottom();
    autoScrollRef.current = true;
    setAwayFromBottom(false);
  };

  const displayMessages = useMemo(() => running ? msgs : msgs.map(message => ({ ...message, streaming: false })), [msgs, running]);
  const childId = `subagent:${delegationId}:${index}`;

  useEffect(() => {
    setMsgs([]); setLoaded(false); setLoadError(undefined); setActivity({ tools: [] });
    nextIdRef.current = 1;
    autoScrollRef.current = true;
    setAwayFromBottom(false);
  }, [delegationId, index]);

  // Subscribe before the asynchronous disk read settles; reconcile by SDK timestamp instead of replacing live output.
  useEffect(() => window.electronAPI.agent.onSubagentStream(data => {
    if (data.delegationId !== delegationId || data.index !== index) return;
    setActivity(previous => updateSubagentActivity(previous, data.ev));
    setMsgs(previous => applySubagentEvent(previous, data.ev, () => -nextIdRef.current++));
    if (data.ev.blocks?.length || data.ev.type === "custom_event" || data.ev.type === "error") setLoaded(true);
  }), [delegationId, index]);

  // Reads are serialized and cancelled on identity/terminal changes. A terminal reload captures the final SDK record.
  useEffect(() => {
    let cancelled = false, pending = false;
    const load = async () => {
      if (!sessionFile || pending) return;
      pending = true;
      try {
        const raw = await window.electronAPI.task.getSubagentMessages(sessionFile);
        if (cancelled) return;
        const disk = mapSessionMessages(raw as Array<{ type: string; message: unknown }>);
        setMsgs(previous => mergeSubagentHistory(disk, previous));
        setLoaded(true); setLoadError(undefined);
      } catch (error) {
        if (!cancelled) { setLoadError(error instanceof Error ? error.message : String(error)); setLoaded(true); }
      } finally { pending = false; }
    };
    void load();
    const timer = running ? setInterval(() => { void load(); }, 3000) : undefined;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [sessionFile, delegationId, index, running]);

  // 滚动贴底(仅用户没滚离底部时跟随——流式输出时用户可自由滚动查看历史)。
  // 除内容变更外还挂 ResizeObserver 观察各消息行：思考块/文本块的展开过渡(200ms)、
  // Markdown 重排、图片解码都会在本次 commit **之后**继续长高——只按 msgs 贴底会越跟越远。
  // 观察器实例只建一次（回调读的都是 ref，不随渲染变化），每帧只重挂观察目标。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!roRef.current) {
      roRef.current = new ResizeObserver(() => {
        if (!autoScrollRef.current) return;
        // 用户正在操作（500ms 内有输入）时不抢滚动位置——比聊天页多这一道：
        // 这是只读查看器，内容长高的补贴晚一帧没有代价，被用户滚动拖回来才是问题
        if (Date.now() - lastUserInputRef.current <= USER_INPUT_WINDOW_MS) return;
        pinToBottom();
      });
    }
    const ro = roRef.current;
    ro.disconnect();
    for (const child of Array.from(el.children)) ro.observe(child);
  }, [msgs, running]);
  useEffect(() => () => { roRef.current?.disconnect(); }, []);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    pinToBottom();
  }, [msgs, running]);

  // Modal 经 createPortal 挂 body:弹窗渲染在输入卡片内,空态时气泡锚点容器有 transform
  // (translateY(-200px)) 会劫持 fixed 定位——弹窗被推到窗口底部被遮挡(对齐 LogOverlay 的处理)
  return (
    <Modal overlayClassName="bg-black/40" onClose={onClose}>
      <div
        className="relative flex flex-col w-[80vw] h-[80vh] rounded-[var(--radius-lg)] bg-[var(--modal-fill)] shadow-2xl overflow-hidden"
      >
        {/* 头部:spinner + 标题 + 状态 + 关闭（与内容/底部同为面板面，不设色块分区——对齐输出窗口与其他弹窗） */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-surface-alt)]">
          <svg className={`${running ? "animate-spin " : ""}text-text-muted shrink-0`} width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="text-sm font-medium text-text-primary truncate flex-1">{title || uiText("ui.SubagentProcessView.aiAssistant")}</span>
          <span className={`text-[length:var(--text-11)] shrink-0 flex items-center gap-1 text-text-muted`}>
            {running && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
            {running ? uiText("ui.OutputWindow.running") : uiText("ui.OutputWindow.finished")}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-6 h-6 rounded-[var(--radius-lg)] flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* 消息区：复用主会话的分段、实时状态与完成折叠 */}
        {/* 阅读型内容区:字号随「阅读字体」缩放(与聊天区 .chat-messages 同思路) */}
        <div ref={scrollRef} onScroll={handleScroll} onWheel={handleUserInput} onTouchStart={handleUserInput} onMouseDown={handleUserInput} className="subagent-output flex-1 overflow-y-auto px-4 py-3" style={{ fontSize: "var(--text-body)" }}>
          {!loaded && !sessionFile && (
            <div className="text-center text-text-secondary py-8">{uiText("ui.SubagentProcessView.preparingTask")}</div>
          )}
          {!loaded && sessionFile && (
            <div className="text-center text-text-secondary py-8">{uiText("ui.EditorPanel.loading")}</div>
          )}
          {loaded && msgs.length === 0 && (
            <div className="text-center text-text-secondary py-8">{uiText("ui.SubagentProcessView.noMessages")}</div>
          )}
          {loadError && <div role="alert" className="text-danger">{loadError}</div>}
          <SubagentTranscript messages={displayMessages} running={running} sessionId={childId} title={title || uiText("ui.SubagentProcessView.aiAssistant")} activity={activity} />
        </div>

        {/* 回底按钮:滚离底部时显示,点击贴底并恢复自动跟随 */}
        {awayFromBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute right-4 bottom-4 w-8 h-8 rounded-full bg-accent text-text-inverse shadow-lg flex items-center justify-center hover:bg-accent-hover transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v9M4.5 8.5L8 12l3.5-3.5"/></svg>
          </button>
        )}
      </div>
    </Modal>
  );
}
