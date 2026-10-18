import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { uiText } from "../../lib/i18n";
import { useSampleLayer } from "./use-sample-layer";
import "./style-preview.css";

interface SampleOption { value: string; label: string }
type Props = { label: string; options: readonly SampleOption[]; adornment?: ReactNode; searchable?: boolean } & (
  { multiple?: false; value: string; onChange: (value: string) => void } |
  { multiple: true; value: string[]; onChange: (value: string[]) => void }
);

export function SampleSelect(props: Props): JSX.Element {
  const { label, options, adornment, searchable } = props;
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusedOnOpen = useRef(false);
  const typeahead = useRef({ value: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { anchorRef, layerRef, host, position } = useSampleLayer(open, () => setOpen(false), `${query}:${options.length}`);
  const values = props.multiple ? props.value : [props.value];
  const items = options.filter((option) => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = Math.max(0, items.findIndex((option) => values.includes(option.value)));
  const close = (restore: boolean) => { setOpen(false); if (restore) anchorRef.current?.focus({ preventScroll: true }); };
  const show = (index = selected) => { setQuery(""); setActive(index); typeahead.current = { value: "", time: 0 }; setOpen(true); };
  const choose = (index: number) => {
    const option = items[index];
    if (!option) return;
    if (props.multiple) props.onChange(props.value.includes(option.value) ? props.value.filter((value) => value !== option.value) : [...props.value, option.value]);
    else { props.onChange(option.value); close(true); }
  };
  useLayoutEffect(() => {
    if (!open) focusedOnOpen.current = false;
    else if (position && !focusedOnOpen.current) {
      focusedOnOpen.current = true;
      (searchable ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
    }
  }, [open, position, searchable]);
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const option = layer?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!layer || !option) return;
    const top = option.offsetTop;
    if (top < layer.scrollTop) layer.scrollTop = top;
    else if (top + option.offsetHeight > layer.scrollTop + layer.clientHeight) layer.scrollTop = top + option.offsetHeight - layer.clientHeight;
  }, [active, open, position, layerRef]);
  const display = props.multiple ? uiText("catalog.selectedCount", { count: props.value.length }) : options.find((option) => option.value === props.value)?.label ?? "";
  return <div className="sample-field sample-priority-field">
    <span id={`${id}-label`}>{label}{adornment}</span>
    <button ref={anchorRef} id={`${id}-trigger`} type="button" role="combobox" className="sample-select-trigger" aria-labelledby={`${id}-label`} aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? `${id}-list` : undefined} onClick={() => open ? close(true) : show()} onKeyDown={(event) => {
      if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); }
      else if (event.key === "Tab" && open) close(false);
      else if (["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"].includes(event.key)) { event.preventDefault(); show(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : selected); }
    }}><span>{display}</span><svg className="sample-select-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button>
    {props.multiple && <div className="sample-chips">{options.filter((option) => props.value.includes(option.value)).map((option) => <span className="sample-chip" key={option.value}>{option.label}<button type="button" aria-label={uiText("catalog.removeTag", { name: option.label })} onClick={() => { props.onChange(props.value.filter((value) => value !== option.value)); anchorRef.current?.focus({ preventScroll: true }); }}>×</button></span>)}</div>}
    {open && host && createPortal(<div ref={layerRef} className="sample-select-menu" data-side={position?.side} style={position ? { left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight } : { visibility: "hidden" }} data-overlay-escape="true" onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
      else if (event.key === "Tab") close(true);
      else if (event.key === "Enter" || event.key === " ") { if (event.target !== searchRef.current) { event.preventDefault(); choose(active); } else if (event.key === "Enter") { event.preventDefault(); choose(active); } }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && (event.target !== searchRef.current || event.key.startsWith("Arrow"))) {
        event.preventDefault();
        listRef.current?.focus({ preventScroll: true });
        if (items.length) setActive((current) => event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length);
      } else if (event.target !== searchRef.current && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const now = Date.now();
        const prefix = now - typeahead.current.time < 700 ? typeahead.current.value + event.key.toLocaleLowerCase() : event.key.toLocaleLowerCase();
        typeahead.current = { value: prefix, time: now };
        const index = items.findIndex((option) => option.label.toLocaleLowerCase().startsWith(prefix));
        if (index >= 0) setActive(index);
      }
    }}>
      {searchable && <div className="sample-field sample-select-search"><input ref={searchRef} role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-label={uiText("catalog.searchOptions")} placeholder={uiText("catalog.search")} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} /></div>}
      <div ref={listRef} id={`${id}-list`} role="listbox" tabIndex={-1} aria-labelledby={`${id}-label`} aria-multiselectable={props.multiple || undefined} aria-activedescendant={items[active] ? `${id}-option-${active}` : undefined}>
        {items.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={values.includes(option.value)} data-index={index} data-highlighted={active === index} onPointerMove={() => setActive(index)} onPointerDown={(event) => event.preventDefault()} onClick={() => choose(index)} className="sample-select-option"><span>{option.label}</span>{values.includes(option.value) && <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>}</div>)}
        {!items.length && <div className="sample-select-empty">{uiText("catalog.noResults")}</div>}
      </div>
    </div>, host)}
  </div>;
}
