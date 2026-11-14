import { useState } from "react";
import type { CollaborationMode, MainChatProfile } from "@shared/collaboration";
import { uiText, useUiLocale, appMessage } from "../../lib/i18n";
import { useConversationConfig, useConversationStore } from "../../stores/conversation-store";
import { MintAvatar } from "../MintAvatar";
import { toast } from "../ui/Toast";
import { modeDisplay } from "../../lib/collaboration";
import { PromptEditorDialog } from "../PromptEditorDialog";
import { Checkbox } from "../ui/Checkbox";

const inputClass = "em-input w-full px-2.5 py-1.5 text-xs text-text-primary";
const labelClass = "block text-[length:var(--text-11)] text-text-secondary mb-1";

export function MainChatSettings({ onClose, onSavingChange }: { onClose: () => void; onSavingChange?: (saving: boolean) => void }): JSX.Element {
  const config = useConversationConfig();
  if (!config) return <p className="text-xs text-text-secondary">{uiText("ui.AgentTemplateSettings.loading")}</p>;
  return <MainChatForm initial={config.main} onClose={onClose} onSavingChange={onSavingChange} />;
}

function MainChatForm({ initial, onClose, onSavingChange }: { initial: MainChatProfile; onClose: () => void; onSavingChange?: (saving: boolean) => void }): JSX.Element {
  useUiLocale();
  const [profile, setProfile] = useState(initial);
  const [saving, setSaving] = useState(false);
  const updateSaving = (value: boolean) => { setSaving(value); onSavingChange?.(value); };
  const update = useConversationStore(state => state.setConfig);
  const save = async (restore = false) => {
    updateSaving(true);
    try {
      const config = restore ? await window.electronAPI.conversation.restoreMain() : await window.electronAPI.conversation.saveMain(profile);
      update(config);
      setProfile(config.main);
      if (!restore) onClose();
    } catch (error) { toast(uiText("collaboration.failed", { detail: appMessage(error instanceof Error ? error.message : String(error)) })); }
    finally { updateSaving(false); }
  };
  const upload = async (file: File) => {
    updateSaving(true);
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error(uiText("collaboration.avatarInvalid"));
      const image = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 256 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error(uiText("collaboration.avatarInvalid"));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setProfile(value => ({ ...value, avatar: canvas.toDataURL("image/webp", 0.9) }));
      } finally { image.close(); }
    } catch (error) { toast(uiText("collaboration.failed", { detail: appMessage(error instanceof Error ? error.message : String(error)) })); }
    finally { updateSaving(false); }
  };
  return <form className="flex flex-col flex-1 min-h-0" onSubmit={event => { event.preventDefault(); event.stopPropagation(); void save(); }}>
    <div className="settings-body flex flex-col flex-1 min-h-0 overflow-y-auto px-6 py-4 gap-4">
    <div className="flex items-center gap-3 shrink-0">
      {profile.avatar ? <img src={profile.avatar} alt={uiText("collaboration.avatar")} className="w-10 h-10 rounded-[var(--radius-lg)] object-cover" /> : <MintAvatar size={40} />}
      <label className="text-xs text-accent cursor-pointer">{uiText("collaboration.changeAvatar")}
        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={saving} className="sr-only"
          onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
      </label>
    </div>
    <label className="block shrink-0"><span className={labelClass}>{uiText("collaboration.nickname")}</span>
      <input className={inputClass} required maxLength={40} placeholder={uiText("collaboration.nicknamePlaceholder")} value={profile.nickname} onChange={event => setProfile({ ...profile, nickname: event.target.value })} /></label>
    <label className="block shrink-0"><span className={labelClass}>{uiText("collaboration.personality")}</span>
      <textarea className={`${inputClass} h-28 resize-none`} placeholder={uiText("collaboration.personalityPlaceholder")} value={profile.personality} onChange={event => setProfile({ ...profile, personality: event.target.value })} /></label>
    <label className="flex flex-col flex-1 min-h-40"><span className={labelClass}>{uiText("collaboration.rules")}</span>
      <textarea className={`${inputClass} flex-1 min-h-0 resize-none`} rows={5} placeholder={uiText("collaboration.rulesPlaceholder")} value={profile.rules} onChange={event => setProfile({ ...profile, rules: event.target.value })} /></label>
    </div>
    <div className="flex justify-end items-center gap-3 px-4 py-2 shrink-0">
      <button type="button" disabled={saving} onClick={() => void save(true)} className="mr-auto text-xs text-text-secondary hover:text-text-primary">{uiText("collaboration.restore")}</button>
      <button type="button" onClick={onClose} disabled={saving} className="text-xs text-text-secondary">{uiText("common.cancel")}</button>
      <button type="submit" disabled={saving || !profile.nickname.trim()} className="btn-accent rounded-[var(--radius-lg)] px-4 py-1.5 text-xs disabled:opacity-50">{uiText("ui.AgentTemplateSettings.save")}</button>
    </div>
  </form>;
}

