import { useState, useEffect, useRef, useCallback } from "react";
import { normalizeEvent } from "./StreamPanel";
import type { StreamEntry } from "./StreamPanel";
import { buildBlocks, ChatBlockView } from "./ChatBlocks";
import { chatActions } from "../stores/chat-actions";
import { useSettingsStore } from "../stores/settings-store";
import { useTabStore } from "../stores/tab-store";
import { useChatStore } from "../stores/chat-store";
import { CONFIRM_DEVELOPMENT_PROMPT } from "../../../shared/prompts";

import { useStatusStore } from "../stores/status-store";
import { StatusBar } from "./StatusBar";
import { ChatInput } from "./ChatInput";
import { getWorkspaceDir } from "../lib/getWorkspaceDir";

interface AttachItem {
  name: string;
  path: string;
  dataUrl?: string;
  kind: "image" | "doc";
}

interface ChatMessage {
  id: number;
  role: "user" | "ai";
  text?: string;
  attaches?: AttachItem[];
  entries?: StreamEntry[];
  timestamp: number;
}

function mapSessionMessages(msgs: Array<{ type: string; message: unknown }>): ChatMessage[] {
  let nextId = 0;
  const mapped: ChatMessage[] = [];
  for (const m of msgs) {
    const ts = (m.message as { created_at?: number })?.created_at ?? Date.now();
    if (m.type === "user") {
      const content = (m.message as { content?: string | unknown[] })?.content;
      const text = typeof content === "string" ? content : Array.isArray(content)
        ? content.map((b: unknown) => (b as { text?: string })?.text ?? "").join("")
        : "";
      if (text) {
        const { attaches, cleanText } = parseAttachMarkers(text);
        mapped.push({ id: ++nextId, role: "user", text: cleanText, attaches: attaches.length > 0 ? attaches : undefined, timestamp: ts });
      }
    } else if (m.type === "assistant") {
      const content = (m.message as { content?: unknown[] })?.content;
      if (Array.isArray(content)) {
        const entries: StreamEntry[] = [];
        for (const block of content) {
          const b = block as { type?: string; text?: string; thinking?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };
          if (b.type === "text" && b.text) {
            entries.push({ kind: "text", text: b.text, timestamp: ts });
          } else if (b.type === "thinking" && b.thinking) {
            entries.push({ kind: "thinking", text: b.thinking, timestamp: ts });
          } else if (b.type === "tool_use") {
            entries.push({ kind: "tool_use", id: (b as { id?: string }).id || "", name: b.name || "?", input: b.input || {}, timestamp: ts, collapsed: false, source: "chat" });
          } else if (b.type === "tool_result") {
            entries.push({ kind: "tool_result", toolUseId: b.tool_use_id || "", content: String(b.content ?? ""), isError: !!b.is_error, timestamp: ts, source: "chat" });
          }
        }
        if (entries.length === 0) continue;
        // Merge consecutive AI messages — same as appendAiEntry does during streaming
        const last = mapped[mapped.length - 1];
        if (last && last.role === "ai") {
          last.entries!.push(...entries);
        } else {
          mapped.push({ id: ++nextId, role: "ai", entries, timestamp: ts });
        }
      }
    }
  }
  return mapped;
}

