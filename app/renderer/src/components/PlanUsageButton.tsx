import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { uiText, useUiLocale } from "../lib/i18n";
import { DeepSeekBalanceSection } from "./DeepSeekBalanceSection";
import { CodexQuotaSection } from "./CodexQuotaSection";
import { formatPlanLabel } from "@shared/codex-quota";
import { hasOpenModal } from "./ui/Modal";
import { registerOverlay } from "../lib/overlay-stack";
import { accountUsageLabels } from "@shared/provider-usage";
import { ProviderUsageSection } from "./ProviderUsageSection";

/** Account usage belongs to the enabled provider, including empty sessions. */
export function PlanUsageButton(): JSX.Element | null {
  useUiLocale();
  const providers = useSettingsStore(state => state.apiProviders);
  const current = providers?.current ? providers.configs[providers.current] : undefined;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const open = !!current && openedFor === current.id;
  const close = useCallback(() => setOpenedFor(null), []);
  /** 套餐等级（plus / pro …）由额度块加载后上报，显示在弹窗标题旁 */
  const [plan, setPlan] = useState<string | undefined>(undefined);
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
    const shift = left - (center - width / 2), maxHeight = Math.max(0, trigger.top - 16);
    setPlacement(previous => previous.shift === shift && previous.maxHeight === maxHeight ? previous : { shift, maxHeight });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    const composer = triggerRef.current?.closest(".input-card") ?? wrapRef.current?.parentElement;
    if (composer) observer?.observe(composer);
    return () => { observer?.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!hasOpenModal() && !wrapRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !hasOpenModal() && !event.defaultPrevented) {
        event.preventDefault(); close(); triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const unregister = registerOverlay(panelRef.current);
    return () => { unregister(); document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  useEffect(() => { close(); setPlan(undefined); }, [current?.id, current?.presetId, current?.authType, current?.apiKey, current?.baseUrl, close]);
  useEffect(() => window.electronAPI.provider.onAuthEvent?.(message => {
    if (message.providerId === current?.id) { close(); setPlan(undefined); }
  }), [current?.id, close]);
  const codex = current?.presetId === "openai-codex";
  const labels = current ? accountUsageLabels(current) : undefined;
  if (!labels) return null;
  const planLabel = codex ? formatPlanLabel(plan) : "";
  const title = codex ? uiText("ui.CodexQuota.title") : current?.presetId === "deepseek" ? uiText("ui.ProviderAccount.deepseekTitle") : uiText("ui.AccountUsage.title",{provider:current!.name});
  const titleLabel = planLabel ? `${title} ${planLabel}` : title;

  return (
    <div ref={wrapRef} className="relative inline-flex shrink-0">
      <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} className="permission-mode-trigger text-text-secondary whitespace-nowrap" onClick={() => setOpenedFor(value => value === current!.id ? null : current!.id)}>
        {uiText("ui.PlanUsage.title")}
      </button>
      {open && (
        <div ref={panelRef} id={panelId} role="dialog" aria-label={titleLabel} className="no-drag absolute bottom-full left-1/2 mb-2 z-dropdown bg-[var(--modal-fill)] rounded-[var(--radius-lg)] shadow-2xl w-[360px] max-w-[calc(100vw-16px)] overflow-y-auto p-5 text-xs" style={{ transform: `translateX(calc(-50% + ${placement.shift}px))`, maxHeight: placement.maxHeight }}>
          <div className="flex items-center justify-between mb-4">
            <span className="min-w-0 flex-1 flex items-baseline gap-1.5 text-sm font-medium text-text-primary">
              <span className="truncate">{title}</span>
              {/* 套餐档位（Plus / Pro …）比标题轻一档，不用括号也不抢视线 */}
              {planLabel && <span className="shrink-0 text-xs font-normal text-text-muted">{planLabel}</span>}
            </span>
            <button type="button" onClick={() => { close(); triggerRef.current?.focus(); }} aria-label={uiText("common.close")} className="text-text-muted hover:text-text-primary">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 4 8 8m0-8-8 8" /></svg>
            </button>
          </div>
          {codex ? <CodexQuotaSection key={current!.id} active onPlan={setPlan} /> : current?.presetId === "deepseek" ? <DeepSeekBalanceSection key={current.id} />
            : <ProviderUsageSection key={`${current!.id}:${current!.presetId}`} providerId={current!.id} labels={labels} />}
        </div>
      )}
    </div>
  );
}