export function CollaborationSettings(): JSX.Element {
  useUiLocale();
  const config = useConversationConfig();
  const [editing, setEditing] = useState<CollaborationMode | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const update = useConversationStore(state => state.setConfig);
  const draft = editing ?? { name: "", scenario: "", prompt: "", defaultEnabled: false };
  const submit = async (action: "save" | "delete" | "restore") => {
    setSaving(true);
    try {
      const result = action === "delete" && editing ? await window.electronAPI.conversation.deleteMode(editing.id)
        : action === "restore" && editing ? await window.electronAPI.conversation.restoreMode(editing.id)
          : await window.electronAPI.conversation.saveMode({ ...draft, id: editing?.id || undefined });
      update(result);
      if (action === "restore") setEditing(result.modes.find(mode => mode.id === editing?.id) ?? null);
      else { setEditing(null); setAdding(false); }
    } catch (error) { toast(uiText("collaboration.failed", { detail: appMessage(error instanceof Error ? error.message : String(error)) })); }
    finally { setSaving(false); }
  };
  const editField = (value: Partial<CollaborationMode>) => setEditing({ ...draft, id: "", builtin: false, ...editing, ...value });
  const closeEditor = () => { setAdding(false); setEditing(null); };
  const editor = (adding || editing) && <PromptEditorDialog title={editing?.id ? modeDisplay(editing, "name") : uiText("collaboration.addMode")} onClose={closeEditor} busy={saving}>
    <form className="flex flex-col flex-1 min-h-0" onSubmit={event => { event.preventDefault(); event.stopPropagation(); void submit("save"); }}>
    <div className="settings-body flex flex-col flex-1 min-h-0 overflow-y-auto px-6 py-4 gap-4">
    <label className="block shrink-0"><span className={labelClass}>{uiText("ui.AgentTemplateSettings.name")}</span><input required maxLength={40} className={inputClass} placeholder={uiText("collaboration.modeNamePlaceholder")} value={modeDisplay(draft, "name")} onChange={event => editField({ name: event.target.value })} /></label>
    <label className="block shrink-0"><span className={labelClass}>{uiText("collaboration.scenario")}</span><input maxLength={200} className={inputClass} placeholder={uiText("collaboration.scenarioPlaceholder")} value={modeDisplay(draft, "scenario")} onChange={event => editField({ scenario: event.target.value })} /></label>
    <label className="flex flex-col flex-1 min-h-40"><span className={labelClass}>{uiText("collaboration.rules")}</span><textarea required className={`${inputClass} flex-1 min-h-0`} placeholder={uiText("collaboration.modeRulesPlaceholder")} value={draft.prompt} onChange={event => editField({ prompt: event.target.value })} /></label>
    <div className="flex items-center gap-2 text-xs text-text-secondary shrink-0 cursor-pointer"
      onClick={() => { if (!saving) editField({ defaultEnabled: !draft.defaultEnabled }); }}>
      <Checkbox checked={draft.defaultEnabled} disabled={saving} ariaLabel={uiText("collaboration.defaultEnabled")}
        onChange={checked => editField({ defaultEnabled: checked })} />
      <span>{uiText("collaboration.defaultEnabled")}</span>
    </div>
    </div>
    <div className="flex justify-end gap-3 px-4 py-2 shrink-0">
      {editing?.builtin && <button type="button" disabled={saving} className="mr-auto text-xs text-text-secondary" onClick={() => void submit("restore")}>{uiText("collaboration.restore")}</button>}
      {editing?.id && !editing.builtin && <button type="button" disabled={saving} className="mr-auto text-xs text-danger" onClick={() => void submit("delete")}>{uiText("ui.AgentTemplateSettings.delete")}</button>}
      <button type="button" disabled={saving} className="text-xs text-text-secondary" onClick={() => { setAdding(false); setEditing(null); }}>{uiText("common.cancel")}</button>
      <button type="submit" disabled={saving} className="btn-accent rounded-[var(--radius-lg)] px-4 py-1.5 text-xs disabled:opacity-50">{uiText("ui.AgentTemplateSettings.save")}</button>
    </div>
  </form></PromptEditorDialog>;
  return <div className="space-y-3">
    {editor}
    <div className="flex justify-end"><button className="text-xs text-accent px-3 py-1" onClick={() => setAdding(true)}>{uiText("collaboration.addMode")}</button></div>
    {config?.modes.map(mode => <div key={mode.id} className="flex items-center gap-3 p-3 rounded-[var(--radius-lg)] bg-surface-alt">
      <div className="min-w-0 flex-1"><div className="text-sm text-text-primary">{modeDisplay(mode, "name")}</div><p className="text-[length:var(--text-11)] text-text-secondary mt-1">{modeDisplay(mode, "scenario")}</p></div>
      <button onClick={() => setEditing(mode)} className="text-xs text-text-secondary hover:text-text-primary">{uiText("menu.edit")}</button>
    </div>)}
  </div>;
}
