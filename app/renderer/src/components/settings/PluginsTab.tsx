import { appMessage } from "../../lib/i18n";
import { formatDate, formatRelativeTimestamp } from "../../lib/locale-format";
import { appText } from "../../lib/i18n";
import { uiText, useUiLocale, uiI18n } from "../../lib/i18n";
import { useEffect, useState } from "react";
import { confirmDialog } from "../ui/ConfirmDialog";

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
  return Date.now() - ms < 30 * 86_400_000
    ? formatRelativeTimestamp(ms) : formatDate(ms, { year: "numeric", month: "short", day: "numeric" });
}

function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-4 rounded-full transition-colors overflow-hidden shrink-0 ml-2 ${checked ? "bg-accent" : "bg-surface-hover"}`}
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
  useUiLocale();
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

  // imported 徽章带来源平台（Claude / Codex / GitHub / Pi），便于区分外部生态导入
  const sourceLabel = s.source === "managed"
    ? "AI"
    : s.source === "builtin"
      ? uiText("ui.PluginsTab.builtIn")
      : s.source === "imported"
        ? uiText("ui.PluginsTab.external", { v0: s.importedFrom === "github" ? "GitHub" : s.importedFrom === "codex" ? "Codex" : s.importedFrom === "pi" ? "Pi" : "Claude" })
        : uiText("ui.PluginsTab.authored");
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
      className={`px-3 py-2 transition-shadow cursor-default ${s.enabled && !s.shadowed ? "em-hover-row" : "opacity-60"}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-xs text-text-primary truncate">{s.name}</span>
          <span className={`text-[length:var(--text-3xs)] px-1 py-0.5 rounded-[var(--radius-lg)] shrink-0 ${sourceCls}`}>{sourceLabel}</span>
          {s.level === "project" && (
            <span className="text-[length:var(--text-3xs)] px-1 py-0.5 rounded-[var(--radius-lg)] bg-surface text-text-muted shrink-0">{uiText("ui.PluginsTab.project")}</span>
          )}
          {s.shadowed && (
            <span className="text-[length:var(--text-3xs)] px-1 py-0.5 rounded-[var(--radius-lg)] bg-warning-soft text-warning shrink-0">{uiText("ui.PluginsTab.shadowed")}</span>
          )}
          {noDesc && (
            <span
              className="text-[length:var(--text-3xs)] px-1 py-0.5 rounded-[var(--radius-lg)] bg-danger-soft text-danger shrink-0"
             
            >{uiText("ui.PluginsTab.noDescription")}</span>
          )}
          {stale && (
            <span className="text-[length:var(--text-3xs)] px-1 py-0.5 rounded-[var(--radius-lg)] bg-surface text-text-muted shrink-0">{uiText("ui.PluginsTab.unusedFor90Days")}</span>
          )}
          {highFail && (
            <span className="text-[length:var(--text-3xs)] px-1 py-0.5 rounded-[var(--radius-lg)] bg-danger-soft text-danger shrink-0">{uiText("ui.PluginsTab.frequentFailures")}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {stat && (
            <span className="text-[length:var(--text-3xs)] text-text-muted whitespace-nowrap">
              {stat.usageCount > 0 ? uiText("ui.PluginsTab.calls", { v0: stat.usageCount, v1: relTime(stat.lastUsedAt) }) : uiText("ui.PluginsTab.neverUsed")}
            </span>
          )}
          <button
            onClick={toggleBody}
            className="text-[length:var(--text-3xs)] text-text-secondary hover:text-text-primary transition-colors px-1"
          >
            {uiText("ui.PluginsTab.body")}</button>
          {onDelete && (
            <button
              onClick={onDelete}
              className="text-[length:var(--text-3xs)] text-text-secondary hover:text-danger transition-colors px-1"
            >
              {uiText("ui.AgentTemplateSettings.delete")}</button>
          )}
          <Toggle checked={s.enabled} onChange={onToggle} />
        </div>
      </div>
      {showBody ? (
        bodyError ? (
          <p className="text-[length:var(--text-11)] text-danger mt-1">{appText(bodyError)}</p>
        ) : (
          <pre className="text-[length:var(--text-2xs)] text-text-secondary mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
            {body ?? uiText("ui.EditorPanel.loading")}
          </pre>
        )
      ) : (
        hover && <p className="text-[length:var(--text-11)] text-text-secondary mt-1 leading-relaxed">{s.source === "builtin" && uiI18n.exists(`builtinSkills.${s.name}.description`) ? uiText(`builtinSkills.${s.name}.description`) : s.description}</p>
      )}
    </div>
  );
}

