import { useEffect, useState } from "react";

// ── Skills Tab ───────────────────────────────────────────────────────────────

interface SkillRowData {
  name: string;
  description: string;
  path: string;
  level: "builtin" | "global" | "project";
  source: "builtin" | "authored" | "imported" | "managed";
  enabled: boolean;
  shadowed?: boolean;
  importedFrom?: string;
}

interface SkillStatData {
  usageCount: number;
  lastUsedAt: number;
  failCount: number;
}

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_BODY_BYTES = 64 * 1024 - 256; // frontmatter 余量；主进程对最终文件做 64KB 硬校验

function relTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}天前`;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-4 rounded-full transition-colors overflow-hidden shrink-0 ml-2 ${checked ? "bg-accent" : "bg-surface-hover border border-border"}`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-surface-elevated shadow transition-all ${checked ? "left-[calc(100%-14px)]" : "left-0.5"}`}
      />
    </button>
  );
}

function SkillRow({ s, stat, onToggle, onDelete }: {
  s: SkillRowData;
  stat?: SkillStatData;
  onToggle: () => void;
  onDelete?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [showBody, setShowBody] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState("");

  const toggleBody = async () => {
    if (showBody) {
      setShowBody(false);
      return;
    }
    setShowBody(true);
    if (body === null && !bodyError) {
      try {
        const detail = await window.electronAPI.skill.get(s.path);
        setBody(detail ? detail.body : "");
      } catch (e: unknown) {
        setBodyError(String(e));
      }
    }
  };

  // imported 徽章带来源平台（Claude / Codex / GitHub），便于区分外部生态导入
  const sourceLabel = s.source === "managed"
    ? "AI"
    : s.source === "builtin"
      ? "内置"
      : s.source === "imported"
        ? `外部·${s.importedFrom === "github" ? "GitHub" : s.importedFrom === "codex" ? "Codex" : "Claude"}`
        : "手写";
  const sourceCls = s.source === "managed"
    ? "bg-warning-soft text-warning"
    : s.source === "imported"
      ? "bg-info-soft text-info"
      : "bg-surface text-text-muted";
  const stale = !!stat && stat.lastUsedAt > 0 && Date.now() - stat.lastUsedAt > 90 * 86_400_000;
  const highFail = !!stat && stat.failCount >= 3 && stat.usageCount > 0 && stat.failCount / stat.usageCount >= 0.3;
  // 缺描述：不进会话 skill 列表（模型无法判断何时用）——但仍列出供补全
  const noDesc = !s.description || s.description === "(无描述)";

  return (
    <div
      className={`px-3 py-2 transition-colors cursor-default ${s.enabled && !s.shadowed ? "hover:bg-surface-hover" : "opacity-60"}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-xs text-text-primary truncate">{s.name}</span>
          <span className={`text-[length:var(--text-3xs)] px-1 py-0.5 rounded shrink-0 ${sourceCls}`}>{sourceLabel}</span>
          {s.level === "project" && (
            <span className="text-[length:var(--text-3xs)] px-1 py-0.5 rounded bg-surface text-text-muted shrink-0">项目</span>
          )}
          {s.shadowed && (
            <span className="text-[length:var(--text-3xs)] px-1 py-0.5 rounded bg-warning-soft text-warning shrink-0">被遮蔽</span>
          )}
          {noDesc && (
            <span
              className="text-[length:var(--text-3xs)] px-1 py-0.5 rounded bg-danger-soft text-danger shrink-0"
              title="SKILL.md 缺 description——不会出现在会话的技能列表，补全后自动恢复"
            >缺描述</span>
          )}
          {stale && (
            <span className="text-[length:var(--text-3xs)] px-1 py-0.5 rounded bg-surface text-text-muted shrink-0">90天未用</span>
          )}
          {highFail && (
            <span className="text-[length:var(--text-3xs)] px-1 py-0.5 rounded bg-danger-soft text-danger shrink-0">失败多</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {stat && (
            <span className="text-[length:var(--text-3xs)] text-text-muted whitespace-nowrap">
              {stat.usageCount > 0 ? `${stat.usageCount}次·${relTime(stat.lastUsedAt)}` : "未用过"}
            </span>
          )}
          <button
            onClick={toggleBody}
            className="text-[length:var(--text-3xs)] text-text-secondary hover:text-text-primary transition-colors px-1"
          >
            正文
          </button>
          {onDelete && (
            <button
              onClick={onDelete}
              className="text-[length:var(--text-3xs)] text-text-secondary hover:text-danger transition-colors px-1"
            >
              删除
            </button>
          )}
          <Toggle checked={s.enabled} onChange={onToggle} />
        </div>
      </div>
      {showBody ? (
        bodyError ? (
          <p className="text-[length:var(--text-11)] text-danger mt-1">{bodyError}</p>
        ) : (
          <pre className="text-[length:var(--text-2xs)] text-text-secondary mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
            {body ?? "加载中…"}
          </pre>
        )
      ) : (
        hover && <p className="text-[length:var(--text-11)] text-text-secondary mt-1 leading-relaxed">{s.description}</p>
      )}
    </div>
  );
}

