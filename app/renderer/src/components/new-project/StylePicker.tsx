import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { uiText, useUiLocale } from "../../lib/i18n";
import { Modal } from "../ui/Modal";
import { STYLE_PRESETS, type PreviewDevice, type StylePreset } from "./style-presets";
import { STYLE_EFFECTS, type StyleAppearance } from "./style-appearance";
import { createVisualSpec, type VisualLayout } from "../../../../shared/visual-design/spec";
import { PreviewViewport } from "./PreviewViewport";
import { PreviewStyleSelect } from "./PreviewStyleSelect";
import type { PreviewScrollMemory } from "./use-preview-scroll";
import { ShowcasePreview } from "./ShowcasePreview";
import "./preview-chrome.css";

interface Props {
  layout?:VisualLayout;
  targets?:string[]; projectName?:string; projectDescription?:string; active?:boolean;
  value:string; onChange:(value:string)=>void; appearance:StyleAppearance; onAppearanceChange:(value:StyleAppearance)=>void;
  defaultDevice?:PreviewDevice;
}
function DeviceSwitch({device,onChange}:{device:PreviewDevice;onChange:(value:PreviewDevice)=>void}):JSX.Element {
  return <div className="creation-device-switch" role="group" aria-label={uiText("creation.preview.device")}>
    <button type="button" aria-pressed={device==="web"} onClick={()=>onChange("web")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8m-4-5v5"/></svg>{uiText("creation.preview.web")}</button>
    <button type="button" aria-pressed={device==="mobile"} onClick={()=>onChange("mobile")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>{uiText("creation.preview.mobile")}</button>
  </div>;
}
function StyleMotif({preset}:{preset:StylePreset}):JSX.Element {return <span className="creation-style-motif" data-style={preset.id} aria-hidden="true"><i/><b/><em/></span>;}

/** One complete product scene per style; legacy layout/component catalogues are not picker destinations. */
export function StylePicker({layout,targets,value,onChange,appearance,onAppearanceChange,defaultDevice="web",projectName,projectDescription,active=true}:Props):JSX.Element {
  const locale=useUiLocale();
  const optionsRef=useRef<HTMLDivElement>(null),scrollMemory=useRef<PreviewScrollMemory>(new Map());
  const [device,setDevice]=useState<PreviewDevice>(defaultDevice),[expanded,setExpanded]=useState(false);
  useEffect(()=>{if(!active)setExpanded(false);},[active]);
  useLayoutEffect(()=>{
    const host=optionsRef.current,selected=host?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if(!host||!selected)return;
    const box=host.getBoundingClientRect(),item=selected.getBoundingClientRect();
    if(item.top<box.top)host.scrollTop-=box.top-item.top;
    else if(item.bottom>box.bottom)host.scrollTop+=item.bottom-box.bottom;
  },[value]);
  const base=STYLE_PRESETS.find(item=>item.id===value)??STYLE_PRESETS[0]!;
  const custom=!!value&&!STYLE_PRESETS.some(item=>item.id===value);
  const visual=createVisualSpec({locale,projectName,projectDescription,styleId:value,palette:"default",effect:appearance.effect,layout,targets});
  const tools=()=> <div className="creation-scene-tools">
    <DeviceSwitch device={device} onChange={setDevice}/>
    <div className="creation-device-switch creation-scene-effects" role="group" aria-label={uiText("catalog.effect")}>{STYLE_EFFECTS.map(effect=><button type="button" key={effect} aria-pressed={appearance.effect===effect} onClick={()=>onAppearanceChange({palette:"default",effect})}>{uiText(`catalog.effect.${base.id}.${effect}`)}</button>)}</div>
  </div>;
  const content=(large:boolean)=> <ShowcasePreview spec={visual} device={device} active={active&&(large||!expanded)} scrollMemory={scrollMemory.current}/>;
  const preview=(large:boolean)=>device==="mobile"?<div className={large?"creation-scene-large-mobile":"creation-inline-layout-viewport"}><PreviewViewport device={device} width={390} height={780}>{content(large)}</PreviewViewport></div>:content(large);
  return <div className="creation-style-picker">
    <div className="creation-style-layout"><div ref={optionsRef} className="creation-style-options" role="group" aria-label={uiText("ui.ProjectFormTypes.uiStyle")}>
      {STYLE_PRESETS.map(item=><button key={item.id} type="button" className={`creation-style-option ${value===item.id?"is-selected":""}`} aria-pressed={value===item.id} aria-label={item.label} onClick={()=>onChange(item.id)}><StyleMotif preset={item}/><span><strong>{item.label}</strong><small>{item.summary}</small></span><span className="creation-option-check" aria-hidden="true">{value===item.id?"✓":""}</span></button>)}
    </div><section className="creation-preview-panel creation-scene-panel" aria-label={uiText("creation.preview.main")}>
      <div className="creation-preview-tools creation-scene-toolbar">{tools()}<button type="button" className="creation-expand-button" onClick={()=>setExpanded(true)} aria-label={uiText("creation.style.previewNamed",{name:base.label})}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>{uiText("creation.style.preview")}</button></div>
      {preview(false)}
    </section></div>
    <div className="creation-style-bottom"><button type="button" className="creation-text-button" onClick={()=>onChange("custom")}>{uiText("ui.StepComponents.describeACustomStyle")}</button></div>
    {custom&&<textarea className="em-input px-3 py-2 min-h-[80px] resize-y" aria-label={uiText("ui.StepComponents.describeACustomStyle")} value={value==="custom"?"":value} onChange={event=>onChange(event.target.value||"custom")} placeholder={uiText("ui.StepComponents.eGAMixOfCyberpunkAnd")}/>}
    {expanded&&<Modal onClose={()=>setExpanded(false)} overlayClassName="creation-preview-overlay"><div className="creation-preview-dialog creation-preview-dialog-rich" role="dialog" aria-modal="true" aria-labelledby="style-preview-title"><div className="creation-preview-workspace creation-scene-workspace"><div className="creation-preview-header creation-scene-dialog-header"><PreviewStyleSelect titleId="style-preview-title" preset={base} onChange={onChange}/><button type="button" className="creation-icon-button" aria-label={uiText("common.close")} onClick={()=>setExpanded(false)}>✕</button></div><div className="creation-preview-tools creation-scene-toolbar">{tools()}</div>{preview(true)}</div></div></Modal>}
  </div>;
}
