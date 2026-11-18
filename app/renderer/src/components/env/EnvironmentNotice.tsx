import { useEffect, useState } from "react";
import { uiText, useUiLocale } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settings-store";
import { requiredEnvironmentProblems, useEnvironment } from "./useEnvironment";

export function useEnvironmentNotice() {
  const { report, operation, checking, probeFailed } = useEnvironment();
  const sandboxDisabled = useSettingsStore(store => store.sandboxDisabled);
  const first = requiredEnvironmentProblems(report, sandboxDisabled)[0];
  const [dismissed, setDismissed] = useState<string>();
  const id = first?.id;
  useEffect(() => { if (!id) setDismissed(undefined); }, [id]);
  return {
    id,
    visible: Boolean(id && id !== dismissed && !operation && !checking && !probeFailed),
    dismiss: () => setDismissed(id),
  };
}

export function EnvironmentNotice({ runtime, onLater, onRepair }: {
  runtime: boolean;
  onLater: () => void;
  onRepair: () => void;
}) {
  useUiLocale();
  return (
    <aside className="environment-notice" aria-label={uiText("environment.noticeTitle")}>
      <p className="text-sm font-medium text-text-primary">{uiText("environment.noticeTitle")}</p>
      <p className="text-xs text-text-secondary">{uiText(runtime ? "environment.runtimeImpact" : "environment.linuxImpact")}</p>
      <div className="flex flex-wrap justify-end gap-1.5">
        <button type="button" className="settings-action settings-action--compact" data-tone="quiet" onClick={onLater}>{uiText("environment.later")}</button>
        <button type="button" className="settings-action settings-action--compact btn-accent" onClick={onRepair}>{uiText("environment.openRepair")}</button>
      </div>
    </aside>
  );
}
