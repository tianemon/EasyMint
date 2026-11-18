import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CollaborationMode, MainChatProfile } from "@shared/collaboration";
import { uiText, useUiLocale, appMessage, appText } from "../../lib/i18n";
import { useConversationConfig, useConversationStore } from "../../stores/conversation-store";
import { MintAvatar } from "../MintAvatar";
import { toast } from "../ui/Toast";
import { modeDisplay } from "../../lib/collaboration";
import { PromptEditorDialog } from "../PromptEditorDialog";
import { Checkbox } from "../ui/Checkbox";

const inputClass = "em-input w-full px-2.5 py-1.5 text-xs text-text-primary disabled:opacity-60";
const labelClass = "block text-[length:var(--text-11)] text-text-secondary mb-1";
export interface RoleFooterSlots { restore: HTMLElement | null; save: HTMLElement | null }
function reloadAfterConflict(): void {
  void useConversationStore.getState().load().catch(error => console.error("[conversation] reload", error));
}

export function MainChatSettings({ onSaved, onSavingChange, roleFooter }: { onSaved?: () => void; onSavingChange?:(saving:boolean)=>void; roleFooter?: RoleFooterSlots }): JSX.Element {
  const config = useConversationConfig();
  if (!config) return <p className="text-xs text-text-secondary">{uiText("ui.AgentTemplateSettings.loading")}</p>;
  return <MainChatForm initial={config.main} initialRevision={config.mainRevision} warning={config.warning} onSaved={onSaved} onSavingChange={onSavingChange} roleFooter={roleFooter} />;
}