function SkillsTab(): JSX.Element {
  const [skills, setSkills] = useState<SkillRowData[]>([]);
  const [stats, setStats] = useState<Record<string, SkillStatData>>({});
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<"builtin" | "global" | "managed">("builtin");

  // 新建表单（managed 区）
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // AI 写入开关（D8：默认关闭，界面一键开启）
  const [manageSkillEnabled, setManageSkillEnabled] = useState(false);
  // AI 自沉淀开关（learn + search_experiences，D8：默认关闭）
  const [learnEnabled, setLearnEnabled] = useState(false);
  // 外部生态目录发现（~/.claude/skills 等，只读发现，默认开启）
  const [importExternal, setImportExternal] = useState(true);

  const load = async () => {
    try {
      const [list, st] = await Promise.all([
        window.electronAPI.skill.list(undefined),
        window.electronAPI.skill.getStats(),
      ]);
      setSkills(list);
      setStats(st);
    } catch (e: unknown) {
      setLoadError(String(e));
    }
  };
  useEffect(() => {
    load();
    window.electronAPI.settings.get()
      .then((s) => {
        setManageSkillEnabled(!!s.manageSkillEnabled);
        setLearnEnabled(!!s.learnEnabled);
        setImportExternal(s.importExternalSkills !== false);
      })
      .catch((e: unknown) => setLoadError(String(e)));
  }, []);

  const handleToggle = async (name: string, enabled: boolean) => {
    await window.electronAPI.skill.toggle(name, enabled);
    setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
  };

  const handleDelete = async (s: SkillRowData) => {
    if (s.source === "managed") {
      const r = await window.electronAPI.skill.deleteManaged(s.name);
      if (!r.ok) {
        setLoadError(r.error || "删除失败");
        return;
      }
    } else {
      if (!window.confirm(`删除 skill「${s.name}」？\n\n目录将从磁盘移除：${s.path}`)) return;
      const r = await window.electronAPI.skill.delete(s.path);
      if (!r.ok) {
        setLoadError(r.error || "删除失败");
        return;
      }
    }
    load();
  };

  const saveManageEnabled = async (v: boolean) => {
    setManageSkillEnabled(v);
    try {
      await window.electronAPI.settings.set("manageSkillEnabled", v);
    } catch (e: unknown) {
      setManageSkillEnabled(!v);
      setLoadError(String(e));
    }
  };

  const saveLearnEnabled = async (v: boolean) => {
    setLearnEnabled(v);
    try {
      await window.electronAPI.settings.set("learnEnabled", v);
    } catch (e: unknown) {
      setLearnEnabled(!v);
      setLoadError(String(e));
    }
  };

  const saveImportExternal = async (v: boolean) => {
    setImportExternal(v);
    try {
      await window.electronAPI.settings.set("importExternalSkills", v);
      load(); // 开关影响扫描结果——立即重载列表
    } catch (e: unknown) {
      setImportExternal(!v);
      setLoadError(String(e));
    }
  };

  const nameValid = SKILL_NAME_RE.test(formName);
  const bodyBytes = new TextEncoder().encode(formBody).length;
  const canSubmit = nameValid && formDesc.trim().length > 0 && formBody.trim().length > 0 && bodyBytes <= MAX_BODY_BYTES && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setFormError("");
    try {
      const r = await window.electronAPI.skill.createManaged(formName, formDesc.trim(), formBody);
      if (!r.ok) {
        setFormError(r.error || "创建失败");
        return;
      }
      setShowForm(false);
      setFormName("");
      setFormDesc("");
      setFormBody("");
      setFormError("");
      await load();
    } catch (e: unknown) {
      setFormError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const builtinSkills = skills.filter((s) => s.level === "builtin");
  const globalSkills = skills.filter((s) => s.level === "global" && s.source !== "managed");
  const managedSkills = skills.filter((s) => s.source === "managed");
  const projectSkills = skills.filter((s) => s.level === "project");
  const visibleSkills = tab === "builtin" ? builtinSkills : tab === "global" ? globalSkills : managedSkills;

  // 优化建议（期3）：基于 registry 统计生成纯文案建议——不自动执行、不改 authored 文件。
  // builtin 排除：不可删除，出「删除/合并」类建议无入口承接
  const suggestions = skills
    .filter((s) => s.source !== "builtin")
    .map((s): { name: string; text: string } | null => {
      const stat = stats[s.name];
      // 从未调用的 skill 在 registry 无条目（stat 为 undefined）——不能提前 return，
      // managed「尚未被调用」建议正依赖此分支
      if (s.source === "managed" && (!stat || stat.usageCount === 0)) {
        return { name: s.name, text: "尚未被调用过——描述可能不含触发词，或内容已过时" };
      }
      if (!stat) return null;
      if (stat.lastUsedAt > 0 && Date.now() - stat.lastUsedAt > 90 * 86_400_000) {
        return { name: s.name, text: "90 天未使用——考虑删除或合并" };
      }
      if (stat.failCount >= 3 && stat.usageCount > 0 && stat.failCount / stat.usageCount >= 0.3) {
        return { name: s.name, text: "失败率高——描述与内容可能不匹配，建议修正 description" };
      }
      return null;
    })
    .filter((x): x is { name: string; text: string } => x !== null);

  return (
    <div className="px-6 py-4 overflow-y-auto space-y-4">
      {loadError && <p className="text-danger text-xs">{loadError}</p>}

      <div>
        <p className="text-sm font-medium text-text-primary">Skills</p>
        <p className="text-[length:var(--text-11)] text-text-secondary mt-0.5">
          内置 Skill 仅 EasyMint 可用；通用 Skill 与 Claude Code 共用；AI 管理区存放 AI 会话中创建的 skill
        </p>
      </div>

      {/* Tab buttons — pill style */}
      <div className="inline-flex rounded-lg border border-border overflow-hidden">
        {(["builtin", "global", "managed"] as const).map((t, i) => (
          <button
            key={t}
            className={`px-4 py-1.5 text-xs font-medium transition-colors ${
              i > 0 ? "border-l border-border" : ""
            } ${
              tab === t ? "bg-[color-mix(in_oklab,var(--color-accent)_15%,transparent)] text-accent" : "text-text-secondary hover:bg-surface-hover"
            }`}
            onClick={() => setTab(t)}
          >
            {t === "builtin" ? "内置" : t === "global" ? "通用" : "AI 管理"}
          </button>
        ))}
      </div>

      {/* 外部生态发现开关（对全部页签生效——只读发现，不改动任何文件） */}
      <div className="bg-surface-alt rounded-lg border border-border px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-text-primary">发现外部生态 skill</p>
          <p className="text-[length:var(--text-11)] text-text-secondary mt-0.5">
            自动识别 Claude Code（<span className="font-mono">~/.claude/skills/</span>、项目 <span className="font-mono">.claude/skills/</span>）、
            Codex（<span className="font-mono">~/.codex/skills/</span>）、GitHub Agent Skills（项目 <span className="font-mono">.github/skills/</span>）中的标准 skill，
            标记为「外部」来源即可用（只读，不改动原目录；同名以 EasyMint 自带版本优先）
          </p>
        </div>
        <Toggle checked={importExternal} onChange={saveImportExternal} />
      </div>

      {/* AI 管理区：写入开关 + 新建表单 */}
      {tab === "managed" && (
        <div className="space-y-3">
          <div className="bg-surface-alt rounded-lg border border-border px-3 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-text-primary">允许 AI 创建与管理 skill</p>
              <p className="text-[length:var(--text-11)] text-text-secondary mt-0.5">
                开启后，新建或重启后重新打开的会话中，Mint 可通过 manage_skill 工具在 AI 管理区创建/更新 skill（进行中的会话不生效）；关闭则只能在此手动管理（默认关闭）
              </p>
            </div>
            <Toggle checked={manageSkillEnabled} onChange={saveManageEnabled} />
          </div>

          <div className="bg-surface-alt rounded-lg border border-border px-3 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-text-primary">允许 AI 自沉淀经验</p>
              <p className="text-[length:var(--text-11)] text-text-secondary mt-0.5">
                开启后，新建或重启后重新打开的会话中，Mint 可在任务完成时用 learn 沉淀经验/创建 skill（弹审阅卡片，确认才入库），并可检索历史经验（进行中的会话不生效）；关闭则完全由你手动维护（默认关闭）
              </p>
            </div>
            <Toggle checked={learnEnabled} onChange={saveLearnEnabled} />
          </div>

          {showForm ? (
            <div className="bg-surface-alt rounded-lg border border-border px-3 py-3 space-y-2">
              <div>
                <label className="text-xs text-text-secondary block mb-1">名称（小写字母/数字/连字符）</label>
                <input
                  className="em-input w-full px-2 py-1.5 text-text-primary text-xs"
                  value={formName}
                  placeholder="my-skill"
                  onChange={(e) => { setFormName(e.target.value); setFormError(""); }}
                />
                {formName && !nameValid && (
                  <p className="text-[length:var(--text-11)] text-danger mt-1">
                    {"名称需匹配 [a-z0-9][a-z0-9-]{0,63}（小写字母/数字/连字符，≤64 字符）"}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-text-secondary block mb-1">描述（单行，注入会话提示词）</label>
                <input
                  className="em-input w-full px-2 py-1.5 text-text-primary text-xs"
                  value={formDesc}
                  placeholder="这个 skill 做什么、什么时候用"
                  onChange={(e) => { setFormDesc(e.target.value); setFormError(""); }}
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary block mb-1">
                  正文（Markdown，{bodyBytes > MAX_BODY_BYTES ? "已超限" : `上限约 ${MAX_BODY_BYTES} 字节`}）
                </label>
                <textarea
                  className="em-input w-full px-2 py-1.5 text-text-primary text-xs min-h-24 resize-y"
                  value={formBody}
                  placeholder="skill 的完整内容：工作流、约束、示例等"
                  onChange={(e) => { setFormBody(e.target.value); setFormError(""); }}
                />
                {bodyBytes > MAX_BODY_BYTES && (
                  <p className="text-[length:var(--text-11)] text-danger mt-1">正文超限（{bodyBytes} 字节），需精简</p>
                )}
              </div>
              {formError && <p className="text-[length:var(--text-11)] text-danger">{formError}</p>}
              <div className="flex items-center gap-2 pt-1">
                <button
                  disabled={!canSubmit}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${canSubmit ? "btn-accent" : "bg-surface-hover text-text-muted cursor-not-allowed"}`}
                  onClick={submit}
                >
                  {submitting ? "创建中…" : "创建"}
                </button>
                <button
                  className="px-3 py-1 text-xs rounded-md text-text-secondary hover:bg-surface-hover transition-colors"
                  onClick={() => { setShowForm(false); setFormError(""); }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              className="px-3 py-1 text-xs rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
              onClick={() => setShowForm(true)}
            >
              + 新建 skill
            </button>
          )}
        </div>
      )}

      {/* Skill list */}
      <div className="bg-surface-alt rounded-lg border border-border overflow-hidden max-h-[220px] overflow-y-auto divide-y divide-border/50">
        {visibleSkills.length > 0 ? (
          visibleSkills.map((s) => (
            <SkillRow
              key={s.path}
              s={s}
              stat={stats[s.name]}
              onToggle={() => handleToggle(s.name, !s.enabled)}
              onDelete={s.source === "builtin" ? undefined : () => handleDelete(s)}
            />
          ))
        ) : (
          <p className="text-text-muted text-xs text-center py-6">
            {tab === "builtin" ? "暂无内置 Skill" : tab === "global" ? "暂无通用 Skill" : "暂无 AI 管理的 skill"}
          </p>
        )}
      </div>

      {/* 优化建议（AI 管理页；有建议才显示） */}
      {tab === "managed" && suggestions.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-2">优化建议</h4>
          <div className="bg-surface-alt rounded-lg border border-border px-3 py-2 space-y-1">
            {suggestions.map((sug) => (
              <p key={sug.name} className="text-[length:var(--text-11)] text-text-secondary leading-relaxed">
                <span className="text-text-primary font-mono">{sug.name}</span>：{sug.text}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Project skills */}
      {projectSkills.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-2">项目级</h4>
          <div className="bg-surface-alt rounded-lg border border-border overflow-hidden max-h-[220px] overflow-y-auto divide-y divide-border/50">
            {projectSkills.map((s) => (
              <SkillRow
                key={s.path}
                s={s}
                stat={stats[s.name]}
                onToggle={() => handleToggle(s.name, !s.enabled)}
                onDelete={() => handleDelete(s)}
              />
            ))}
          </div>
        </div>
      )}

      {skills.length === 0 && (
        <p className="text-text-secondary text-xs text-center py-8">
          暂无 Skill。将 skill 放入 ~/.easymint/skills/ 目录即可自动识别。
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
          <span className="text-[length:var(--text-3xs)] px-1 py-0.5 rounded bg-surface text-text-muted shrink-0">{typeLabel}</span>
          {Object.entries(requiredKeys).map(([k, v]) => (
            <span key={k} className={`text-[length:var(--text-3xs)] px-1 py-0.5 rounded shrink-0 ${v || apiKeys[k] ? "bg-accent-bg text-accent" : "bg-warning/10 text-warning"}`}>
              {k}
            </span>
          ))}
        </div>
        <Toggle checked={s.enabled} onChange={onToggle} />
      </div>
      {expanded && (
        <p className="text-[length:var(--text-2xs)] text-text-secondary mt-1 truncate">
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
  // MCP config env (mcp.json) takes priority, then apiKeys from em-settings.json.
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
          <p className="text-[length:var(--text-11)] text-text-secondary mb-3">
            MCP 工具所需的第三方服务密钥，会注入到对应 MCP 服务器的环境变量中。
          </p>
          <div className="bg-surface-alt rounded-lg px-4 py-3 space-y-2">
            {Array.from(allKeys.entries()).filter(([k]) => k !== "VISION_API_KEY" && k !== "TAVILY_API_KEY").map(([key, val]) => (
              <div key={key}>
                <label className="text-xs text-text-secondary block mb-1">{key}</label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    className="em-input w-full px-2 py-1.5 pr-7 text-text-primary text-xs"
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
        <p className="text-[length:var(--text-11)] text-text-secondary mb-3">
          EM 独立配置（~/.easymint/mcp.json），与 Claude Code 解耦。
        </p>

        {servers.length === 0 ? (
          <p className="text-text-secondary text-xs text-center py-8">
            未检测到 MCP 服务器。可编辑 ~/.easymint/mcp.json 添加。
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
