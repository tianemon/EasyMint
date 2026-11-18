import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CollaborationMode } from "@shared/collaboration";
import { uiText, useUiLocale } from "../lib/i18n";
import { modeDisplay } from "../lib/collaboration";
import { ComposerPopover } from "./ui/ComposerPopover";

export function CollaborationModePicker({ modes, selected, onChange, disabled, active = true }: {
  modes: CollaborationMode[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  active?: boolean;
}): JSX.Element {
  useUiLocale();
  const panelId = useId();
  const [expanded, setOpen] = useState(false);
  const open = active && expanded;
  useEffect(() => { if (!active) setOpen(false); }, [active]);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusedMode = useRef<string | undefined>(undefined);
  const restoreFocus = useRef(false);
  const names = modes.filter(mode => selected.includes(mode.id)).map(mode => modeDisplay(mode, "name"));
  const summary = names[0] || uiText("ui.ChatInput.standard");
  const options = useCallback(() => Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('[role="checkbox"]:not(:disabled)') ?? []), []);
  useEffect(() => {
    if (disabled) return;
    if (!open) {
      if (restoreFocus.current) {
        restoreFocus.current = false;
        if (document.activeElement === document.body) trigger.current?.focus();
      }
      return;
    }
    restoreFocus.current = false;
    const buttons = options();
    // 选择写入期间控件会暂时禁用，恢复后把焦点交还原选项。
    const previous = buttons.find(button => button.closest<HTMLElement>("[data-mode-id]")?.dataset.modeId === focusedMode.current);
    (previous ?? buttons.find(button => button.getAttribute("aria-checked") === "true") ?? buttons[0])?.focus();
  }, [open, disabled, modes, options]);
  useEffect(() => {
    if (!open || !disabled) return;
    const holdTab = (event: KeyboardEvent) => { if (event.key === "Tab") event.preventDefault(); };
    document.addEventListener("keydown", holdTab);
    return () => document.removeEventListener("keydown", holdTab);
  }, [open, disabled]);
  const dismiss = (reason: "escape" | "outside") => {
    if (reason === "escape") {
      restoreFocus.current = Boolean(disabled);
      trigger.current?.focus();
    }
    setOpen(false);
  };
  return <>
    <span className="text-sm text-text-muted shrink-0 whitespace-nowrap">{uiText("collaboration.title")}</span>
    <button ref={trigger} type="button" disabled={!active || disabled || !modes.length} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? panelId : undefined}
      aria-label={`${uiText("collaboration.title")}: ${names.join(" + ") || summary}`}
      onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setOpen(true); }
      }} className="inp-sel composer-mode-trigger flex items-center gap-1 min-w-0 max-w-[320px] disabled:opacity-50">
      <span className="truncate">{summary}</span>
      {names.length > 1 && <span className="shrink-0">+{names.length - 1}</span>}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        className="block shrink-0 text-text-secondary"><path d="M2 3.5l3 3 3-3" /></svg>
    </button>
    {open && <ComposerPopover anchor={trigger} panel={panel} onDismiss={dismiss} id={panelId} aria-label={uiText("collaboration.title")}
      className="w-max p-1.5"
      onFocusCapture={event => { focusedMode.current = (event.target as HTMLElement).closest<HTMLElement>("[data-mode-id]")?.dataset.modeId; }}
      onKeyDown={event => {
        if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) return;
        event.preventDefault();
        const buttons = options();
        if (!buttons.length) return;
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const backwards = event.key === "ArrowUp" || event.key === "Tab" && event.shiftKey;
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (index + (backwards ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
      {modes.map(mode => {
        const checked = selected.includes(mode.id);
        const toggle = () => { if (!disabled) { focusedMode.current = mode.id; onChange(checked ? selected.filter(id => id !== mode.id) : [...selected, mode.id]); } };
        const name = modeDisplay(mode, "name"), scenario = modeDisplay(mode, "scenario");
        return <button type="button" key={mode.id} data-mode-id={mode.id} role="checkbox" aria-checked={checked}
          aria-label={name} aria-description={scenario || undefined} disabled={disabled} onClick={toggle}
          className={`composer-option flex w-full min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-left whitespace-nowrap transition-colors hover:bg-surface-hover ${checked ? "bg-accent-subtle" : ""}`}>
          <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border ${checked ? "border-accent bg-accent text-text-inverse" : "border-border bg-surface"}`} aria-hidden="true">
            {checked && <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1.8 5.2l2.1 2.1L8.2 2.9" /></svg>}
          </span>
          <span className="shrink-0 max-w-[min(18rem,45vw)] truncate text-xs font-medium text-text-primary">{name}</span>
          {scenario && <span className="min-w-0 truncate text-[length:var(--text-11)] text-text-secondary">{scenario}</span>}
        </button>;
      })}
    </ComposerPopover>}
  </>;
}
