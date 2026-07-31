import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import type { StreamEntry } from "./StreamPanel";
import { buildBlocks, ChatBlockView } from "./ChatBlocks";
import { chatActions } from "../stores/chat-actions";
import { useSettingsStore } from "../stores/settings-store";
import { useTabStore } from "../stores/tab-store";
import { useChatStore } from "../stores/chat-store";
import { CONFIRM_DEVELOPMENT_PROMPT } from "../../../shared/prompts";

import { useStatusStore } from "../stores/status-store";
import { StatusBar } from "./StatusBar";
import { PermissionPrompt } from "./PermissionPrompt";
import { ChatInput } from "./ChatInput";
import { SessionStatsPopup } from "./SessionStatsPopup";
import { getWorkspaceDir } from "../lib/getWorkspaceDir";

/** 气泡复制按钮：悬浮气泡时显示在气泡下方，复制整条文本 */
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
      className="absolute top-full left-0 mt-1 flex items-center justify-center w-6 h-6 rounded-md text-text-secondary opacity-0 group-hover:opacity-100 hover:text-text-primary transition-opacity duration-150"
      style={{ background: "var(--color-card)", boxShadow: "var(--shadow-sm)" }}
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.5 3.5L13 5.5"/></svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2"/></svg>
      )}
    </button>
  );
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

/** Pi 事件中的 blocks → StreamEntry 格式（兼容现有渲染） */
function piBlocksToEntries(blocks: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; content?: unknown; thinking?: string }>): StreamEntry[] {
  const ts = Date.now();
  const result: StreamEntry[] = [];
  for (const b of blocks) {
    if (b.type === "text" && b.text) {
      result.push({ kind: "text", text: b.text, timestamp: ts });
    } else if (b.type === "thinking" && (b.thinking || b.text)) {
      result.push({ kind: "thinking", text: (b.thinking || b.text)!, timestamp: ts });
    } else if (b.type === "tool_use") {
      result.push({ kind: "tool_use", id: b.id || "", name: b.name || "?", input: b.input || {}, timestamp: ts, collapsed: false, source: "chat" });
    } else if (b.type === "tool_result") {
      result.push({ kind: "tool_result", toolUseId: b.id || "", content: String(b.content ?? ""), isError: false, timestamp: ts, source: "chat" });
    }
  }
  return result;
}

/** 合并连续 text entry（Pi 偶发拆成多 block） */
function mergeConsecutiveText(entries: StreamEntry[]): StreamEntry[] {
  const result: StreamEntry[] = [];
  for (const e of entries) {
    if (e.kind === "text" && result.length > 0 && result[result.length - 1]!.kind === "text") {
      result[result.length - 1]!.text = (result[result.length - 1]!.text || "") + (e.text || "");
    } else {
      result.push({ ...e });
    }
  }
  return result;
}

/** PiChatEvent → StreamEntry[] */
function piEventToEntries(ev: { type: string; blocks?: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> }> }): StreamEntry[] {
  if (ev.type === "message" && Array.isArray(ev.blocks)) {
    return piBlocksToEntries(ev.blocks);
  }
  return [];
}

