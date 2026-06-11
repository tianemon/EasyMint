import { useEffect, useState, useCallback } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { PromptSettings } from "./settings/PromptSettings";
import { ProviderSettings } from "./settings/ProviderSettings";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

// ── Git Check Section ─────────────────────────────────────────────────────────

function useDetect(cmd: "git" | "nodeRuntime" | "npx" | "codegraph") {
  const [info, setInfo] = useState<{ found: boolean; version?: string } | null>(null);
  useEffect(() => {
    window.electronAPI?.[cmd]?.detect().then(setInfo).catch(() => setInfo({ found: false }));
  }, [cmd]);
  return info;
}

function EnvRow({ label, info, installUrl }: { label: string; info: { found: boolean; version?: string } | null; installUrl?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-primary">{label}</span>
        {info === null ? (
          <span className="text-xs text-text-muted">检测中...</span>
        ) : info.found ? (
          <span className="text-xs text-text-secondary">{info.version}</span>
        ) : (
          <span className="text-xs text-danger">未安装</span>
        )}
      </div>
      {info && !info.found && installUrl && (
        <a
          href={installUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-lg bg-accent text-text-inverse text-xs font-medium hover:bg-accent-hover transition-colors"
        >
          点击安装 {label}
        </a>
      )}
    </div>
  );
}

function EnvCheckSection(): JSX.Element {
  const gitInfo = useDetect("git");
  const nodeInfo = useDetect("nodeRuntime");
  const npxInfo = useDetect("npx");
  const codegraphInfo = useDetect("codegraph");

  return (
    <section>
      <h3 className="text-sm font-medium text-text-secondary mb-2">环境检测</h3>
      <div className="bg-surface-alt rounded-lg border border-border px-4 py-3 space-y-3">
        <EnvRow label="Git" info={gitInfo} installUrl="https://git-scm.com/downloads" />
        <EnvRow label="Node.js" info={nodeInfo} installUrl="https://nodejs.org/" />
        <EnvRow label="Playwright (npx)" info={npxInfo}
          installUrl="https://nodejs.org/" />
        <EnvRow label="CodeGraph" info={codegraphInfo}
          installUrl="https://github.com/tianemon/CodeGraph?tab=readme-ov-file#%E5%AE%89%E8%A3%85" />
      </div>
    </section>
  );
}

// ── Upload Cache Section ─────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function UploadCacheSection(): JSX.Element | null {
  const [stats, setStats] = useState<{ totalSize: number; fileCount: number; files: { name: string; size: number; created: number; isImage: boolean }[] } | null>(null);
  const [sortBy, setSortBy] = useState<"time" | "size">("time");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);

  const load = useCallback(async () => {
    try { setStats(await window.electronAPI.upload.stats(sortBy)); } catch { /* */ }
  }, [sortBy]);
  useEffect(() => { load(); }, [load]);

  const handleCleanSelected = async () => {
    if (selected.size === 0) return;
    setCleaning(true);
    await window.electronAPI.upload.clean([...selected]);
    setSelected(new Set());
    await load();
    setCleaning(false);
  };

  const handleCleanAll = async () => {
    if (!confirm(`确定删除全部 ${stats?.fileCount || 0} 个上传文件（${formatBytes(stats?.totalSize || 0)}）？`)) return;
    setCleaning(true);
    await window.electronAPI.upload.cleanAll();
    setSelected(new Set());
    await load();
    setCleaning(false);
  };

  const toggleSelect = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name); else next.add(name);
    setSelected(next);
  };

  const selectAll = () => {
    if (stats && selected.size === stats.files.length) setSelected(new Set());
    else if (stats) setSelected(new Set(stats.files.map((f) => f.name)));
  };

  if (!stats || stats.fileCount === 0) return null;

  return (
    <section>
      <h3 className="text-sm font-medium text-text-secondary mb-2">上传缓存</h3>
      <div className="bg-surface-alt rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <span className="text-xs text-text-secondary">总 {formatBytes(stats.totalSize)} · {stats.fileCount} 个文件</span>
          <div className="flex gap-2">
            <button className="text-[11px] text-text-secondary hover:text-accent transition-colors" onClick={() => setSortBy(sortBy === "time" ? "size" : "time")}>
              {sortBy === "time" ? "按时间 ↓" : "按大小 ↓"}
            </button>
            <button className="text-[11px] text-text-secondary hover:text-accent transition-colors" onClick={selectAll}>
              {stats && selected.size === stats.files.length ? "取消全选" : "全选"}
            </button>
            <button className="text-[11px] text-danger hover:text-danger/80 transition-colors disabled:opacity-40" disabled={selected.size === 0} onClick={handleCleanSelected}>
              清理选中
            </button>
            <button className="text-[11px] text-danger hover:text-danger/80 transition-colors" onClick={handleCleanAll}>清理全部</button>
          </div>
        </div>
        <div className="max-h-[160px] overflow-y-auto">
          {stats.files.map((f) => (
            <div key={f.name} className={`flex items-center gap-2 px-4 py-1.5 border-b border-border/50 last:border-0 cursor-pointer hover:bg-surface-hover transition-colors text-xs ${selected.has(f.name) ? "bg-accent/5" : ""}`}
              onClick={() => toggleSelect(f.name)}>
              <input type="checkbox" checked={selected.has(f.name)} readOnly className="w-3 h-3 rounded accent-accent shrink-0" />
              <span className="flex-1 text-text-primary truncate">{f.name}</span>
              <span className="text-text-secondary shrink-0 w-16 text-right">{formatBytes(f.size)}</span>
              <span className="text-text-secondary shrink-0 w-20 text-right">{new Date(f.created).toLocaleDateString("zh-CN")}</span>
            </div>
          ))}
        </div>
      </div>
      {cleaning && <p className="text-text-secondary text-[11px] mt-1">清理中...</p>}
    </section>
  );
}

