import { useEffect, useRef, useState } from "react";
import { ChatMessage, mapSessionMessages, piBlocksToEntries, mergeConsecutiveText, displayToolLabel } from "./chat-utils";
import type { StreamEntry } from "./StreamPanel";
import { useDelegationStore } from "../stores/delegation-store";

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
        const streamBlock = prev.find((m) => m.streaming);
        if (!streamBlock) return mapped;
        const lastDiskAi = [...mapped].reverse().find((m) => m.role === "ai");
        if (!lastDiskAi) return [...mapped, streamBlock];
        const d = textOf(lastDiskAi);
        const s = textOf(streamBlock);
        if (s && d.startsWith(s)) {
          // 磁盘已含流式块(更全)→ 用磁盘;标记最后一条 ai 为 streaming,
          // 后续实时流帧继续替换它而非追加(否则重复显示同一段)
          return mapped.map((m, i, arr) =>
            i === arr.length - 1 && m.role === "ai" ? { ...m, streaming: true } : m
          );
        }
        if (s && s.startsWith(d)) return [...mapped.slice(0, -1), streamBlock]; // 流式比磁盘新 → 替换磁盘最后
        return [...mapped, streamBlock];
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [running, sessionFile]);

  // 滚动贴底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="flex flex-col w-[720px] max-w-[92vw] h-[68vh] rounded-[12px] border border-border bg-surface-elevated shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-accent-bg">
          <svg className="animate-spin text-accent shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="text-sm font-medium text-text-primary truncate flex-1">{title || "子 Agent"}</span>
          <span className="text-[11px] text-text-secondary shrink-0">
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

        {/* 消息区(全量显示思考/文本/工具调用) */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-[var(--color-sidebar)]/40">
          {!loaded && !sessionFile && (
            <div className="text-center text-xs text-text-secondary py-8">等待子 Agent 会话创建…</div>
          )}
          {!loaded && sessionFile && (
            <div className="text-center text-xs text-text-secondary py-8">加载中…</div>
          )}
          {loaded && msgs.length === 0 && (
            <div className="text-center text-xs text-text-secondary py-8">暂无消息</div>
          )}
          {msgs.map((m) => <SubagentMessage key={m.id} msg={m} />)}
          {running && <div className="flex justify-center"><span className="text-[11px] text-text-secondary animate-pulse">● 运行中</span></div>}
        </div>
      </div>
    </div>
  );
}

/** 精简只读消息气泡(user 右 / ai 左,Mint 气泡复用主聊天样式;思考/文本/工具全量显示) */
function SubagentMessage({ msg }: { msg: ChatMessage }): JSX.Element {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="msg-bubble-user rounded-[10px] rounded-tr-[4px] px-3 py-1.5 text-sm whitespace-pre-wrap break-words max-w-[80%]">{msg.text}</div>
      </div>
    );
  }
  const entries = msg.entries ?? [];
  if (entries.length === 0) return <></>;
  return (
    <div className="flex gap-3 items-start">
      <div className="msg-avatar agent shrink-0">M</div>
      <div className="min-w-0 flex-1">
        <div className="msg-bubble-agent rounded-[10px] rounded-bl-[4px] px-3 py-1.5 text-sm overflow-hidden">
          {entries.map((e, i) => <SubagentEntry key={i} entry={e} />)}
        </div>
      </div>
    </div>
  );
}

/** 单条流式条目(思考/文本/工具调用) */
function SubagentEntry({ entry }: { entry: StreamEntry }): JSX.Element {
  if (entry.kind === "text") {
    return <div className="whitespace-pre-wrap break-words text-text-primary">{entry.text}</div>;
  }
  if (entry.kind === "thinking") {
    return (
      <div className="mb-1 text-xs text-[var(--color-text-secondary)] italic border-l-2 border-[var(--color-border)] pl-2 whitespace-pre-wrap break-words opacity-80">
        {entry.text}
      </div>
    );
  }
  if (entry.kind === "tool_use") {
    const input = (entry as unknown as { input?: unknown }).input;
    const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    return (
      <div className="mb-1 flex items-center gap-1.5 text-xs">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>
        <span className="text-[var(--color-accent)]">{displayToolLabel((entry as unknown as { name: string }).name, args)}</span>
      </div>
    );
  }
  if (entry.kind === "tool_result") {
    const content = String((entry as unknown as { content: string }).content ?? "").trim();
    const short = content.length > 160 ? `${content.slice(0, 160)}…` : content;
    return <div className="mb-1 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap break-words font-mono">{short}</div>;
  }
  return <></>;
}
