import { useEffect, useState } from "react";

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
            <span key={k} className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${v || apiKeys[k] ? "bg-accent-bg text-accent" : "bg-warning/10 text-warning"}`}>
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

/** 插件设置:Skills + MCP */
export function PluginsTab(): JSX.Element {
  return (
    <div className="space-y-5">
      <SkillsTab />
      <hr className="border-border" />
      <McpTab />
    </div>
  );
}