/** 工具名 → 中文标签 */
function displayToolLabel(name: string, args?: Record<string, unknown>): string {
  const n = name.toLowerCase();
  const ctx = (args?.file_path || args?.path || args?.filePath || args?.query || args?.pattern || args?.target_file) as string | undefined;
  const fname = (ctx && typeof ctx === "string") ? ctx.split("/").pop() || "" : "";
  const ext = fname.split(".").pop()?.toLowerCase() || "";

  // Skill / MCP 特殊处理
  const skillInInput = args?.skill as string | undefined;
  if (skillInInput) return `调用 Skill: ${skillInInput}`;
  if (n.startsWith("skill__")) return `调用 Skill: ${name.slice(7)}`;
  if (n.startsWith("mcp__")) return `调用 MCP: ${name.split("__")[1] || "工具"}`;

  if (n === "read" || n === "glob") {
    const isConfig = /json|toml|yaml|yml|env|ini|config|cfg|rc$/i.test(ext) || /package\.json|tsconfig|eslint|prettier/i.test(fname);
    const isDoc = /md|markdown|rst|txt|readme/i.test(ext) || /README|CLAUDE|CHANGELOG|LICENSE/i.test(fname);
    const isSource = /tsx?|jsx?|py|rs|go|java|c|h|cpp|swift|kt|rb|php|vue|svelte|css|scss|html$/i.test(ext);
    const isTest = /test|spec|__test__/i.test(fname);
    if (isConfig) return fname ? `加载配置: ${fname}` : "读取项目配置";
    if (isTest) return fname ? `查看测试: ${fname}` : "查看测试文件";
    if (isDoc) return fname ? `阅读文档: ${fname}` : "查阅文档";
    if (isSource) return fname ? `检查代码: ${fname}` : "分析源代码";
    if (n === "glob") return fname ? `搜索文件: ${fname}` : "查找文件";
    return fname ? `读取: ${fname}` : "读取文件";
  }

  if (n === "write") {
    if (ext === "json" || /package\.json|tsconfig/i.test(fname)) return fname ? `更新配置: ${fname}` : "写入配置文件";
    if (ext === "md" || /README|CLAUDE|CHANGELOG/i.test(fname)) return fname ? `撰写文档: ${fname}` : "输出文档";
    if (/tsx?|jsx?|py|rs|go|css/.test(ext)) return fname ? `编写代码: ${fname}` : "创建源文件";
    return fname ? `写入: ${fname}` : "写入文件";
  }

  if (n === "edit") return fname ? `修改: ${fname}` : "编辑文件";

  if (n === "grep") return ctx ? "搜索内容" : "查找代码";

  if (n === "bash") {
    const cmd = (args?.command as string) || "";
    const short = cmd.length > 40 ? cmd.slice(0, 40) + "…" : cmd;
    return short ? `执行: ${short}` : "执行命令";
  }

  if (n === "task") {
    const agent = args?.subagent_type as string | undefined;
    if (agent === "builder") return "委托 Builder 编码";
    if (agent === "evaluator") return "委托 Evaluator 验收";
    return agent ? `调度 Agent: ${agent}` : "调度 Agent";
  }

  if (n === "webfetch") {
    const url = ctx || "";
    const domain = url ? (() => { try { return new URL(url).hostname; } catch { return url.slice(0, 40); } })() : "";
    return domain ? `获取网页: ${domain}` : "抓取网页内容";
  }

  if (n === "websearch") {
    const query = (args?.query as string) || ctx || "";
    return query ? `搜索: ${query.slice(0, 30)}` : "联网搜索";
  }

  return name;
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

  // 快捷命令已屏蔽，暂停加载以减少 IPC 开销
  // 恢复时取消注释：useEffect(() => { ... }, []);
  useEffect(() => {
    // useSettingsStore.getState().loadCommands();
    // const unsub = window.electronAPI?.agent?.onCommandsChanged?.(({ commands }) => {
    //   useSettingsStore.getState().setAvailableCommands(commands);
    // });
    // return () => { unsub?.(); };
  }, []);

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
  // turn 边界：turn_start 记录当前 turn 在最后一条 AI 消息 entries 中的起始位置
  const turnEntryIdxRef = useRef(0);
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
    }
  }, [existingSid]);
  const runningSessions = useTabStore((s) => s.runningSessions);
  const busy = runningSessions.has(sidRef.current);
  const setBusy = (v: boolean) => { useTabStore.getState().setSessionRunning(sidRef.current, v); };

  const scrollToBottom = useCallback((force = false) => {
    if (!containerRef.current) return;
    if (force || autoScrollRef.current) {
      const el = containerRef.current;
      requestAnimationFrame(() => {
        if (!el) return;
        if (force) {
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        } else {
          el.scrollTop = el.scrollHeight;
        }
      });
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
          for (const raw of buffered) {
            const ev = raw as any;
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
    let _curAi = 0;
    const unsub = window.electronAPI.agent.onStream((event: any) => {
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
      // Pi 新 assistant turn 开始 → 记录 turn 边界（entries 从此处开始替换，保留旧 turn 内容）
      if (event.type === "turn_start") {
        const msgs = useChatStore.getState().messagesBySession[sidRef.current] || [];
        const lastAi = msgs.filter((m: any) => m.role === "ai").pop();
        turnEntryIdxRef.current = lastAi ? (lastAi.entries || []).length : 0;
        steeringRef.current = false;
      }
      // Pi SDK message_update 携带累计全文，替换当前 turn 的 entries（保留之前 turn 的内容）
      if (event.type === "message" && Array.isArray(event.blocks)) {
        const rawEntries = piBlocksToEntries(event.blocks);
        if (rawEntries.length > 0) {
          const entries = mergeConsecutiveText(rawEntries);
          _curAi = useChatStore.getState().replaceAiEntriesFrom(sidRef.current, turnEntryIdxRef.current, entries);
          scrollToBottom();
        }
      }
      // thinking delta
      if (event.type === "thinking" && Array.isArray(event.blocks) && showThinking) {
        for (const b of event.blocks) {
          if (b.type === "text" && b.text) {
            useChatStore.getState().appendAiEntry(sidRef.current, { kind: "thinking", text: b.text, timestamp: Date.now() });
          }
        }
      }
      // tool progress
      if (event.type === "tool_progress" && event.toolName) {
        const label = displayToolLabel(event.toolName, event.toolArgs);
        useStatusStore.getState().setText(label);
        lastStatusRef.current = label;
      }
      // compaction UI
      if (event.type === "compacting") {
        useStatusStore.getState().setSummarizing(true);
      }
      if (event.type === "compacted") {
        useStatusStore.getState().setSummarizing(false);
      }
      // error
      if (event.type === "error") {
        useStatusStore.getState().setText(event.message || "出错了");
      }
      // context usage update
      if (event.type === "context_usage") {
        useStatusStore.getState().setCtxPct(event.percentage || 0);
      }
    });
    const unsubExit = window.electronAPI.agent.onExit(({ runId }: { runId: string }) => { if (!currentChatRef.current) return; if (runId !== currentChatRef.current) return; _curAi = 0; busyRef.current = false; lastStatusRef.current = ""; setBusy(false); useStatusStore.getState().setText(""); onActivity?.(); });
    const unsubCtx = window.electronAPI.agent.onContextUsage(({ percentage }) => { useStatusStore.getState().setCtxPct(percentage); });
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
    const unsubCtxSum = window.electronAPI.agent.onContextSummarizing(({ chatId: ctxChatId, type }: { chatId: string; type?: string }) => { if (!currentChatRef.current) return; if (ctxChatId !== currentChatRef.current) return; useStatusStore.getState().setText("正在整理会话..."); if (type === "compact") { useTabStore.getState().setSessionRunning(sidRef.current, true); useStatusStore.getState().setCompacting(true); } else { useStatusStore.getState().setSummarizing(true); } });
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
      useStatusStore.getState().setText("摘要超时，将开新会话继续");
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
          useStatusStore.getState().setText("");
        }
      } catch { /* 网络错误忽略 */ }
    }, 30_000);
    return () => clearInterval(interval);
  }, [busy, existingSid]);

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
    turnEntryIdxRef.current = 0;  // 新用户消息 → 重置 turn 边界
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

    busyRef.current = true; lastStatusRef.current = "正在请求..."; setBusy(true); useStatusStore.getState().setText("正在请求...");

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
    } catch { busyRef.current = false; setBusy(false); currentChatRef.current = null; useStatusStore.getState().setText("发送失败，请检查网络后重试"); }
  }, [busy, attaches, projectPath, permissionMode]);

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
      <div className="flex gap-4 items-start max-w-[75%] w-fit">
        <div className="rounded-[10px] rounded-br-[4px] px-[14px] py-1.5 text-sm leading-[1.55] overflow-hidden min-w-0 [overflow-wrap:anywhere]" style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)', boxShadow: 'var(--msg-user-shadow)' }}>
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
        <div className="msg-avatar user">U</div>
      </div>
    );
  }

  const userBubble = useCallback((msg: ChatMessage) => (
    <UserBubble msg={msg} />
  ), []);

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden pb-2">
        {!hasMessages ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M8 9h8M8 13h6"/></svg>
            </div>
            <h1 className="chat-empty-title">开始对话</h1>
            <p className="chat-empty-desc">描述你想做什么，Mint 会帮你完成。</p>
          </div>
        ) : (
          <div className="px-8 py-4 space-y-3">
            {messages.map((msg) => (
              <MemoChatMessage
                key={msg.id}
                msg={msg}
                showThinking={showThinking}
                showToolUse={showToolUse}
                busy={busy}
                userBubble={userBubble}
              />
            ))}
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
              <div className="flex gap-4 items-start max-w-[75%]">
                <div className="msg-avatar agent">M</div>
                <div className="min-w-0">
                  <div className="msg-from">Mint</div>
                  <div className="bg-accent-subtle border border-border rounded-[10px] rounded-bl-[4px] px-[14px] py-1.5 animate-pulse">
                    <span className="text-sm text-text-secondary">...</span>
                  </div>
                </div>
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

      <StatusBar sessionId={sidRef.current} />
      <PermissionPrompt />

      {/* Attach preview — above thinking when busy */}
      {busy && attaches.length > 0 && (
        <div className="px-4 py-2 bg-surface-alt/30 border-t border-border/50 shrink-0"><AttachPreview /></div>
      )}

      <div className="chat-input-area">
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
      </div>
      {showStats && (
        <SessionStatsPopup
          sessionId={sidRef.current}
          projectPath={projectPath || getWorkspaceDir()}
          onClose={() => setShowStats(false)}
        />
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
}

const MemoChatMessage = memo(function MemoChatMessage({ msg, showThinking, showToolUse, busy, userBubble }: MemoChatMessageProps) {
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
  const copyText = useMemo(() => {
    if (msg.role === "user") return msg.text || "";
    if (!msg.entries) return "";
    return msg.entries.filter((e) => e.kind === "text").map((e) => e.text).join("\n");
  }, [msg]);

  if (msg.role === "user") {
    return (
      <div className="msg-in group">
        <div className="flex justify-end">
          <div className="relative">
            {userBubble(msg)}
            <CopyBubbleBtn text={copyText} />
          </div>
        </div>
      </div>
    );
  }

  if (visible.length === 0) return null;

  return (
    <div className="msg-in group">
      <div className="flex gap-4 items-start max-w-[75%]">
        <div className="msg-avatar agent">M</div>
        <div className="min-w-0 relative">
          <div className="msg-from">Mint</div>
          <div className="rounded-[10px] rounded-bl-[4px] px-[14px] py-1.5 overflow-hidden" style={{ background: 'var(--color-card-agent)', boxShadow: 'var(--msg-agent-shadow)' }}>
            {blocks.map((block, i) => (
              <ChatBlockView key={`blk-${msg.id}-${i}`} block={block} streaming={busy} />
            ))}
          </div>
          <CopyBubbleBtn text={copyText} />
        </div>
      </div>
    </div>
  );
});
