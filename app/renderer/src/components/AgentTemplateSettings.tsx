import { uiText, useUiLocale, appText } from "../lib/i18n";
import { useEffect, useState } from "react";
import { confirmDialog } from "./ui/ConfirmDialog";

interface Template {
  id: string; name: string; description: string; prompt: string; agentType: string;
}

/**
 * 内置模板：不可修改、不可删除（与主进程 agent-templates.ts 的 BUILTIN_TEMPLATE_IDS 对应）。
 *
 * 原先 Builder / Evaluator 是「受限编辑」（只能改供应商 / 模型 / 思考等级）——
 * 子 Agent 的运行配置已收敛为主会话唯一来源（2026-09-16 用户拍板），那三个字段不复存在，
 * 受限编辑也就没有可编辑项，故四个内置模板统一为只读浏览。
 */
const BUILTIN_IDS = new Set(["mint", "mint-designer", "default-builder", "default-evaluator"]);

/** Agent 模板设置(列表+编辑表单) */
export function AgentTemplateSettings(): JSX.Element {
  useUiLocale();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    window.electronAPI.agentTemplates.list()
      .then((ts) => setTemplates(ts as Template[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleSave = async (data: { name: string; description: string; prompt: string }) => {
    if (!data.name.trim() || !data.prompt.trim()) return;
    if (editing) {
      await window.electronAPI.agentTemplates.update(editing.id, data);
    } else {
      await window.electronAPI.agentTemplates.create({ ...data, agentType: "custom" });
    }
    setEditing(null); setAdding(false);
    load(); // reload list
  };

  const handleDelete = async (id: string) => {
    const ok = await confirmDialog({ title: uiText("ui.AgentTemplateSettings.deleteThisTemplate"), message: uiText("ui.AgentTemplateSettings.thisCannotBeUndone"), confirmText: uiText("ui.AgentTemplateSettings.delete"), danger: true });
    if (!ok) return;
    await window.electronAPI.agentTemplates.delete(id);
    load();
  };

  if (adding || editing) {
    return <TemplateForm initial={editing} onSave={handleSave} onCancel={() => { setEditing(null); setAdding(false); }} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text-secondary">{uiText("ui.AgentTemplateSettings.agentTemplates")}</h3>
          <p className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">
            {uiText("ui.AgentTemplateSettings.templatesDefineRolesOnlySubagentsInheritThe")}</p>
        </div>
        <button onClick={() => setAdding(true)}
          className="shrink-0 whitespace-nowrap px-3 py-1 rounded-[var(--radius-lg)] text-accent text-xs font-medium hover:bg-accent-subtle transition-colors">
          {uiText("ui.AgentTemplateSettings.newTemplate")}</button>
      </div>
      {loading ? (
        <div className="text-xs text-text-secondary/60 py-4 text-center">{uiText("ui.AgentTemplateSettings.loading")}</div>
      ) : templates.length === 0 ? (
        <div className="text-xs text-text-secondary/60 py-4 text-center">{uiText("ui.AgentTemplateSettings.noCustomTemplates")}</div>
      ) : (
        templates.map((tpl) => (
          <div key={tpl.id} className="group flex items-start gap-3 p-3 rounded-[var(--radius-lg)] bg-surface-alt em-hover-row transition-shadow">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{tpl.name}</span>
                {tpl.id === "mint" && <span className="text-[length:var(--text-3xs)] px-1.5 py-0.5 rounded-full bg-accent-subtle text-accent shrink-0">{uiText("ui.AgentTemplateSettings.default")}</span>}
              </div>
              <div className="text-[length:var(--text-11)] text-text-secondary mt-0.5">{["mint", "default-builder", "default-evaluator"].includes(tpl.id) ? appText(tpl.description) : tpl.id === "mint-designer" && tpl.description.startsWith("UI 设计师。") ? tpl.description.split(/(?<=预览。)/).map(appText).join(" ") : tpl.description}</div>
            </div>
            <div className="flex gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
              {BUILTIN_IDS.has(tpl.id) ? (
                // 内置模板：统一进入表单页只读浏览
                <button onClick={() => setEditing(tpl)}
                  className="px-2 py-1 text-[length:var(--text-2xs)] rounded-[var(--radius-lg)] text-text-secondary hover:text-text-primary transition-colors">{uiText("ui.AgentTemplateSettings.browse")}</button>
              ) : (
                <>
                  <button onClick={() => setEditing(tpl)}
                    className="px-2 py-1 text-[length:var(--text-2xs)] rounded-[var(--radius-lg)] text-text-secondary hover:text-text-primary transition-colors">{uiText("menu.edit")}</button>
                  <button onClick={() => handleDelete(tpl.id)}
                    className="px-2 py-1 text-[length:var(--text-2xs)] rounded-[var(--radius-lg)] text-text-secondary hover:text-danger transition-colors">{uiText("ui.AgentTemplateSettings.delete")}</button>
                </>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * 模板编辑/新建表单 —— 只有人设三件套（名称 / 一句话描述 / 人格提示词）。
 *
 * 这里**不该再出现**供应商 / 模型 / 思考等级：子 Agent 的运行配置一律跟随主会话
 * （2026-09-16 用户拍板「取消全部子 agent 的配置入口」）。若将来有人想加回来，
 * 先想清楚"两处配置冲突时谁赢"——那正是这次被取消的原因。
 */
function TemplateForm({ initial, onSave, onCancel }: {
  initial: Template | null;
  onSave: (data: { name: string; description: string; prompt: string }) => void;
  onCancel: () => void;
}): JSX.Element {
  useUiLocale();
  const editMode = initial != null;
  // 内置模板：整表只读浏览（它们的人设随版本内置，自定义请新建模板）
  const locked = editMode && BUILTIN_IDS.has(initial.id);
  const [name, setName] = useState(initial?.name || "");
  const [desc, setDesc] = useState(initial?.description || "");
  const [prompt, setPrompt] = useState(initial?.prompt || "");

  const handleSave = () => {
    if (!name.trim() || !prompt.trim()) return;
    onSave({ name: name.trim(), description: desc.trim(), prompt: prompt.trim() });
  };

  return (
    <div className="bg-surface-alt rounded-[var(--radius-lg)] px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-secondary">{editMode ? (locked ? uiText("ui.AgentTemplateSettings.viewTemplate") : uiText("ui.AgentTemplateSettings.editTemplate")) : uiText("ui.AgentTemplateSettings.newTemplate2")}</h3>
        <button onClick={onCancel} className="text-[length:var(--text-11)] text-text-secondary hover:text-text-primary">{locked ? uiText("common.close") : uiText("common.cancel")}</button>
      </div>
      {locked && (
        <div className="rounded-[var(--radius-lg)] bg-accent-subtle px-3 py-2.5 text-[length:var(--text-11)] text-text-secondary leading-relaxed">
          {uiText("ui.AgentTemplateSettings.builtInTemplate")}<span className="text-text-primary font-medium">{initial.name}</span>{uiText("ui.AgentTemplateSettings.readOnlySubagentModelsAndThinkingLevels")}<span className="text-text-primary">{uiText("ui.AgentTemplateSettings.followTheMainSession")}</span>{uiText("ui.AgentTemplateSettings.templatesDoNotStoreRuntimeSettings")}</div>
      )}
      <div>
        <label className="text-[length:var(--text-11)] text-text-secondary block mb-1 em-required">{uiText("ui.AgentTemplateSettings.name")}</label>
        <input className="em-input w-full h-8 px-2.5 text-xs text-text-primary disabled:opacity-60"
          placeholder={uiText("ui.AgentTemplateSettings.eGTester")} value={name} onChange={(e) => setName(e.target.value)} disabled={locked} />
      </div>
      <div>
        <label className="text-[length:var(--text-11)] text-text-secondary block mb-1 em-required">{uiText("ui.AgentTemplateSettings.shortDescription")}</label>
        <input className="em-input w-full h-8 px-2.5 text-xs text-text-primary disabled:opacity-60"
          placeholder={uiText("ui.AgentTemplateSettings.eGWritesUnitTests")} value={desc} onChange={(e) => setDesc(e.target.value)} disabled={locked} />
      </div>
      <div>
        <label className="text-[length:var(--text-11)] text-text-secondary block mb-1 em-required">{uiText("ui.AgentTemplateSettings.roleResponsibilitiesPromptSystemPrompt")}</label>
        <textarea className="em-input w-full px-2.5 py-1.5 text-xs text-text-primary disabled:opacity-60"
          rows={4} placeholder={uiText("ui.AgentTemplateSettings.defineTheAgentSBehaviorExpertiseAnd")}
          value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={locked} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-[var(--radius-lg)] text-xs text-text-secondary hover:bg-surface-hover">{locked ? uiText("common.close") : uiText("common.cancel")}</button>
        {!locked && (
          <button onClick={handleSave}
            disabled={!name.trim() || !prompt.trim()}
            className={`px-4 py-1.5 rounded-[var(--radius-lg)] text-xs font-medium ${name.trim() && prompt.trim() ? "btn-accent" : "opacity-40 cursor-not-allowed bg-surface text-text-secondary"}`}>
            {uiText("ui.AgentTemplateSettings.save")}</button>
        )}
      </div>
    </div>
  );
}
