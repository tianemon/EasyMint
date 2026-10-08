import { appText } from "../lib/i18n";
import { uiText, useUiLocale } from "../lib/i18n";
import { useMemo, useState } from "react";
import type { ContextImageEntry } from "@shared/image-context";
import { Modal } from "./ui/Modal";

function sizeLabel(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageRecoveryDialog({ candidates, onCancel, onConfirm, mode = "retry", currentImageCount = 0 }: {
  candidates: ContextImageEntry[];
  onCancel: () => void;
  onConfirm: (entryIds: string[], omitCurrentImages: boolean) => Promise<string | null>;
  mode?: "retry" | "manage";
  currentImageCount?: number;
}): JSX.Element {
  useUiLocale();
  // Proactive cleanup keeps the newest image message unless the user selects it explicitly.
  const [selected, setSelected] = useState(() => new Set((mode === "manage" ? candidates.slice(0, -1) : candidates).map((entry) => entry.entryId)));
  const [omitCurrentImages, setOmitCurrentImages] = useState(mode === "retry" && candidates.length === 0 && currentImageCount > 0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totals = useMemo(() => candidates.reduce((sum, entry) => selected.has(entry.entryId)
    ? { images: sum.images + entry.imageCount, bytes: sum.bytes + entry.encodedBytes }
    : sum, { images: 0, bytes: 0 }), [candidates, selected]);

  const submit = async () => {
    if (working || (selected.size === 0 && !omitCurrentImages)) return;
    setWorking(true);
    setError(null);
    try {
      setError(await onConfirm([...selected], omitCurrentImages));
    } catch (e) {
      setError(e instanceof Error ? e.message : uiText("ui.ChatPanel.cleanupFailedTryAgain"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal tier="modal" overlayClassName="bg-black/40 backdrop-blur-sm" onClose={() => { if (!working) onCancel(); }}>
      <div className="bg-[var(--modal-fill)] rounded-[var(--radius-lg)] p-5 max-w-lg w-full shadow-2xl mx-4">
        <div className="text-sm font-medium text-text-primary mb-2">{mode === "retry" ? uiText("ui.ImageRecoveryDialog.cleanUpHistoricalImagesAndRetry") : uiText("ui.ChatPanel.cleanUpHistoricalImages")}</div>
        <p className="text-xs text-text-secondary leading-relaxed mb-3">
          {uiText("ui.ImageRecoveryDialog.selectedImagesWillNoLongerBeSent")}{mode === "retry" ? uiText("ui.ImageRecoveryDialog.theFailedTurnWillBeRewoundAnd") : ""}
        </p>
        {candidates.length > 0 ? <div className="max-h-64 overflow-y-auto rounded-[var(--radius-lg)] border border-border divide-y divide-border">
          {candidates.map((entry) => (
            <label key={entry.entryId} className="flex gap-2 items-start px-3 py-2 cursor-pointer hover:bg-surface-hover">
              <input
                type="checkbox"
                checked={selected.has(entry.entryId)}
                disabled={working}
                onChange={(event) => setSelected((previous) => {
                  const next = new Set(previous);
                  if (event.target.checked) next.add(entry.entryId);
                  else next.delete(entry.entryId);
                  return next;
                })}
              />
              <span className="min-w-0 flex-1 text-xs text-text-secondary">
                <span className="block truncate text-text-primary">{entry.preview || uiText("ui.ImageRecoveryDialog.historicalImageMessages")}</span>
                {uiText("counts.images", { count: entry.imageCount })}{" · "}{sizeLabel(entry.encodedBytes)}
              </span>
            </label>
          ))}
        </div> : <p className="text-xs text-text-muted">{uiText("ui.ImageRecoveryDialog.noHistoricalImagesToRemove")}</p>}
        {mode === "retry" && currentImageCount > 0 && (
          <label className="flex gap-2 items-center mt-3 text-xs text-text-secondary cursor-pointer">
            <input type="checkbox" checked={omitCurrentImages} disabled={working} onChange={(event) => setOmitCurrentImages(event.target.checked)} />
            {uiText("counts.sendImagesAsPaths", { count: currentImageCount })}</label>
        )}
        <div className="text-xs text-text-muted mt-2">{totals.images > 0 ? uiText("ui.ImageRecoveryDialog.historicalImagesSelectedReducingAboutOfImage", { v0: totals.images, v1: sizeLabel(totals.bytes) }) : uiText("ui.ImageRecoveryDialog.noHistoricalImagesSelected")}</div>
        {error && <p className="text-xs text-danger mt-2" role="alert">{appText(error)}</p>}
        <div className="flex gap-2 justify-end mt-4">
          <button type="button" disabled={working} className="px-4 py-1.5 text-xs rounded-[var(--radius-lg)] bg-surface-alt border border-border text-text-secondary hover:text-text-primary" onClick={onCancel}>{uiText("common.cancel")}</button>
          <button type="button" disabled={working || (selected.size === 0 && !omitCurrentImages)} className="px-4 py-1.5 text-xs rounded-[var(--radius-lg)] btn-accent disabled:opacity-50" onClick={() => { void submit(); }}>
            {working ? uiText("ui.ImageRecoveryDialog.cleaningUp") : mode === "retry" ? selected.size === 0 ? uiText("ui.ImageRecoveryDialog.retryWithPaths") : uiText("ui.ImageRecoveryDialog.cleanUpAndRetry") : uiText("ui.ImageRecoveryDialog.cleanUpSelectedImages")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