function MainChatForm({ initial, initialRevision, warning, onSaved, onSavingChange, roleFooter }: { initial: MainChatProfile; initialRevision?: string; warning?: string; onSaved?: () => void;onSavingChange?:(saving:boolean)=>void; roleFooter?: RoleFooterSlots }): JSX.Element {
  useUiLocale();
  const formId = useId();
  const [profile, setProfile] = useState(initial);
  const [revision, setRevision] = useState(initialRevision);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const updateSaving = (value: boolean) => {setSaving(value);onSavingChange?.(value);};
  const update = useConversationStore(state => state.setConfig);
  useEffect(() => {
    if (!dirty) { setProfile(initial); setRevision(initialRevision); }
  }, [initial, initialRevision, dirty]);
  const edit = (value: Partial<MainChatProfile>) => { setDirty(true); setProfile(current => ({ ...current, ...value })); };
  const save = async (restore = false) => {
    if (pending.current || (!restore && !profile.nickname.trim())) return;
    pending.current = true;
    updateSaving(true);
    try {
      const config = restore ? await window.electronAPI.conversation.restoreMain(revision) : await window.electronAPI.conversation.saveMain(profile, revision);
      update(config);
      setProfile(config.main);
      setRevision(config.mainRevision);
      setDirty(false);
      if (!restore) onSaved?.();
    } catch (error) { toast(uiText("collaboration.failed", { detail: appMessage(error instanceof Error ? error.message : String(error)) })); reloadAfterConflict(); }
    finally { pending.current = false; updateSaving(false); }
  };
  const upload = async (file: File) => {
    if (pending.current) return;
    pending.current = true;
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
        edit({ avatar: canvas.toDataURL("image/webp", 0.9) });
      } finally { image.close(); }
    } catch (error) { toast(uiText("collaboration.failed", { detail: appMessage(error instanceof Error ? error.message : String(error)) })); }
    finally { pending.current = false; updateSaving(false); }
  };
  const restoreAction = <button type="button" disabled={saving} onClick={() => void save(true)} className="settings-action mr-auto" data-tone="quiet">{uiText("collaboration.restore")}</button>;
  const saveAction = <button type="submit" form={formId} disabled={saving || !profile.nickname.trim()} className="btn-accent rounded-[var(--radius-lg)] px-5 py-1.5 text-sm font-medium disabled:opacity-50">{uiText("ui.AgentTemplateSettings.save")}</button>;
  return <form id={formId} noValidate aria-label={uiText("collaboration.mainChat")} className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); event.stopPropagation(); void save(); }}>
    <div className="settings-body flex flex-col gap-3">
    {warning && <p role="alert" className="text-sm text-warning break-words">{appText(warning)}</p>}
    <div className="flex items-center gap-4 shrink-0 pb-1">
      <button type="button" disabled={saving} aria-label={uiText("collaboration.changeAvatar")} title={uiText("collaboration.changeAvatar")}
        onClick={() => avatarInput.current?.click()}
        className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-lg)] bg-[var(--field-idle)] hover:bg-surface-hover focus-visible:bg-surface-hover transition-colors disabled:opacity-60">
        {profile.avatar ? <img src={profile.avatar} alt={uiText("collaboration.avatar")} className="size-full object-cover" /> : <MintAvatar size={48} />}
      </button>
        <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" disabled={saving} className="hidden"
          onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
      <div className="grid flex-1 min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-2 gap-y-2 sm:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]">
        <label htmlFor={`${formId}-nickname`} className="whitespace-nowrap text-[length:var(--text-11)] text-text-secondary">{uiText("collaboration.nickname")}</label>
        <input id={`${formId}-nickname`} className={`${inputClass} h-9 min-w-0`} disabled={saving} required maxLength={40} placeholder={uiText("collaboration.nicknamePlaceholder")} value={profile.nickname} onChange={event => edit({ nickname: event.target.value })} />
        <label htmlFor={`${formId}-user-address`} className="whitespace-nowrap text-[length:var(--text-11)] text-text-secondary sm:ml-3">{uiText("collaboration.userAddress")}</label>
        <input id={`${formId}-user-address`} className={`${inputClass} h-9 min-w-0`} disabled={saving} maxLength={40} placeholder={uiText("collaboration.userAddressPlaceholder")} value={profile.userAddress} onChange={event => edit({ userAddress: event.target.value })} />
      </div>
    </div>
    <label className="block shrink-0"><span className={labelClass}>{uiText("collaboration.personality")}</span>
      <textarea className={`${inputClass} em-content-input h-28 resize-none`} disabled={saving} placeholder={uiText("collaboration.personalityPlaceholder")} value={profile.personality} onChange={event => edit({ personality: event.target.value })} /></label>
    <label className="block"><span className={labelClass}>{uiText("collaboration.mainRules")}</span>
      <textarea className={`${inputClass} em-content-input h-40 resize-none`} disabled={saving} placeholder={uiText("collaboration.instructionsPlaceholder")} value={profile.rules} onChange={event => edit({ rules: event.target.value })} /></label>
    </div>
    {roleFooter?.restore && roleFooter.save
      ? <>{createPortal(restoreAction, roleFooter.restore)}{createPortal(saveAction, roleFooter.save)}</>
      : <div className="flex justify-end items-center gap-3 shrink-0">{restoreAction}{saveAction}</div>}
  </form>;
}

