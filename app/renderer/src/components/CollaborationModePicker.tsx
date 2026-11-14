import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CollaborationMode } from "@shared/collaboration";
import { uiText, useUiLocale } from "../lib/i18n";
import { modeDisplay } from "../lib/collaboration";
import { Checkbox } from "./ui/Checkbox";

export function CollaborationModePicker({ modes, selected, onChange, disabled }: {
  modes: CollaborationMode[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}): JSX.Element {
  const locale = useUiLocale();
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const names = modes.filter(mode => selected.includes(mode.id)).map(mode => modeDisplay(mode, "name"));
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const bounds = panel.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, anchor.top - bounds.height - 8),
    });
  }, [open, modes, locale]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (event: MouseEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { close(); trigger.current?.focus(); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);
  return <>
    <span id={labelId} className="text-sm text-text-muted">{uiText("collaboration.title")}</span>
    <button ref={trigger} type="button" disabled={disabled} aria-expanded={open} aria-haspopup="dialog" aria-labelledby={`${labelId} ${labelId}-value`}
      onClick={() => setOpen(value => !value)} className="inp-sel flex items-center gap-1 disabled:opacity-50">
      <span id={`${labelId}-value`}>{names.join(" + ") || uiText("ui.ChatInput.standard")}</span>
    </button>
    {open && createPortal(<div ref={panel} role="dialog" aria-label={uiText("collaboration.title")}
      className="fixed z-dropdown w-max max-w-[calc(100vw-16px)] rounded-[var(--radius-lg)] border border-border bg-surface-elevated shadow-xl overflow-y-auto max-h-[70vh]"
      style={{ left: position.left, top: position.top }}>
      {modes.map(mode => {
        const checked = selected.includes(mode.id);
        const toggle = () => { if (!disabled) onChange(checked ? selected.filter(id => id !== mode.id) : [...selected, mode.id]); };
        return <div key={mode.id} onClick={toggle} className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface-hover cursor-pointer whitespace-nowrap">
          <Checkbox checked={checked} disabled={disabled} onChange={toggle} ariaLabel={modeDisplay(mode, "name")} />
          <span className="text-xs font-medium text-text-primary shrink-0">{modeDisplay(mode, "name")}</span>
          {mode.scenario && <span title={modeDisplay(mode, "scenario")} className="truncate text-[length:var(--text-11)] text-text-secondary">{modeDisplay(mode, "scenario")}</span>}
        </div>;
      })}
    </div>, document.body)}
  </>;
}
