import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { uiText, useUiLocale } from "../lib/i18n";
import { CodexQuotaSection } from "./CodexQuotaSection";
import { Modal } from "./ui/Modal";

/** Subscription usage belongs to the enabled provider, including empty sessions. */
export function PlanUsageButton(): JSX.Element | null {
  useUiLocale();
  const providers = useSettingsStore(state => state.apiProviders);
  const [open, setOpen] = useState(false);
  const current = providers?.current ? providers.configs[providers.current] : undefined;
  useEffect(() => setOpen(false), [current?.id]);
  if (current?.presetId !== "openai-codex") return null;

  return (
    <>
      <button type="button" className="permission-mode-trigger text-text-secondary whitespace-nowrap" onClick={() => setOpen(true)}>
        {uiText("ui.PlanUsage.title")}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} overlayClassName="bg-overlay">
          <div role="dialog" aria-modal="true" aria-label={uiText("ui.PlanUsage.title")} className="bg-[var(--modal-fill)] rounded-[var(--radius-lg)] shadow-2xl w-[360px] max-w-[calc(100vw-32px)] p-5 text-xs">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-text-primary">{uiText("ui.PlanUsage.title")}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label={uiText("common.close")} className="text-text-muted hover:text-text-primary">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 4 8 8m0-8-8 8" /></svg>
              </button>
            </div>
            <CodexQuotaSection active />
          </div>
        </Modal>
      )}
    </>
  );
}