export function CollaborationSettings(): JSX.Element {
  useUiLocale();
  const config = useConversationConfig();
  const [editing, setEditing] = useState<CollaborationMode | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const update = useConversationStore(state => state.setConfig);
  const draft = editing ?? { name: "", scenario: "", prompt: "", defaultEnabled: false };
  const canSave = Boolean(modeDisplay(draft, "name").trim() && draft.prompt.trim());
  const submit = async (action: "save" | "delete" | "restore") => {
    if (pending.current) return;
    if (action === "save" && !canSave) return;
    pending.current = true;
    setSaving(true);
    try {
      const result = action === "delete" && editing ? await window.electronAPI.conversation.deleteMode(editing.id, editing.revision)
        : action === "restore" && editing ? await window.electronAPI.conversation.restoreMode(editing.id, editing.revision)
          : await window.electronAPI.conversation.saveMode({ ...draft, id: editing?.id || undefined });
      update(result);
      if (action === "restore") setEditing(result.modes.find(mode => mode.id === editing?.id) ?? null);
      else { setEditing(null); setAdding(false); }
    } catch (error) { toast(uiText("collaboration.failed", { detail: appMessage(error instanceof Error ? error.message : String(error)) })); reloadAfterConflict(); }
    finally { pending.current = false; setSaving(false); }
  };
  const editField = (value: Partial<CollaborationMode>) => setEditing({ ...draft, id: "", builtin: false, ...editing, ...value,
    customizedFields: [...new Set([...(editing?.customizedFields ?? []), ...(["name", "scenario"] as const).filter(key => value[key] !== undefined)])],
  });
  const closeEditor = () => { setAdding(false); setEditing(null); };
  const editor = (adding || editing) && <PromptEditorDialog title={editing?.id ? modeDisplay(editing, "name") : uiText("collaboration.addMode")} onClose={closeEditor} busy={saving}>
    <form noValidate className="flex flex-col flex-1 min-h-0" onSubmit={event => { event.preventDefault(); event.stopPropagation(); void submit("save"); }}>
    <div className="settings-body flex flex-col flex-1 min-h-0 overflow-y-auto px-6 py-4 gap-4">
    <label className="block shrink-0"><span className={labelClass}>{uiText("ui.AgentTemplateSettings.name")}</span><input disabled={saving} required maxLength={40} className={inputClass} placeholder={uiText("collaboration.modeNamePlaceholder")} value={modeDisplay(draft, "name")} onChange={event => editField({ name: event.target.value })} /></label>
    <label className="block shrink-0"><span className={labelClass}>{uiText("collaboration.scenario")}</span><input disabled={saving} maxLength={200} className={inputClass} placeholder={uiText("collaboration.scenarioPlaceholder")} value={modeDisplay(draft, "scenario")} onChange={event => editField({ scenario: event.target.value })} /></label>
    <label className="flex flex-col flex-1 min-h-40"><span className={labelClass}>{uiText("collaboration.rules")}</span><textarea disabled={saving} required className={`${inputClass} em-content-input flex-1 min-h-0`} placeholder={uiText("collaboration.modeRulesPlaceholder")} value={draft.prompt} onChange={event => editField({ prompt: event.target.value })} /></label>
    <div className="flex items-center gap-2 text-xs text-text-secondary shrink-0 cursor-pointer"
      onClick={() => { if (!saving) editField({ defaultEnabled: !draft.defaultEnabled }); }}>
      <Checkbox checked={draft.defaultEnabled} disabled={saving} ariaLabel={uiText("collaboration.defaultEnabled")}
        onChange={checked => editField({ defaultEnabled: checked })} />
      <span>{uiText("collaboration.defaultEnabled")}</span>
    </div>
    </div>
    <div className="flex justify-end gap-3 px-4 py-2 shrink-0">
      {editing?.builtin && <button type="button" disabled={saving} className="settings-action mr-auto" data-tone="quiet" onClick={() => void submit("restore")}>{uiText("collaboration.restore")}</button>}
      {editing?.id && !editing.builtin && <button type="button" disabled={saving} className="settings-action mr-auto" data-tone="danger" onClick={() => void submit("delete")}>{uiText("ui.AgentTemplateSettings.delete")}</button>}
      <button type="button" disabled={saving} className="settings-action" data-tone="quiet" onClick={() => { setAdding(false); setEditing(null); }}>{uiText("common.cancel")}</button>
      <button type="submit" disabled={saving || !canSave} className="settings-action btn-accent">{uiText("ui.AgentTemplateSettings.save")}</button>
    </div>
  </form></PromptEditorDialog>;
  return <div className="space-y-3">
    {editor}
    <div className="flex justify-end"><button className="settings-action" data-tone="accent" onClick={() => setAdding(true)}>{uiText("collaboration.addMode")}</button></div>
    {config?.modes.map(mode => <div key={mode.id} className="flex items-center gap-3 p-3 rounded-[var(--radius-lg)] bg-surface-alt">
      <div className="min-w-0 flex-1"><div className="text-sm text-text-primary">{modeDisplay(mode, "name")}</div><p className="text-[length:var(--text-11)] text-text-secondary mt-1">{modeDisplay(mode, "scenario")}</p></div>
      <button onClick={() => setEditing(mode)} className="settings-action">{uiText("menu.edit")}</button>
    </div>)}
  </div>;
}
