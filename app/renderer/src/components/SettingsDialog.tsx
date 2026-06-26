import { useEffect, useState, useCallback } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { ProviderSettings } from "./settings/ProviderSettings";

export type SettingsTab = "general" | "plugins" | "providers" | "about";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

// ── Git Check Section ─────────────────────────────────────────────────────────

function useDetect(cmd: "git" | "nodeRuntime" | "codegraph") {
  const [info, setInfo] = useState<{ found: boolean; version?: string } | null>(null);
  useEffect(() => {
    window.electronAPI?.[cmd]?.detect().then(setInfo).catch(() => setInfo({ found: false }));
  }, [cmd]);
  return info;
}

function EnvRow({ label, info, installUrl }: {
  label: string;
  info: { found: boolean; version?: string } | null;
  installUrl?: string;
}) {
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

function CodegraphRow({ info }: { info: { found: boolean; version?: string } | null }) {
  const cmd = "curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh";
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-2 mt-1">
        <span className="text-sm text-text-primary">CodeGraph</span>
        {info === null ? (
          <span className="text-xs text-text-muted">检测中...</span>
        ) : info.found ? (
          <span className="text-xs text-text-secondary">{info.version}</span>
        ) : (
          <span className="text-xs text-danger">未安装</span>
        )}
      </div>
      {info && !info.found && (
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1">
            <code className="text-[10px] text-text-secondary bg-surface px-2 py-0.5 rounded select-all">{cmd}</code>
            <button
              className="shrink-0 px-1.5 py-0.5 rounded text-[10px] text-text-secondary hover:text-accent hover:bg-surface-hover transition-colors"
              onClick={handleCopy}
            >
              {copied ? "已复制" : "复制"}
            </button>
          </div>
          <span className="text-[10px] text-text-muted">
            https://github.com/colbymchenry/codegraph
          </span>
        </div>
      )}
    </div>
  );
}

function EnvCheckSection(): JSX.Element {
  const gitInfo = useDetect("git");
  const nodeInfo = useDetect("nodeRuntime");
  const codegraphInfo = useDetect("codegraph");

  return (
    <section>
      <h3 className="text-sm font-medium text-text-secondary mb-2">环境检测</h3>
      <div className="bg-surface-alt rounded-lg border border-border px-4 py-3 space-y-3">
        <EnvRow label="Git" info={gitInfo} installUrl="https://git-scm.com/downloads" />
        <EnvRow label="Node.js" info={nodeInfo} installUrl="https://nodejs.org/" />
        <CodegraphRow info={codegraphInfo} />
      </div>
    </section>
  );
}

// ── Cache Management Section ──────────────────────────────────────────────────

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CacheManagementSection(): JSX.Element {
  const [clearing, setClearing] = useState(false);
  const [updateSize, setUpdateSize] = useState<number | null>(null);
  const [uploadSize, setUploadSize] = useState<number | null>(null);

  const scan = () => {
    window.electronAPI?.app?.updateCacheSize?.().then(setUpdateSize).catch(() => {});
    window.electronAPI?.upload?.stats?.().then((s) => setUploadSize(s.totalSize)).catch(() => {});
  };
  useEffect(() => { scan(); }, []);

  const handleClear = async () => {
    setClearing(true);
    await window.electronAPI?.app?.clearUpdateCache?.();
    await scan();
    setClearing(false);
  };

  return (
    <section>
      <h3 className="text-sm font-medium text-text-secondary mb-2">缓存管理</h3>
      <div className="bg-surface-alt rounded-lg border border-border divide-y divide-border">

        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h4 className="text-xs font-medium text-text-primary">安装包缓存</h4>
            {updateSize === null ? (
              <p className="text-[11px] text-text-muted">扫描中...</p>
            ) : updateSize > 0 ? (
              <p className="text-[11px] text-text-secondary">{formatMB(updateSize)}</p>
            ) : (
              <p className="text-[11px] text-text-muted">暂无缓存</p>
            )}
          </div>
          {updateSize !== null && updateSize > 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:border-accent/50 transition-colors"
                onClick={handleClear}
                disabled={clearing}
              >
                {clearing ? "清除中..." : "清除缓存"}
              </button>
              <button
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:border-accent/50 transition-colors"
                onClick={() => window.electronAPI?.app?.openUpdateCache?.()}
              >
                文件夹
              </button>
            </div>
          )}
        </div>

        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h4 className="text-xs font-medium text-text-primary">上传缓存</h4>
            {uploadSize === null ? (
              <p className="text-[11px] text-text-muted">扫描中...</p>
            ) : uploadSize > 0 ? (
              <p className="text-[11px] text-text-secondary">{formatMB(uploadSize)}</p>
            ) : (
              <p className="text-[11px] text-text-muted">暂无缓存</p>
            )}
          </div>
          {uploadSize !== null && uploadSize > 0 && (
            <button
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:border-accent/50 transition-colors"
              onClick={() => window.electronAPI?.upload?.openDir?.()}
            >
              打开文件夹
            </button>
          )}
        </div>

      </div>
    </section>
  );
}

// ── Skills Tab ───────────────────────────────────────────────────────────────

