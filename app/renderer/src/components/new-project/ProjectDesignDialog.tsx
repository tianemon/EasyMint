import { useEffect, useState } from "react";
import { uiText } from "../../lib/i18n";
import { Modal } from "../ui/Modal";
import { STYLE_PRESETS } from "./style-presets";
import { StylePicker } from "./StylePicker";
import { createVisualSpec, type VisualSelection } from "../../../../shared/visual-design/spec";

export function ProjectDesignDialog({ projectPath, projectName, onClose }: {
  projectPath: string; projectName: string; onClose: () => void;
}) {
  const [selection, setSelection] = useState<VisualSelection | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    window.electronAPI.project.readDesign(projectPath).then(spec => {
      if (active) {
        const selected=spec?.selection ?? createVisualSpec().selection;
        const recovered=STYLE_PRESETS.find(style=>style.id===selected.brief);
        setSelection(recovered ? {...selected,styleId:recovered.id,brief:""} : selected);
      }
    }).catch(error => {
      if (active) setError(String(error.message ?? error));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectPath]);
  const patch = (value: Partial<VisualSelection>) => setSelection(old => ({ ...old, ...value }));
  const resolved = selection ? createVisualSpec(selection).selection : null;
  const save = async () => {
    if (!selection || saving) return;
    setSaving(true);
    setError("");
    try {
      await window.electronAPI.project.updateDesign(projectPath, selection);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(/user changes|user-edited|content merge|not linked/i.test(message)
        ? uiText("creation.design.conflict") : message);
    } finally { setSaving(false); }
  };
  return <Modal onClose={() => { if (!saving) onClose(); }}>
    <div className="bg-surface rounded-[var(--radius-lg)] w-[min(1100px,96vw)] max-h-[94vh] overflow-auto p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{uiText("creation.design.edit")}</h2>
        <button type="button" onClick={onClose} disabled={saving} aria-label={uiText("common.close")}>✕</button>
      </div>
      {loading && <p role="status">{uiText("creation.design.loading")}</p>}
      {selection && resolved && <StylePicker
        value={selection.brief || selection.styleId || ""} onChange={styleId => patch({ styleId, brief: (!styleId || styleId === "custom" || STYLE_PRESETS.some(style=>style.id===styleId)) ? "" : styleId })}
        appearance={{ palette: resolved.palette, effect: resolved.effect }}
        onAppearanceChange={value => patch({ ...value, ...(value.palette !== selection.palette ? { brandId: "" } : {}) })}
        brandId={selection.brandId} onBrandChange={brandId => patch({ brandId, palette: "default" })}
        layout={resolved.layout} onLayoutChange={layout => patch({ layout })}
        targets={selection.targets} projectName={projectName}
      />}
      {error && <p role="alert" className="text-danger mt-3">{error}</p>}
      <div className="flex justify-end gap-3 mt-4">
        <button type="button" onClick={onClose} disabled={saving}>{uiText("common.cancel")}</button>
        <button type="button" className="btn-accent px-5 py-2 rounded-[var(--radius-lg)]" disabled={!selection || saving} onClick={save}>{uiText("creation.design.save")}</button>
      </div>
    </div>
  </Modal>;
}
