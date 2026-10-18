import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { uiText } from "../../lib/i18n";
import { Modal, registerLocalEscape } from "../ui/Modal";
import { SampleSelect } from "./SampleSelect";
import { SampleIcon } from "./SampleIcon";
import { usePreviewScroll, type PreviewScrollMemory } from "./use-preview-scroll";
import { StyleArtwork } from "./StyleArtwork";
import { useSampleLayer } from "./use-sample-layer";
import { sampleStyle, type PreviewDevice, type StylePreset } from "./style-presets";
import type { StyleEffect } from "./style-appearance";
import "./style-preview.css";
import "./component-gallery.css";

export const GALLERY_CATEGORIES = ["all", "buttons", "inputs", "choices", "selects", "navigation", "data", "feedback", "layers"] as const;
export type GalleryCategory = typeof GALLERY_CATEGORIES[number];
const COVER_HEADLINES = {
  minimalism: "creation.sample.artHeadline", flat: "creation.sample.artFlatHeadline",
  material: "creation.sample.artMaterialHeadline", glass: "creation.sample.artGlassHeadline",
  neumorphism: "creation.sample.artReliefHeadline", skeuomorphism: "creation.sample.artPaperHeadline",
  "liquid-glass": "creation.style.liquid-glass.headline",
  "claymorphism": "creation.style.claymorphism.headline",
  "business": "creation.style.business.headline",
  "luxury": "creation.style.luxury.headline",
  "bento": "creation.style.bento.headline",
  "colorful": "creation.style.colorful.headline",
  "retro": "creation.style.retro.headline",
  "soft": "creation.style.soft.headline",
  "editorial": "creation.style.editorial.headline",
  "dark": "creation.style.dark.headline",
  "tech": "creation.style.tech.headline",

} as const;
type LayerDemo = "confirm" | "drawer" | "popover" | "menu";
const initialData = () => ({ layer: "confirm" as LayerDemo, text: "Studio", search: "", password: "mint-studio", notes: "", email: "hello", radio: "design", checks: ["design"], enabled: true, segment: "week", range: 48, single: "design", multiple: ["design", "docs"], searchable: "code", tab: "recent", page: 1, ascending: true, selectedRows: [] as string[], removedRows: [] as string[], state: "empty" });
export function useGallerySample() {
  const [data, setData] = useState(initialData);
  const [category, setCategory] = useState<GalleryCategory>("all");
  return { data, category, setCategory, update: (patch: Partial<ReturnType<typeof initialData>>) => setData((current) => ({ ...current, ...patch })), reset: () => setData(initialData()) };
}
type Controller = ReturnType<typeof useGallerySample>;

function SampleTooltip(): JSX.Element {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const { anchorRef, layerRef, host, position } = useSampleLayer(open, () => setOpen(false), "", 150);
  useLayoutEffect(() => {
    if (open && host) return registerLocalEscape(host, () => setOpen(false));
  }, [open, host]);
  const keep = () => { clearTimeout(timer.current); setOpen(true); };
  const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 140); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return <><button ref={anchorRef} type="button" className="sample-button sample-secondary" aria-describedby={open ? id : undefined} data-overlay-escape={open || undefined} onPointerEnter={keep} onPointerLeave={leave} onFocus={keep} onBlur={leave} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>{uiText("catalog.tooltip")}</button>{open && host && createPortal(<div ref={layerRef} id={id} role="tooltip" className="sample-select-menu gallery-tooltip" style={position ? { left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight } : { visibility: "hidden" }} onPointerEnter={keep} onPointerLeave={leave}>{uiText("catalog.tooltipText")}</div>, host)}</>;
}

