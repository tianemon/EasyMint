import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { uiText, useUiLocale } from "../lib/i18n";
import { CodexQuotaSection } from "./CodexQuotaSection";
import { hasOpenModal } from "./ui/Modal";
import { registerOverlay } from "../lib/overlay-stack";

/** Subscription usage belongs to the enabled provider, including empty sessions. */
export function PlanUsageButton(): JSX.Element | null {
  useUiLocale();
  const providers = useSettingsStore(state => state.apiProviders);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [placement, setPlacement] = useState({ shift: 0, maxHeight: 400 });
  const place = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const width = panel.getBoundingClientRect().width;
    const center = trigger.left + trigger.width / 2;
    const left = Math.max(8, Math.min(center - width / 2, window.innerWidth - width - 8));
    setPlacement({ shift: left - (center - width / 2), maxHeight: Math.max(0, trigger.top - 16) });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!hasOpenModal() && !wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !hasOpenModal() && !event.defaultPrevented) {
        event.preventDefault(); setOpen(false); triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const unregister = registerOverlay(panelRef.current);
    return () => { unregister(); document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const current = providers?.current ? providers.configs[providers.current] : undefined;
  useEffect(() => setOpen(false), [current?.id]);
  if (current?.presetId !== "openai-codex") return null;

  return (
    <div ref={wrapRef} className="relative inline-flex shrink-0">
      <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} className="permission-mode-trigger text-text-secondary whitespace-nowrap" onClick={() => setOpen(value => !value)}>
        {uiText("ui.PlanUsage.title")}
      </button>
      {open && (
        <div ref={panelRef} id={panelId} role="dialog" aria-label={uiText("ui.PlanUsage.title")} className="no-drag absolute bottom-full left-1/2 mb-2 z-dropdown bg-[var(--modal-fill)] rounded-[var(--radius-lg)] shadow-2xl w-[360px] max-w-[calc(100vw-16px)] overflow-y-auto p-5 text-xs" style={{ transform: `translateX(calc(-50% + ${placement.shift}px))`, maxHeight: placement.maxHeight }}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-text-primary">{uiText("ui.PlanUsage.title")}</span>
            <button type="button" onClick={() => { setOpen(false); triggerRef.current?.focus(); }} aria-label={uiText("common.close")} className="text-text-muted hover:text-text-primary">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 4 8 8m0-8-8 8" /></svg>
            </button>
          </div>
          <CodexQuotaSection active />
        </div>
      )}
    </div>
  );
}
