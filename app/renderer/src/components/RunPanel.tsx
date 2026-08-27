import { useEffect, useState, useCallback, useRef } from "react";
import type { CSSProperties } from "react";
import { useProcessStore, type RunPlatform, type Runnable } from "../stores/process-store";
import { LogOverlay } from "./LogOverlay";
import { ScriptEditDialog } from "./ScriptEditDialog";

interface RunPanelProps {
  projectPath: string;
  onCollapse: () => void;
}

interface PortStatus {
  free: boolean;
  pid?: number;
  name?: string;
}

/** 从 url 中提取端口号 */
function extractPort(url?: string): number | null {
  if (!url) return null;
  const m = url.match(/:(\d+)/);
  return m?.[1] ? parseInt(m[1]) : null;
}

const PLATFORM_LABEL: Record<RunPlatform, string> = {
  react: "react",
  vue: "vue",
  nextjs: "next.js",
  nuxt: "nuxt",
  angular: "angular",
  svelte: "svelte",
  spring: "spring",
  django: "django",
  flask: "flask",
  fastapi: "fastapi",
  nodejs: "node.js",
  rails: "rails",
  laravel: "laravel",
  go: "go",
  rust: "rust",
  dotnet: ".net",
  "react-native": "react native",
  expo: "expo",
  flutter: "flutter",
  electron: "electron",
  tauri: "tauri",
  python: "python",
  shell: "shell",
  git: "git",
};

const PLATFORM_COLOR: Record<RunPlatform, string> = {
  react: "bg-sky-500/15 text-sky-500",
  vue: "bg-emerald-500/15 text-emerald-500",
  nextjs: "bg-neutral-500/15 text-neutral-600",
  nuxt: "bg-emerald-500/15 text-emerald-500",
  angular: "bg-red-500/15 text-red-500",
  svelte: "bg-orange-500/15 text-orange-500",
  spring: "bg-green-600/15 text-green-600",
  django: "bg-green-600/15 text-green-600",
  flask: "bg-gray-500/15 text-gray-500",
  fastapi: "bg-teal-500/15 text-teal-500",
  nodejs: "bg-yellow-500/15 text-yellow-600",
  rails: "bg-red-600/15 text-red-600",
  laravel: "bg-red-500/15 text-red-500",
  go: "bg-cyan-500/15 text-cyan-500",
  rust: "bg-orange-600/15 text-orange-600",
  dotnet: "bg-purple-500/15 text-purple-500",
  "react-native": "bg-blue-500/15 text-blue-500",
  expo: "bg-purple-500/15 text-purple-500",
  flutter: "bg-blue-400/15 text-blue-400",
  electron: "bg-violet-500/15 text-violet-500",
  tauri: "bg-orange-500/15 text-orange-500",
  python: "bg-blue-500/15 text-blue-500",
  shell: "bg-gray-500/15 text-gray-500",
  git: "bg-orange-500/15 text-orange-500",
};

function platformLabel(p: string): string {
  return PLATFORM_LABEL[p as RunPlatform] || p;
}

const DEFAULT_COLOR = "bg-gray-400/15 text-gray-400";

function platformColor(p: string): string {
  return PLATFORM_COLOR[p as RunPlatform] || DEFAULT_COLOR;
}

/** 按命令首词推断平台标签（显示用）：Mint 写的 platform 可能按项目技术栈硬标，
 *  ./xx.sh 被标成 flutter 等——命令开头是什么工具就显示什么标签；
 *  未命中映射的小众命令直接显示命令首词本身（自适应，绝不显示无关的项目技术栈） */
function inferPlatform(cmd: string, declared: string): string {
  const first = cmd.trim().split(/\s+/)[0]?.toLowerCase() || "";
  if (first.startsWith("flutter")) return "flutter";
  if (first === "git") return "git";
  if (first.startsWith("npm") || first.startsWith("pnpm") || first.startsWith("yarn")) return "nodejs";
  if (first.startsWith("node")) return "nodejs";
  if (first.startsWith("python")) return "python";
  if (first === "bash" || first === "sh" || first === "zsh" || first.startsWith("./") || first.endsWith(".sh")) return "shell";
  if (first === "mvn" || first === "gradle") return "spring";
  if (first === "cargo") return "rust";
  if (first === "go" || first.startsWith("go ")) return "go";
  if (first === "dotnet") return "dotnet";
  if (first === "docker") return "shell";
  // 未命中：显示命令首词本身（platformLabel/platformColor 对未知值有兜底）
  return first || declared;
}

