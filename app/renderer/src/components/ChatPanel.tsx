import { useState, useEffect, useRef, useCallback } from "react";
import { normalizeEvent } from "./StreamPanel";
import type { StreamEntry } from "./StreamPanel";
import { buildBlocks, ChatBlockView } from "./ChatBlocks";
import { chatActions } from "../stores/chat-actions";
import { useSettingsStore } from "../stores/settings-store";
import { QuickPrompts } from "./QuickPrompts";
import { CONFIRM_DEVELOPMENT_PROMPT } from "../../../shared/prompts";

function getWorkspaceDir(): string {
  const base = useSettingsStore.getState().defaultProjectDir || "~/EasyMintProject";
  return `${base.replace(/\/$/, "")}/workspace/`;
}

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
      if (text && !text.includes("Request interrupted") && !text.includes("No response requested") && !text.includes("<command-") && !text.includes("<local-command-") && !/set model to/i.test(text)) {
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
            if (!b.text.includes("Request interrupted") && !b.text.includes("No response requested") && !b.text.includes("<command-") && !b.text.includes("<local-command-") && !/set model to/i.test(b.text)) {
              entries.push({ kind: "text", text: b.text, timestamp: ts });
            }
          } else if (b.type === "thinking" && b.thinking) {
            entries.push({ kind: "thinking", text: b.thinking, timestamp: ts });
          } else if (b.type === "tool_use") {
            entries.push({ kind: "tool_use", id: (b as { id?: string }).id || "", name: b.name || "?", input: b.input || {}, timestamp: ts, collapsed: false, source: "chat" });
          } else if (b.type === "tool_result") {
            entries.push({ kind: "tool_result", toolUseId: b.tool_use_id || "", content: String(b.content ?? ""), isError: !!b.is_error, timestamp: ts, source: "chat" });
          }
        }
        if (entries.length > 0) mapped.push({ id: ++nextId, role: "ai", entries, timestamp: ts });
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
    const num = parseInt(m[2]!, 10);
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
}

