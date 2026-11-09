import { useCallback, useEffect, useRef, useState } from "react";
import { uiText, useUiLocale } from "../../lib/i18n";
import { hasOpenModal } from "../ui/Modal";

const DISMISSED_KEY = "easymint_mobile_connection_guide_v2";
const DISMISSED_EVENT = "easymint:mobile-guide-dismissed";

function wasDismissed(): boolean {
  try { return localStorage.getItem(DISMISSED_KEY) === "dismissed"; } catch { return false; }
}
export function dismissMobileConnectionGuide(): void {
  try { localStorage.setItem(DISMISSED_KEY, "dismissed"); } catch { /* Persist through the main process instead. */ }
  void window.electronAPI?.settings?.set("mobileConnectionGuideDismissed", true)
    .catch((error: unknown) => console.error("[mobile-guide] Could not save dismissal", error));
  window.dispatchEvent(new Event(DISMISSED_EVENT));
}

export function useMobileConnectionGuide(blocked: boolean): { visible: boolean; dismiss: () => void } {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(wasDismissed);
  const dismissedRef = useRef(dismissed);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const settings = await window.electronAPI?.settings?.get();
        if (!active) return;
        if (settings?.mobileConnectionGuideDismissed || dismissedRef.current) {
          dismissedRef.current = true; setDismissed(true);
          // Migrate an earlier local-only dismissal to the persistent settings store.
          if (!settings?.mobileConnectionGuideDismissed) void window.electronAPI?.settings?.set("mobileConnectionGuideDismissed", true)
            .catch((error: unknown) => console.error("[mobile-guide] Could not migrate dismissal", error));
        }
      } catch (error) { console.error("[mobile-guide] Could not read dismissal", error); }
      finally { if (active) setLoaded(true); }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const onDismiss = (): void => { dismissedRef.current = true; setDismissed(true); setVisible(false); };
    const onStorage = (event: StorageEvent): void => { if (event.key === DISMISSED_KEY && event.newValue === "dismissed") onDismiss(); };
    window.addEventListener(DISMISSED_EVENT, onDismiss);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener(DISMISSED_EVENT, onDismiss); window.removeEventListener("storage", onStorage); };
  }, []);
  useEffect(() => {
    if (!loaded || blocked || dismissed) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const showWhenClear = (): void => {
      if (!active || wasDismissed()) return;
      if (hasOpenModal()) { timer = setTimeout(showWhenClear, 1000); return; }
      setVisible(true);
    };
    timer = setTimeout(showWhenClear, 1800);
    return () => { active = false; clearTimeout(timer); };
  }, [blocked, dismissed, loaded]);
  const dismiss = useCallback(() => { dismissMobileConnectionGuide(); setVisible(false); setDismissed(true); }, []);
  return { visible: visible && !blocked && !dismissed, dismiss };
}

export function MobileConnectionGuide({ onClose, onOpen }: { onClose: () => void; onOpen: () => void }): JSX.Element {
  useUiLocale();
  return <section className="mobile-connection-guide em-glass no-drag" aria-label={uiText("ui.MobileConnectionGuide.title")}>
    <button type="button" className="mobile-connection-guide-close" onClick={onClose} aria-label={uiText("common.close")}>×</button>
    <div className="mobile-connection-guide-title">{uiText("ui.MobileConnectionGuide.title")}</div>
    <p>{uiText("ui.MobileConnectionGuide.description")}</p>
    <button type="button" className="mobile-connection-guide-open" onClick={onOpen}>{uiText("ui.MobileConnectionGuide.open")}</button>
  </section>;
}
