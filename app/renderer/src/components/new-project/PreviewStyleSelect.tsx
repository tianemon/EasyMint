import { useLayoutEffect, useId, useRef, useState } from "react";
import { uiText } from "../../lib/i18n";
import { registerLocalEscape } from "../ui/Modal";
import { STYLE_PRESETS, type StylePreset } from "./style-presets";

export function PreviewStyleSelect({ preset, onChange, titleId }: { titleId: string; preset: StylePreset; onChange: (id: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const root = ref.current;
    if (!open || !root) return;
    root.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    const close = () => { setOpen(false); trigger.current?.focus(); };
    const escape = registerLocalEscape(root, close);
    const outside = (event: Event) => { if (event.target instanceof Node && !root.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    return () => { escape(); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("focusin", outside); };
  }, [open]);
  return <div ref={ref} className="creation-preview-style-select">
    <button ref={trigger} type="button" role="combobox" aria-label={uiText("creation.preview.changeStyle")} aria-description={preset.label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} onKeyDown={(event) => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); } }}><span id={titleId}>{preset.label}</span><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button>
    {open && <div id={id} role="listbox" aria-label={uiText("creation.preview.changeStyle")} onKeyDown={(event) => {
      const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (current + 1) % items.length : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length : -1;
      if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
    }}>{STYLE_PRESETS.map((style) => <button key={style.id} type="button" role="option" tabIndex={-1} aria-selected={style.id === preset.id} onClick={() => { onChange(style.id); setOpen(false); trigger.current?.focus(); }}><span>{style.label}</span>{style.id === preset.id && <span aria-hidden="true">✓</span>}</button>)}</div>}
  </div>;
}