export function ChatPanel({ projectPath, sessionId: existingSid, onSessionCreated, onActivity }: ChatPanelProps): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [statusText, setStatusText] = useState("思考中...");
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const currentRunRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const [summarizing, setSummarizing] = useState(false);
  const [ctxPct, setCtxPct] = useState(0);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attaches, setAttaches] = useState<AttachItem[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState("auto");
  const storeModel = useSettingsStore((s) => s.model);
  const setStoreModel = useSettingsStore((s) => s.setModel);
  const availableModels = useSettingsStore((s) => s.availableModels);
  const showThinking = useSettingsStore((s) => s.showThinking);
  const showToolUse = useSettingsStore((s) => s.showToolUse);
  const [chatModel, setChatModel] = useState("");
  const [balanceText, setBalanceText] = useState("");

  const refreshBalance = useCallback(async () => {
    try {
      const data = await window.electronAPI.settings.fetchBalance();
      if (data?.balance_infos?.length) {
        const b = data.balance_infos[0]!;
        setBalanceText(`${b.total_balance}`);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshBalance(); const t = setInterval(refreshBalance, 5 * 60 * 1000); return () => clearInterval(t); }, [refreshBalance]);

  const handleModelChange = useCallback(async (m: string) => {
    setChatModel(m); setStoreModel(m);
    const sid = sidRef.current;
    if (sid) { window.electronAPI.agent.setModel(sid, m).catch(() => {}); }
  }, [setStoreModel]);

  const msgIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const sidRef = useRef<string | null>(existingSid ?? null);
  useEffect(() => { if (existingSid) sidRef.current = existingSid; }, [existingSid]);

  const scrollToBottom = useCallback((force = false) => {
    if (!containerRef.current) return;
    if (force || autoScrollRef.current) {
      requestAnimationFrame(() => { if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight; });
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current; if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
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
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { e.preventDefault(); files.push(file); }
      }
    }
    if (files.length > 0) uploadFiles(files, "image");
  }, [uploadFiles]);

  // ── File inputs ────────────────────────────────────

  const handleImgChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) { uploadFiles(e.target.files, "image"); e.target.value = ""; }
  }, [uploadFiles]);

  const handleDocChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) { uploadFiles(e.target.files, "doc"); e.target.value = ""; }
  }, [uploadFiles]);

  // ── History / stream ───────────────────────────────

  useEffect(() => {
    if (!existingSid) return; let cancelled = false;
    const projectDir = projectPath || getWorkspaceDir();
    (async () => {
      try {
        const buffered = await window.electronAPI.agent.getBufferedStream(existingSid);
        if (!cancelled && buffered.length > 0) {
          let cur = 0;
          for (const raw of buffered) {
            const entry = normalizeEvent(raw as StreamEvent); if (!entry) continue;
            if (!cur) { cur = ++msgIdRef.current; setMessages((prev) => [...prev, { id: cur, role: "ai", entries: [entry], timestamp: Date.now() }]); }
            else setMessages((prev) => prev.map((m) => m.id === cur ? { ...m, entries: [...(m.entries || []), entry] } : m));
          }
        }
      } catch { /* */ }
      if (cancelled) return; const snapshot = msgIdRef.current;
      try {
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
          if (!cancelled && mapped.length > 0) { setMessages(mapped); msgIdRef.current = Math.max(...mapped.map((m) => m.id)); }
        }
      } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, [existingSid, projectPath]);

  useEffect(() => {
    let curAi = 0;
    const unsub = window.electronAPI.agent.onStream((event: StreamEvent) => {
      if (event.source !== "chat") return;
      if (sidRef.current && event.sessionId && event.sessionId !== sidRef.current) return;
      if (currentRunRef.current && event.runId !== currentRunRef.current) return;
      if (stoppedRef.current) return;
      if (!currentRunRef.current) { currentRunRef.current = event.runId; setCurrentRunId(event.runId); }
      setLoading(true); setStreaming(true);
      if (event.type === "status") { setStatusText(typeof event.data.text === "string" ? event.data.text : "处理中..."); return; }
      if (event.type === "tool_use") {
        const name = typeof event.data.name === "string" ? event.data.name : "";
        const input = event.data.input as Record<string, unknown> | undefined;
        const labels: Record<string, string> = {
          Bash: "执行命令", Read: "读取文件", Write: "写入文件", Edit: "编辑文件",
          Grep: "搜索内容", Glob: "搜索文件", WebFetch: "抓取网页", WebSearch: "搜索网页",
          Task: "调用子 Agent", TodoWrite: "更新待办",
        };
        let label = labels[name] || name;
        if (name.startsWith("mcp__")) {
          const parts = name.split("__");
          label = `MCP: ${parts[1] || "工具"}`;
        }
        // Append context for relevant tools
        if (name === "Bash") {
          const cmd = input?.command as string | undefined;
          if (cmd) label += `: ${cmd.length > 50 ? cmd.slice(0, 50) + "…" : cmd}`;
        } else if (name === "Task") {
          const agent = input?.subagent_type as string | undefined;
          if (agent) label += `: ${agent}`;
        } else {
          const ctx = (input?.file_path || input?.filePath || input?.url || input?.query || input?.pattern || input?.target_file) as string | undefined;
          if (ctx && typeof ctx === "string" && ctx.length < 80) {
            label += `: ${ctx.split("/").pop() || ctx}`;
          }
        }
        if (label) setStatusText(label);
      }
      const entry = normalizeEvent(event); if (!entry) return;
      if (!curAi) { curAi = ++msgIdRef.current; setMessages((prev) => [...prev, { id: curAi, role: "ai", entries: [entry], timestamp: entry.timestamp }]); }
      else setMessages((prev) => prev.map((m) => m.id === curAi ? { ...m, entries: [...(m.entries || []), entry], timestamp: entry.timestamp } : m));
      scrollToBottom();
    });
    const unsubExit = window.electronAPI.agent.onExit(({ runId }) => { if (currentRunRef.current && runId !== currentRunRef.current) return; curAi = 0; setLoading(false); setStreaming(false); onActivity?.(); });
    const unsubSid = window.electronAPI.agent.onChatSession(({ sessionId: realSid }) => {
      if (!sidRef.current) {
        sidRef.current = realSid;
        onSessionCreated?.(realSid);
      }
    });
    // Context rotation events
    const unsubCtxSum = window.electronAPI.agent.onContextSummarizing(() => { setSummarizing(true); setStatusText("正在整理会话..."); });
    const unsubCtxUsage = window.electronAPI.agent.onContextUsage(({ percentage }) => {
      const pct = Math.round(percentage);
      setCtxPct(pct);
      if (sidRef.current) {
        window.electronAPI.sessionCache.write(sidRef.current, { contextUsage: pct }).catch(() => {});
      }
    });
    return () => { unsub(); unsubExit(); unsubSid(); unsubCtxSum(); unsubCtxUsage(); };
  }, []);

  // Summarizing timeout — 120s safety net
  useEffect(() => {
    if (!summarizing) return;
    const timer = setTimeout(() => {
      setSummarizing(false);
      setStatusText("思考中...");
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
        if (cache.contextUsage > 0) setCtxPct(cache.contextUsage);
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

  const sendText = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg && attaches.length === 0) return;
    if (loading) return;

    // Build agent message with numbered markers
    const parts: string[] = [];
    attaches.forEach((a, i) => {
      const tag = a.kind === "image" ? "Image" : "File";
      parts.push(`[${tag} #${i + 1}: ${a.path}]`);
    });
    if (msg) parts.push(msg);
    const agentText = parts.join("\n");

    const ts = Date.now();
    setMessages((prev) => [...prev, { id: ++msgIdRef.current, role: "user", text: msg || undefined, attaches: [...attaches], timestamp: ts }]);
    setInput("");
    setAttaches([]);
    setLoading(true); setStatusText("思考中...");
    stoppedRef.current = false; autoScrollRef.current = true; scrollToBottom(true);

    try {
      setStreaming(true); currentRunRef.current = null;
      const result = await window.electronAPI.agent.sendMessage(projectPath, agentText, { sessionId: sidRef.current, permissionMode });
      setCurrentRunId(result.chatId); currentRunRef.current = result.chatId;
    } catch { setLoading(false); currentRunRef.current = null; }
  }, [input, loading, attaches, projectPath, permissionMode]);

  useEffect(() => { chatActions.register((t: string) => sendText(t)); return () => chatActions.unregister(); }, [sendText]);

  const handleSend = useCallback(() => sendText(), [sendText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const hasMessages = messages.length > 0;

  // Detect "确认开发" button trigger
  const lastAiText = messages.length > 0
    ? messages.filter((m) => m.role === "ai" && m.entries).pop()?.entries
        ?.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text).join("") ?? ""
    : "";
  const showConfirmDev = lastAiText.includes("确认开发") && !loading;
  const canSend = input.trim() || attaches.length > 0;

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
      <div className="flex flex-col items-end max-w-[82%]">
        <div className="rounded-[10px] rounded-br-[4px] px-[14px] py-[10px] text-[13px] leading-[1.55] overflow-hidden" style={{ background: 'var(--color-user-bubble)', color: 'var(--color-user-bubble-text)' }}>
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
          {msg.text ? <span className="whitespace-pre-wrap">{msg.text}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
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
                    msg.entries.filter((e) => {
                      // Suppress model-switch hook output regardless of event type
                      const t = (e as { text?: string; message?: string; content?: string }).text
                            || (e as { message?: string }).message
                            || (e as { content?: string }).content
                            || "";
                      if (e.kind === "text") return true;
                      if (e.kind === "thinking") return showThinking;
                      return showToolUse;
                    }).length === 0 ? null : (
                      <div className="flex flex-col max-w-[85%]">
                        <div className="bg-accent-subtle border border-border rounded-[10px] rounded-bl-[4px] px-[14px] py-2 overflow-hidden">
                          {buildBlocks(
                            msg.entries.filter((e) => {
                              if (e.kind === "text") return true;
                              if (e.kind === "thinking") return showThinking;
                              return showToolUse;
                            }),
                            String(msg.id)
                          ).map((block, i) => <ChatBlockView key={`blk-${msg.id}-${i}`} block={block} streaming={streaming} />)}
                        </div>
                      </div>
                    )
                  ) : null}
                </div>
              );
            })}
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
          </div>
        )}
      </div>

      {/* Attach preview — above thinking when loading */}
      {(streaming || loading) && attaches.length > 0 && (
        <div className="px-4 py-2 bg-surface-alt/30 border-t border-border/50 shrink-0"><AttachPreview /></div>
      )}

      {(streaming || loading) && (
        <div className="flex items-center px-4 py-1.5 text-text-secondary text-xs bg-surface-alt/50 shrink-0">
          <span>{statusText}</span>
        </div>
      )}

      {summarizing && (
        <div className="flex items-center gap-2 px-4 py-2 text-text-primary text-sm bg-accent-bg border-b border-accent-border-light shrink-0">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-accent animate-spin"><circle cx="8" cy="8" r="6" strokeOpacity="0.3"/><path d="M8 2a6 6 0 015.5 3.5" strokeLinecap="round"/></svg>
          <span>正在进行会话摘要，将在新会话继续。</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface shrink-0">
        <input ref={imgInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml" multiple className="hidden" onChange={handleImgChange} />
        <input ref={docInputRef} type="file" multiple className="hidden" onChange={handleDocChange} accept=".pdf,.doc,.docx,.md,.txt,.csv,.xls,.xlsx,.ts,.tsx,.js,.jsx,.py,.java,.json,.yaml,.yml,.toml,.html,.css,.sh,.env,.cfg" />
        <button className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-accent transition-colors" title="上传图片" onClick={() => imgInputRef.current?.click()}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><circle cx="5" cy="6" r="1.2"/><path d="M1.5 11l3.5-3.5 2.5 2.5 3-4 4 5"/></svg>
        </button>
        <button className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-accent transition-colors" title="上传文档" onClick={() => docInputRef.current?.click()}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M3 2h7l4 4v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v4h4M6 9h4M6 12h4"/></svg>
        </button>
        <div className="flex-1" />
        <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)} className="text-[11px] px-2 py-1 rounded-md bg-surface border border-border text-text-primary outline-none focus:border-accent cursor-pointer">
          <option value="auto">智能判断</option><option value="plan">只读</option><option value="acceptEdits">手动确认</option><option value="bypassPermissions">完全自主</option>
        </select>
        <span className="text-[10px] text-text-secondary hidden sm:inline">权限</span>
        <select value={chatModel || storeModel} onChange={(e) => handleModelChange(e.target.value)} className="text-[11px] px-2 py-1 rounded-md bg-surface border border-border text-text-primary outline-none focus:border-accent cursor-pointer max-w-[200px]" title="切换模型">
          {availableModels.map((m) => (<option key={m} value={m}>{m}</option>))}
        </select>
        {balanceText && <span className="text-[10px] text-text-secondary cursor-pointer hover:text-accent transition-colors" onClick={refreshBalance} title="账户余额，点击刷新">{balanceText}</span>}
        <span className="text-[10px] text-text-secondary" title="上下文使用率，可设置阈值">{ctxPct}%</span>
      </div>

      {/* Input area */}
      <div className="border-t border-border p-3 pt-2 shrink-0">
        {!(streaming || loading) && attaches.length > 0 && (
          <div className="mb-2"><AttachPreview /></div>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={summarizing ? "正在进行会话摘要..." : "输入消息，Enter 发送，Shift+Enter 换行，粘贴或拖入图片..."}
            rows={3}
            disabled={summarizing}
            className="chat-input flex-1 min-h-[90px] resize-none bg-surface border border-border rounded-[10px] px-[14px] py-[10px] text-[13px] text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-inset disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <div className="flex flex-col gap-1.5 shrink-0">
            {!summarizing && (
              <QuickPrompts
                onFill={(text) => { setInput(text); textareaRef.current?.focus(); }}
              />
            )}
            {summarizing ? (
              <div className="w-9 h-9 rounded-md bg-surface-alt border border-border flex items-center justify-center opacity-40 cursor-not-allowed">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M1 1l14 7-14 7 4-7-4-7z"/></svg>
              </div>
            ) : (loading || streaming) ? (
              <button onClick={() => { stoppedRef.current = true; const rid = currentRunRef.current; if (rid) window.electronAPI.agent.abort(rid); setLoading(false); setStreaming(false); }}
                className="w-9 h-9 rounded-md bg-danger-bg text-danger flex items-center justify-center hover:bg-danger-bg transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>
              </button>
            ) : (
              <button onClick={handleSend} disabled={!canSend}
                className="w-9 h-9 rounded-md bg-accent text-text-inverse flex items-center justify-center hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M1 1l14 7-14 7 4-7-4-7z"/></svg>
              </button>
            )}
          </div>
        </div>
      </div>
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
