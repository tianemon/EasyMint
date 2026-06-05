import { useEffect, useState, useCallback } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { PromptSettings } from "./settings/PromptSettings";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface ToggleRowProps {
  label: string;
  description: string;
  hint: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, description, hint, enabled, onChange }: ToggleRowProps): JSX.Element {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 mr-4">
        <p className="text-sm text-text-primary">{label}</p>
        <p className="text-xs text-text-secondary mt-0.5">{description}</p>
        <p className="text-[11px] text-text-secondary mt-0.5 opacity-70">{hint}</p>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 overflow-hidden ${
          enabled ? "bg-accent" : "bg-surface-hover border border-border"
        }`}
        role="switch"
        aria-checked={enabled}
      >
        <span
          className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-surface-elevated shadow transition-all ${
            enabled ? "left-[calc(100%-22px)]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function StarRating({ count }: { count: number }): JSX.Element {
  return (
    <span className="text-warning text-xs">
      {count}
    </span>
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

const TOKEN_ROWS = [
  { label: "普通开发", stars: 1, desc: "仅 Worker agent 消耗" },
  { label: "评估模式", stars: 2, desc: "Worker + Evaluator（Playwright 自动化）" },
  { label: "TDD 模式", stars: 2, desc: "测试先行，每轮额外生成测试代码" },
  { label: "截图验证", stars: 3, desc: "image-vision 每次截图分析，Token 消耗高" },
  { label: "全开（评估+TDD+截图）", stars: 4, desc: "所有验证机制全部开启，消耗最高" },
];

// ── Skills Tab ───────────────────────────────────────────────────────────────

function SkillsTab(): JSX.Element {
  const [skills, setSkills] = useState<{ name: string; description: string; path: string; level: "global" | "project"; enabled: boolean }[]>([]);
  const [loadError, setLoadError] = useState("");

  const load = () => {
    window.electronAPI.skill.list(undefined).then(setSkills).catch((e: unknown) => setLoadError(String(e)));
  };
  useEffect(load, []);

  const handleImport = async () => {
    try {
      const dir = await window.electronAPI.dialog.openDirectory();
      if (!dir) return;
      await window.electronAPI.skill.import(dir, "global");
      load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "导入失败");
    }
  };

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

      {/* Import button */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-text-primary">Skill 管理</p>
        <button
          className="px-3 py-1 rounded-lg bg-accent text-text-inverse text-xs font-medium hover:bg-accent-hover transition-colors"
          onClick={handleImport}
        >
          导入 Skill
        </button>
      </div>
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

// ── MCP Tab ───────────────────────────────────────────────────────────────────

function McpTab(): JSX.Element {
  const [servers, setServers] = useState<{ name: string; type: string; command?: string; args?: string[]; url?: string; enabled: boolean }[]>([]);
  const [requiredKeys, setRequiredKeys] = useState<Record<string, Record<string, string>>>({});
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [showKey, setShowKey] = useState(false);

  const load = async () => {
    try {
      const [s, keys] = await Promise.all([
        window.electronAPI.mcp.list(),
        window.electronAPI.mcp.requiredKeys(),
      ]);
      setServers(s);
      setRequiredKeys(keys);
      const settings = await window.electronAPI.settings.get();
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

      {/* API Keys */}
      {allKeys.size > 0 && (
        <section>
          <h3 className="text-sm font-medium text-text-primary mb-2">API Keys</h3>
          <p className="text-[11px] text-text-secondary mb-3">
            MCP 工具所需的第三方服务密钥，会注入到对应 MCP 服务器的环境变量中。
          </p>
          <div className="bg-surface-alt rounded-lg px-4 py-3 space-y-2">
            {Array.from(allKeys.entries()).map(([key, val]) => (
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
        <h3 className="text-sm font-medium text-text-primary mb-2">服务器</h3>
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", prompt: "", tools: "", model: "", agentType: "builder" as string });
  const [loadError, setLoadError] = useState("");

  const load = () => {
    window.electronAPI.agentTemplates.list().then(setTemplates).catch((e: unknown) => setLoadError(String(e)));
  };
  useEffect(load, []);

  const resetForm = () => {
    setForm({ name: "", description: "", prompt: "", tools: "", model: "", agentType: "builder" });
    setEditingId(null);
  };

  const handleSave = async () => {
    const toolsArr = form.tools.split(",").map((s) => s.trim()).filter(Boolean);
    const input = { ...form, tools: toolsArr, model: form.model || undefined };
    if (editingId) {
      await window.electronAPI.agentTemplates.update(editingId, input);
    } else {
      await window.electronAPI.agentTemplates.create(input);
    }
    resetForm();
    load();
  };

  const handleEdit = (t: typeof templates[0]) => {
    setEditingId(t.id);
    setForm({ name: t.name, description: t.description, prompt: t.prompt, tools: t.tools.join(", "), model: t.model || "", agentType: t.agentType });
  };

  const handleDelete = async (id: string) => {
    await window.electronAPI.agentTemplates.delete(id);
    if (editingId === id) resetForm();
    load();
  };

  const AGENT_TYPES = [
    { value: "mint", label: "Mint（PM / 主对话）" },
    { value: "orchestrator", label: "Orchestrator（调度者）" },
    { value: "builder", label: "Builder（开发者）" },
    { value: "evaluator", label: "Evaluator（验收者）" },
  ];

  return (
    <div className="px-6 py-4 overflow-y-auto space-y-4">
      {loadError && <p className="text-danger text-xs">{loadError}</p>}

      {/* Template List */}
      {templates.length === 0 ? (
        <p className="text-text-secondary text-xs text-center py-4">暂无 Agent 模板，创建一个吧。</p>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className={`p-3 rounded-lg border transition-colors ${editingId === t.id ? "border-accent bg-accent/5" : "border-border hover:border-accent/30"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-text-primary">{t.name}</span>
                  <span className="text-xs text-text-secondary ml-2">{t.agentType}</span>
                </div>
                <div className="flex gap-1">
                  <button className="text-xs text-text-secondary hover:text-accent transition-colors" onClick={() => handleEdit(t)}>编辑</button>
                  <button className="text-xs text-text-secondary hover:text-danger transition-colors" onClick={() => handleDelete(t.id)}>删除</button>
                </div>
              </div>
              <p className="text-xs text-text-secondary mt-0.5 truncate">{t.description}</p>
            </div>
          ))}
        </div>
      )}

      {/* Form */}
      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">{editingId ? "编辑模板" : "新建模板"}</h3>
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-text-secondary block mb-1">名称</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 Builder" />
            </div>
            <div className="w-44">
              <label className="text-xs text-text-secondary block mb-1">类型</label>
              <select className="input" value={form.agentType} onChange={(e) => setForm({ ...form, agentType: e.target.value })}>
                {AGENT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">描述（SDK 用于匹配调用时机）</label>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="如：当需要实现 task.json 中的开发任务时使用" />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">系统提示词</label>
            <textarea className="input resize-y" rows={4} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="Agent 的身份定义和工作流程..." />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">工具（逗号分隔）</label>
            <input className="input" value={form.tools} onChange={(e) => setForm({ ...form, tools: e.target.value })} placeholder="Read, Write, Edit, Bash, Glob, Grep" />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">模型（可选，不填继承默认）</label>
            <input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="如 deepseek-v4-pro" />
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 rounded-lg bg-accent text-text-inverse text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-40" disabled={!form.name || !form.prompt} onClick={handleSave}>
              {editingId ? "更新" : "创建"}
            </button>
            {editingId && (
              <button className="px-4 py-2 rounded-lg text-text-secondary text-sm hover:bg-surface-hover transition-colors" onClick={resetForm}>取消</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps): JSX.Element | null {
  const {
    evaluateMode,
    tddMode,
    screenshotVerification,
    apiBaseUrl,
    apiKey,
    model,
    availableModels,
    defaultProjectDir,
    contextThreshold,
    setEvaluateMode,
    setTddMode,
    setScreenshotVerification,
    setDefaultProjectDir,
    setContextThreshold,
    setApiBaseUrl,
    setApiKey,
    setModel,
    setAvailableModels,
    loadFromElectron,
  } = useSettingsStore();
  const [showKey, setShowKey] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "prompts" | "agents" | "skills" | "mcp">("general");

  useEffect(() => {
    if (open) {
      loadFromElectron();
    }
  }, [open, loadFromElectron]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 modal-overlay">
      <div className="bg-surface-elevated rounded-xl border border-border shadow-2xl modal-card flex flex-col" style={{ width: 800, height: 700 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-0 border-b border-border">
          <div className="flex gap-0">
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "general" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("general")}
            >
              通用
            </button>
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "prompts" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("prompts")}
            >
              提示词
            </button>
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "agents" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("agents")}
            >
              Agent 模板
            </button>
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "skills" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("skills")}
            >
              Skill
            </button>
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "mcp" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("mcp")}
            >
              MCP
            </button>
          </div>
          <button
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors"
            onClick={onClose}
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
                <div className="bg-surface-alt rounded-lg px-4 py-3">
                  <p className="text-sm text-text-primary">主题</p>
                  <p className="text-xs text-text-secondary mt-0.5">亮色 Mint（仅亮色）</p>
                </div>
              </section>

              {/* 路径 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">默认项目路径</h3>
                <div className="bg-surface-alt rounded-lg px-4 py-3">
                  <input
                    className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
                    placeholder="~/EasyMintProject"
                    value={defaultProjectDir}
                    onChange={(e) => setDefaultProjectDir(e.target.value)}
                  />
                  <p className="text-[10px] text-text-secondary mt-0.5">新建项目时的默认父目录，workspace 会话也存放于此路径下</p>
                </div>
              </section>

              {/* API 设置 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">API 配置</h3>
                <div className="bg-surface-alt rounded-lg px-4 py-3 space-y-3">
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">Base URL</label>
                    <input
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
                      placeholder="https://api.deepseek.com/anthropic"
                      value={apiBaseUrl}
                      onChange={(e) => setApiBaseUrl(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">API Key</label>
                    <div className="relative">
                      <input
                        type={showKey ? "text" : "password"}
                        className="w-full px-3 py-2 pr-8 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
                        placeholder="sk-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        ) : (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">可选模型列表</label>
                    <div className="space-y-1 mb-2">
                      {availableModels.map((m, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <input
                            className="flex-1 px-2 py-1.5 rounded bg-surface border border-border text-text-primary text-xs outline-none focus:border-accent"
                            value={m}
                            onChange={(e) => {
                              const next = [...availableModels];
                              next[i] = e.target.value;
                              setAvailableModels(next);
                            }}
                          />
                          <button
                            className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-danger transition-colors text-xs"
                            onClick={() => setAvailableModels(availableModels.filter((_, j) => j !== i))}
                          >✕</button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="px-3 py-1 rounded border border-accent/50 text-accent text-xs hover:border-accent hover:bg-accent/5 transition-colors"
                        onClick={() => setAvailableModels([...availableModels, ""])}
                      >+ 添加模型</button>
                      <button
                        className="px-3 py-1 rounded border border-accent/50 text-accent text-xs hover:border-accent hover:bg-accent/5 transition-colors"
                        onClick={async () => {
                          try {
                            const models = await window.electronAPI.settings.fetchModels();
                            if (models.length > 0) setAvailableModels(models);
                          } catch (e: unknown) {
                            alert(e instanceof Error ? e.message : "获取失败");
                          }
                        }}
                      >从 API 获取</button>
                    </div>
                    <p className="text-[10px] text-text-secondary mt-1.5">在聊天窗口中可切换的模型列表。默认使用第一个或下方指定的模型。</p>
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">默认模型</label>
                    {availableModels.length > 0 ? (
                      <select
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      >
                        <option value="">— 不限 —</option>
                        {availableModels.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
                        placeholder="deepseek-v4-pro[1m]"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      />
                    )}
                    <p className="text-[10px] text-text-secondary mt-0.5">新会话的默认模型，先获取模型列表后可从下拉选择</p>
                  </div>
                </div>
              </section>

              {/* 开发选项 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">开发选项</h3>
                <div className="bg-surface-alt rounded-lg px-4 divide-y divide-border">
                  <ToggleRow label="评估模式" description="每轮 Worker 完成后自动触发 Evaluator 验证" hint="启用 Playwright 自动化测试，验证前端改动正确性" enabled={evaluateMode} onChange={setEvaluateMode} />
                  <ToggleRow label="TDD 模式" description="先编写测试代码，再实现功能" hint="每次实现前先生成测试用例，以测试驱动开发流程" enabled={tddMode} onChange={setTddMode} />
                  <ToggleRow label="截图验证" description="使用 image-vision 对每次改动进行截图对比" hint="每轮完成后截图并通过视觉模型分析，确保 UI 无回归" enabled={screenshotVerification} onChange={setScreenshotVerification} />
                </div>
              </section>

              {/* Context threshold */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">上下文轮转阈值</h3>
                <div className="bg-surface-alt rounded-lg px-4 py-3">
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
              {/* Token 消耗对照表 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">预估 Token 消耗</h3>
                <div className="bg-surface-alt rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-4 py-2.5 text-text-secondary font-medium">模式</th>
                        <th className="text-left px-4 py-2.5 text-text-secondary font-medium">说明</th>
                        <th className="text-center px-4 py-2.5 text-text-secondary font-medium">消耗</th>
                      </tr>
                    </thead>
                    <tbody>
                      {TOKEN_ROWS.map((row) => (
                        <tr key={row.label} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5 text-text-primary">{row.label}</td>
                          <td className="px-4 py-2.5 text-text-secondary">{row.desc}</td>
                          <td className="px-4 py-2.5 text-center"><StarRating count={row.stars} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : activeTab === "prompts" ? (
            <PromptSettings />
          ) : activeTab === "agents" ? (
            <AgentsTab />
          ) : activeTab === "skills" ? (
            <SkillsTab />
          ) : (
            <McpTab />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-2 border-t border-border">
          <button
            className="px-5 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors text-sm"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="px-5 py-1.5 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors text-sm font-medium"
            onClick={onClose}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