function SkillRow({ s, onToggle }: { s: { name: string; description: string; path: string; enabled: boolean }; onToggle: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`px-3 py-2 transition-colors cursor-default ${s.enabled ? "hover:bg-surface-hover" : "opacity-60"}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-primary truncate">{s.name}</span>
        <button
          onClick={onToggle}
          className={`relative w-8 h-4 rounded-full transition-colors overflow-hidden shrink-0 ml-2 ${s.enabled ? "bg-accent" : "bg-surface-hover border border-border"}`}
          role="switch"
          aria-checked={s.enabled}
        >
          <span
            className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-surface-elevated shadow transition-all ${s.enabled ? "left-[calc(100%-14px)]" : "left-0.5"}`}
          />
        </button>
      </div>
      {expanded && (
        <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">{s.description}</p>
      )}
    </div>
  );
}

function SkillsTab(): JSX.Element {
  const [skills, setSkills] = useState<{ name: string; description: string; path: string; level: "builtin" | "global" | "project"; enabled: boolean }[]>([]);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<"builtin" | "global">("builtin");

  const load = () => {
    window.electronAPI.skill.list(undefined).then(setSkills).catch((e: unknown) => setLoadError(String(e)));
  };
  useEffect(load, []);

  const handleToggle = async (name: string, enabled: boolean) => {
    await window.electronAPI.skill.toggle(name, enabled);
    setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
  };

  const builtinSkills = skills.filter((s) => s.level === "builtin");
  const globalSkills = skills.filter((s) => s.level === "global");
  const projectSkills = skills.filter((s) => s.level === "project");
  const visibleSkills = tab === "builtin" ? builtinSkills : globalSkills;

  return (
    <div className="px-6 py-4 overflow-y-auto space-y-4">
      {loadError && <p className="text-danger text-xs">{loadError}</p>}

      <div>
        <p className="text-sm font-medium text-text-primary">Skills</p>
        <p className="text-[11px] text-text-secondary mt-0.5">
          内置 Skill 仅 EasyMint 可用；通用 Skill 与 Claude Code 共用
        </p>
      </div>

      {/* Tab buttons — pill style */}
      <div className="inline-flex rounded-lg border border-border overflow-hidden">
        {(["builtin", "global"] as const).map((t, i) => (
          <button
            key={t}
            className={`px-4 py-1.5 text-xs font-medium transition-colors ${
              i > 0 ? "border-l border-border" : ""
            } ${
              tab === t ? "bg-[color-mix(in_oklab,var(--color-accent)_15%,transparent)] text-accent" : "text-text-secondary hover:bg-surface-hover"
            }`}
            onClick={() => setTab(t)}
          >
            {t === "builtin" ? "内置" : "通用"}
          </button>
        ))}
      </div>

      {/* Skill list */}
      <div className="bg-surface-alt rounded-lg border border-border overflow-hidden max-h-[220px] overflow-y-auto divide-y divide-border/50">
        {visibleSkills.length > 0 ? (
          visibleSkills.map((s) => (
            <SkillRow key={s.path} s={s} onToggle={() => handleToggle(s.name, !s.enabled)} />
          ))
        ) : (
          <p className="text-text-muted text-xs text-center py-6">
            {tab === "builtin" ? "暂无内置 Skill" : "暂无通用 Skill"}
          </p>
        )}
      </div>

      {/* Project skills */}
      {projectSkills.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-2">项目级</h4>
          <div className="bg-surface-alt rounded-lg border border-border overflow-hidden max-h-[220px] overflow-y-auto divide-y divide-border/50">
            {projectSkills.map((s) => (
              <SkillRow key={s.path} s={s} onToggle={() => handleToggle(s.name, !s.enabled)} />
            ))}
          </div>
        </div>
      )}

      {skills.length === 0 && (
        <p className="text-text-secondary text-xs text-center py-8">
          暂无 Skill。将 skill 放入 ~/.claude/skills/ 目录即可自动识别。
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

function McpRow({ s, onToggle, requiredKeys, apiKeys, typeLabel }: {
  s: { name: string; type: string; command?: string; args?: string[]; url?: string; enabled: boolean };
  onToggle: () => void;
  requiredKeys: Record<string, string>;
  apiKeys: Record<string, string>;
  typeLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`px-3 py-2 transition-colors cursor-default ${s.enabled ? "hover:bg-surface-hover" : "opacity-60"}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-xs text-text-primary truncate">{s.name}</span>
          <span className="text-[9px] px-1 py-0.5 rounded bg-surface text-text-muted shrink-0">{typeLabel}</span>
          {Object.entries(requiredKeys).map(([k, v]) => (
            <span key={k} className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${v || apiKeys[k] ? "bg-accent/10 text-accent" : "bg-warning/10 text-warning"}`}>
              {k}
            </span>
          ))}
        </div>
        <button
          onClick={onToggle}
          className={`relative w-8 h-4 rounded-full transition-colors overflow-hidden shrink-0 ml-2 ${s.enabled ? "bg-accent" : "bg-surface-hover border border-border"}`}
          role="switch"
          aria-checked={s.enabled}
        >
          <span
            className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-surface-elevated shadow transition-all ${s.enabled ? "left-[calc(100%-14px)]" : "left-0.5"}`}
          />
        </button>
      </div>
      {expanded && (
        <p className="text-[10px] text-text-secondary mt-1 truncate">
          {s.type === "http" ? s.url : [s.command, ...(s.args || [])].join(" ")}
        </p>
      )}
    </div>
  );
}

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
          <div className="bg-surface-alt rounded-lg border border-border overflow-hidden max-h-[220px] overflow-y-auto divide-y divide-border/50">
            {servers.map((s) => (
              <McpRow key={s.name} s={s} onToggle={() => handleToggle(s.name, !s.enabled)}
                requiredKeys={requiredKeys[s.name] || {}} apiKeys={apiKeys} typeLabel={typeLabel(s.type)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function SettingsDialog({ open, onClose, initialTab }: SettingsDialogProps): JSX.Element | null {
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
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || "general");
  const [appVersion, setAppVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<{ status: string; version?: string; percent?: number; transferred?: number; totalSize?: number }>({ status: "idle" });
  const [checking, setChecking] = useState(false);

  // 外部指定 initialTab 时同步（如 LeftToolbar 点「有新版本」→ 跳到关于页）
  useEffect(() => { if (initialTab) setActiveTab(initialTab); }, [initialTab]);

  useEffect(() => {
    if (!open) return;
    loadFromElectron();
    // 拉取版本号 + 同步已下载状态
    window.electronAPI?.app?.getVersion?.().then((v) => setAppVersion(v)).catch(() => {});
    window.electronAPI?.app?.hasUpdate?.().then(({ hasUpdate, version }) => {
      if (hasUpdate && version) setUpdateStatus({ status: "downloaded", version });
    }).catch(() => {});
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loadFromElectron, onClose]);

  // 监听更新状态广播
  useEffect(() => {
    if (!open) return;
    const off = window.electronAPI?.app?.onUpdateStatus?.((data) => {
      setUpdateStatus(data);
      setChecking(data.status === "checking");
    });
    return () => { off?.(); };
  }, [open]);

  const handleCheckUpdate = () => {
    setChecking(true);
    window.electronAPI?.app?.checkUpdate?.().catch(() => setChecking(false));
  };

  const handleInstallUpdate = () => {
    window.electronAPI?.app?.installUpdate?.();
  };

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
                <h3 className="text-sm font-medium text-text-secondary mb-2">上下文压缩阈值</h3>
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
                  <p className="text-[11px] text-text-secondary mt-1">达到阈值时优先原地压缩（同会话无感），压缩 3 次后自动开启新会话。建议 65%。</p>
                </div>
              </section>

              {/* 更新缓存 */}
              <CacheManagementSection />

              {/* 环境检测 */}
              <EnvCheckSection />
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
              <img src="./icon.png" className="w-20 h-20 mb-2" />
              <div className="text-center">
                <h2 className="text-2xl font-bold text-text-primary">EasyMint</h2>
                <p className="text-sm text-text-secondary mt-1">AI 驱动开发，简单的操作让想法变为现实</p>
              </div>

              {/* 版本号 + 更新检测 */}
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-text-primary font-medium">v{appVersion || "..."}</span>
                  <button
                    type="button"
                    className="w-5 h-5 flex items-center justify-center text-text-secondary hover:text-accent transition-colors"
                    onClick={handleCheckUpdate}
                    disabled={checking}
                    title="检查更新"
                  >
                    <svg className={`w-4 h-4 ${checking ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                    </svg>
                  </button>
                </div>

                {/* 更新状态文案 */}
                {updateStatus.status === "checking" && (
                  <span className="text-xs text-text-secondary">正在检查更新...</span>
                )}
                {updateStatus.status === "available" && (
                  <span className="text-xs text-accent">发现新版本 v{updateStatus.version}，准备下载...</span>
                )}
                {updateStatus.status === "downloading" && (
                  <div className="flex flex-col items-center gap-1 w-56">
                    <span className="text-xs text-accent whitespace-nowrap">
                      正在下载 v{updateStatus.version}... {updateStatus.percent ?? 0}%
                      {updateStatus.transferred != null && updateStatus.totalSize
                        ? `（${formatMB(updateStatus.transferred)} / ${formatMB(updateStatus.totalSize)}）`
                        : ""}
                    </span>
                    <div className="w-full h-1 rounded-full bg-surface-hover overflow-hidden">
                      <div className="h-full bg-accent transition-all" style={{ width: `${updateStatus.percent ?? 0}%` }} />
                    </div>
                  </div>
                )}
                {updateStatus.status === "downloaded" && (
                  <button
                    type="button"
                    className="px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors"
                    onClick={handleInstallUpdate}
                  >
                    重启并更新到 v{updateStatus.version}
                  </button>
                )}
                {updateStatus.status === "no-update" && (
                  <span className="text-xs text-text-muted">当前已是最新版本</span>
                )}
                {updateStatus.status === "error" && (
                  <span className="text-xs text-text-muted">检查更新失败，请稍后再试</span>
                )}
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
