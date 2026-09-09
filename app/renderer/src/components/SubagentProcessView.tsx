import { useEffect, useMemo, useRef, useState } from "react";
import { buildBlocks, ChatBlockView } from "./ChatBlocks";
import { ChatMessage, mapSessionMessages, piBlocksToEntries, mergeConsecutiveText } from "./chat-utils";
import { useDelegationStore } from "../stores/delegation-store";
import { Modal } from "./ui/Modal";

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

  // 用户输入(wheel/touch/mousedown)标记——500ms 内的 scroll 变化视为用户滚动意图
  const handleUserInput = (): void => { lastUserInputRef.current = Date.now(); };
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

  /** 消息全部内容(重载合并判断用)——不能只取 text:流式块可能只有思考/工具,
   *  此时文本比对为空会误判为「磁盘没有」而重复追加同一条消息 */
  const textOf = (m: ChatMessage): string =>
    (m.entries ?? []).map((e) => {
      if (e.kind === "text" || e.kind === "thinking") return e.text;
      if (e.kind === "tool_use") return e.name;
      if (e.kind === "tool_result") return e.content;
      return "";
    }).join("\n");

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

  // Modal 经 createPortal 挂 body:弹窗渲染在输入卡片内,空态时气泡锚点容器有 transform
  // (translateY(-200px)) 会劫持 fixed 定位——弹窗被推到窗口底部被遮挡(对齐 LogOverlay 的处理)
  return (
    <Modal overlayClassName="bg-black/40" onClose={onClose}>
      <div
        className="relative flex flex-col w-[80vw] h-[80vh] rounded-[var(--radius-lg)] border border-border bg-surface-alt shadow-2xl overflow-hidden"
      >
        {/* 头部:spinner + 标题 + 状态 + 关闭(思考/工具与主聊天一致常显,无显示开关) */}
        <div className="bg-accent-bg">
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
              className="shrink-0 w-6 h-6 rounded-[var(--radius-lg)] flex items-center justify-center text-text-secondary hover:bg-accent-bg hover:text-text-primary transition-colors"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {/* 消息区(思考/工具与主聊天一致常显;可选中复制) */}
        {/* 阅读型内容区:字号随「阅读字体」缩放(与聊天区 .chat-messages 同思路) */}
        <div ref={scrollRef} onScroll={handleScroll} onWheel={handleUserInput} onTouchStart={handleUserInput} onMouseDown={handleUserInput} className="subagent-output flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ fontSize: "var(--text-body)" }}>
          {!loaded && !sessionFile && (
            <div className="text-center text-text-secondary py-8">正在准备任务…</div>
          )}
          {!loaded && sessionFile && (
            <div className="text-center text-text-secondary py-8">加载中…</div>
          )}
          {loaded && msgs.length === 0 && (
            <div className="text-center text-text-secondary py-8">暂无消息</div>
          )}
          {msgs.map((m) => {
            // 流式尾消息 = 运行中最后一条带 streaming 标记的 AI 消息(实时增长的那条,
            // 磁盘重载合并也把它追加在末尾)。ChatBlockView 的思考自动展开/收起由
            // isStreamingTail 驱动——仅尾消息为 true:思考增长中展开,结束(不再是尾块)自动收起
            const streamTail = running && m.role === "ai" && !!m.streaming && m === msgs[msgs.length - 1];
            return <SubagentMessage key={m.keyId ?? m.id} msg={m} running={running} streamTail={streamTail} />;
          })}
          {running && <div className="flex justify-center"><span className="text-[length:var(--text-11)] text-text-secondary animate-pulse">● 运行中</span></div>}
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

/** 只读消息气泡(user 右 / ai 左,Mint 气泡复用主聊天外观)。
 *  ai 内容走与 ChatPanel 相同的块渲染:buildBlocks 分组 → ChatBlockView,
 *  思考「流式中展开、完成后自动折叠」、工具卡折叠/展开、文本 Markdown、diff DiffView 全部一致。
 *  streamTail = 运行中正在增长的尾消息——ChatBlockView 的 isStreamingTail 仅对它的末块为 true:
 *  思考增长中展开,结束(末块变为文本/工具、或回合结束 running 转 false)自动收起。
 *  streaming 传 running(回合级,对齐 ChatPanel 的 busy):工具执行中转圈/✓/✗ 由它驱动 */
function SubagentMessage({ msg, running, streamTail }: { msg: ChatMessage; running: boolean; streamTail?: boolean }): JSX.Element {
  const entries = msg.entries ?? [];
  // 工具 input 查找表(toolUseId → input):工具结果被拆到独立块(同批无 tool_use)时,
  // tool-result-only 块仍能取 file_path 做语言高亮/摘要显示(对齐 ChatPanel 同款构建)
  const toolInputs = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const e of entries) {
      if (e.kind === "tool_use" && e.id) {
        const input = typeof e.input === "object" && e.input !== null ? (e.input as Record<string, unknown>) : undefined;
        if (input) m.set(e.id, input);
      }
    }
    return m;
  }, [entries]);

  const blocks = useMemo(
    () => (entries.length > 0 ? buildBlocks(entries, String(msg.id), toolInputs) : []),
    [entries, msg.id, toolInputs],
  );

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="msg-bubble-user rounded-[var(--radius-lg)] rounded-br-[4px] px-[14px] py-1.5 leading-[1.55] whitespace-pre-wrap break-words max-w-[80%]">{msg.text}</div>
      </div>
    );
  }
  // 无任何块时不渲染气泡(避免空容器留白)
  if (blocks.length === 0) return <></>;
  return (
    <div className="flex gap-3 items-start">
      <div className="msg-avatar agent shrink-0">M</div>
      <div className="min-w-0 flex-1">
        <div className="msg-bubble-agent rounded-[var(--radius-lg)] rounded-bl-[4px] px-[14px] py-1.5 overflow-hidden">
          {blocks.map((block, i) => (
            <ChatBlockView
              key={`blk-${msg.id}-${i}`}
              block={block}
              streaming={running}
              isStreamingTail={streamTail && i === blocks.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
