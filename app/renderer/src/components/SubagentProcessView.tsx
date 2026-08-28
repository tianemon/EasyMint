import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChatMessage, mapSessionMessages, piBlocksToEntries, mergeConsecutiveText, displayToolLabel } from "./chat-utils";
import type { StreamEntry } from "./StreamPanel";
import { useDelegationStore } from "../stores/delegation-store";
import { DiffView } from "./ChatBlocks";
import { registerOverlay } from "../lib/overlay-stack";

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
  const sessionFile = useDelegationStore((s) => s.sessionFiles[`${delegationId}:${index}`]);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const nextIdRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true); // 流式输出是否自动贴底(用户滚动时停止)
  const lastUserInputRef = useRef(0); // 最近一次用户输入时间(滚动意图判定窗口)
  const [awayFromBottom, setAwayFromBottom] = useState(false); // 回底按钮显示开关
  // 注册到全局弹窗栈:点击本窗口不关闭下层(如侧边栏抽屉)
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => registerOverlay(overlayRef.current), []);

  // 用户输入(wheel/touch/mousedown)标记——500ms 内的 scroll 变化视为用户滚动意图
  const markUserInput = (): void => { lastUserInputRef.current = Date.now(); };
  const handleUserInput = (): void => markUserInput();
  const handleScroll = (): void => {
    // 程序性贴底(无用户输入)不参与判定
    if (Date.now() - lastUserInputRef.current > 500) return;
    const el = scrollRef.current; if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom < 8;
    autoScrollRef.current = atBottom; // 滚回底部恢复跟随,滚离底部停止
    setAwayFromBottom(!atBottom);
  };
  const scrollToBottom = (): void => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    autoScrollRef.current = true;
    setAwayFromBottom(false);
  };
  // 显示开关:默认都隐藏(只看文本);思考过程/工具调用点击展开
  const [showThinking, setShowThinking] = useState(false);
  const [showToolUse, setShowToolUse] = useState(false);

  /** 消息纯文本(重载合并判断用) */
  const textOf = (m: ChatMessage): string =>
    (m.entries ?? []).filter((e) => e.kind === "text").map((e) => e.text).join("");

  // 打开/切换任务:加载历史 + 定稿 streaming 标记
  useEffect(() => {
    let cancelled = false;
    setMsgs([]);
    setLoaded(false);
    nextIdRef.current = 1;
    (async () => {
      if (!sessionFile) return;
      const raw = await window.electronAPI.task.getSubagentMessages(sessionFile);
      if (cancelled) return;
      setMsgs(mapSessionMessages(raw as Array<{ type: string; message: unknown }>));
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [sessionFile, delegationId, index]);

  // 实时流订阅(按 delegationId+index 过滤;消息帧为累计快照 → 替换末尾 streaming 块)
  useEffect(() => {
    const unsub = window.electronAPI.agent.onSubagentStream((data) => {
      if (data.delegationId !== delegationId || data.index !== index) return;
      const ev = data.ev;
      // message_start = 新输出段消息(磁盘逐条 assistant)开始:终态化当前 streaming 块,
      // 下个内容帧创建新气泡——与主聊天 ChatPanel 一致(每条 assistant 消息独立气泡)
      if (ev.type === "message_start") {
        if (Array.isArray(ev.blocks) && ev.blocks.length > 0) {
          // 非流式消息(message_start 携带完整内容)直接渲染为新气泡
          const entries = mergeConsecutiveText(piBlocksToEntries(ev.blocks));
          if (entries.length > 0) {
            setMsgs((prev) => [
              ...prev.map((m) => (m.role === "ai" && m.streaming ? { ...m, streaming: false } : m)),
              { id: -nextIdRef.current++, role: "ai", entries, timestamp: Date.now(), streaming: true },
            ]);
          }
        } else {
          // 流式消息开始:仅终态化当前块(内容帧随后到达)
          setMsgs((prev) => prev.map((m) => (m.role === "ai" && m.streaming ? { ...m, streaming: false } : m)));
        }
        return;
      }
      if (ev.type !== "message" || !Array.isArray(ev.blocks) || ev.blocks.length === 0) return;
      const entries = mergeConsecutiveText(piBlocksToEntries(ev.blocks));
      if (entries.length === 0) return;
      setMsgs((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "ai" && last.streaming) {
          return [...prev.slice(0, -1), { ...last, entries }];
        }
        // 实时流块用负数 id(mapSessionMessages 历史消息为正数 id,负数命名空间永不相交)
        return [...prev, { id: -nextIdRef.current++, role: "ai", entries, timestamp: Date.now(), streaming: true }];
      });
    });
    return unsub;
  }, [delegationId, index]);

  // 3s 定时重载兜底(有 streaming 块时合并保留;终态停止)
  useEffect(() => {
    if (!running || !sessionFile) return;
    const timer = setInterval(async () => {
      const raw = await window.electronAPI.task.getSubagentMessages(sessionFile);
      const mapped = mapSessionMessages(raw as Array<{ type: string; message: unknown }>);
      setMsgs((prev) => {
        // 只认实时产生的流式块(keyId undefined=负数 id 命名空间)——磁盘消息即使带
        // streaming 标记也不作为流式块保留,否则新旧两批次磁盘消息共存导致 React key 冲突
        const streamBlock = prev.find((m) => m.streaming && m.keyId === undefined);
        if (!streamBlock) return mapped;
        const lastDiskAi = [...mapped].reverse().find((m) => m.role === "ai");
        if (!lastDiskAi) return [...mapped, streamBlock];
        const d = textOf(lastDiskAi);
        const s = textOf(streamBlock);
        if (s && d.startsWith(s)) return mapped; // 磁盘已含流式内容(更全)→ 磁盘为准,流式块弃用(该段已落盘,无后续帧)
        if (s && s.startsWith(d)) return [...mapped.slice(0, -1), streamBlock]; // 流式比磁盘新 → 替换磁盘最后
        return [...mapped, streamBlock];
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [running, sessionFile]);

  // 滚动贴底(仅用户没滚离底部时跟随——流式输出时用户可自由滚动查看历史)
  useEffect(() => {
    if (!autoScrollRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  // createPortal 挂 body:弹窗渲染在输入卡片内,空态时气泡锚点容器有 transform
  // (translateY(-200px)) 会劫持 fixed 定位——弹窗被推到窗口底部被遮挡(对齐 LogOverlay 的处理)
  return createPortal(
    <div ref={overlayRef} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="relative flex flex-col w-[80vw] h-[80vh] rounded-[12px] border border-border bg-surface-elevated shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部:第一行 = spinner + 标题 + 状态 + 关闭;第二行 = 显示开关 */}
        <div className="border-b border-border bg-accent-bg">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <svg className="animate-spin text-accent shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-medium text-text-primary truncate flex-1">{title || "AI 助手"}</span>
            <span className={`text-[length:var(--text-11)] shrink-0 flex items-center gap-1 ${running ? "text-success" : "text-text-muted"}`}>
              {running && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />}
              {running ? "运行中" : "已结束"}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 w-6 h-6 rounded-[6px] flex items-center justify-center text-text-secondary hover:bg-accent-bg hover:text-text-primary transition-colors"
              title="关闭"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          {/* 显示开关行:多选框样式(纯 div 实现,无原生 input 闪烁),默认都隐藏 */}
          <div className="flex items-center gap-4 px-4 pb-2.5">
            <button
              type="button"
              onClick={() => setShowThinking((o) => !o)}
              className="flex items-center gap-1.5 cursor-pointer select-none text-[length:var(--text-11)] text-text-secondary hover:text-text-primary transition-colors bg-transparent border-none p-0"
            >
              <span
                className={`w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center transition-colors ${showThinking ? "bg-accent border-accent" : "border-border bg-surface"}`}
              >
                {showThinking && (
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                )}
              </span>
              思考过程
            </button>
            <button
              type="button"
              onClick={() => setShowToolUse((o) => !o)}
              className="flex items-center gap-1.5 cursor-pointer select-none text-[length:var(--text-11)] text-text-secondary hover:text-text-primary transition-colors bg-transparent border-none p-0"
            >
              <span
                className={`w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center transition-colors ${showToolUse ? "bg-accent border-accent" : "border-border bg-surface"}`}
              >
                {showToolUse && (
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                )}
              </span>
              工具调用
            </button>
          </div>
        </div>

        {/* 消息区(思考/工具调用按开关显示,默认只显示文本;可选中复制) */}
        <div ref={scrollRef} onScroll={handleScroll} onWheel={handleUserInput} onTouchStart={handleUserInput} onMouseDown={handleUserInput} className="subagent-output flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-[var(--color-sidebar)]/40">
          {!loaded && !sessionFile && (
            <div className="text-center text-xs text-text-secondary py-8">正在准备任务…</div>
          )}
          {!loaded && sessionFile && (
            <div className="text-center text-xs text-text-secondary py-8">加载中…</div>
          )}
          {loaded && msgs.length === 0 && (
            <div className="text-center text-xs text-text-secondary py-8">暂无消息</div>
          )}
          {msgs.map((m) => <SubagentMessage key={m.keyId ?? m.id} msg={m} showThinking={showThinking} showToolUse={showToolUse} />)}
          {running && <div className="flex justify-center"><span className="text-[length:var(--text-11)] text-text-secondary animate-pulse">● 运行中</span></div>}
        </div>

        {/* 回底按钮:滚离底部时显示,点击贴底并恢复自动跟随 */}
        {awayFromBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute right-4 bottom-4 w-8 h-8 rounded-full bg-accent text-text-inverse shadow-lg flex items-center justify-center hover:bg-accent-hover transition-colors"
            title="回到底部"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v9M4.5 8.5L8 12l3.5-3.5"/></svg>
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** 精简只读消息气泡(user 右 / ai 左,Mint 气泡复用主聊天样式;思考/工具按开关显示) */
function SubagentMessage({ msg, showThinking, showToolUse }: { msg: ChatMessage; showThinking: boolean; showToolUse: boolean }): JSX.Element {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="msg-bubble-user rounded-[10px] rounded-tr-[4px] px-3 py-1.5 text-sm whitespace-pre-wrap break-words max-w-[80%]">{msg.text}</div>
      </div>
    );
  }
  const entries = msg.entries ?? [];
  // 按显示开关过滤可见条目——纯思考/纯工具消息在开关关闭时无可视内容,
  // 不渲染气泡容器(否则隐藏内容后留下空白气泡)
  const visible = entries.filter((e) =>
    e.kind === "text" ||
    (e.kind === "thinking" && showThinking) ||
    ((e.kind === "tool_use" || e.kind === "tool_result") && showToolUse)
  );
  if (visible.length === 0) return <></>;
  return (
    <div className="flex gap-3 items-start">
      <div className="msg-avatar agent shrink-0">M</div>
      <div className="min-w-0 flex-1">
        <div className="msg-bubble-agent rounded-[10px] rounded-bl-[4px] px-3 py-1.5 text-sm overflow-hidden">
          {visible.map((e, i) => <SubagentEntry key={i} entry={e} showThinking={showThinking} showToolUse={showToolUse} />)}
        </div>
      </div>
    </div>
  );
}

/** 单条流式条目(文本常显;思考/工具调用按开关显示) */
function SubagentEntry({ entry, showThinking, showToolUse }: { entry: StreamEntry; showThinking: boolean; showToolUse: boolean }): JSX.Element {
  if (entry.kind === "text") {
    return <div className="whitespace-pre-wrap break-words text-text-primary">{entry.text}</div>;
  }
  if (entry.kind === "thinking") {
    if (!showThinking) return <></>;
    return (
      <div className="mb-1.5 flex gap-2 items-start">
        <span className="shrink-0 text-[length:var(--text-3xs)] px-1 py-0.5 rounded bg-[var(--color-sidebar-hover)] text-text-muted mt-0.5">思考</span>
        <div className="text-xs text-[var(--color-text-secondary)] italic whitespace-pre-wrap break-words opacity-90">{entry.text}</div>
      </div>
    );
  }
  if (entry.kind === "tool_use") {
    if (!showToolUse) return <></>;
    const input = (entry as unknown as { input?: unknown }).input;
    const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    return (
      <div className="mb-1.5 flex gap-2 items-center">
        <span className="shrink-0 text-[length:var(--text-3xs)] px-1 py-0.5 rounded bg-[var(--color-sidebar-hover)] text-text-muted">工具</span>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2" strokeLinecap="round" className="shrink-0"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>
        <span className="text-[var(--color-accent)]">{displayToolLabel((entry as unknown as { name: string }).name, args)}</span>
      </div>
    );
  }
  if (entry.kind === "tool_result") {
    if (!showToolUse) return <></>;
    const content = String((entry as unknown as { content: string }).content ?? "").trim();
    // edit 结果含 "变更内容:" diff → 复用主聊天的 DiffView 红绿渲染
    if (content.includes("变更内容:")) {
      return (
        <div className="mb-1.5 ml-6 rounded bg-[var(--color-sidebar-hover)]/50 px-2 py-1 overflow-x-auto">
          <DiffView text={content} />
        </div>
      );
    }
    const short = content.length > 160 ? `${content.slice(0, 160)}…` : content;
    return (
      <div className="mb-1.5 ml-6 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap break-words font-mono bg-[var(--color-sidebar-hover)]/50 rounded px-2 py-1">
        {short}
      </div>
    );
  }
  return <></>;
}
