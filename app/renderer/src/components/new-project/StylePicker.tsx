import { useLayoutEffect, useRef, useState } from "react";
import { uiText, useUiLocale } from "../../lib/i18n";
import { Modal } from "../ui/Modal";
import { UI_STYLE_OPTIONS } from "./ProjectFormTypes";
import { STYLE_PRESETS, type PreviewDevice, type StylePreset } from "./style-presets";
import { type StyleAppearance } from "./style-appearance";
import { CompiledLayoutPreview } from "./CompiledLayoutPreview";
import { BRAND_REFERENCES, VISUAL_LAYOUTS, createVisualSpec, presetFromVisualSpec, type VisualLayout } from "../../../../shared/visual-design/spec";
import { AppearanceButtons, AppearancePanel, type AppearancePanelKind } from "./AppearanceControls";
import { PreviewViewport } from "./PreviewViewport";
import { PreviewStyleSelect } from "./PreviewStyleSelect";
import type { PreviewScrollMemory } from "./use-preview-scroll";
import { ComponentGallery, GALLERY_CATEGORIES, useGallerySample } from "./ComponentGallery";

// Aspect presets describe preview shapes, not a claim to emulate device hardware or pixel density.
const MOBILE_VIEWPORTS = [
  { id: "tall", width: 360, height: 780, ratio: "9:19.5", rotatedRatio: "19.5:9" },
  { id: "standard", width: 360, height: 640, ratio: "9:16", rotatedRatio: "16:9" },
  { id: "wide", width: 480, height: 768, ratio: "10:16", rotatedRatio: "16:10" },
  { id: "square", width: 600, height: 600, ratio: "1:1", rotatedRatio: "1:1" },
] as const;