function AnchoredDemo({ menu, selected, onSelect, onAction }: { menu?: boolean; selected: boolean; onSelect: () => void; onAction: (origin: HTMLElement | null) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { anchorRef, layerRef, host, position } = useSampleLayer(open, () => setOpen(false), "", 220);
  return <><button ref={anchorRef} type="button" className={`sample-button ${selected ? "sample-primary" : "sample-secondary"}`} aria-pressed={selected} aria-haspopup="dialog" aria-expanded={open} onClick={() => { onSelect(); setOpen(true); }}>{uiText(menu ? "catalog.menu" : "catalog.popover")}</button>{open && host && <Modal portalTarget={host} overlayClassName="gallery-anchored-overlay" onClose={() => setOpen(false)}><div ref={layerRef} className="sample-select-menu gallery-anchored-card" role="dialog" aria-modal="true" aria-labelledby={id} style={position ? { left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight } : { visibility: "hidden" }}><strong id={id}>{uiText(menu ? "catalog.menu" : "catalog.quickActions")}</strong>{menu ? ["edit", "duplicate", "archive"].map((action) => <button key={action} type="button" className="gallery-menu-action" onClick={() => { onAction(anchorRef.current); setOpen(false); }}>{uiText(`catalog.${action}`)}</button>) : <><p>{uiText("catalog.popoverText")}</p><button type="button" className="sample-button sample-primary" onClick={() => { onAction(anchorRef.current); setOpen(false); }}>{uiText("common.done")}</button></>}</div></Modal>}</>;
}

export function ComponentGallery({ preset, device, effect, sample, expanded = false, scrollMemory, projectName, previewActive = true }: { previewActive?: boolean; scrollMemory?: PreviewScrollMemory; projectName?: string; preset: StylePreset; device: PreviewDevice; effect: StyleEffect; sample: Controller; expanded?: boolean }): JSX.Element {
  const { data, update, category } = sample;
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLElement | null>(null);
  const dialogOrigin = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [dialog, setDialog] = useState<"confirm" | "delete" | "drawer" | null>(null);
  const [notice, setNotice] = useState<{ key: string; kind: "success" | "error" } | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Keep the mobile navigation mounted (and focused), but dismiss transient category UI.
  useLayoutEffect(() => {
    clearTimeout(timer.current);
    setBusy(false);
    setPasswordVisible(false);
    setDialog(null);
    setNotice(null);
  }, [category]);
  usePreviewScroll(mainRef, previewActive ? scrollMemory : undefined, `components:${device}:${category}`, preset.id);
  const openDialog = (value: "confirm" | "delete" | "drawer") => { if (value !== "delete") update({ layer: value }); dialogOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDialog(value); };
  const notify = (key = "catalog.actionDone", kind: "success" | "error" = "success", origin?: HTMLElement | null) => { sourceRef.current = origin ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null); setNotice({ key, kind }); };
  const closeNotice = () => { setNotice(null); if (sourceRef.current?.isConnected) sourceRef.current.focus(); };
  const choices = ["design", "code", "docs"].map((value) => ({ value, label: uiText(`catalog.${value}`) }));
  const all = category === "all";
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  const section = (key: Exclude<GalleryCategory, "all">, content: ReactNode) => <section className={`gallery-section gallery-section-${key}`} data-preview-anchor={key} aria-labelledby={`${id}-${key}`}><h3 id={`${id}-${key}`}>{uiText(`catalog.${key}`)}</h3><div className="gallery-section-body">{content}</div></section>;
  const field = (key: string, input: ReactNode) => <div className="sample-field gallery-field"><label htmlFor={`${id}-${key}`}>{uiText(`catalog.${key}`)}</label>{input}</div>;
  const buttonGroup = section("buttons", <>
    <div className="gallery-button-row"><button type="button" className="sample-button sample-primary" onClick={() => notify()}>{uiText("catalog.primary")}</button><button type="button" className="sample-button sample-secondary" onClick={() => notify()}>{uiText("catalog.secondary")}</button><button type="button" className="sample-button gallery-ghost" onClick={() => notify()}>{uiText("catalog.textButton")}</button></div>
    <div className="gallery-button-row"><button type="button" className="sample-button gallery-outline" onClick={() => notify()}>{uiText("catalog.outline")}</button><button type="button" className="sample-button gallery-danger" onClick={() => openDialog("delete")}>{uiText("catalog.delete")}</button><button type="button" className="sample-button sample-secondary" disabled>{uiText("catalog.disabled")}</button><button type="button" className="sample-button sample-secondary gallery-icon-button" aria-label={uiText("catalog.add")} onClick={() => notify()}><SampleIcon name="plus" /></button></div>
    {!all && <div className="gallery-button-row"><button type="button" className="sample-button sample-primary" aria-busy={busy} disabled={busy} onClick={() => { setBusy(true); timer.current = setTimeout(() => { setBusy(false); notify("catalog.loaded"); }, 700); }}>{busy && <span className="gallery-spinner" aria-hidden="true" />}{uiText(busy ? "catalog.loading" : "catalog.loadDemo")}</button>{["small", "regular", "large"].map((size) => <button key={size} type="button" className={`sample-button sample-secondary gallery-size-${size}`} onClick={() => notify()}>{uiText(`catalog.${size}`)}</button>)}</div>}
  </>);
  const inputGroup = section("inputs", <>
    {field("textInput", <input id={`${id}-textInput`} value={data.text} onChange={(event) => update({ text: event.target.value })} placeholder={uiText("catalog.enterText")} />)}
    {field("search", <div className="gallery-input-wrap"><input ref={searchInputRef} id={`${id}-search`} value={data.search} placeholder={uiText("catalog.searchPlaceholder")} onChange={(event) => update({ search: event.target.value })} />{data.search ? <button type="button" className="gallery-input-action" aria-label={uiText("catalog.clearSearch")} onClick={() => { update({ search: "" }); searchInputRef.current?.focus(); }}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button> : <span className="gallery-input-action" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0Zm-1 4 4 4" /></svg></span>}</div>)}
    {!all && <>
      {field("password", <div className="gallery-input-wrap"><input id={`${id}-password`} type={passwordVisible ? "text" : "password"} value={data.password} onChange={(event) => update({ password: event.target.value })} /><button type="button" className="gallery-input-action" aria-pressed={passwordVisible} aria-label={uiText("catalog.showPassword")} onClick={() => setPasswordVisible(!passwordVisible)}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2"/>{passwordVisible && <path d="m3 3 14 14"/>}</svg></button></div>)}
      {field("notes", <textarea id={`${id}-notes`} value={data.notes} placeholder={uiText("catalog.notesPlaceholder")} onChange={(event) => update({ notes: event.target.value })} />)}
      {field("readonly", <input id={`${id}-readonly`} value="Studio" readOnly />)}
      {field("disabledInput", <input id={`${id}-disabledInput`} value={uiText("catalog.disabled")} disabled />)}
      {field("validation", <><input id={`${id}-validation`} value={data.email} inputMode="email" spellCheck={false} aria-invalid={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)} aria-describedby={`${id}-validation-error`} onChange={(event) => update({ email: event.target.value })} /><small className="sample-error" id={`${id}-validation-error`}>{!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ? uiText("catalog.emailError") : "\u00a0"}</small></>)}
    </>}
  </>);
  const choiceGroup = section("choices", <>
    <fieldset className="gallery-choice-group"><legend>{uiText("catalog.radio")}</legend><div>{choices.map((option) => <label className="gallery-choice" key={option.value}><input type="radio" name={`${id}-radio`} checked={data.radio === option.value} onChange={() => update({ radio: option.value })}/><span>{option.label}</span></label>)}</div></fieldset>
    <fieldset className="gallery-choice-group"><legend>{uiText("catalog.checkbox")}</legend><div>{choices.map((option) => <label className="gallery-choice" key={option.value}><input type="checkbox" checked={data.checks.includes(option.value)} onChange={() => update({ checks: toggle(data.checks, option.value) })}/><span>{option.label}</span></label>)}</div></fieldset>
    <div className="gallery-switch-row"><span>{uiText("catalog.switch")}</span><button type="button" role="switch" className="sample-switch" aria-label={uiText("catalog.switch")} aria-checked={data.enabled} onClick={() => update({ enabled: !data.enabled })}><i/></button></div>
    {!all && <><div className="gallery-segment" role="group" aria-label={uiText("catalog.segment")}>{["day", "week", "month"].map((period) => <button key={period} type="button" aria-pressed={data.segment === period} onClick={() => update({ segment: period })}>{uiText(`catalog.${period}`)}</button>)}</div><label className="gallery-range-label"><span>{uiText("catalog.slider")}<output>{data.range}%</output></span><div className="gallery-range"><div><i style={{ width: `${data.range}%` }}/></div><input type="range" aria-label={uiText("catalog.slider")} min={0} max={100} value={data.range} onChange={(event) => update({ range: Number(event.target.value) })}/></div></label></>}
  </>);
  const selectGroup = section("selects", <><SampleSelect label={uiText("catalog.singleSelect")} value={data.single} options={choices} onChange={(single) => update({ single })}/><SampleSelect multiple label={uiText("catalog.multiSelect")} value={data.multiple} options={choices} onChange={(multiple) => update({ multiple })}/>{!all && <SampleSelect searchable label={uiText("catalog.searchSelect")} value={data.searchable} options={[...choices, { value: "test", label: uiText("catalog.testing") }, { value: "assets", label: uiText("catalog.assets") }]} onChange={(searchable) => update({ searchable })}/>}</>);
  const rows = ["design", "code", "docs", "testing", "launch", "assets"].filter((value) => !data.removedRows.includes(value)).map((value) => ({ value, label: uiText(`catalog.${value}`) })).sort((a, b) => (data.ascending ? 1 : -1) * a.label.localeCompare(b.label));
  const pages = Math.max(1, Math.ceil(rows.length / 2));
  const page = Math.min(data.page, pages);
  const pagination = <div className="gallery-pagination" role="group" aria-label={uiText("catalog.pagination")}><button type="button" disabled={page === 1} onClick={() => update({ page: page - 1 })} aria-label={uiText("catalog.previousPage")}>‹</button>{Array.from({ length: pages }, (_, index) => <button key={index} type="button" aria-current={page === index + 1 ? "page" : undefined} onClick={() => update({ page: index + 1 })}>{index + 1}</button>)}<button type="button" disabled={page === pages} onClick={() => update({ page: page + 1 })} aria-label={uiText("catalog.nextPage")}>›</button></div>;
  const navigationGroup = section("navigation", <><div className="gallery-tabs" role="group" aria-label={uiText("catalog.tabs")}>{["recent", "saved"].map((tab) => <button key={tab} type="button" aria-pressed={data.tab === tab} onClick={() => update({ tab })}>{uiText(`catalog.${tab}`)}</button>)}</div><div className="gallery-tab-content">{uiText(data.tab === "recent" ? "catalog.recentContent" : "catalog.savedContent")}</div><nav className="gallery-breadcrumb" aria-label={uiText("catalog.breadcrumb")}><button type="button" onClick={() => update({ tab: "recent" })}>{uiText("catalog.workspace")}</button><span>/</span><span>{uiText("catalog.design")}</span></nav><div className="gallery-mini-sidebar">{choices.map((option) => <button key={option.value} type="button" aria-pressed={data.radio === option.value} onClick={() => update({ radio: option.value })}>{option.label}</button>)}</div>{pagination}</>);
  const dataGroup = section("data", <><div className="gallery-data-header"><div className="gallery-avatars"><span>A</span><span>M</span><span>J</span></div><span className="sample-chip">{uiText("catalog.active")}<b>3</b></span></div><div className="sample-chips">{choices.map((option) => <span className="sample-chip" key={option.value}>{option.label}</span>)}</div><div className="gallery-progress" role="progressbar" aria-label={uiText("catalog.progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.range}><i style={{ width: `${data.range}%` }}/></div><table className="gallery-table"><thead><tr><th>{uiText("catalog.selection")}</th><th><button type="button" aria-label={uiText("catalog.sortName")} onClick={() => update({ ascending: !data.ascending })}>{uiText("catalog.name")} {data.ascending ? "↑" : "↓"}</button></th><th>{uiText("catalog.status")}</th></tr></thead><tbody>{rows.slice((page - 1) * 2, page * 2).map((row) => <tr key={row.value} data-selected={data.selectedRows.includes(row.value)}><td><label className="gallery-choice"><input type="checkbox" aria-label={uiText("catalog.selectRow", { name: row.label })} checked={data.selectedRows.includes(row.value)} onChange={() => update({ selectedRows: toggle(data.selectedRows, row.value) })}/></label></td><td>{row.label}</td><td><span className="sample-chip">{uiText("catalog.draft")}</span></td></tr>)}</tbody></table>{pagination}</>);
  const feedbackGroup = section("feedback", <><div className="gallery-alerts">{["info", "success", "warning", "error"].map((tone) => <div className="gallery-alert" data-tone={tone} key={tone}><SampleIcon name={tone === "success" ? "check" : "alert"}/>{uiText(`catalog.${tone}`)}</div>)}</div><div className="gallery-button-row"><button type="button" className="sample-button sample-secondary" onClick={() => notify()}>{uiText("catalog.toast")}</button><SampleTooltip/><button type="button" className="sample-button gallery-ghost" onClick={() => update({ state: data.state === "empty" ? "loading" : "empty" })}>{uiText("catalog.toggleState")}</button></div>{data.state === "empty" ? <div className="gallery-empty"><SampleIcon name="folder"/><span>{uiText("catalog.empty")}</span></div> : <div className="gallery-skeleton" role="status" aria-label={uiText("catalog.loading")}><i/><i/><i/></div>}</>);
  const layerGroup = section("layers", <><div className="gallery-layer-art" data-layer={data.layer} aria-hidden="true"><i/><b/><em/></div><div className="gallery-button-row"><button type="button" className={`sample-button ${data.layer === "confirm" ? "sample-primary" : "sample-secondary"}`} aria-pressed={data.layer === "confirm"} aria-haspopup="dialog" aria-expanded={dialog === "confirm"} onClick={() => openDialog("confirm")}>{uiText("catalog.openDialog")}</button><button type="button" className={`sample-button ${data.layer === "drawer" ? "sample-primary" : "sample-secondary"}`} aria-pressed={data.layer === "drawer"} aria-haspopup="dialog" aria-expanded={dialog === "drawer"} onClick={() => openDialog("drawer")}>{uiText("catalog.drawer")}</button><AnchoredDemo selected={data.layer === "popover"} onSelect={() => update({ layer: "popover" })} onAction={(origin) => notify("catalog.actionDone", "success", origin)}/><AnchoredDemo menu selected={data.layer === "menu"} onSelect={() => update({ layer: "menu" })} onAction={(origin) => notify("catalog.actionDone", "success", origin)}/></div></>);
  return <div ref={rootRef} className={`sample-app sample-gallery ${expanded ? "is-expanded" : ""}`} data-style={preset.id} data-device={device} data-effect={effect} data-palette={preset.appearance?.palette ?? "default"} data-category={category} style={sampleStyle(preset) as CSSProperties}>
    <header className="gallery-masthead"><span className="gallery-wordmark"><SampleIcon name="layers" />FORM<span>/ STUDIO</span></span><span className="gallery-edition">{uiText(`catalog.${category}`)}<i aria-hidden="true" />{String(GALLERY_CATEGORIES.indexOf(category) + 1).padStart(2, "0")} / {String(GALLERY_CATEGORIES.length).padStart(2, "0")}</span></header>
    <main key={category} className="sample-main gallery-main" ref={mainRef}>
      {all && <section className="gallery-editorial" data-preview-anchor="cover" aria-label={uiText("creation.sample.featureLabel")}>
        <div className="gallery-editorial-copy"><span className="sample-overline">{projectName?.trim() || uiText("creation.sample.featureKicker")}</span><h2>{uiText(COVER_HEADLINES[preset.id])}</h2><div className="gallery-editorial-footer"><span>{preset.label}</span></div></div>
        <StyleArtwork preset={preset} progress={data.range} />
      </section>}
      <div className="gallery-grid">{(all || category === "buttons") && buttonGroup}{(all || category === "inputs") && inputGroup}{(all || category === "choices") && choiceGroup}{(all || category === "selects") && selectGroup}{category === "navigation" && navigationGroup}{category === "data" && dataGroup}{category === "feedback" && feedbackGroup}{category === "layers" && layerGroup}</div>
    </main>
    {device === "mobile" && <nav className="sample-bottom-nav gallery-mobile-nav" aria-label={uiText("catalog.categories")}>{([{ category: "all", icon: "grid" }, { category: "inputs", icon: "settings" }, { category: "selects", icon: "folder" }, { category: "layers", icon: "layers" }] as const).map((item) => <button type="button" key={item.category} className={`sample-nav-item ${category === item.category ? "is-active" : ""}`} aria-pressed={category === item.category} onClick={() => sample.setCategory(item.category)}><SampleIcon name={item.icon}/><span>{uiText(`catalog.${item.category}`)}</span></button>)}</nav>}
    <div className="sample-feedback" role="status" hidden={!notice} data-kind={notice?.kind}><span className="sample-feedback-symbol"><SampleIcon name={notice?.kind === "error" ? "alert" : "check"}/></span><span>{notice ? uiText(notice.key) : ""}</span><button type="button" aria-label={uiText("common.close")} onClick={closeNotice}>×</button></div>
    {dialog && rootRef.current && <Modal portalTarget={rootRef.current} overlayClassName={`gallery-modal-overlay ${dialog === "drawer" ? "gallery-drawer-overlay" : ""}`} onClose={() => setDialog(null)}><div className={`gallery-modal-card ${dialog === "drawer" ? "gallery-drawer" : ""}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-modal-title`}><div className="gallery-modal-heading"><h3 id={`${id}-modal-title`}>{uiText(dialog === "delete" ? "catalog.deleteTitle" : dialog === "drawer" ? "catalog.drawer" : "catalog.confirmTitle")}</h3><button type="button" className="sample-button gallery-ghost gallery-icon-button" aria-label={uiText("common.close")} onClick={() => setDialog(null)}>×</button></div><p>{uiText(dialog === "drawer" ? "catalog.drawerText" : dialog === "delete" ? "catalog.deleteText" : "catalog.confirmText")}</p>{dialog === "drawer" && <div className="gallery-drawer-items">{choices.map((choice) => <span className="sample-chip" key={choice.value}>{choice.label}</span>)}</div>}<div className="gallery-modal-actions"><button type="button" className="sample-button sample-secondary" onClick={() => setDialog(null)}>{uiText("common.cancel")}</button><button type="button" className={`sample-button ${dialog === "delete" ? "gallery-danger" : "sample-primary"}`} onClick={() => { if (dialog === "delete") update({ removedRows: [...data.removedRows, ...rows.slice(0, 1).map((row) => row.value)] }); setDialog(null); notify("catalog.actionDone", "success", dialogOrigin.current); }}>{uiText("catalog.confirm")}</button></div></div></Modal>}
  </div>;
}