// ── Skills Tab ───────────────────────────────────────────────────────────────

function SkillsTab(): JSX.Element {
  const [skills, setSkills] = useState<{ name: string; description: string; path: string; level: "global" | "project"; enabled: boolean }[]>([]);
  const [loadError, setLoadError] = useState("");

  const load = () => {
    window.electronAPI.skill.list(undefined).then(setSkills).catch((e: unknown) => setLoadError(String(e)));
  };
  useEffect(load, []);

  const handleHide = async (skillPath: string, skillName: string) => {
    await window.electronAPI.skill.delete(skillPath);
    setSkills((prev) => prev.filter((s) => s.name !== skillName));
  };

  const handleToggle = async (name: string, enabled: boolean) => {
    await window.electronAPI.skill.toggle(name, enabled);
    setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
  };

  const globalSkills = skills.filter((s) => s.level === "global");
  const projectSkills = skills.filter((s) => s.level === "project");

  return (
    <div className="px-6 py-4 overflow-y-auto space-y-4">
      {loadError && <p className="text-danger text-xs">{loadError}</p>}

      <p className="text-sm font-medium text-text-primary">Skills</p>
      <p className="text-[11px] text-text-secondary -mt-3">
        与 Claude Code 共用 ~/.claude/skills/ 和项目级 .claude/skills/ 目录
      </p>

      {/* Global skills */}
      {globalSkills.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-2">全局</h4>
          <div className="space-y-1">
            {globalSkills.map((s) => (
              <div key={s.path} className={`p-3 rounded-lg border transition-colors ${s.enabled ? "border-border" : "border-border/50 opacity-60"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-text-primary">{s.name}</span>
                    <p className="text-xs text-text-secondary mt-0.5 truncate">{s.description}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <button
                      onClick={() => handleToggle(s.name, !s.enabled)}
                      className={`relative w-9 h-5 rounded-full transition-colors overflow-hidden ${s.enabled ? "bg-accent" : "bg-surface-hover border border-border"}`}
                      role="switch"
                      aria-checked={s.enabled}
                    >
                      <span
                        className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-surface-elevated shadow transition-all ${s.enabled ? "left-[calc(100%-18px)]" : "left-0.5"}`}
                      />
                    </button>
                    <button
                      className="text-xs text-text-secondary hover:text-danger transition-colors"
                      onClick={() => handleHide(s.path, s.name)}
                    >
                      隐藏
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Project skills */}
      {projectSkills.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-2">项目级</h4>
          <div className="space-y-1">
            {projectSkills.map((s) => (
              <div key={s.path} className={`p-3 rounded-lg border transition-colors ${s.enabled ? "border-border" : "border-border/50 opacity-60"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-text-primary">{s.name}</span>
                    <p className="text-xs text-text-secondary mt-0.5 truncate">{s.description}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <button
                      onClick={() => handleToggle(s.name, !s.enabled)}
                      className={`relative w-9 h-5 rounded-full transition-colors overflow-hidden ${s.enabled ? "bg-accent" : "bg-surface-hover border border-border"}`}
                      role="switch"
                      aria-checked={s.enabled}
                    >
                      <span
                        className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-surface-elevated shadow transition-all ${s.enabled ? "left-[calc(100%-18px)]" : "left-0.5"}`}
                      />
                    </button>
                    <button
                      className="text-xs text-text-secondary hover:text-danger transition-colors"
                      onClick={() => handleHide(s.path, s.name)}
                    >
                      隐藏
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {skills.length === 0 && (
        <p className="text-text-secondary text-xs text-center py-8">
          暂无 Skill。点击「导入 Skill」选择一个 skill 文件夹，或手动将 skill 放入 ~/.claude/skills/ 目录。
        </p>
      )}
    </div>
  );
}

// ── Built-in Tools Section (used in Providers tab) ─────────────────────────────

function BuiltinToolsSection(): JSX.Element {
  const [builtinTools, setBuiltinTools] = useState<Record<string, boolean>>({ vision: false, webFetch: false });
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await window.electronAPI.settings.get();
      setBuiltinTools(s.builtinTools ?? { vision: false, webFetch: false });
      setApiKeys(s.apiKeys ?? {});
    })();
  }, []);

  const handleToggle = async (name: string, on: boolean) => {
    const next = { ...builtinTools, [name]: on };
    setBuiltinTools(next);
    await window.electronAPI.settings.set("builtinTools", next);
  };

  const saveKey = async (key: string, value: string) => {
    const next = { ...apiKeys, [key]: value };
    setApiKeys(next);
    await window.electronAPI.settings.set("apiKeys", next);
  };

  return (
    <section>
      <h3 className="text-sm font-medium text-text-primary mb-2">模型能力增强</h3>
      <p className="text-[11px] text-text-secondary mb-3">
        对于非多模态模型，提供视觉识别和网页抓取能力。开启后自动注入到每次会话。
      </p>
      <div className="space-y-2">
        {([
          { key: "vision", label: "图片识别", desc: "使用 Qwen 视觉模型描述图片内容，让纯文本模型也能\"看懂\"图片", keyId: "VISION_API_KEY", keyHint: "获取: dashscope.aliyun.com" },
          { key: "webFetch", label: "网页抓取", desc: "读取网页实际内容，让模型能查阅在线文档和资料", keyId: "TAVILY_API_KEY", keyHint: "获取: tavily.com" },
        ] as const).map(({ key, label, desc, keyId, keyHint }) => {
          const on = builtinTools[key];
          return (
          <div key={key} className="bg-surface-alt rounded-lg px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0 mr-3">
                <div className="text-xs font-medium text-text-primary">{label}</div>
                <div className="text-[10px] text-text-muted mt-0.5">{desc}</div>
              </div>
              <button type="button" onClick={() => handleToggle(key, !on)}
                className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${on ? "bg-accent" : "bg-border"}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? "left-4" : "left-0.5"}`} />
              </button>
            </div>
            {on && (
              <div className="mt-2">
                <label className="text-[10px] text-text-secondary block mb-1">{keyId}</label>
                <div className="relative">
                  <input type={showKey ? "text" : "password"}
                    className="w-full px-2 py-1.5 pr-7 rounded bg-surface border border-border text-text-primary text-xs outline-none focus:border-accent"
                    defaultValue={apiKeys[keyId] || ""} placeholder="未设置"
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (apiKeys[keyId] || "")) saveKey(keyId, v); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  />
                  <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                    onClick={() => setShowKey(!showKey)}>
                    {showKey ? (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
                <div className="text-[10px] text-text-muted mt-1">{keyHint}</div>
              </div>
            )}
          </div>
          );
        })}
      </div>
    </section>
  );
}

// ── MCP Tab ───────────────────────────────────────────────────────────────────

function McpTab(): JSX.Element {
  const [servers, setServers] = useState<{ name: string; type: string; command?: string; args?: string[]; url?: string; enabled: boolean }[]>([]);
  const [requiredKeys, setRequiredKeys] = useState<Record<string, Record<string, string>>>({});
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [showKey, setShowKey] = useState(false);

  const load = async () => {
    try {
      const [s, keys, settings] = await Promise.all([
        window.electronAPI.mcp.list(),
        window.electronAPI.mcp.requiredKeys(),
        window.electronAPI.settings.get(),
      ]);
      setServers(s);
      setRequiredKeys(keys);
      setApiKeys(settings.apiKeys ?? {});
    } catch (e: unknown) {
      setLoadError(String(e));
    }
  };
  useEffect(() => { load(); }, []);

  const handleToggle = async (name: string, enabled: boolean) => {
    await window.electronAPI.mcp.toggle(name, enabled);
    setServers((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
  };

  const saveKey = async (key: string, value: string) => {
    const next = { ...apiKeys, [key]: value };
    setApiKeys(next);
    await window.electronAPI.settings.set("apiKeys", next);
  };

  const typeLabel = (t: string) => t === "stdio" ? "本地进程" : t === "http" ? "HTTP" : "SSE";

  // Collect all required keys across MCP servers, with their current values.
  // MCP config env (.claude.json) takes priority, then apiKeys from em-settings.json.
  const allKeys = new Map<string, string>(); // key → value
  for (const keyMap of Object.values(requiredKeys)) {
    for (const [k, v] of Object.entries(keyMap)) {
      if (!allKeys.has(k)) allKeys.set(k, v || apiKeys[k] || "");
    }
  }

  return (
    <div className="px-6 py-4 overflow-y-auto space-y-5">
      {loadError && <p className="text-danger text-xs">{loadError}</p>}

      {Array.from(allKeys.entries()).filter(([k]) => k !== "VISION_API_KEY" && k !== "TAVILY_API_KEY").length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-text-primary mb-2">API Keys</h3>
          <p className="text-[11px] text-text-secondary mb-3">
            MCP 工具所需的第三方服务密钥，会注入到对应 MCP 服务器的环境变量中。
          </p>
          <div className="bg-surface-alt rounded-lg px-4 py-3 space-y-2">
            {Array.from(allKeys.entries()).filter(([k]) => k !== "VISION_API_KEY" && k !== "TAVILY_API_KEY").map(([key, val]) => (
              <div key={key}>
                <label className="text-xs text-text-secondary block mb-1">{key}</label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    className="w-full px-2 py-1.5 pr-7 rounded bg-surface border border-border text-text-primary text-xs outline-none focus:border-accent"
                    defaultValue={val}
                    placeholder="未设置"
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== val) saveKey(key, v); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  />
                  <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                    onClick={() => setShowKey(!showKey)}>
                    {showKey ? (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* MCP Servers */}
      <section>
        <h3 className="text-sm font-medium text-text-primary mb-2">MCP</h3>
        <p className="text-[11px] text-text-secondary mb-3">
          与 Claude Code 共享配置。使用 `claude mcp add/remove` 管理服务器。
        </p>

        {servers.length === 0 ? (
          <p className="text-text-secondary text-xs text-center py-8">
            未检测到 MCP 服务器。在终端运行 `claude mcp add &lt;name&gt; &lt;command&gt;` 添加。
          </p>
        ) : (
          <div className="space-y-1">
            {servers.map((s) => (
              <div key={s.name} className={`p-3 rounded-lg border transition-colors ${s.enabled ? "border-border" : "border-border/50 opacity-60"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-primary">{s.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-alt text-text-secondary">{typeLabel(s.type)}</span>
                      {Object.entries(requiredKeys[s.name] || {}).map(([k, v]) => (
                        <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${v || apiKeys[k] ? "bg-accent/10 text-accent" : "bg-warning/10 text-warning"}`}>
                          {v || apiKeys[k] ? (
                            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5"><circle cx="4.5" cy="5" r="2.5"/><path d="M6.5 7l3 3M5.5 3v2"/></svg>
                          ) : (
                            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5"><path d="M6 2v4M6 8.5h0"/><circle cx="6" cy="6" r="4.5"/></svg>
                          )}
                          {k}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5 truncate">
                      {s.type === "http" ? s.url : [s.command, ...(s.args || [])].join(" ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <button
                      onClick={() => handleToggle(s.name, !s.enabled)}
                      className={`relative w-9 h-5 rounded-full transition-colors overflow-hidden ${s.enabled ? "bg-accent" : "bg-surface-hover border border-border"}`}
                      role="switch"
                      aria-checked={s.enabled}
                    >
                      <span
                        className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-surface-elevated shadow transition-all ${s.enabled ? "left-[calc(100%-18px)]" : "left-0.5"}`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Agent Templates Tab ──────────────────────────────────────────────────────

function AgentsTab(): JSX.Element {
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string; prompt: string; tools: string[]; model?: string; agentType: string }[]>([]);
  const [loadError, setLoadError] = useState("");

  const load = () => {
    window.electronAPI.agentTemplates.list().then(setTemplates).catch((e: unknown) => setLoadError(String(e)));
  };
  useEffect(load, []);

  const AGENT_TYPE_LABELS: Record<string, string> = {
    mint: "Mint（PM / 主对话）",
    builder: "Builder（开发者）",
    evaluator: "Evaluator（验收者）",
  };

  return (
    <div className="px-6 py-4 overflow-y-auto space-y-4">
      {loadError && <p className="text-danger text-xs">{loadError}</p>}

      <p className="text-[11px] text-text-secondary">
        Agent 模板由系统管理，启动时自动同步。如需修改 Builder/Evaluator 的行为，请编辑项目 CLAUDE.md。
      </p>

      {templates.length === 0 ? (
        <p className="text-text-secondary text-xs text-center py-4">暂无 Agent 模板</p>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="p-3 rounded-lg border border-border">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-text-primary">{t.name}</span>
                  <span className="text-xs text-text-secondary ml-2">{AGENT_TYPE_LABELS[t.agentType] || t.agentType}</span>
                </div>
              </div>
              <p className="text-xs text-text-secondary mt-0.5 truncate">{t.description}</p>
              <p className="text-[10px] text-text-muted mt-1 truncate">{t.tools.join(", ")}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps): JSX.Element | null {
  const {
    defaultProjectDir,
    contextThreshold,
    showThinking,
    showToolUse,
    setDefaultProjectDir,
    setContextThreshold,
    setShowThinking,
    setShowToolUse,
    loadFromElectron,
  } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<"general" | "agent" | "plugins" | "providers" | "about">("general");

  useEffect(() => {
    if (!open) return;
    loadFromElectron();
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loadFromElectron, onClose]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 modal-overlay">
      <div className="bg-surface rounded-2xl border border-border-light shadow-xl overflow-hidden modal-card flex flex-col" style={{ width: 800, height: 700 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-0 border-b border-border bg-surface-alt">
          <div className="flex gap-0">
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "general" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("general")}
            >
              通用
            </button>
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "providers" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("providers")}
            >
              模型
            </button>
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "plugins" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("plugins")}
            >
              插件
            </button>
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "agent" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("agent")}
            >
              Agent
            </button>

            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "about" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("about")}
            >
              关于
            </button>
          </div>
          <button
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors"
            onClick={handleClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 flex-1 overflow-y-auto">
          {activeTab === "general" ? (
            <div className="space-y-5">
              {/* 外观 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">外观</h3>
                <div className="bg-surface-alt rounded-lg border border-border px-4 py-3">
                  <p className="text-sm text-text-primary">主题</p>
                  <p className="text-xs text-text-secondary mt-0.5">亮色 Mint（仅亮色）</p>
                </div>
              </section>

              {/* 路径 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">默认项目路径</h3>
                <div className="bg-surface-alt rounded-lg border border-border px-4 py-3">
                  <input
                    className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
                    placeholder="~/EasyMintProject"
                    value={defaultProjectDir}
                    onChange={(e) => setDefaultProjectDir(e.target.value)}
                  />
                  <p className="text-[10px] text-text-secondary mt-0.5">新建项目时的默认父目录，workspace 会话也存放于此路径下</p>
                </div>
              </section>

              {/* 聊天 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">聊天</h3>
                <div className="bg-surface-alt rounded-lg border border-border px-4 py-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showThinking}
                      onChange={(e) => setShowThinking(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-accent"
                    />
                    <span className="text-xs text-text-primary">思考过程</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showToolUse}
                      onChange={(e) => setShowToolUse(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-accent"
                    />
                    <span className="text-xs text-text-primary">工具调用（Bash、Read、Edit、Task 等）</span>
                  </div>
                </div>
              </section>

              {/* Context threshold */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">上下文轮转阈值</h3>
                <div className="bg-surface-alt rounded-lg border border-border px-4 py-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="40"
                      max="85"
                      step="5"
                      value={contextThreshold}
                      onChange={(e) => setContextThreshold(Number(e.target.value))}
                      className="flex-1 accent-accent"
                    />
                    <span className="text-sm text-text-primary font-medium w-10 text-right">{contextThreshold}%</span>
                  </div>
                  <p className="text-[11px] text-text-secondary mt-1">当上下文使用达到此百分比时，自动总结对话并切换到新会话继续工作。</p>
                </div>
              </section>

              {/* Upload cache */}
              <UploadCacheSection />

              {/* 环境检测 */}
              <EnvCheckSection />
            </div>
          ) : activeTab === "agent" ? (
            <div className="space-y-5">
              <PromptSettings />
              <AgentsTab />
            </div>
          ) : activeTab === "plugins" ? (
            <div className="space-y-5">
              <SkillsTab />
              <hr className="border-border" />
              <McpTab />
            </div>
          ) : activeTab === "providers" ? (
            <div className="space-y-5">
              <ProviderSettings />
              <BuiltinToolsSection />
            </div>
          ) : activeTab === "about" ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-6">
              <img src="/icon.png" className="w-20 h-20 mb-2" />
              <div className="text-center">
                <h2 className="text-2xl font-bold text-text-primary">EasyMint</h2>
                <p className="text-sm text-text-secondary mt-1">AI 驱动开发，简单的操作让想法变为现实</p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-text-secondary">开源项目地址</span>
                <a
                  href="https://github.com/tianemon/EasyMint"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  github.com/tianemon/EasyMint
                </a>
              </div>
              <div className="text-xs text-text-muted space-x-4">
                <span>v0.1.0</span>
                <span>Electron · React · TypeScript</span>
                <span>claude-agent-sdk</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-2 border-t border-border bg-surface-alt">
          <button
            className="px-5 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors text-sm"
            onClick={handleClose}
          >
            取消
          </button>
          <button
            className="px-5 py-1.5 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors text-sm font-medium"
            onClick={handleClose}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