function SkillsTab({ projectPath }: { projectPath?: string }): JSX.Element {
  useUiLocale();
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
  // AI 自沉淀开关（learn / search_experiences / retire_experiences 三件同开，D8：默认关闭）
  const [learnEnabled, setLearnEnabled] = useState(false);
  // 外部生态目录发现（~/.claude/skills 等，只读发现，默认开启）
  const [importExternal, setImportExternal] = useState(true);
  // Skill 导入（粘贴链接/目录路径）
  const [skillImportOpen, setSkillImportOpen] = useState(false);
  const [skillSource, setSkillSource] = useState("");
  const [skillImportMsg, setSkillImportMsg] = useState("");
  const [skillImporting, setSkillImporting] = useState(false);

  const handleSkillImport = async () => {
    if (!skillSource.trim()) return;
    setSkillImporting(true);
    setSkillImportMsg(uiText("ui.PiImport.importing"));
    try {
      const r = await window.electronAPI.skill.import(skillSource.trim());
      if (r.ok) {
        setSkillImportMsg(uiText("ui.PluginsTab.skillInstalledLoadItWithUseSkill", { v0: r.name }));
        load();
      } else {
        setSkillImportMsg("❌ " + (r.error || uiText("ui.PluginsTab.importFailed")));
      }
    } catch (e) {
      setSkillImportMsg("❌ " + String(e));
    } finally {
      setSkillImporting(false);
    }
  };

  const load = async () => {
    try {
      const [list, st] = await Promise.all([
        window.electronAPI.skill.list(projectPath),
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
  }, [projectPath]);

  const handleToggle = async (name: string, enabled: boolean) => {
    await window.electronAPI.skill.toggle(name, enabled);
    setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
  };

  const handleDelete = async (s: SkillRowData) => {
    if (s.source === "managed") {
      const r = await window.electronAPI.skill.deleteManaged(s.name);
      if (!r.ok) {
        setLoadError(r.error || uiText("ui.PluginsTab.couldNotDelete"));
        return;
      }
    } else {
      const ok = await confirmDialog({
        title: uiText("ui.PluginsTab.deleteSkill", { v0: s.name }),
        message: uiText("ui.PluginsTab.thisDirectoryWillBeRemoved", { v0: s.path }),
        confirmText: uiText("ui.AgentTemplateSettings.delete"),
        danger: true,
      });
      if (!ok) return;
      // 项目级 skill 需带 projectPath 才能通过 deleteSkill 的目录白名单
      const r = await window.electronAPI.skill.delete(s.path, projectPath);
      if (!r.ok) {
        setLoadError(r.error || uiText("ui.PluginsTab.couldNotDelete"));
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
        setFormError(r.error || uiText("ui.PluginsTab.couldNotCreate"));
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
        return { name: s.name, text: uiText("ui.PluginsTab.neverCalledTheDescriptionMayLackTrigger") };
      }
      if (!stat) return null;
      if (stat.lastUsedAt > 0 && Date.now() - stat.lastUsedAt > 90 * 86_400_000) {
        return { name: s.name, text: uiText("ui.PluginsTab.unusedFor90DaysConsiderDeletingOr") };
      }
      if (stat.failCount >= 3 && stat.usageCount > 0 && stat.failCount / stat.usageCount >= 0.3) {
        return { name: s.name, text: uiText("ui.PluginsTab.highFailureRateCheckWhetherTheDescription") };
      }
      return null;
    })
    .filter((x): x is { name: string; text: string } => x !== null);

  return (
    <div className="px-6 py-4 overflow-y-auto space-y-4">
      {loadError && <p className="text-danger text-xs">{appText(loadError)}</p>}

      {/* Tab buttons — pill style */}
      <div className="inline-flex rounded-[var(--radius-lg)] overflow-hidden">
        {(["builtin", "global", "managed"] as const).map((t, i) => (
          <button
            key={t}
            className={`px-4 py-1.5 text-xs font-medium transition-colors ${
              i > 0 ? "" : ""
            } ${
              tab === t ? "bg-[color-mix(in_oklab,var(--color-accent)_15%,transparent)] text-accent" : "text-text-secondary hover:bg-surface-hover"
            }`}
            onClick={() => setTab(t)}
          >
            {t === "builtin" ? uiText("ui.PluginsTab.builtIn") : t === "global" ? uiText("settings.general") : uiText("ui.PluginsTab.aiManaged")}
          </button>
        ))}
      </div>

      {/* 外部生态发现开关（对全部页签生效——只读发现，不改动任何文件） */}
      <div className="bg-surface-alt rounded-[var(--radius-lg)] px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-text-primary">{uiText("ui.PluginsTab.discoverExternalSkills")}</p>
          <p className="text-[length:var(--text-11)] text-text-secondary mt-0.5">
            {uiText("ui.PluginsTab.discoverSkillsFromClaudeCodeCodexGithub")}</p>
        </div>
        <Toggle checked={importExternal} onChange={saveImportExternal} />
      </div>

      {/* Skill 导入（粘贴 GitHub 链接或本地目录路径） */}
      <div className="bg-surface-alt rounded-[var(--radius-lg)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-text-primary">{uiText("ui.PluginsTab.importSkill")}</p>
            <p className="text-[length:var(--text-11)] text-text-secondary mt-0.5">
              {uiText("ui.PluginsTab.pasteARepositoryUrlOrLocalDirectory")}</p>
          </div>
          {!skillImportOpen && (
            <button type="button" onClick={() => setSkillImportOpen(true)}
              className="px-3 py-1 rounded-[var(--radius-lg)] text-[length:var(--text-2xs)] text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors shrink-0">
              {uiText("ui.ChatBlocks.import")}</button>
          )}
        </div>
        {skillImportOpen && (
          <div className="mt-2 space-y-2">
            <input
              className="em-input w-full px-2.5 py-1.5 text-xs font-mono"
              placeholder={uiText("ui.PluginsTab.httpsGithubComUserSkillRepoOr")}
              value={skillSource}
              onChange={(e) => setSkillSource(e.target.value)}
            />
            {skillImportMsg && <p className="text-[length:var(--text-11)] whitespace-pre-line">{appText(skillImportMsg)}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setSkillImportOpen(false); setSkillSource(""); setSkillImportMsg(""); }}
                className="px-3 py-1 rounded-[var(--radius-lg)] text-[length:var(--text-2xs)] text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors">
                {uiText("common.close")}</button>
              <button type="button" disabled={!skillSource.trim() || skillImporting} onClick={handleSkillImport}
                className="px-3.5 py-1 rounded-[var(--radius-lg)] text-[length:var(--text-2xs)] font-medium bg-accent text-text-inverse hover:bg-accent-hover transition-colors disabled:opacity-50">
                {skillImporting ? uiText("ui.PiImport.importing") : uiText("ui.ChatBlocks.import")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* AI 管理区：写入开关 + 新建表单 */}
      {tab === "managed" && (
        <div className="space-y-3">
          <div className="bg-surface-alt rounded-[var(--radius-lg)] px-3 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-text-primary">{uiText("ui.PluginsTab.allowAiToManageSkills")}</p>
              <p className="text-[length:var(--text-11)] text-text-secondary mt-0.5">
                {uiText("ui.PluginsTab.mintCanCreateAndUpdateAiManaged")}</p>
            </div>
            <Toggle checked={manageSkillEnabled} onChange={saveManageEnabled} />
          </div>

          <div className="bg-surface-alt rounded-[var(--radius-lg)] px-3 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-text-primary">{uiText("ui.PluginsTab.allowAiToRetainExperience")}</p>
              <p className="text-[length:var(--text-11)] text-text-secondary mt-0.5">
                {uiText("ui.PluginsTab.mintCanSaveUsefulLessonsAfterTasks")}</p>
            </div>
            <Toggle checked={learnEnabled} onChange={saveLearnEnabled} />
          </div>

          {showForm ? (
            <div className="bg-surface-alt rounded-[var(--radius-lg)] px-3 py-3 space-y-2">
              <div>
                <label className="text-xs text-text-secondary block mb-1">{uiText("ui.PluginsTab.nameLowercaseLettersDigitsHyphens")}</label>
                <input
                  className="em-input w-full px-2 py-1.5 text-text-primary text-xs"
                  value={formName}
                  placeholder="my-skill"
                  onChange={(e) => { setFormName(e.target.value); setFormError(""); }}
                />
                {formName && !nameValid && (
                  <p className="text-[length:var(--text-11)] text-danger mt-1">
                    {uiText("ui.PluginsTab.nameMustMatchAZ09A")}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-text-secondary block mb-1">{uiText("ui.PluginsTab.descriptionOneLineIncludedInSessionPrompts")}</label>
                <input
                  className="em-input w-full px-2 py-1.5 text-text-primary text-xs"
                  value={formDesc}
                  placeholder={uiText("ui.PluginsTab.whatThisSkillDoesAndWhenTo")}
                  onChange={(e) => { setFormDesc(e.target.value); setFormError(""); }}
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary block mb-1">
                  {uiText("ui.PluginsTab.bodyMarkdown")}{bodyBytes > MAX_BODY_BYTES ? uiText("ui.PluginsTab.limitExceeded") : uiText("ui.PluginsTab.limitAboutBytes", { v0: MAX_BODY_BYTES })}）
                </label>
                <textarea
                  className="em-input w-full px-2 py-1.5 text-text-primary text-xs min-h-24 resize-y"
                  value={formBody}
                  placeholder={uiText("ui.PluginsTab.fullSkillContentWorkflowConstraintsExamplesEtc")}
                  onChange={(e) => { setFormBody(e.target.value); setFormError(""); }}
                />
                {bodyBytes > MAX_BODY_BYTES && (
                  <p className="text-[length:var(--text-11)] text-danger mt-1">{uiText("ui.PluginsTab.bodyExceedsLimit")}{bodyBytes} {uiText("ui.PluginsTab.bytesShortenIt")}</p>
                )}
              </div>
              {formError && <p className="text-[length:var(--text-11)] text-danger">{appText(formError)}</p>}
              <div className="flex items-center gap-2 pt-1">
                <button
                  disabled={!canSubmit}
                  className={`px-3 py-1 text-xs rounded-[var(--radius-lg)] transition-colors ${canSubmit ? "btn-accent" : "bg-surface-hover text-text-muted cursor-not-allowed"}`}
                  onClick={submit}
                >
                  {submitting ? uiText("ui.PluginsTab.creating") : uiText("ui.PluginsTab.create")}
                </button>
                <button
                  className="px-3 py-1 text-xs rounded-[var(--radius-lg)] text-text-secondary hover:bg-surface-hover transition-colors"
                  onClick={() => { setShowForm(false); setFormError(""); }}
                >
                  {uiText("common.cancel")}</button>
              </div>
            </div>
          ) : (
            <button
              className="px-3 py-1 text-xs rounded-[var(--radius-lg)] text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
              onClick={() => setShowForm(true)}
            >
              {uiText("ui.PluginsTab.newSkill")}</button>
          )}
        </div>
      )}

      {/* Skill list */}
      <div className="bg-surface-alt rounded-[var(--radius-lg)] overflow-hidden max-h-[220px] overflow-y-auto">
        {visibleSkills.length > 0 ? (
          visibleSkills.map((s) => (
            <SkillRow
              key={s.path}
              s={s}
              stat={stats[s.name]}
              onToggle={() => handleToggle(s.name, !s.enabled)}
              // imported 为外部生态只读发现，deleteSkill 会拒绝——不给删除入口
              onDelete={s.source === "builtin" || s.source === "imported" ? undefined : () => handleDelete(s)}
            />
          ))
        ) : (
          <p className="text-text-muted text-xs text-center py-6">
            {tab === "builtin" ? uiText("ui.PluginsTab.noBuiltInSkills") : tab === "global" ? uiText("ui.PluginsTab.noGeneralSkills") : uiText("ui.PluginsTab.noAiManagedSkills")}
          </p>
        )}
      </div>

      {/* 优化建议（AI 管理页；有建议才显示） */}
      {tab === "managed" && suggestions.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-2">{uiText("ui.PluginsTab.suggestions")}</h4>
          <div className="bg-surface-alt rounded-[var(--radius-lg)] px-3 py-2 space-y-1">
            {suggestions.map((sug) => (
              <p key={sug.name} className="text-[length:var(--text-11)] text-text-secondary leading-relaxed">
                <span className="text-text-primary font-mono">{sug.name}</span>：{appText(sug.text)}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Project skills */}
      {projectSkills.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-2">{uiText("ui.PluginsTab.projectScope")}</h4>
          <div className="bg-surface-alt rounded-[var(--radius-lg)] overflow-hidden max-h-[220px] overflow-y-auto">
            {projectSkills.map((s) => (
              <SkillRow
                key={s.path}
                s={s}
                stat={stats[s.name]}
                onToggle={() => handleToggle(s.name, !s.enabled)}
                onDelete={s.source === "imported" ? undefined : () => handleDelete(s)}
              />
            ))}
          </div>
        </div>
      )}

      {skills.length === 0 && (
        <p className="text-text-secondary text-xs text-center py-8">
          {uiText("ui.PluginsTab.noSkillsPlaceASkillInEasymint")}</p>
      )}
    </div>
  );
}

// ── MCP Tab ───────────────────────────────────────────────────────────────────

const MCP_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** MCP 服务器新增/编辑表单（类型切换显示对应字段，支持测试连接） */
function McpServerForm({
  initial,
  scope,
  projectPath,
  onCancel,
  onSaved,
}: {
  initial: { name: string; cfg: McpServerCfg } | null;
  scope: "user" | "project";
  projectPath: string;
  onCancel: () => void;
  onSaved: () => void;
}): JSX.Element {
  useUiLocale();
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<"stdio" | "http" | "sse">(initial?.cfg.type ?? "stdio");
  const [command, setCommand] = useState(initial?.cfg.command ?? "");
  const [argsText, setArgsText] = useState((initial?.cfg.args ?? []).join(" "));
  const [url, setUrl] = useState(initial?.cfg.url ?? "");
  const [envText, setEnvText] = useState(
    Object.entries(initial?.cfg.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"),
  );
  const [headersText, setHeadersText] = useState(
    Object.entries(initial?.cfg.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n"),
  );
  const [oauth, setOauth] = useState(!!initial?.cfg.oauth);
  const [desc, setDesc] = useState(initial?.cfg.description ?? "");
  const [err, setErr] = useState("");
  const [testResult, setTestResult] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const buildCfg = (): McpServerCfg => {
    const env: Record<string, string> = {};
    for (const line of envText.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const i = t.indexOf("=");
      if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    const headers: Record<string, string> = {};
    for (const line of headersText.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const i = t.indexOf(":");
      if (i > 0) headers[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    // 用途说明与传输类型无关，两个分支都要带上
    const base = { description: desc.trim() || undefined, timeout: initial?.cfg.timeout, callbackPort: initial?.cfg.callbackPort, cwd: initial?.cfg.cwd, requestTimeoutSeconds: initial?.cfg.requestTimeoutSeconds, exposure: initial?.cfg.exposure, toolExposure: initial?.cfg.toolExposure };
    return type === "stdio"
      ? { ...base, type, command: command.trim() || undefined, args: argsText.trim() ? argsText.trim().split(/\s+/) : undefined, env: Object.keys(env).length ? env : undefined }
      : { ...base, type, url: url.trim() || undefined, headers: Object.keys(headers).length ? headers : undefined, env: Object.keys(env).length ? env : undefined, oauth: oauth || undefined };
  };

  const validate = (): string | null => {
    if (!MCP_NAME_RE.test(name)) return uiText("ui.PluginsTab.useLowercaseLettersDigitsAndHyphensE");
    if (type === "sse") return uiText("ui.PluginsTab.switchToHttpAndEnterTheServer");
    if (type === "stdio" && !command.trim()) return uiText("ui.PluginsTab.localProcessesRequireACommandEG");
    if (type !== "stdio") {
      if (!url.trim()) return uiText("ui.PluginsTab.requiresAUrl", { v0: type.toUpperCase() });
      try {
        const u = new URL(url.trim());
        if (!/^https?:$/.test(u.protocol)) return uiText("ui.PluginsTab.urlMustUseHttpOrHttps");
      } catch { return uiText("ui.PluginsTab.invalidUrl"); }
    }
    return null;
  };

  const test = async () => {
    const e = validate();
    if (e) { setErr(e); return; }
    setBusy(true);
    setErr("");
    setTestResult(uiText("ui.PluginsTab.connecting"));
    try {
      const r = await window.electronAPI.mcp.test(buildCfg(), projectPath);
      setTestResult(r.ok ? uiText("ui.PluginsTab.connectedToolsFound", { v0: r.toolCount ?? 0 }) : uiText("ui.PluginsTab.connectionFailed", { v0: appMessage(r.error) }));
    } catch (e2) {
      setTestResult(uiText("ui.PluginsTab.testFailed", { v0: String(e2) }));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const e = validate();
    if (e) { setErr(e); return; }
    setBusy(true);
    setErr("");
    try {
      const r = await window.electronAPI.mcp.save(name, buildCfg(), scope, scope === "project" ? projectPath : undefined);
      if (!r.ok) { setErr(r.error || uiText("ui.PluginsTab.couldNotSave")); return; }
      onSaved();
    } catch (e2) {
      setErr(String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-surface-alt rounded-[var(--radius-lg)] px-3 py-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <input
          className="em-input flex-1 px-2.5 py-1.5 text-xs font-mono"
          placeholder={uiText("ui.PluginsTab.serverNameLowercaseLettersDigitsHyphens")}
          value={name}
          disabled={!!initial}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex rounded-[var(--radius-lg)] overflow-hidden shrink-0">
          {(["stdio", "http"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`px-2 py-1 text-[length:var(--text-11)] transition-colors ${
                type === t ? "bg-accent text-text-inverse" : "text-text-secondary hover:bg-surface-hover"
              }`}
            >
              {t === "stdio" ? uiText("ui.PluginsTab.localProcess") : t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <input
        className="em-input w-full px-2.5 py-1.5 text-xs"
        placeholder={uiText("ui.PluginsTab.purposeOptionalEGBrowserControlMint")}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
      />

      {type === "stdio" ? (
        <>
          <input
            className="em-input w-full px-2.5 py-1.5 text-xs font-mono"
            placeholder={uiText("ui.PluginsTab.commandEGNpx")}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <input
            className="em-input w-full px-2.5 py-1.5 text-xs font-mono"
            placeholder={uiText("ui.PluginsTab.spaceSeparatedArgumentsEGYModelcontextprotocol")}
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
          />
        </>
      ) : (
        <input
          className="em-input w-full px-2.5 py-1.5 text-xs font-mono"
          placeholder="https://example.com/mcp"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      )}

      {type !== "stdio" && (
        <>
          <div>
            <label className="text-[length:var(--text-11)] text-text-secondary block mb-1">
              {uiText("ui.PluginsTab.headersOnePerLineKeyValueE")}</label>
            <textarea
              className="em-input w-full px-2.5 py-1.5 text-xs font-mono resize-y min-h-12"
              placeholder={"Authorization: Bearer github_pat_xxx"}
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between gap-3 bg-surface rounded-[var(--radius-lg)] px-2.5 py-2">
            <div className="min-w-0">
              <p className="text-[length:var(--text-11)] text-text-primary">{uiText("ui.PluginsTab.thisServerRequiresOauthLogin")}</p>
              <p className="text-[length:var(--text-11)] text-text-secondary mt-0.5">
                {uiText("ui.PluginsTab.authorizeInYourBrowserWhenConnectingTokens")}</p>
            </div>
            <Toggle checked={oauth} onChange={setOauth} />
          </div>
        </>
      )}
      <div>
        <label className="text-[length:var(--text-11)] text-text-secondary block mb-1">
          {uiText("ui.PluginsTab.environmentVariablesOneKeyValuePerLine")}{"${VAR}"} {uiText("ui.PluginsTab.and")}{uiText("ui.PluginsTab.varDefault")}）
        </label>
        <textarea
          className="em-input w-full px-2.5 py-1.5 text-xs font-mono resize-y min-h-12"
          placeholder={"API_KEY=xxx\nBASE_URL=${API_BASE:-https://api.example.com}"}
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
        />
      </div>

      {err && <p className="text-danger text-[length:var(--text-11)]">{appText(err)}</p>}
      {testResult && <p className="text-text-secondary text-[length:var(--text-11)]">{appText(testResult)}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={test} disabled={busy}
          className="px-3 py-1 rounded-[var(--radius-lg)] text-[length:var(--text-2xs)] text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors">
          {uiText("ui.PluginsTab.testConnection")}</button>
        <button type="button" onClick={onCancel}
          className="px-3 py-1 rounded-[var(--radius-lg)] text-[length:var(--text-2xs)] text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors">
          {uiText("common.cancel")}</button>
        <button type="button" onClick={save} disabled={busy}
          className="px-3.5 py-1 rounded-[var(--radius-lg)] text-[length:var(--text-2xs)] font-medium bg-accent text-text-inverse hover:bg-accent-hover transition-colors">
          {uiText("ui.AgentTemplateSettings.save")}</button>
      </div>
    </div>
  );
}

function McpTab({ projectPath: projectPathProp }: { projectPath?: string }): JSX.Element {
  useUiLocale();
  const [servers, setServers] = useState<{ name: string; type: string; command?: string; args?: string[]; url?: string; enabled: boolean; scope: "user" | "project" | "project-compat"; writable: boolean; pendingApproval?: boolean }[]>([]);
  const [projectPath, setProjectPath] = useState<string>("");
  const [requiredKeys, setRequiredKeys] = useState<Record<string, Record<string, string>>>({});
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [showKey, setShowKey] = useState(false);
  // 阶段A：连接状态 + 新增/编辑表单
  const [statuses, setStatuses] = useState<Record<string, { state: string; toolCount?: number; error?: string }>>({});
  const [editing, setEditing] = useState<{ name: string; cfg: McpServerCfg; scope: "user" | "project" } | null>(null);
  const [adding, setAdding] = useState(false);
  const [actionErr, setActionErr] = useState("");
  // 粘贴导入：textarea + 解析结果消息
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteMsg, setPasteMsg] = useState("");
  const [pasting, setPasting] = useState(false);

  const load = async () => {
    try {
      // 当前项目路径：优先用 ProjectPage 传入的（窗口内真实当前项目）；
      // 兜底 lastProjectId → project.get（仅防御——设置弹窗只挂在项目页内，正常都走上一分支）
      let curProject = projectPathProp ?? "";
      if (!curProject) {
        const snap = await window.electronAPI.settings.get().catch(() => null) as { lastProjectId?: string } | null;
        if (snap?.lastProjectId) {
          const proj = await window.electronAPI.project.get(snap.lastProjectId).catch(() => undefined);
          curProject = proj?.path ?? "";
        }
      }
      setProjectPath(curProject);
      const [s, keys, settings, st] = await Promise.all([
        window.electronAPI.mcp.list(curProject),
        window.electronAPI.mcp.requiredKeys(),
        window.electronAPI.settings.get(),
        window.electronAPI.mcp.status(curProject),
      ]);
      setServers(s);
      setRequiredKeys(keys);
      setApiKeys(settings.apiKeys ?? {});
      const map: Record<string, { state: string; toolCount?: number; error?: string }> = {};
      for (const x of st) map[x.name] = x;
      setStatuses(map);
    } catch (e: unknown) {
      setLoadError(String(e));
    }
  };
  useEffect(() => { load(); }, []);

  // Status reads never connect. Keep disconnect/auth changes visible while the panel is open.
  useEffect(() => {
    const timer = setInterval(() => {
      void window.electronAPI.mcp.status(projectPath || undefined).then(items => setStatuses(Object.fromEntries(items.map(item => [item.name, item]))));
    }, 2500);
    return () => clearInterval(timer);
  }, [projectPath]);

  const handleToggle = async (name: string, enabled: boolean) => {
    await window.electronAPI.mcp.toggle(name, enabled);
    setServers((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
    load();
  };

  const handleDelete = async (name: string, scope: "user" | "project" | "project-compat") => {
    // 项目根 .mcp.json 为只读兼容来源（对齐 handleEdit 的提示）
    if (scope === "project-compat") { setActionErr(uiText("ui.PluginsTab.theProjectSRootMcpJsonIs")); return; }
    // 删除不可逆（配置 + 凭据从磁盘永久移除），二次确认
    const scopeText = scope === "user" ? uiText("ui.PluginsTab.userSettingsEasymintMcpJson") : uiText("ui.PluginsTab.projectSettingsProjectEasymintMcpJson");
    const ok = await confirmDialog({
      title: uiText("ui.PluginsTab.deleteMcpServer", { v0: name }),
      message: uiText("ui.PluginsTab.permanentlyRemoveThisServerConfigurationIncludingCredentials", { v0: scopeText }),
      confirmText: uiText("ui.AgentTemplateSettings.delete"),
      danger: true,
    });
    if (!ok) return;
    const r = await window.electronAPI.mcp.delete(name, scope, projectPath);
    if (!r.ok) { setActionErr(r.error || uiText("ui.PluginsTab.couldNotDelete")); return; }
    setActionErr("");
    load();
  };

  const handleRetry = async (name: string) => {
    const r = await window.electronAPI.mcp.retry(name, projectPath);
    if (!r.ok) setActionErr(r.error || uiText("ui.PluginsTab.couldNotReconnect"));
    else setActionErr("");
    load();
  };

  const handleEdit = async (name: string, scope: "user" | "project" | "project-compat") => {
    if (scope === "project-compat") { setActionErr(uiText("ui.PluginsTab.theProjectSRootMcpJsonIs2")); return; }
    const cfg = await window.electronAPI.mcp.get(name, scope, projectPath);
    if (cfg) setEditing({ name, cfg, scope });
  };

  const handleApprove = async (name: string) => {
    if (!projectPath) { setActionErr(uiText("ui.PluginsTab.openAProjectToApproveAProject")); return; }
    try {
      await window.electronAPI.mcp.approve(name, projectPath);
      setActionErr("");
    } catch (error) {
      setActionErr(error instanceof Error ? error.message : uiText("ui.PluginsTab.approvalFailedRefreshTheListAndTry"));
    }
    load();
  };

  const statusBadge = (name: string, enabled: boolean) => {
    if (!enabled) return { text: uiText("ui.PluginsTab.disabled"), cls: "bg-surface text-text-muted" };
    const st = statuses[name];
    if (!st || st.state === "connecting") return { text: uiText("ui.PluginsTab.connecting2"), cls: "bg-surface text-text-muted" };
    if (st.state === "connected") return { text: uiText("ui.PluginsTab.connected", { v0: st.toolCount ? uiText("ui.extra.toolCount", { count: st.toolCount }) : "" }), cls: "bg-success-soft text-success" };
    if (st.state === "idle" && st.toolCount !== undefined) return { text: uiText("ui.PluginsTab.testPassedTools", { v0: st.toolCount }), cls: "bg-success-soft text-success" };
    if (st.state === "idle" || st.state === "closed") return { text: uiText("ui.PluginsTab.notConnected"), cls: "bg-surface text-text-muted" };
    if (st.state === "disconnected") return { text: uiText("ui.PluginsTab.disconnected"), cls: "bg-warning-soft text-warning" };
    if (st.state === "needs-auth") return { text: uiText("ui.PluginsTab.loginRequired"), cls: "bg-warning-soft text-warning" };
    if (st.state === "pending") return { text: uiText("ui.PluginsTab.approvalRequired"), cls: "bg-warning-soft text-warning" };
    return { text: uiText("ui.DevicePanel.connectionFailed"), cls: "bg-danger-soft text-danger" };
  };

  const saveKey = async (key: string, value: string) => {
    // 以主进程配置为基底：组件态在加载失败时为空，用它整体覆盖会清掉其他 key
    const s = await window.electronAPI.settings.get();
    const next = { ...(s.apiKeys ?? {}), [key]: value };
    setApiKeys(next);
    await window.electronAPI.settings.set("apiKeys", next);
  };

  const typeLabel = (t: string) => t === "stdio" ? uiText("ui.PluginsTab.localProcess") : t === "http" ? "HTTP" : "SSE";

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
      {loadError && <p className="text-danger text-xs">{appText(loadError)}</p>}

      {Array.from(allKeys.entries()).filter(([k]) => k !== "VISION_API_KEY" && k !== "TAVILY_API_KEY").length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-text-secondary mb-2">API Keys</h3>
          <p className="text-[length:var(--text-11)] text-text-secondary mb-3">
            {uiText("ui.PluginsTab.thirdPartyServiceKeysSuppliedAsEnvironment")}</p>
          <div className="bg-surface-alt rounded-[var(--radius-lg)] px-4 py-3 space-y-2">
            {Array.from(allKeys.entries()).filter(([k]) => k !== "VISION_API_KEY" && k !== "TAVILY_API_KEY").map(([key, val]) => (
              <div key={key}>
                <label className="text-xs text-text-secondary block mb-1">{key}</label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    className="em-input w-full px-2 py-1.5 pr-7 text-text-primary text-xs"
                    defaultValue={val}
                    placeholder={uiText("ui.PluginsTab.notSet")}
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
        <div className={`flex items-center mb-2 ${adding || editing || pasteMode ? "justify-start" : "justify-end"}`}>
          {!adding && !editing && !pasteMode && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setPasteMode(true)}
                className="px-3 py-1 rounded-[var(--radius-lg)] text-[length:var(--text-2xs)] text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors">
                {uiText("ui.PluginsTab.pasteConfiguration")}</button>
              <button type="button" onClick={() => setAdding(true)}
                className="px-3 py-1 rounded-[var(--radius-lg)] text-[length:var(--text-2xs)] font-medium bg-accent text-text-inverse hover:bg-accent-hover transition-colors">
                {uiText("ui.PluginsTab.addServer")}</button>
            </div>
          )}
        </div>
        {!adding && !editing && (
          <p className="text-[length:var(--text-11)] text-text-secondary mb-3">
            {uiText("ui.PluginsTab.configurationIsStoredInEasymintMcpJson")}</p>
        )}
        {actionErr && <p className="text-danger text-[length:var(--text-11)] mb-2">{appText(actionErr)}</p>}

        {pasteMode && (
          <div className="bg-surface-alt rounded-[var(--radius-lg)] px-3 py-3 space-y-2">
            <p className="text-[length:var(--text-11)] text-text-secondary">
              {uiText("ui.PluginsTab.pasteConfigurationMcpserversJsonClaudeMcpAdd")}</p>
            <textarea
              className="em-input w-full px-2.5 py-1.5 text-xs font-mono resize-y min-h-20"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={uiText("ui.PluginsTab.mcpserversGithubTypeHttpUrlHttpsApi")}
            />
            {pasteMsg && <p className="text-[length:var(--text-11)] whitespace-pre-line">{pasteMsg}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setPasteMode(false); setPasteText(""); setPasteMsg(""); }}
                className="px-3 py-1 rounded-[var(--radius-lg)] text-[length:var(--text-2xs)] text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors">
                {uiText("common.close")}</button>
              <button type="button" disabled={!pasteText.trim() || pasting}
                onClick={async () => {
                  setPasting(true);
                  setPasteMsg(uiText("ui.PluginsTab.parsing"));
                  try {
                    const r = await window.electronAPI.mcp.importText(pasteText);
                    if (r.ok) {
                      setPasteMsg((r.message || uiText("ui.PluginsTab.imported")) + (r.notes?.length ? "\n" + r.notes.join("；") : ""));
                      load();
                    } else {
                      setPasteMsg("❌ " + (r.error || uiText("ui.PluginsTab.importFailed")));
                    }
                  } catch (e2) { setPasteMsg("❌ " + String(e2)); }
                  finally { setPasting(false); }
                }}
                className="px-3.5 py-1 rounded-[var(--radius-lg)] text-[length:var(--text-2xs)] font-medium bg-accent text-text-inverse hover:bg-accent-hover transition-colors disabled:opacity-50">
                {uiText("ui.PluginsTab.parseAndImport")}</button>
            </div>
          </div>
        )}
        {(adding || editing) && (
          <McpServerForm
            initial={editing ? { name: editing.name, cfg: editing.cfg } : null}
            scope={editing?.scope ?? (projectPath ? "user" : "user")}
            projectPath={projectPath}
            onCancel={() => { setAdding(false); setEditing(null); }}
            onSaved={() => { setAdding(false); setEditing(null); load(); }}
          />
        )}

        {servers.length === 0 && !adding ? (
          <p className="text-text-secondary text-xs text-center py-8">
            {uiText("ui.PluginsTab.noMcpServersAddOneUsingThe")}</p>
        ) : (
          <div className="bg-surface-alt rounded-[var(--radius-lg)] overflow-hidden max-h-[260px] overflow-y-auto">
            {servers.map((s) => {
              const badge = statusBadge(s.name, s.enabled);
              return (
                <div key={s.name} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="text-xs text-text-primary truncate">{s.name}</span>
                      <span className={`text-[length:var(--text-3xs)] px-1 py-0.5 rounded-[var(--radius-lg)] shrink-0 ${badge.cls}`}>{badge.text}</span>
                      <span className="text-[length:var(--text-3xs)] px-1 py-0.5 rounded-[var(--radius-lg)] bg-surface text-text-muted shrink-0">{typeLabel(s.type)}</span>
                      <span
                        className={`text-[length:var(--text-3xs)] px-1 py-0.5 rounded-[var(--radius-lg)] shrink-0 ${s.scope === "user" ? "bg-surface text-text-muted" : "bg-info-soft text-info"}`}
                        
                      >
                        {s.scope === "user" ? uiText("ui.PluginsTab.userScope") : s.scope === "project" ? uiText("ui.PluginsTab.projectScope") : uiText("ui.PluginsTab.projectMcpJson")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {s.pendingApproval && (
                        <button type="button" onClick={() => handleApprove(s.name)}
                          className="px-1.5 py-0.5 rounded-[var(--radius-lg)] text-[length:var(--text-3xs)] bg-warning-soft text-warning hover:bg-warning hover:text-text-inverse transition-colors">
                          {uiText("ui.PluginsTab.approvalRequired")}</button>
                      )}
                      {["failed", "disconnected", "idle", "closed"].includes(statuses[s.name]?.state ?? "") && s.enabled && !s.pendingApproval && (
                        <button type="button" onClick={() => handleRetry(s.name)}
                          className="px-1.5 py-0.5 rounded-[var(--radius-lg)] text-[length:var(--text-3xs)] text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors">
                          {uiText("ui.ChatPanel.retry")}</button>
                      )}
                      {s.enabled && !s.pendingApproval && s.type === "http" && <button type="button" onClick={async () => {
                        const result = await window.electronAPI.mcp.login(s.name, projectPath);
                        setActionErr(result.ok ? "" : result.error || uiText("ui.OAuthLoginDialog.loginFailed"));
                        void load();
                      }} className="px-1.5 py-0.5 text-[length:var(--text-3xs)] text-text-secondary hover:text-text-primary">{uiText("ui.OAuthLoginDialog.logIn")}</button>}
                      {s.enabled && !s.pendingApproval && s.type === "http" && <button type="button" onClick={async () => {
                        const result = await window.electronAPI.mcp.logout(s.name, projectPath);
                        setActionErr(result.ok ? "" : result.error || uiText("ui.PluginsTab.couldNotLogOut"));
                        void load();
                      }} className="px-1.5 py-0.5 text-[length:var(--text-3xs)] text-text-secondary hover:text-text-primary">{uiText("ui.PluginsTab.logOut")}</button>}
                      <button type="button" onClick={() => handleEdit(s.name, s.scope)}
                        className="px-1.5 py-0.5 rounded-[var(--radius-lg)] text-[length:var(--text-3xs)] text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors">
                        {uiText("menu.edit")}</button>
                      <button type="button" onClick={() => handleDelete(s.name, s.scope)}
                        className="px-1.5 py-0.5 rounded-[var(--radius-lg)] text-[length:var(--text-3xs)] text-text-secondary hover:text-danger hover:bg-surface-hover transition-colors">
                        {uiText("ui.AgentTemplateSettings.delete")}</button>
                      <Toggle checked={s.enabled} onChange={(v) => handleToggle(s.name, v)} />
                    </div>
                  </div>
                  {statuses[s.name]?.error && (
                    <p className="text-[length:var(--text-3xs)] text-danger mt-1 break-all">
                      {appText(statuses[s.name]?.error)}
                    </p>
                  )}
                  {Object.keys(requiredKeys[s.name] ?? {}).length > 0 && (
                    <p className="text-[length:var(--text-3xs)] text-text-muted mt-1">
                      {uiText("ui.PluginsTab.requiredKeys")}{Object.keys(requiredKeys[s.name] ?? {}).join("、")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

type PiExtensionRow = Awaited<ReturnType<typeof window.electronAPI.piExtension.list>>[number];

function ExtensionsTab({ projectPath }: { projectPath?: string }): JSX.Element {
  useUiLocale();
  const [items, setItems] = useState<PiExtensionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () => {
    setBusy(true);
    try { setItems(await window.electronAPI.piExtension.list(projectPath)); setError(""); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, [projectPath]);
  useEffect(() => window.electronAPI.piExtension.onError(() => { void refresh(); }), [projectPath]);

  const toggle = async (item: PiExtensionRow) => {
    const enable = !item.approved;
    setBusy(true);
    try {
      setItems(await window.electronAPI.piExtension.approve(item.id, item.fingerprint, enable, projectPath));
      setError("");
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="space-y-3 px-1 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-text-primary">{uiText("ui.PluginsTab.piExtensions")}</h3>
          <p className="text-xs text-text-secondary mt-1">{uiText("ui.PluginsTab.discoverNativePiAndEasymintExtensionsApproval")}</p>
        </div>
        <button type="button" className="text-xs text-accent hover:underline" disabled={busy} onClick={() => void refresh()}>{uiText("ui.PluginsTab.refresh")}</button>
      </div>
      {error && <p className="text-xs text-danger">{appText(error)}</p>}
      {!busy && items.length === 0 && <p className="text-xs text-text-muted py-4">{uiText("ui.PluginsTab.noPiOrEasymintExtensionsFound")}</p>}
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-surface px-3 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-primary font-medium truncate">{item.name}</span>
              <span className="text-[length:var(--text-3xs)] text-text-muted">{item.origin === "pi" ? uiText("ui.PluginsTab.nativePi") : "EasyMint"}</span>
              <span className="text-[length:var(--text-3xs)] text-text-muted">{item.scope === "project" ? uiText("ui.PluginsTab.currentProject") : uiText("ui.PluginsTab.userScope")}</span>
              <span className="text-[length:var(--text-3xs)] text-text-muted">{{ ready: uiText("ui.PluginsTab.approvedRunsWithFullAccess"), pending: uiText("ui.PluginsTab.approvalRequired"), disabled: uiText("ui.PluginsTab.disabledInSourceConfiguration"), missing: uiText("ui.PluginsTab.fileMissing"), error: uiText("ui.PluginsTab.verificationFailed") }[item.status]}</span>
              {item.tools !== undefined && <span className="text-[length:var(--text-3xs)] text-text-muted">{item.tools} {uiText("ui.PluginsTab.tools")}{item.commands ?? 0} {uiText("ui.PluginsTab.commands")}</span>}
            </div>
            <p className="text-[length:var(--text-3xs)] text-text-muted truncate mt-1" title={item.path}>{item.path}</p>
            {item.error && <p className="text-[length:var(--text-3xs)] text-danger mt-1">{appText(item.error)}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {item.fingerprint && <button type="button" className="text-[length:var(--text-3xs)] text-text-secondary hover:text-text-primary" onClick={() => void window.electronAPI.piExtension.reveal(item.id, projectPath).catch((e: unknown) => setError(String(e)))}>{uiText("ui.PluginsTab.reveal")}</button>}
            {!!item.fingerprint && item.enabledInPi && <Toggle checked={item.approved} disabled={busy} onChange={() => void toggle(item)} />}
          </div>
        </div>
      ))}
      <p className="text-[length:var(--text-3xs)] text-text-muted">{uiText("ui.PluginsTab.executableExtensionsLoadOnlyInFullAccess")}</p>
    </section>
  );
}

/** 插件设置:Skills / MCP / Pi 扩展（projectPath = 窗口内当前打开的项目路径） */
export function PluginsTab({ projectPath }: { projectPath?: string }): JSX.Element {
  useUiLocale();
  const [tab, setTab] = useState<"skills" | "mcp" | "extensions">("skills");
  return (
    <div className="space-y-1.5">
      <div className="flex justify-center px-6">
        <div className="inline-flex rounded-[var(--radius-lg)] overflow-hidden">
          {([["skills", "Skills"], ["mcp", "MCP"], ["extensions", uiText("ui.PluginsTab.extensions")]] as const).map(([id, label], i) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${i > 0 ? "" : ""} ${
                tab === id
                  ? "bg-[color-mix(in_oklab,var(--color-accent)_15%,transparent)] text-accent"
                  : "text-text-secondary hover:bg-surface-hover"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "skills" ? <SkillsTab projectPath={projectPath} /> : tab === "mcp" ? <McpTab projectPath={projectPath} /> : <ExtensionsTab projectPath={projectPath} />}
    </div>
  );
}
