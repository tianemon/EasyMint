import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { uiText } from "../../lib/i18n";
import { STYLE_EFFECTS, STYLE_PALETTES, type StyleAppearance, type StyleEffect, type StylePalette } from "./style-appearance";
import { APPEARANCE_PALETTES, resolveStylePreset, type StylePreset } from "./style-presets";

export type AppearancePanelKind = "palette" | "effect" | null;
interface AppearanceProps { base?: StylePreset; appearance: StyleAppearance; kind: AppearancePanelKind }
function colors(base: StylePreset | undefined, palette: StylePalette): string[] {
  if (palette !== "default") { const value = APPEARANCE_PALETTES[palette]; return [value.art, value.accent, value.soft]; }
  return [base?.artwork.color ?? "#64646c", base?.accent ?? "#262626", base?.artwork.soft ?? "#ededf0"];
}
function Swatch({ base, palette }: { base?: StylePreset; palette: StylePalette }): JSX.Element {
  return <span className="creation-palette-swatch" aria-hidden="true">{colors(base, palette).map((color, index) => <i key={index} style={{ background: color }}/>)}</span>;
}
function Chevron(): JSX.Element { return <svg className="creation-appearance-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>; }

export function AppearanceButtons({ base, appearance, kind, onToggle }: AppearanceProps & { onToggle: (kind: AppearancePanelKind) => void }): JSX.Element {
  const palette = uiText(`catalog.palette.${appearance.palette}`);
  const effect = uiText(`catalog.effect.${base?.id ?? "generic"}.${appearance.effect}`);
  return <>
    <button type="button" className="creation-appearance-trigger" data-appearance-trigger="palette" data-overlay-escape={kind === "palette" || undefined} onKeyDown={(event) => { if (event.key === "Escape" && kind === "palette") { event.preventDefault(); event.stopPropagation(); onToggle(null); } }} aria-label={uiText("catalog.palette")} aria-description={palette} title={`${uiText("catalog.palette")} · ${palette}`} aria-expanded={kind === "palette"} onClick={() => onToggle(kind === "palette" ? null : "palette")}><Swatch base={base} palette={appearance.palette}/><span>{palette}</span><Chevron/></button>
    <button type="button" className="creation-appearance-trigger" data-appearance-trigger="effect" data-overlay-escape={kind === "effect" || undefined} onKeyDown={(event) => { if (event.key === "Escape" && kind === "effect") { event.preventDefault(); event.stopPropagation(); onToggle(null); } }} aria-label={uiText("catalog.effect")} aria-description={effect} title={`${uiText("catalog.effect")} · ${effect}`} aria-expanded={kind === "effect"} onClick={() => onToggle(kind === "effect" ? null : "effect")}><svg className="creation-effect-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 7h16M4 17h16"/><rect x="7" y="4" width="4" height="6" rx="2" fill="currentColor" stroke="none"/><rect x="14" y="14" width="4" height="6" rx="2" fill="currentColor" stroke="none"/></svg><span>{effect}</span><Chevron/></button>
  </>;
}
function EffectSample({ base, appearance, effect }: { base?: StylePreset; appearance: StyleAppearance; effect: StyleEffect }): JSX.Element {
  const preset = base ? resolveStylePreset(base, { ...appearance, effect }) : undefined;
  const style = { "--appearance-bg": preset?.background ?? "var(--field-idle)", "--appearance-surface": preset?.recipes.card.background ?? "var(--color-surface-elevated)", "--appearance-shadow": preset?.recipes.primary.shadow ?? "none", "--appearance-card-shadow": preset?.recipes.card.shadow ?? "none", "--appearance-texture": preset?.texture ?? "none", "--appearance-button": preset?.recipes.primary.background ?? "var(--color-text-primary)", "--appearance-art": preset?.artwork.color ?? "var(--color-text-muted)", "--appearance-soft": preset?.artwork.soft ?? "var(--field-idle)", "--appearance-ink": preset?.ink ?? "var(--color-text-primary)" } as CSSProperties;
  return <span className="creation-effect-sample" data-style={base?.id ?? "minimalism"} data-effect={effect} style={style} aria-hidden="true"><i/><b/><em/></span>;
}
export function AppearancePanel({ base, appearance, kind, onChange, onDismiss, active = true }: AppearanceProps & { active?: boolean; onChange: (value: StyleAppearance) => void; onDismiss: () => void }): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const previousKind = useRef(kind);
  useLayoutEffect(() => {
    const requested = previousKind.current !== kind;
    previousKind.current = kind;
    const panel = ref.current;
    if (!active || !kind || !panel) return;
    // Only an explicit open requests focus; modal opening/closing owns its own focus return.
    if (requested) panel.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    const viewport = panel.closest<HTMLElement>(".creation-preview-sidebar-tools");
    if (!viewport) return;
    const reveal = () => {
      const frame = viewport.getBoundingClientRect();
      const active = document.activeElement instanceof HTMLElement && panel.contains(document.activeElement) ? document.activeElement : panel;
      const target = panel.getBoundingClientRect().height > viewport.clientHeight - 8 ? active : panel;
      const rect = target.getBoundingClientRect();
      if (rect.height >= viewport.clientHeight - 8 || rect.top < frame.top) viewport.scrollTop += rect.top - frame.top - 4;
      else if (rect.bottom > frame.bottom - 4) viewport.scrollTop += rect.bottom - frame.bottom + 4;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(viewport); observer.observe(panel);
    return () => observer.disconnect();
  }, [kind, active]);
  if (!kind) return null;
  return <div ref={ref} className="creation-appearance-panel creation-appearance-panel-rich" data-kind={kind} role="group" data-overlay-escape="true" aria-label={uiText(`catalog.${kind}`)} onKeyDown={(event) => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation();
    const trigger = ref.current?.closest(".creation-preview-dialog-rich,.creation-preview-panel")?.querySelector<HTMLButtonElement>(`[data-appearance-trigger="${kind}"]`);
    onDismiss(); trigger?.focus({ preventScroll: true });
    const viewport = trigger?.closest<HTMLElement>(".creation-preview-sidebar-tools");
    if (trigger && viewport && trigger.getBoundingClientRect().top < viewport.getBoundingClientRect().top) viewport.scrollTop += trigger.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 4;
  }}>
    {kind === "palette" ? STYLE_PALETTES.map((palette) => <button type="button" key={palette} className="creation-palette-option" title={uiText(`catalog.palette.${palette}`)} aria-pressed={appearance.palette === palette} onClick={() => onChange({ ...appearance, palette })}><Swatch base={base} palette={palette}/><span>{uiText(`catalog.palette.${palette}`)}</span>{appearance.palette === palette && <b className="creation-appearance-check" aria-hidden="true">✓</b>}</button>) : STYLE_EFFECTS.map((effect) => <button type="button" key={effect} className="creation-effect-option" title={uiText(`catalog.effect.${base?.id ?? "generic"}.${effect}`)} aria-pressed={appearance.effect === effect} onClick={() => onChange({ ...appearance, effect })}><EffectSample base={base} appearance={appearance} effect={effect}/><span>{uiText(`catalog.effect.${base?.id ?? "generic"}.${effect}`)}</span>{appearance.effect === effect && <b className="creation-appearance-check" aria-hidden="true">✓</b>}</button>)}
  </div>;
}
