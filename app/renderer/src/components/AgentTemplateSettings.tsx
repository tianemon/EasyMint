import { uiText, useUiLocale, appText } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { confirmDialog } from "./ui/ConfirmDialog";
import { MainChatSettings, type RoleFooterSlots } from "./settings/ConversationSettings";
import { toast } from "./ui/Toast";
import { appMessage } from "../lib/i18n";
import { PromptEditorDialog } from "./PromptEditorDialog";

interface Template {
  id: string; name: string; description: string; prompt: string; agentType: string; revision?: string;
}

/** 内置执行模板保留名称与职责，编辑入口仅开放模板正文。 */
const BUILTIN_IDS = new Set(["default-builder", "default-evaluator"]);

/** Agent 模板设置(列表+编辑表单) */
export function AgentTemplateSettings({onSavingChange, roleFooter}:{onSavingChange?:(saving:boolean)=>void; roleFooter?: RoleFooterSlots}={}): JSX.Element {
  useUiLocale();
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
  const roles = templates.filter(template => template.id !== "mint");

  return (
    <div className="space-y-3">
      {(adding || editing) && <PromptEditorDialog
        title={editing ? `${uiText("ui.AgentTemplateSettings.editTemplate")} · ${editing.name}` : uiText("ui.AgentTemplateSettings.newTemplate2")}
        onClose={closeEditor} busy={editorSaving}>
        {editing && BUILTIN_IDS.has(editing.id) ? <TemplatePromptForm template={editing} onClose={closeEditor} onSavingChange={setEditorSaving} />
            : <TemplateForm initial={editing} onSave={handleSave} onCancel={closeEditor} onSavingChange={setEditorSaving} />}
      </PromptEditorDialog>}
      <MainChatSettings onSavingChange={onSavingChange} roleFooter={roleFooter} />
      <div className="flex items-center justify-end pt-2">
        <button onClick={() => setAdding(true)}
          className="settings-action" data-tone="accent">
          {uiText("ui.AgentTemplateSettings.newTemplate")}</button>
      </div>
      {loading ? (
        <div className="text-xs text-text-secondary/60 py-4 text-center">{uiText("ui.AgentTemplateSettings.loading")}</div>
      ) : roles.length === 0 ? (
        <div className="text-xs text-text-secondary/60 py-4 text-center">{uiText("ui.AgentTemplateSettings.noCustomTemplates")}</div>
      ) : (
        roles.map((tpl) => (
          <div key={tpl.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] bg-surface-alt em-hover-row transition-shadow">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{tpl.name}</span>
              </div>
              <div className="text-[length:var(--text-11)] text-text-secondary mt-0.5">{BUILTIN_IDS.has(tpl.id) ? appText(tpl.description) : tpl.id === "mint-designer" && tpl.description.startsWith("UI 设计师。") ? tpl.description.split(/(?<=预览。)/).map(appText).join(" ") : tpl.description}</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {BUILTIN_IDS.has(tpl.id) ? (
                // 主对话与执行模板使用各自的字段编辑器。
                <button onClick={() => setEditing(tpl)}
                  className="settings-action">{uiText("menu.edit")}</button>
              ) : (
                <>
                  <button onClick={() => setEditing(tpl)}
                    className="settings-action">{uiText("menu.edit")}</button>
                  <button onClick={() => handleDelete(tpl.id)}
                    className="settings-action" data-tone="danger">{uiText("ui.AgentTemplateSettings.delete")}</button>
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
  const pending = useRef(false);
  const save = async (restore = false) => {
    if (pending.current) return;
    pending.current = true;
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
    finally { pending.current = false; setSaving(false); onSavingChange(false); }
  };
  return <form className="flex flex-col flex-1 min-h-0" onSubmit={event => { event.preventDefault(); event.stopPropagation(); void save(); }}>
    <div className="settings-body flex flex-col flex-1 min-h-0 overflow-y-auto px-6 py-4 gap-3">
      <label className="block shrink-0"><span className="text-[length:var(--text-11)] text-text-secondary block mb-1">{uiText("ui.AgentTemplateSettings.name")}</span>
        <input className="em-input w-full h-8 px-2.5 text-xs text-text-primary" readOnly value={template.name} /></label>
      <label className="block shrink-0"><span className="text-[length:var(--text-11)] text-text-secondary block mb-1">{uiText("collaboration.description")}</span>
        <input className="em-input w-full h-8 px-2.5 text-xs text-text-primary" readOnly value={appText(template.description)} /></label>
      <label className="flex flex-col flex-1 min-h-40"><span className="block text-[length:var(--text-11)] text-text-secondary mb-1">{uiText("collaboration.rules")}</span>
        <textarea className="em-input em-content-input w-full px-2.5 py-1.5 text-text-primary flex-1 min-h-0 disabled:opacity-60" disabled={saving} required placeholder={uiText("collaboration.rulesPlaceholder")} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
    </div>
    <div className="flex items-center justify-end gap-3 px-4 py-2 shrink-0">
      <button type="button" disabled={saving} onClick={() => void save(true)} className="settings-action mr-auto" data-tone="quiet">{uiText("collaboration.restore")}</button>
      <button type="button" disabled={saving} onClick={onClose} className="settings-action" data-tone="quiet">{uiText("common.cancel")}</button>
      <button type="submit" disabled={saving || !prompt.trim()} className="settings-action btn-accent">{uiText("ui.AgentTemplateSettings.save")}</button>
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
  const pending = useRef(false);

  const handleSave = async () => {
    if (pending.current || !name.trim() || !prompt.trim()) return;
    pending.current = true;
    setSaving(true);
    onSavingChange(true);
    try { await onSave({ name: name.trim(), description: desc.trim(), prompt: prompt.trim() }); }
    catch (error) { toast(uiText("collaboration.failed", { detail: appMessage(error instanceof Error ? error.message : String(error)) })); }
    finally { pending.current = false; setSaving(false); onSavingChange(false); }
  };

  return (
    <form className="flex flex-col flex-1 min-h-0" onSubmit={event => { event.preventDefault(); event.stopPropagation(); void handleSave(); }}>
      <div className="settings-body flex flex-col flex-1 min-h-0 overflow-y-auto px-6 py-4 gap-3">
      <div className="shrink-0">
        <label className="text-[length:var(--text-11)] text-text-secondary block mb-1 em-required">{uiText("ui.AgentTemplateSettings.name")}</label>
        <input className="em-input w-full h-8 px-2.5 text-xs text-text-primary disabled:opacity-60"
          disabled={saving} placeholder={uiText("ui.AgentTemplateSettings.eGTester")} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="shrink-0">
        <label className="text-[length:var(--text-11)] text-text-secondary block mb-1">{uiText("collaboration.description")}</label>
        <input className="em-input w-full h-8 px-2.5 text-xs text-text-primary disabled:opacity-60"
          disabled={saving} placeholder={uiText("collaboration.descriptionPlaceholder")} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="flex flex-col flex-1 min-h-40">
        <label className="text-[length:var(--text-11)] text-text-secondary block mb-1 em-required">{uiText("collaboration.rules")}</label>
        <textarea className="em-input em-content-input w-full px-2.5 py-1.5 text-text-primary disabled:opacity-60 flex-1 min-h-0" disabled={saving}
          placeholder={uiText("collaboration.rulesPlaceholder")}
          value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </div>
      </div>
      <div className="flex justify-end gap-2 px-4 py-2 shrink-0">
        <button type="button" onClick={onCancel} disabled={saving} className="settings-action" data-tone="quiet">{uiText("common.cancel")}</button>
          <button type="submit"
            disabled={saving || !name.trim() || !prompt.trim()}
            className="settings-action btn-accent">
            {uiText("ui.AgentTemplateSettings.save")}</button>
      </div>
    </form>
  );
}