function DeviceSwitch({ device, onChange }: { device: PreviewDevice; onChange: (device: PreviewDevice) => void }): JSX.Element {
  return <div className="creation-device-switch" role="group" aria-label={uiText("creation.preview.device")}>
    <button type="button" aria-pressed={device === "web"} onClick={() => onChange("web")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8m-4-5v5"/></svg>{uiText("creation.preview.web")}</button>
    <button type="button" aria-pressed={device === "mobile"} onClick={() => onChange("mobile")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>{uiText("creation.preview.mobile")}</button>
  </div>;
}
function StyleMotif({ preset }: { preset: StylePreset }): JSX.Element { return <span className="creation-style-motif" data-style={preset.id} aria-hidden="true"><i/><b/><em/></span>; }

export function StylePicker({ brandId, onBrandChange, layout, onLayoutChange, targets, value, onChange, appearance, onAppearanceChange, defaultDevice = "web", projectName, projectDescription }: { brandId?:string; onBrandChange?:(id:string)=>void; layout?:VisualLayout; onLayoutChange?:(layout:VisualLayout)=>void; targets?:string[]; projectName?: string; projectDescription?: string; value: string; onChange: (value: string) => void; appearance: StyleAppearance; onAppearanceChange: (value: StyleAppearance) => void; defaultDevice?: PreviewDevice }): JSX.Element {
  useUiLocale();
  const optionsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host=optionsRef.current, selected=host?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if(!host||!selected)return;
    const box=host.getBoundingClientRect(), item=selected.getBoundingClientRect();
    if(item.top<box.top)host.scrollTop-=box.top-item.top;
    else if(item.bottom>box.bottom)host.scrollTop+=item.bottom-box.bottom;
  },[value]);
  const [device, setDevice] = useState<PreviewDevice>(defaultDevice);
  const [view, setView] = useState<"components" | "layout">("components");
  const [settings, setSettings] = useState<AppearancePanelKind>(null);
  const [expanded, setExpanded] = useState(false);
  const [mobileViewport, setMobileViewport] = useState<typeof MOBILE_VIEWPORTS[number]>(MOBILE_VIEWPORTS[0]);
  const [rotated, setRotated] = useState(false);
  const viewportWidth = rotated ? mobileViewport.height : mobileViewport.width;
  const viewportHeight = rotated ? mobileViewport.width : mobileViewport.height;
  const [resetKey, setResetKey] = useState(0);
  const [more, setMore] = useState(() => !!value && !STYLE_PRESETS.some((preset) => preset.id === value));
  const scrollMemory = useRef<PreviewScrollMemory>(new Map());
  const gallerySample = useGallerySample();
  const predefined = UI_STYLE_OPTIONS.find((option) => option.value === value);
  const base = STYLE_PRESETS.find((item) => item.id === value) ?? STYLE_PRESETS[0]!;
  const visual = createVisualSpec({projectName,projectDescription,styleId:value,...appearance,brandId,layout,targets});
  const preset = {...presetFromVisualSpec(visual),label:base.label,description:base.description,summary:base.summary};
  const custom = value === "custom" || (!!value && !predefined);
  const appearanceButtons = <AppearanceButtons base={base} appearance={appearance} kind={settings} onToggle={setSettings}/>;
  const appearancePanel = (active = !expanded) => <AppearancePanel active={active} base={base} appearance={appearance} kind={settings} onChange={onAppearanceChange} onDismiss={() => setSettings(null)}/>;
  const tools = (allowExpand: boolean) => <>
    <div className="creation-preview-tools creation-catalog-tools">
      <div className="creation-gallery-tabs creation-device-switch" role="group" aria-label={uiText("catalog.view")}>
        {(["components", "layout"] as const).map((tab) => <button key={tab} type="button" aria-pressed={view === tab} onClick={() => setView(tab)}>{uiText(`catalog.${tab}`)}</button>)}
      </div><DeviceSwitch device={device} onChange={setDevice}/>
      <div className="creation-preview-actions">{appearanceButtons}{allowExpand && <button type="button" className="creation-expand-button" onClick={() => setExpanded(true)} aria-label={uiText("creation.style.previewNamed", { name: preset?.label ?? "" })}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>{uiText("creation.style.preview")}</button>}</div>
    </div>
    {!allowExpand && device === "mobile" && <div className="creation-viewport-tools" role="group" aria-label={uiText("creation.preview.ratio")}>
      {MOBILE_VIEWPORTS.map((viewport) => <button type="button" key={viewport.id} aria-pressed={mobileViewport.id === viewport.id} onClick={() => setMobileViewport(viewport)}>{uiText(`creation.preview.viewport.${viewport.id}`)}</button>)}
      <span className="creation-viewport-ratio" aria-live="polite">{rotated ? mobileViewport.rotatedRatio : mobileViewport.ratio}</span>
      <button type="button" className="creation-viewport-rotate" aria-pressed={rotated} onClick={() => setRotated(!rotated)}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 9a8 8 0 1 1 1 9M4 3v6h6"/></svg>{uiText("creation.preview.rotate")}</button>
    </div>}
    {appearancePanel(!allowExpand || !expanded)}
    {view === "components" ? <div className="creation-catalog-nav" role="group" aria-label={uiText("catalog.categories")}>{GALLERY_CATEGORIES.map((category) => <button key={category} type="button" aria-pressed={gallerySample.category === category} onClick={() => gallerySample.setCategory(category)}>{uiText(`catalog.${category}`)}</button>)}<button type="button" className="creation-catalog-reset" onClick={() => { gallerySample.reset(); for (const key of scrollMemory.current.keys()) if (key.startsWith("components:")) scrollMemory.current.delete(key); setResetKey((key) => key + 1); }}>{uiText("catalog.reset")}</button></div> : <div className="creation-layout-tools" role="group" aria-label={uiText("creation.design.layout")}>{VISUAL_LAYOUTS.map(item=><button type="button" className="creation-state-toggle" key={item} aria-pressed={(layout??"dashboard")===item} onClick={()=>onLayoutChange?.(item)}>{uiText(`creation.design.layout.${item}`)}</button>)}</div>}
  </>;
  const previewContent = (large: boolean) => preset && (view === "components" ? <div className={`component-gallery-host ${large ? "is-expanded" : ""}`} data-device={device}><ComponentGallery key={`${preset.id}:${device}:${large}:${resetKey}`} preset={preset} device={device} effect={appearance.effect} sample={gallerySample} expanded={large} previewActive={large || !expanded} scrollMemory={scrollMemory.current} projectName={projectName}/></div> : <CompiledLayoutPreview spec={visual} device={device} title={projectName} description={projectDescription}/>);
  const preview = (large: boolean) => large ? <PreviewViewport device={device} width={viewportWidth} height={viewportHeight}>{previewContent(true)}</PreviewViewport> : previewContent(false);
  return <div className="creation-style-picker">
    <div className="creation-style-layout">
      <div ref={optionsRef} className="creation-style-options" role="group" aria-label={uiText("ui.ProjectFormTypes.uiStyle")}>
        <button type="button" className={`creation-style-option creation-style-recommend ${!value ? "is-selected" : ""}`} aria-pressed={!value} onClick={() => onChange("")}><span className="creation-recommend-symbol" aria-hidden="true">✧</span><span><strong>{uiText("creation.style.recommend")}</strong><small>{uiText("creation.style.recommendHint")}</small></span></button>
        {STYLE_PRESETS.map((item) => <button key={item.id} type="button" className={`creation-style-option ${value === item.id ? "is-selected" : ""}`} aria-pressed={value === item.id} aria-label={item.label} onClick={() => onChange(item.id)}><StyleMotif preset={item}/><span><strong>{item.label}</strong><small>{item.summary}</small></span><span className="creation-option-check" aria-hidden="true">{value === item.id ? "✓" : ""}</span></button>)}
      </div>
      <section className="creation-preview-panel" aria-label={uiText("creation.preview.main")}>{preset ? <><div className="sr-only"><strong aria-live="polite">{!value && <span>{uiText("creation.preview.example")} · </span>}{preset.label}</strong></div>{tools(true)}{preview(false)}</> : <><div className="creation-preview-actions">{appearanceButtons}</div>{appearancePanel()}<div className="creation-preview-placeholder"><strong>{predefined?.label ?? uiText("ui.StepComponents.describeACustomStyle")}</strong><p>{uiText("creation.preview.otherStyle")}</p></div></>}</section>
    </div>
    <div className="creation-style-bottom"><button type="button" className="creation-text-button" aria-expanded={more} onClick={() => setMore(!more)}>{uiText("creation.style.more")}<span aria-hidden="true">{more ? " −" : " +"}</span></button></div>
    {more && <div className="creation-style-more"><div className="creation-brand-options" role="group" aria-label={uiText("creation.design.brand")}><button type="button" className="creation-state-toggle" aria-pressed={!brandId} onClick={()=>onBrandChange?.("")}>{uiText("creation.design.brand.none")}</button>{BRAND_REFERENCES.filter(brand=>brand.curated).map(brand=><button type="button" className="creation-state-toggle" key={brand.id} aria-pressed={brandId===brand.id} onClick={()=>onBrandChange?.(brand.id)}><i style={{display:"inline-block",width:10,height:10,borderRadius:99,background:brand.accent,marginRight:6}}/>{brand.name}</button>)}</div><button type="button" className="creation-text-button" onClick={()=>onChange("custom")}>{uiText("ui.StepComponents.describeACustomStyle")}</button></div>}
    {custom && <textarea className="em-input px-3 py-2 min-h-[80px] resize-y" aria-label={uiText("ui.StepComponents.describeACustomStyle")} value={value === "custom" ? "" : value} onChange={(event) => onChange(event.target.value || "custom")} placeholder={uiText("ui.StepComponents.eGAMixOfCyberpunkAnd")} />}
    {expanded && preset && <Modal onClose={() => setExpanded(false)} overlayClassName="creation-preview-overlay"><div className="creation-preview-dialog creation-preview-dialog-rich" role="dialog" aria-modal="true" aria-labelledby="style-preview-title"><div className="creation-preview-workspace"><aside className="creation-preview-sidebar"><div className="creation-preview-header"><PreviewStyleSelect titleId="style-preview-title" preset={preset} onChange={onChange}/><button type="button" className="creation-icon-button" aria-label={uiText("common.close")} onClick={() => setExpanded(false)}>✕</button></div><div className="creation-preview-sidebar-tools">{tools(false)}</div><div className="creation-preview-footer"><button type="button" className="btn-accent px-4 py-2 rounded-[var(--radius-lg)] text-sm" onClick={() => { if (value !== preset.id) onChange(preset.id); setExpanded(false); }}>{value === preset.id ? uiText("common.done") : uiText("creation.style.use")}</button></div></aside>{preview(true)}</div></div></Modal>}
  </div>;
}
