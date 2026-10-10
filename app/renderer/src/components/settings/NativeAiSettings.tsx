import { useEffect, useState } from "react";
import { AUTO_MODEL_ID, type ModelReference, type NativeAiSettings as Configuration } from "@shared/native-ai";
import { Select } from "../Select";
import { uiText, useUiLocale } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settings-store";

type Choice = ModelReference & { name: string };
const encode = (value?: ModelReference) => value ? JSON.stringify(value) : "";

export function NativeAiSettings(): JSX.Element {
  useUiLocale();
  const [models, setModels] = useState<{ chat: Choice[]; image: Choice[] }>({ chat: [], image: [] });
  const [image, setImage] = useState("");
  const [planning, setPlanning] = useState("");
  const [execution, setExecution] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => Promise.all([window.electronAPI.settings.get(), window.electronAPI.agent.nativeAiModels()])).then(([settings, catalog]) => {
      if (!active) return;
      setModels(catalog);
      setImage(encode(settings.nativeAi?.imageModel));
      setPlanning(encode(settings.nativeAi?.autoRouting?.planning));
      setExecution(encode(settings.nativeAi?.autoRouting?.execution));
      setLoaded(true);
    }).catch(reason => { if (active) setError(String(reason instanceof Error ? reason.message : reason)); });
    return () => { active = false; };
  }, []);
  const choices = (items: Choice[], value: string) => {
    const result = [{ value: "", label: uiText("pi.notConfigured") },
      ...items.map(item => ({ value: encode({ provider: item.provider, model: item.model }), label: `${item.provider} / ${item.name}` }))];
    if (value && !result.some(item => item.value === value)) result.push({ value, label: uiText("pi.unavailable") });
    return result;
  };
  const save = async () => {
    setSaving(true); setError(""); setSaved(false);
    try {
      const config: Configuration = {
        ...(image ? { imageModel: JSON.parse(image) as ModelReference } : {}),
        ...(planning && execution ? { autoRouting: { planning: JSON.parse(planning) as ModelReference, execution: JSON.parse(execution) as ModelReference } } : {}),
      };
      await window.electronAPI.settings.set("nativeAi", config);
      await useSettingsStore.getState().loadFromElectron();
      setSaved(true);
    } catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); }
    finally { setSaving(false); }
  };
  const field = (label: string, value: string, change: (v: string) => void, items: Choice[]) => (
    <label className="flex flex-col gap-2 text-xs text-text-secondary">
      <span>{label}</span>
      <Select block value={value} disabled={!loaded || saving} options={choices(items, value)} onChange={v => { change(v); setSaved(false); }} />
    </label>
  );
  return (
    <section>
      <h3 className="text-sm font-medium text-text-secondary mb-2">{uiText("pi.nativeAi")}</h3>
      <div className="bg-surface-alt rounded-[var(--radius-lg)] px-4 py-3 space-y-3">
        {field(uiText("pi.imageModel"), image, setImage, models.image)}
        <p className="text-[length:var(--text-2xs)] text-text-muted">{uiText("pi.imageHint")}</p>
        {field(uiText("pi.planningModel"), planning, setPlanning, models.chat)}
        {field(uiText("pi.executionModel"), execution, setExecution, models.chat)}
        <p className="text-[length:var(--text-2xs)] text-text-muted">{uiText("pi.routingHint", { id: AUTO_MODEL_ID })}</p>
        <button type="button" className="btn-primary text-xs" disabled={!loaded || saving || !!planning !== !!execution} onClick={() => { void save(); }}>{uiText(saving ? "pi.saving" : "pi.save")}</button>
        {saved && <p role="status" className="text-xs text-success">{uiText("pi.saved")}</p>}
        {error && <p role="alert" className="text-xs text-danger">{
          error === "Wait until the automatic-model run finishes before changing routing" ? uiText("pi.routingBusy")
            : error === "Image model is unavailable" || error === "Routing model is unavailable" ? uiText("pi.unavailable")
              : error.includes("nativeAiModels") ? uiText("pi.restartRequired") : error
        }</p>}
      </div>
    </section>
  );
}
