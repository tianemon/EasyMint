import { uiText, useUiLocale, appText } from "../lib/i18n";
import { useEffect, useState } from "react";
import { confirmDialog } from "./ui/ConfirmDialog";
import { MainChatSettings } from "./settings/ConversationSettings";
import { toast } from "./ui/Toast";
import { appMessage } from "../lib/i18n";
import { PromptEditorDialog } from "./PromptEditorDialog";
import { useConversationConfig } from "../stores/conversation-store";

interface Template {
  id: string; name: string; description: string; prompt: string; agentType: string; revision?: string;
}

/** 内置执行模板保留名称与职责，编辑入口仅开放模板正文。 */
const BUILTIN_IDS = new Set(["mint", "default-builder", "default-evaluator"]);

/** Agent 模板设置(列表+编辑表单) */
export function AgentTemplateSettings(): JSX.Element {
  useUiLocale();
  const conversation = useConversationConfig();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editorSaving, setEditorSaving] = useState(false);

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
      await window.electronAPI.agentTemplates.update(editing.id, data, editing.revision);
    } else {
      await window.electronAPI.agentTemplates.create({ ...data, agentType: "custom" });
    }
    setEditing(null); setAdding(false);
    load(); // reload list
  };

  const handleDelete = async (id: string) => {
    const ok = await confirmDialog({ title: uiText("ui.AgentTemplateSettings.deleteThisTemplate"), message: uiText("ui.AgentTemplateSettings.thisCannotBeUndone"), confirmText: uiText("ui.AgentTemplateSettings.delete"), danger: true });
    if (!ok) return;
    await window.electronAPI.agentTemplates.delete(id, templates.find(template => template.id === id)?.revision);
    load();
  };

  const closeEditor = () => { setEditing(null); setAdding(false); load(); };
  const templateName = (template: Template) => template.id === "mint" ? conversation?.main.nickname ?? template.name : template.name;

  return (
    <div className="space-y-3">
      {(adding || editing) && <PromptEditorDialog
        title={editing ? `${uiText("ui.AgentTemplateSettings.editTemplate")} · ${templateName(editing)}` : uiText("ui.AgentTemplateSettings.newTemplate2")}
        onClose={closeEditor} busy={editorSaving}>
        {editing?.id === "mint" ? <MainChatSettings onClose={closeEditor} onSavingChange={setEditorSaving} />
          : editing && BUILTIN_IDS.has(editing.id) ? <TemplatePromptForm template={editing} onClose={closeEditor} onSavingChange={setEditorSaving} />
            : <TemplateForm initial={editing} onSave={handleSave} onCancel={closeEditor} onSavingChange={setEditorSaving} />}
      </PromptEditorDialog>}
      <div className="flex items-center justify-end">
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
                <span className="text-sm font-medium text-text-primary">{templateName(tpl)}</span>
              </div>
              <div className="text-[length:var(--text-11)] text-text-secondary mt-0.5">{["mint", "default-builder", "default-evaluator"].includes(tpl.id) ? appText(tpl.description) : tpl.id === "mint-designer" && tpl.description.startsWith("UI 设计师。") ? tpl.description.split(/(?<=预览。)/).map(appText).join(" ") : tpl.description}</div>
            </div>
            <div className="flex gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
              {BUILTIN_IDS.has(tpl.id) ? (
                // 主对话与执行模板使用各自的字段编辑器。
                <button onClick={() => setEditing(tpl)}
                  className="px-2 py-1 text-[length:var(--text-2xs)] rounded-[var(--radius-lg)] text-text-secondary hover:text-text-primary transition-colors">{uiText("menu.edit")}</button>
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

function TemplatePromptForm({ template, onClose, onSavingChange }: { template: Template; onClose: () => void; onSavingChange: (saving: boolean) => void }): JSX.Element {
  const [prompt, setPrompt] = useState(template.prompt);
  const [revision, setRevision] = useState(template.revision);
  const [saving, setSaving] = useState(false);
  const save = async (restore = false) => {
    setSaving(true);
    onSavingChange(true);
    try {
      if (restore) {
        const result = await window.electronAPI.agentTemplates.restore(template.id, revision);
        setPrompt(result.prompt);
        setRevision(result.revision);
      } else {
        await window.electronAPI.agentTemplates.update(template.id, { prompt }, revision);
        onClose();
      }
    } catch (error) { toast(uiText("collaboration.failed", { detail: appMessage(error instanceof Error ? error.message : String(error)) })); }
    finally { setSaving(false); onSavingChange(false); }
  };
  return <form className="flex flex-col flex-1 min-h-0" onSubmit={event => { event.preventDefault(); event.stopPropagation(); void save(); }}>
    <div className="settings-body flex flex-col flex-1 min-h-0 overflow-y-auto px-6 py-4 gap-3">
      <label className="block shrink-0"><span className="text-[length:var(--text-11)] text-text-secondary block mb-1">{uiText("ui.AgentTemplateSettings.name")}</span>
        <input className="em-input w-full h-8 px-2.5 text-xs text-text-primary" readOnly value={template.name} /></label>
      <label className="block shrink-0"><span className="text-[length:var(--text-11)] text-text-secondary block mb-1">{uiText("collaboration.description")}</span>
        <input className="em-input w-full h-8 px-2.5 text-xs text-text-primary" readOnly value={appText(template.description)} /></label>
      <label className="flex flex-col flex-1 min-h-40"><span className="block text-[length:var(--text-11)] text-text-secondary mb-1">{uiText("collaboration.rules")}</span>
        <textarea className="em-input w-full px-2.5 py-1.5 text-xs text-text-primary flex-1 min-h-0" required placeholder={uiText("collaboration.rulesPlaceholder")} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
    </div>
    <div className="flex items-center justify-end gap-3 px-4 py-2 shrink-0">
      <button type="button" disabled={saving} onClick={() => void save(true)} className="mr-auto text-xs text-text-secondary">{uiText("collaboration.restore")}</button>
      <button type="button" disabled={saving} onClick={onClose} className="text-xs text-text-secondary">{uiText("common.cancel")}</button>
      <button type="submit" disabled={saving || !prompt.trim()} className="btn-accent px-4 py-1.5 rounded-[var(--radius-lg)] text-xs disabled:opacity-50">{uiText("ui.AgentTemplateSettings.save")}</button>
    </div>
  </form>;
}

/**
 * 自定义模板使用名称、描述和规则提示词；内置执行模板的名称与描述只读。
 *
 * 这里**不该再出现**供应商 / 模型 / 思考等级：子 Agent 的运行配置一律跟随主会话
 * （2026-09-16 用户拍板「取消全部子 agent 的配置入口」）。若将来有人想加回来，
 * 先想清楚"两处配置冲突时谁赢"——那正是这次被取消的原因。
 */
function TemplateForm({ initial, onSave, onCancel, onSavingChange }: {
  initial: Template | null;
  onSave: (data: { name: string; description: string; prompt: string }) => Promise<void>;
  onCancel: () => void;
  onSavingChange: (saving: boolean) => void;
}): JSX.Element {
  useUiLocale();
  const [name, setName] = useState(initial?.name || "");
  const [desc, setDesc] = useState(initial?.description || "");
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !prompt.trim()) return;
    setSaving(true);
    onSavingChange(true);
    try { await onSave({ name: name.trim(), description: desc.trim(), prompt: prompt.trim() }); }
    catch (error) { toast(uiText("collaboration.failed", { detail: appMessage(error instanceof Error ? error.message : String(error)) })); }
    finally { setSaving(false); onSavingChange(false); }
  };

  return (
    <form className="flex flex-col flex-1 min-h-0" onSubmit={event => { event.preventDefault(); event.stopPropagation(); void handleSave(); }}>
      <div className="settings-body flex flex-col flex-1 min-h-0 overflow-y-auto px-6 py-4 gap-3">
      <div className="shrink-0">
        <label className="text-[length:var(--text-11)] text-text-secondary block mb-1 em-required">{uiText("ui.AgentTemplateSettings.name")}</label>
        <input className="em-input w-full h-8 px-2.5 text-xs text-text-primary disabled:opacity-60"
          placeholder={uiText("ui.AgentTemplateSettings.eGTester")} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="shrink-0">
        <label className="text-[length:var(--text-11)] text-text-secondary block mb-1 em-required">{uiText("collaboration.description")}</label>
        <input className="em-input w-full h-8 px-2.5 text-xs text-text-primary disabled:opacity-60"
          placeholder={uiText("collaboration.descriptionPlaceholder")} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="flex flex-col flex-1 min-h-40">
        <label className="text-[length:var(--text-11)] text-text-secondary block mb-1 em-required">{uiText("collaboration.rules")}</label>
        <textarea className="em-input w-full px-2.5 py-1.5 text-xs text-text-primary disabled:opacity-60 flex-1 min-h-0"
          placeholder={uiText("collaboration.rulesPlaceholder")}
          value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </div>
      </div>
      <div className="flex justify-end gap-2 px-4 py-2 shrink-0">
        <button type="button" onClick={onCancel} disabled={saving} className="px-3 py-1.5 rounded-[var(--radius-lg)] text-xs text-text-secondary hover:bg-surface-hover">{uiText("common.cancel")}</button>
          <button type="submit"
            disabled={saving || !name.trim() || !prompt.trim()}
            className={`px-4 py-1.5 rounded-[var(--radius-lg)] text-xs font-medium ${name.trim() && prompt.trim() ? "btn-accent" : "opacity-40 cursor-not-allowed bg-surface text-text-secondary"}`}>
            {uiText("ui.AgentTemplateSettings.save")}</button>
      </div>
    </form>
  );
}
