import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CollaborationMode } from "@shared/collaboration";
import { uiText, useUiLocale } from "../lib/i18n";
import { modeDisplay } from "../lib/collaboration";

export function CollaborationModePicker({ modes, selected, onChange, disabled }: {
  modes: CollaborationMode[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}): JSX.Element {
  useUiLocale();
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
  }, [open, modes.length]);
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
    <button ref={trigger} type="button" disabled={disabled} aria-expanded={open} aria-haspopup="dialog"
      onClick={() => setOpen(value => !value)} className="inp-sel flex items-center gap-1 disabled:opacity-50">
      {uiText("collaboration.title")} · {names.join(" + ") || uiText("ui.ChatInput.standard")} <span aria-hidden="true">⌄</span>
    </button>
    {open && createPortal(<div ref={panel} role="dialog" aria-label={uiText("collaboration.title")}
      className="fixed z-dropdown w-80 max-w-[calc(100vw-16px)] rounded-[var(--radius-lg)] border border-border bg-surface-elevated shadow-xl overflow-y-auto max-h-[70vh]"
      style={{ left: position.left, top: position.top }}>
      {modes.map(mode => <label key={mode.id} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-hover cursor-pointer">
        <input type="checkbox" checked={selected.includes(mode.id)} disabled={disabled} className="mt-1 accent-accent"
          onChange={event => onChange(event.target.checked ? [...selected, mode.id] : selected.filter(id => id !== mode.id))} />
        <span className="min-w-0"><span className="text-xs font-medium text-text-primary">{modeDisplay(mode, "name")}</span>
          {mode.scenario && <span className="block text-[length:var(--text-11)] text-text-secondary mt-1">{modeDisplay(mode, "scenario")}</span>}</span>
      </label>)}
    </div>, document.body)}
  </>;
}