function parseAttachMarkers(text: string): { attaches: AttachItem[]; cleanText: string } {
  const attaches: AttachItem[] = [];
  const re = /\[(Image|File)\s+#(\d+):\s*([^\]]+)\]/g;
  let clean = text;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1] === "Image" ? "image" : "doc";
    const p = m[3]!;
    attaches.push({ kind, name: p.split("/").pop() || p, path: p, dataUrl: kind === "image" ? "" : undefined });
    clean = clean.replace(m[0], "");
  }
  return { attaches, cleanText: clean.trim() };
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
  const lastStatusRef = useRef("");

  /** 从流事件更新状态栏——Effect A（缓冲补放）和 Effect B（实时 onStream）共用 */
  const updateStreamStatus = useCallback((event: StreamEvent, setBusyFn: (v: boolean) => void) => {
    if (!busyRef.current) { busyRef.current = true; setBusyFn(true); }
    if (event.type === "status") {
      const st = typeof event.data.text === "string" ? event.data.text : "处理中...";
      if (lastStatusRef.current !== st) { lastStatusRef.current = st; useStatusStore.getState().setText(st); }
      return;
    }
    if (event.type === "assistant" && typeof event.data.delta === "string") {
      const st = "正在思考...";
      if (lastStatusRef.current !== st) { lastStatusRef.current = st; useStatusStore.getState().setText(st); }
      return;
    }
    if (event.type === "tool_use") {
      const name = typeof event.data.name === "string" ? event.data.name : "";
      const input = event.data.input as Record<string, unknown> | undefined;
      // SDK 0.3.179+ tool_use_meta 提供显示名，有则直接用
      const displayName = typeof event.data.displayName === "string" ? event.data.displayName : "";
      if (displayName) {
        if (lastStatusRef.current !== displayName) { lastStatusRef.current = displayName; useStatusStore.getState().setText(displayName); }
        return;
      }
      let label = "";
      const ctx = (input?.file_path || input?.filePath || input?.query || input?.pattern || input?.target_file) as string | undefined;
      const fname = (ctx && typeof ctx === "string") ? ctx.split("/").pop() || "" : "";
      const ext = fname.split(".").pop()?.toLowerCase() || "";

      // Skill / MCP 特殊处理
      const skillInInput = input?.skill as string | undefined;
      if (skillInInput) {
        label = `调用 Skill: ${skillInInput}`;
      } else if (name.startsWith("Skill__")) {
        label = `调用 Skill: ${name.slice(7)}`;
      } else if (name.startsWith("mcp__")) {
        label = `调用 MCP: ${name.split("__")[1] || "工具"}`;
      } else if (name === "Read" || name === "Glob") {
        const isConfig = /json|toml|yaml|yml|env|ini|config|cfg|rc$/i.test(ext) || /package\.json|tsconfig|eslint|prettier/i.test(fname);
        const isDoc = /md|markdown|rst|txt|readme/i.test(ext) || /README|CLAUDE|CHANGELOG|LICENSE/i.test(fname);
        const isSource = /tsx?|jsx?|py|rs|go|java|c|h|cpp|swift|kt|rb|php|vue|svelte|css|scss|html$/i.test(ext);
        const isTest = /test|spec|__test__/i.test(fname);
        if (isConfig) label = fname ? `加载配置: ${fname}` : "读取项目配置";
        else if (isTest) label = fname ? `查看测试: ${fname}` : "查看测试文件";
        else if (isDoc) label = fname ? `阅读文档: ${fname}` : "查阅文档";
        else if (isSource) label = fname ? `检查代码: ${fname}` : "分析源代码";
        else if (name === "Glob") label = fname ? `搜索文件: ${fname}` : "查找文件";
        else label = fname ? `读取: ${fname}` : "读取文件";
      } else if (name === "Write") {
        if (ext === "json" || /package\.json|tsconfig/i.test(fname)) label = fname ? `更新配置: ${fname}` : "写入配置文件";
        else if (ext === "md" || /README|CLAUDE|CHANGELOG/i.test(fname)) label = fname ? `撰写文档: ${fname}` : "输出文档";
        else if (/tsx?|jsx?|py|rs|go|css/.test(ext)) label = fname ? `编写代码: ${fname}` : "创建源文件";
        else label = fname ? `写入: ${fname}` : "写入文件";
      } else if (name === "Edit") {
        label = fname ? `修改: ${fname}` : "编辑文件";
      } else if (name === "Grep") {
        label = ctx ? `搜索内容` : "查找代码";
      } else if (name === "Bash") {
        const cmd = (input?.command as string) || "";
        const short = cmd.length > 40 ? cmd.slice(0, 40) + "…" : cmd;
        label = `执行: ${short}`;
      } else if (name === "Task") {
        const agent = input?.subagent_type as string | undefined;
        if (agent === "builder") label = "委托 Builder 编码";
        else if (agent === "evaluator") label = "委托 Evaluator 验收";
        else label = agent ? `调度 Agent: ${agent}` : "调度 Agent";
      } else if (name === "WebFetch") {
        const url = ctx || "";
        const domain = url ? (() => { try { return new URL(url).hostname; } catch { return url.slice(0, 40); } })() : "";
        label = domain ? `获取网页: ${domain}` : "抓取网页内容";
      } else if (name === "WebSearch") {
        const query = (input?.query as string) || ctx || "";
        label = query ? `搜索: ${query.slice(0, 30)}` : "联网搜索";
      } else {
        label = "执行任务";
      }

      if (label && lastStatusRef.current !== label) { lastStatusRef.current = label; useStatusStore.getState().setText(label); }
    }
  }, []);
  // 状态栏独立存储 → 密集更新时只重渲染 StatusBar，不牵连 ChatPanel/消息列表
  // 注意：ChatPanel 不读 s.text，否则每次 statusText 变化都会重渲染整个组件
  const summarizing = useStatusStore((s) => s.summarizing);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [attaches, setAttaches] = useState<AttachItem[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState("auto");
  const storeModel = useSettingsStore((s) => s.model);
  const setStoreModel = useSettingsStore((s) => s.setModel);
  const showThinking = useSettingsStore((s) => s.showThinking);
  const showThinkingRef = useRef(showThinking);
  showThinkingRef.current = showThinking;
  const showToolUse = useSettingsStore((s) => s.showToolUse);
  const [chatModel, setChatModel] = useState("");

  // 启动时拉取一次命令缓存 + 订阅 SDK 推送的命令变化
  useEffect(() => {
    useSettingsStore.getState().loadCommands();
    const unsub = window.electronAPI?.agent?.onCommandsChanged?.(({ commands }) => {
      useSettingsStore.getState().setAvailableCommands(commands);
    });
    return () => { unsub?.(); };
  }, []);

  const handleModelChange = useCallback(async (m: string) => {
    setChatModel(m); setStoreModel(m);
    const sid = sidRef.current;
    if (sid) { window.electronAPI.agent.setModel(sid, m).catch(() => {}); }
  }, [setStoreModel]);

  const msgIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  /** 输入框变化处理：检测开头 / 触发命令面板（仅在输入框纯命令上下文下，不影响代码片段） */
  const autoScrollRef = useRef(true);
  // 已处理事件 seq 集合：缓冲补放（Effect A）与实时 onStream 共享，避免同一事件被两条路径双写
  const processedSeqRef = useRef<Set<number>>(new Set());
  const sidRef = useRef<string>(initialSid);
  useEffect(() => { if (existingSid) { sidRef.current = existingSid; setSid(existingSid); } }, [existingSid]);
  const runningSessions = useTabStore((s) => s.runningSessions);
  const busy = runningSessions.has(sidRef.current);
  const setBusy = (v: boolean) => { useTabStore.getState().setSessionRunning(sidRef.current, v); };

  const scrollToBottom = useCallback((force = false) => {
    if (!containerRef.current) return;
    if (force || autoScrollRef.current) {
      requestAnimationFrame(() => { if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight; });
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current; if (!el) return;
    // 用户主动滚动：一旦离开底部就立即停止自动跟随（阈值小，轻滑即可解锁），
    // 避免 onStream 的 scrollToBottom 把用户拉回底部导致"滑不动"。
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distFromBottom < 8;
  }, []);

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

  useEffect(() => {
    if (!existingSid) return; let cancelled = false;
    const projectDir = projectPath || getWorkspaceDir();
    (async () => {
        const buffered = await window.electronAPI.agent.getBufferedStream(existingSid);
        if (!cancelled && buffered.length > 0) {
          let _cur = 0;
          for (const raw of buffered) {
            const ev = raw as StreamEvent;
            if (typeof ev.seq === "number" && processedSeqRef.current.has(ev.seq)) continue;
            updateStreamStatus(ev, setBusy);
            const entry = normalizeEvent(ev); if (!entry) continue;
            if (entry.kind === "thinking" && !showThinkingRef.current) continue;
            if (typeof ev.seq === "number") processedSeqRef.current.add(ev.seq);
            _cur = useChatStore.getState().appendAiEntry(sidRef.current, entry);
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

  useEffect(() => {
    let _curAi = 0;
    const unsub = window.electronAPI.agent.onStream((event: StreamEvent) => {
      if (event.source !== "chat") return;
      // Filter by chatId when known; for existing sessions where chat was started
      // externally (e.g. project init), fall back to sessionId match.
      if (currentChatRef.current) {
        if (!event.runId || event.runId !== currentChatRef.current) return;
      } else if (existingSid) {
        // Existing session from outside — accept events matching our sessionId
        if (!event.sessionId || event.sessionId !== existingSid) return;
      } else {
        // 新标签页，还没获取到真实 sessionId —— 先收着不拦截（sidRef 很快会被更新）
        return;
      }
      if (stoppedRef.current) return;
      if (!currentChatRef.current) { currentChatRef.current = event.runId; setCurrentRunId(event.runId); }
      // 状态栏更新（setBusy/setText）——与 Effect A 缓冲补放共用同一逻辑
      updateStreamStatus(event, setBusy);
      // Task subagent completion → refresh project status
      if (event.type === "tool_result" && (event.data as { tool_use_id?: string }).tool_use_id) {
        onActivity?.();
      }
      const entry = normalizeEvent(event); if (!entry) return;
      if (entry.kind === "thinking" && !showThinkingRef.current) return;
      // seq 去重：缓冲补放（Effect A）可能已处理过该事件，跳过避免双写
      if (typeof event.seq === "number") {
        if (processedSeqRef.current.has(event.seq)) return;
        processedSeqRef.current.add(event.seq);
      }
      _curAi = useChatStore.getState().appendAiEntry(sidRef.current, entry);
      scrollToBottom();
    });
    const unsubExit = window.electronAPI.agent.onExit(({ runId }) => { if (!currentChatRef.current) return; if (runId !== currentChatRef.current) return; _curAi = 0; busyRef.current = false; lastStatusRef.current = ""; setBusy(false); useStatusStore.getState().setText(""); onActivity?.(); });
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
    const unsubCtxSum = window.electronAPI.agent.onContextSummarizing(({ chatId: ctxChatId }) => { if (!currentChatRef.current) return; if (ctxChatId !== currentChatRef.current) return; useStatusStore.getState().setSummarizing(true); useStatusStore.getState().setText("正在整理会话..."); });
    const unsubCtxUsage = window.electronAPI.agent.onContextUsage(({ chatId: ctxChatId, percentage }) => {
      if (!currentChatRef.current) return;
      if (ctxChatId !== currentChatRef.current) return;
      const pct = Math.round(percentage);
      useStatusStore.getState().setCtxPct(pct);
      if (sidRef.current) {
        window.electronAPI.sessionCache.write(sidRef.current, { contextUsage: pct }).catch(() => {});
      }
    });
    return () => { unsub(); unsubExit(); unsubSid(); unsubCtxSum(); unsubCtxUsage(); if (sidRef.current) { useTabStore.getState().setSessionRunning(sidRef.current, false); if (!sidRef.current.startsWith("__new_")) { window.electronAPI.agent.scheduleIdleTimeout(sidRef.current, 10 * 60 * 1000); } } useStatusStore.getState().reset(); };
  }, []);

  // Summarizing timeout — 120s safety net
  useEffect(() => {
    if (!summarizing) return;
    const timer = setTimeout(() => {
      useStatusStore.getState().setSummarizing(false);
      useStatusStore.getState().setText("正在请求...");
      console.error("[ChatPanel] summarization timed out after 120s");
    }, 120_000);
    return () => clearTimeout(timer);
  }, [summarizing]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

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
    if (busy) return;

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
    setAttaches([]);
    busyRef.current = true; lastStatusRef.current = "正在请求..."; setBusy(true); useStatusStore.getState().setText("正在请求...");
    onActivity?.(); // 立即刷新会话列表，不等 Mint 回复
    stoppedRef.current = false; autoScrollRef.current = true; scrollToBottom(true);

    try {
      currentChatRef.current = null;
      // sendText 是 fire-and-forget，直接调 sendMessage 拿 chatId。
      // chatId 必须立即可得，否则 onStream 过滤器 currentChatRef 为 null 会拦截所有事件
      const result = await window.electronAPI.agent.sendMessage(projectPath, agentText, { sessionId: existingSid ?? null, permissionMode });
      setCurrentRunId(result.chatId); currentChatRef.current = result.chatId;
    } catch { busyRef.current = false; setBusy(false); currentChatRef.current = null; }
  }, [busy, attaches, projectPath, permissionMode]);

  useEffect(() => { chatActions.register((t: string) => sendText(t)); return () => chatActions.unregister(); }, [sendText]);

  const hasMessages = messages.length > 0;

  // Tool-call driven UI actions — Mint calls show_* tools, frontend detects tool_use entries
  const lastAiEntries = messages.length > 0
    ? messages.filter((m) => m.role === "ai" && m.entries).pop()?.entries ?? []
    : [];
  const lastToolUses = lastAiEntries.filter((e) => e.kind === "tool_use");
  const showConfirmDev = !busy && lastToolUses.some((e) => (e as { name?: string }).name === "mcp__easymint-ui__show_confirm_dev");
  const showNewProjectBtn = onNewProject && !busy && lastToolUses.some((e) => (e as { name?: string }).name === "mcp__easymint-ui__show_new_project");

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
      <div className="flex flex-col items-end max-w-[75%] w-fit">
        <div className="rounded-[10px] rounded-br-[4px] px-[14px] py-1.5 text-sm leading-[1.55] overflow-hidden min-w-0 [overflow-wrap:anywhere]" style={{ background: 'var(--color-user-bubble)', color: 'var(--color-user-bubble-text)' }}>
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
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden pb-2">
        {!hasMessages ? (
          <div className="flex items-center justify-center h-full"><p className="text-sm text-text-secondary">开始对话，让 Mint 帮你开发项目。</p></div>
        ) : (
          <div className="p-4 space-y-3">
            {messages.map((msg) => {
              return (
                <div key={msg.id} className="msg-in">
                  {msg.role === "user" ? (
                    <div className="flex justify-end"><UserBubble msg={msg} /></div>
                  ) : msg.entries ? (
                    (() => {
                      const visible = msg.entries.filter((e) => {
                        if (e.kind === "text") return true;
                        if (e.kind === "thinking") return showThinking;
                        return showToolUse;
                      });
                      if (visible.length === 0) return null;
                      const blocks = buildBlocks(visible, String(msg.id)).map((block, i) => <ChatBlockView key={`blk-${msg.id}-${i}`} block={block} streaming={busy} />);
                      return (
                        <div className="flex flex-col max-w-[75%] w-fit">
                          <div className="bg-accent-subtle border border-border rounded-[10px] rounded-bl-[4px] px-[14px] py-1.5 overflow-hidden">
                            {blocks}
                          </div>
                        </div>
                      );
                    })()
                  ) : null}
                </div>
              );
            })}
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
                  className="px-6 py-2.5 rounded-xl bg-accent text-text-inverse text-sm font-medium hover:bg-accent-hover transition-colors shadow-sm"
                >
                  确认开发
                </button>
              </div>
            )}
            {/* 等待 AI 回复的加载占位泡：无可见 AI 内容时显示 */}
            {busy && messages.length > 0 && (() => {
              const last = messages[messages.length - 1]!;
              if (last.role === "user") return true;
              if (last.role !== "ai" || !last.entries) return false;
              const visible = last.entries.filter((e: any) => {
                if (e.kind === "text") return true;
                if (e.kind === "thinking") return showThinking;
                return showToolUse;
              });
              return visible.length === 0;
            })() && (
              <div className="flex flex-col max-w-[75%] w-fit">
                <div className="bg-accent-subtle border border-border rounded-[10px] rounded-bl-[4px] px-[14px] py-1.5 animate-pulse">
                  <span className="text-sm text-text-secondary">...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <StatusBar sessionId={sidRef.current} />

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
      />
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
