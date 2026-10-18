import { uiText, useUiLocale } from "../../lib/i18n";
import { useEffect, useRef } from "react";
import { renderVisualDocument } from "../../../../shared/visual-design/document";
import type { VisualSpec } from "../../../../shared/visual-design/spec";
import base from "../../../../../resources/visual-design/style-preview.css?raw";
import gallery from "../../../../../resources/visual-design/component-gallery.css?raw";
import layouts from "../../../../../resources/visual-design/layouts.css?raw";
import additional from "../../../../../resources/visual-design/additional-styles.css?raw";
import runtime from "../../../../../resources/visual-design/runtime.js?raw";
export function CompiledLayoutPreview({spec,device,title,description}:{spec:VisualSpec;device:'web'|'mobile';title?:string;description?:string}) {
 const locale=useUiLocale();
 const frame=useRef<HTMLIFrameElement>(null),position=useRef(0);
 useEffect(()=>{const listener=(event:MessageEvent)=>{if(event.source===frame.current?.contentWindow&&event.data?.type==='visual-preview-scroll'&&Number.isFinite(event.data.top))position.current=Math.max(0,event.data.top)};window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener)},[]);
 return <iframe ref={frame} title={uiText("creation.preview.main")} sandbox="allow-scripts" style={{border:0,width:'100%',height:'100%',minHeight:0,display:'block',flex:1}} srcDoc={renderVisualDocument(spec,{css:[base,gallery,layouts,additional].join('\n'),runtime},{device,title,description,locale})} onLoad={()=>frame.current?.contentWindow?.postMessage({type:'visual-preview-restore',top:position.current},'*')}/>;
}