/** 标题滚动显示：文本溢出时 hover 滚动到末尾完整显示（滚动距离 JS 计算，注入 CSS 变量） */
function TitleMarquee({ text, onClick }: { text: string; onClick: () => void }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [dist, setDist] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ov = el.scrollWidth > el.clientWidth + 1;
    setOverflow(ov);
    if (ov) setDist(el.scrollWidth - el.clientWidth);
  }, [text]);
  return (
    <span ref={ref} className="flex-1 min-w-0 overflow-hidden whitespace-nowrap cursor-pointer rounded px-1 -mx-1 text-xs text-text-primary font-medium hover:text-accent hover:bg-accent-subtle transition-colors"
      onClick={onClick} title="点击编辑脚本">
      <span className={`inline-block ${overflow ? "run-title-scroll" : ""}`} style={{ "--scroll-dist": `${dist}px` } as CSSProperties}>{text}</span>
    </span>
  );
}

export function RunPanel({ projectPath }: RunPanelProps): JSX.Element {
  const { runnables, cmdStates, activeLogId, detect, start, stop, restart, openLog, appendLog, setRunning, loadStatus } = useProcessStore();
  const [detectSpinning, setDetectSpinning] = useState(false);
  const [portStatuses, setPortStatuses] = useState<Record<string, PortStatus>>({});
  const [customPorts, setCustomPorts] = useState<Record<string, string>>({});
  const [showDetail, setShowDetail] = useState<Record<string, boolean>>({});
  // 编辑弹窗目标 + 删除确认（内联）
  const [editing, setEditing] = useState<{ r: Runnable; runnables: Runnable[] } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 检测单个端口
  const checkPortStatus = useCallback(async (commandId: string, url?: string) => {
    const port = extractPort(url);
    if (!port) return;
    try {
      const st = await window.electronAPI.process.checkPort(port);
      setPortStatuses(function(prev) {
        const next: Record<string, PortStatus> = {};
        for (const k in prev) next[k] = prev[k]!;
        next[commandId] = st!;
        return next;
      });
    } catch { /* */ }
  }, []);

  // 删除脚本（确认后写回 run.json，watcher 自动刷新）
  const handleDelete = useCallback(async (r: Runnable) => {
    setSaving(true);
    try {
      await window.electronAPI.process.saveRunJson(projectPath, runnables.filter((x) => x.id !== r.id));
      setConfirmDeleteId(null);
    } catch (e) {
      console.error("[RunPanel] delete script failed:", e);
      alert("删除失败，请检查 run.json 是否被占用");
    } finally {
      setSaving(false);
    }
  }, [projectPath, runnables]);

  // 释放端口
  const handleKillPort = useCallback(async (commandId: string, url?: string) => {
    const port = extractPort(url);
    if (!port) return;
    await window.electronAPI.process.killPort(port);
    setTimeout(function() { checkPortStatus(commandId, url); }, 600);
  }, [checkPortStatus]);

  // 点击弹窗外关闭
  useEffect(() => {
    let hasOpen = false;
    for (const k in showDetail) { if (showDetail[k]) { hasOpen = true; break; } }
    if (!hasOpen) return;
    const handler = function(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-port-detail]") && !target.closest("[data-port-toggle]")) {
        setShowDetail({});
      }
    };
    document.addEventListener("mousedown", handler);
    return function() { document.removeEventListener("mousedown", handler); };
  }, [showDetail]);

  useEffect(() => {
    detect(projectPath);
  }, [projectPath, detect]);

  // run.json 变化(Mint 直接写文件)→ 自动重新检测,无需手动刷新
  useEffect(() => {
    const off = window.electronAPI?.process?.onRunJsonChanged?.(() => detect(projectPath));
    return () => { off?.(); };
  }, [projectPath, detect]);

  // 启动时检测所有端口
  useEffect(() => {
    runnables.forEach(function(r) { checkPortStatus(r.id, r.url); });
  }, [runnables, checkPortStatus]);

  // 监听进程输出
  useEffect(() => {
    const off = window.electronAPI?.process?.onOutput?.((data) => {
      appendLog(data.commandId, data.line);
    });
    return () => { off?.(); };
  }, [appendLog]);

  // 监听状态变更
  useEffect(() => {
    const off = window.electronAPI?.process?.onStatusChanged?.((data) => {
      setRunning(data.commandId, data.running);
      if (!data.running) loadStatus(data.commandId);
    });
    return () => { off?.(); };
  }, [setRunning, loadStatus]);

  return (
    <div className="h-full flex flex-col bg-[var(--color-drawer-panel)]">
      {/* Header */}
      <div className="flex items-center gap-2 h-9 px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-text-secondary">运行</span>
        <div className="flex-1" />
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-accent hover:bg-surface-hover transition-colors"
          onClick={async () => {
            setDetectSpinning(true);
            await detect(projectPath);
            setTimeout(() => setDetectSpinning(false), 600);
          }}
          title="刷新检测"
        >
          <svg className={`w-3.5 h-3.5 ${detectSpinning ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>
      </div>

      {/* 命令列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {runnables.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[11px] text-text-muted text-center px-4">
            未检测到启动配置<br />Mint 开发完会生成 .easymint/run.json
          </div>
        ) : (
          <div className="space-y-1.5">
            {runnables.map((r) => {
              const st = cmdStates[r.id] || { running: false, logs: [] };
              const ps = portStatuses[r.id];
              const port = extractPort(r.url);
              const portBusy = ps && !ps.free;
              const canStart = !st.running && !portBusy;
              return (
                <div key={r.id} className={`rounded-lg border px-2.5 py-2 transition-colors ${st.running ? "border-success-border bg-success-soft" : "border-border"}`}>
                  {/* 第一行：标题（hover 滚动完整显示，点击编辑脚本）+ 运行状态 */}
                  <div className="flex items-center gap-1.5">
                    <TitleMarquee text={r.label} onClick={() => setEditing({ r, runnables })} />
                    {st.running && (
                      <span className="text-[9px] text-success flex items-center gap-1 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                        PID {st.pid}
                      </span>
                    )}
                  </div>
                  {/* 第二行：平台标签（按命令首词推断）+ URL（命令不再显示，编辑弹窗中查看） */}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 ${platformColor(inferPlatform(r.run_command, r.platform))}`}>[{platformLabel(inferPlatform(r.run_command, r.platform))}]</span>
                    {st.running && r.url ? (
                      <span className="text-[9px] text-accent font-mono truncate">{r.url}</span>
                    ) : (
                      <span className="text-[10px] text-text-muted font-mono truncate">{r.run_command}</span>
                    )}
                  </div>
                  {/* 端口状态 */}
                  {port && (
                    <div className="relative mt-1 flex items-center gap-1.5 text-[10px] flex-wrap">
                      <input
                        className="w-14 text-[10px] px-1 py-0.5 rounded border border-border bg-surface text-text-primary font-mono text-center"
                        value={customPorts[r.id] !== undefined ? customPorts[r.id] : String(port)}
                        onChange={function(e) {
                          const val = e.target.value.replace(/\D/g, "");
                          setCustomPorts(function(prev) {
                            const next: Record<string, string> = {};
                            for (const k in prev) next[k] = prev[k]!;
                            next[r.id] = val;
                            return next;
                          });
                          const newPort = parseInt(val);
                          if (newPort && newPort > 0) checkPortStatus(r.id, "http://localhost:" + newPort);
                        }}
                      />
                      <span className="text-text-muted">·</span>
                      {ps ? (ps.free
                        ? <span className="text-success">空闲</span>
                        : <>
                            <span className="text-danger">占用</span>
                            <span
                              data-port-toggle
                              className="text-danger underline cursor-pointer select-none"
                              onClick={function(e) { e.stopPropagation();
                                setShowDetail(function(prev) {
                                  const next: Record<string, boolean> = {};
                                  for (const k in prev) next[k] = prev[k]!;
                                  next[r.id] = !prev[r.id];
                                  return next;
                                });
                              }}
                            >详情</span>
                            {showDetail[r.id] && (
                              <span data-port-detail className="absolute top-full mt-1 text-[9px] text-text-primary bg-surface border border-border rounded-md px-2 py-1 shadow-lg z-10"
                                style={{ maxWidth: "200px", wordBreak: "break-all", lineHeight: "1.4" }}>
                                {ps.name || "PID " + ps.pid} (PID {ps.pid})
                              </span>
                            )}
                            <button
                              className="text-[9px] px-1.5 py-0.5 rounded bg-danger-soft text-danger hover:bg-danger-bg active:scale-95 transition-all duration-100"
                              onClick={function() { handleKillPort(r.id, r.url); }}
                            >释放</button>
                          </>
                      ) : <span className="text-text-muted">检测中</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-1 mt-1.5">
                    {st.running ? (
                      <>
                        <button
                          className="flex-1 px-2 py-1 rounded bg-danger-soft text-danger text-[10px] font-medium hover:bg-danger-bg transition-colors"
                          onClick={() => stop(r.id)}
                        >停止</button>
                        <button
                          className="w-6 h-6 flex items-center justify-center rounded border border-border text-text-secondary hover:text-accent hover:border-accent-border-strong transition-colors shrink-0"
                          onClick={() => restart(projectPath, r.id)}
                          title="重启"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        </button>
                        <button
                          className="w-6 h-6 flex items-center justify-center rounded border border-border text-text-secondary hover:text-accent hover:border-accent-border-strong transition-colors shrink-0"
                          onClick={() => openLog(r.id)}
                          title="查看日志"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                        {r.url && (
                          <button
                            className="w-6 h-6 flex items-center justify-center rounded border border-border text-text-secondary hover:text-accent hover:border-accent-border-strong transition-colors shrink-0"
                            onClick={() => window.open(r.url, "_blank")}
                            title={`打开 ${r.url}`}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          </button>
                        )}
                      </>
                    ) : confirmDeleteId === r.id ? (
                      <div className="flex-1 flex items-center gap-1">
                        <span className="flex-1 text-center text-[10px] text-danger">删除脚本？</span>
                        <button
                          className="shrink-0 px-2 py-1 rounded bg-danger-soft text-danger text-[10px] font-medium hover:bg-danger-bg transition-colors"
                          onClick={() => { void handleDelete(r); }}
                          disabled={saving}
                        >删除</button>
                        <button
                          className="w-7 h-7 flex items-center justify-center rounded border border-border text-text-secondary hover:text-text-primary transition-colors shrink-0"
                          onClick={() => setConfirmDeleteId(null)}
                          title="取消"
                        >✕</button>
                      </div>
                    ) : (
                      <>
                        <button
                          className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${canStart ? "bg-accent-soft text-accent hover:bg-accent-bg" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}
                          onClick={() => {
                            const cp = customPorts[r.id];
                            const p = cp ? parseInt(cp) : undefined;
                            canStart && start(projectPath, r.id, p);
                          }}
                          disabled={!canStart}
                          title={portBusy ? "端口被占用，请先释放或更换端口" : ""}
                        >运行</button>
                        <button
                          className="w-9 py-1 rounded border border-border text-text-secondary hover:text-danger hover:border-danger/40 transition-colors shrink-0 flex items-center justify-center"
                          onClick={() => setConfirmDeleteId(r.id)}
                          title="删除脚本"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4h12M6 4V2h4v2M4 4l.7 10h6.6L12 4M6.5 7v4M9.5 7v4"/></svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 日志浮窗 */}
      {activeLogId && <LogOverlay commandId={activeLogId} />}
      {/* 脚本编辑弹窗（点击卡片标题打开；保存后 run.json watcher 自动刷新面板） */}
      {editing && (
        <ScriptEditDialog
          projectPath={projectPath}
          runnable={editing.r}
          runnables={editing.runnables}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
