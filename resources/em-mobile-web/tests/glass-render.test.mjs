import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { fileURLToPath } from 'node:url';
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/ui/glass-dom-mirror.ts', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'adapter', plugins: [{ name: 'geometry-stub', setup(b) {
 b.onResolve({filter:/liquid-dom-optics\.mjs$/},()=>({path:'optics',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export function renderFilter(...args){globalThis.renders.push(args)} export function renderContour(){}'}));
} }] });
function fixture() {
 const window=new Window(),document=window.document,frames=new Map(),observers=[],media=new Map();let next=0;
 document.body.innerHTML='<div class="app"><div class="ambient"><div class="ambient-green"></div></div><div class="message-scroll"><div class="message-column">'+Array.from({length:30},(_,i)=>`<div class="msg-row" data-liquid-row data-index="${i}">message ${i}</div>`).join('')+'</div></div><div class="glass-liquid" data-liquid-glass data-liquid-blur="2.5" style="border-radius:24px"></div></div>';
 Object.defineProperties(window.HTMLElement.prototype,{clientWidth:{get(){return this.classList.contains('glass-liquid')?358:390}},clientHeight:{get(){return this.classList.contains('glass-liquid')?98:800}}});
 window.HTMLElement.prototype.getBoundingClientRect=function(){const isGlass=this.classList.contains('glass-liquid'),column=this.classList.contains('message-column'),row=this.hasAttribute('data-index'),scroll=document.querySelector('.message-scroll').scrollTop,top=isGlass?700:row?Number(this.dataset.index)*100-scroll:column?-scroll:0,height=isGlass?98:row?100:column?3000:800,width=isGlass?358:390;return {left:0,right:width,top,bottom:top+height,width,height,x:0,y:top,toJSON(){}}};
 Object.defineProperty(document,'fonts',{value:{ready:{then(){}}}});
 const state={window,document,console,renders:[],devicePixelRatio:2,performance:{now:()=>5},requestAnimationFrame:cb=>{frames.set(++next,cb);return next},cancelAnimationFrame:id=>frames.delete(id),getComputedStyle:window.getComputedStyle.bind(window),
  ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},MutationObserver:class{constructor(cb){this.cb=cb;observers.push(this)}observe(){}disconnect(){this.disconnected=true}},
  matchMedia:query=>{if(!media.has(query))media.set(query,{matches:false,listeners:new Set(),addEventListener(_,cb){this.listeners.add(cb)},removeEventListener(_,cb){this.listeners.delete(cb)}});return media.get(query)}};
 for(const key of ['Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Event','CustomEvent'])state[key]=window[key];
 vm.createContext(state);vm.runInContext(result.outputFiles[0].text,state);
 const root=document.querySelector('.app'),surface=root.querySelector('.glass-liquid');
 return {state,document,root,surface,observers,media,flush(){const jobs=[...frames.values()];frames.clear();jobs.forEach(cb=>cb())}};
}
test('surfaces share observers; final unmount releases mirrors, listeners and backend',()=>{
 const f=fixture(),other=f.surface.cloneNode();f.root.append(other);
 const a=f.state.adapter.registerLiquidGlass(f.surface),b=f.state.adapter.registerLiquidGlass(other);f.flush();
 assert.equal(f.observers.length,2);assert.equal(f.state.renders.length,2);assert.equal(f.root.querySelectorAll('[data-liquid-mirror-layer]').length,2);
 a();assert.equal(f.root.dataset.liquidBackend,'dom-mirror');b();assert.equal(f.root.dataset.liquidBackend,undefined);assert.equal(f.root.querySelectorAll('[data-liquid-mirror-layer]').length,0);assert.ok(f.observers.every(o=>o.disconnected));
});
test('scroll moves a bounded live mirror without rebuilding geometry or capturing DOM',()=>{
 const f=fixture(),stop=f.state.adapter.registerLiquidGlass(f.surface);f.flush();const calls=f.state.renders.length;
 const scroller=f.root.querySelector('.message-scroll');scroller.scrollTop=400;scroller.dispatchEvent(new f.state.Event('scroll'));f.flush();
 const viewport=f.surface.querySelector('.liquid-dom-viewport');assert.match(viewport.firstElementChild.style.transform,/-400px/);assert.ok(viewport.querySelectorAll('.msg-row').length<8);assert.match(viewport.textContent,/message 11/);assert.equal(f.state.renders.length,calls);
 const layer=f.surface.querySelector('[data-liquid-mirror-layer]');assert.equal(layer.getAttribute('aria-hidden'),'true');assert.equal(layer.inert,true);stop();
});
test('streaming edits replace mirrored text while the same optical map is reused',()=>{
 const f=fixture(),stop=f.state.adapter.registerLiquidGlass(f.surface);f.flush();const calls=f.state.renders.length;
 const row=f.root.querySelector('[data-index="7"]');row.textContent='updated streaming text';f.observers[0].cb([{target:row.firstChild,type:'characterData'}]);f.flush();
 assert.match(f.surface.textContent,/updated streaming text/);assert.equal(f.state.renders.length,calls);stop();
});
test('reduced transparency disables the optical backend and can be changed live',()=>{
 const f=fixture(),stop=f.state.adapter.registerLiquidGlass(f.surface);f.flush();const media=f.media.get('(prefers-reduced-transparency: reduce)');media.matches=true;media.listeners.forEach(cb=>cb());f.flush();assert.equal(f.root.dataset.liquidBackend,'reduced-transparency');media.matches=false;media.listeners.forEach(cb=>cb());f.flush();assert.equal(f.root.dataset.liquidBackend,'dom-mirror');stop();assert.equal(media.listeners.size,0);
});
test('clone IDs are isolated while SVG references and original controls remain intact',()=>{
 const f=fixture(),source=f.document.createElement('div');source.innerHTML='<svg><defs><linearGradient id="paint"></linearGradient></defs><rect fill="url(#paint)"></rect></svg><input name="draft" autofocus onclick="alert(1)"><script>bad()</script>';
 const copy=f.state.adapter.cloneMirrorNode(source,'mirror-test');assert.notEqual(copy.querySelector('linearGradient').id,'paint');assert.equal(copy.querySelector('rect').getAttribute('fill'),'url(#mirror-test-0)');assert.equal(copy.querySelector('input').getAttribute('name'),null);assert.equal(copy.querySelector('input').getAttribute('onclick'),null);assert.equal(copy.querySelector('script'),null);assert.equal(source.querySelector('linearGradient').id,'paint');
});

test('frost is applied to the backdrop before all three liquid refraction paths',async()=>{
 const {renderFilter}=await import('../../../app/shared/visual-design/liquid-dom-optics.mjs');
 const window=new Window(),doc=window.document;
 window.HTMLCanvasElement.prototype.getContext=()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}});
 window.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,';
 const filter=doc.createElementNS('http://www.w3.org/2000/svg','filter');
 renderFilter(filter,58,58,29,{blur:2.5},{bands:3,resolution:.25});
 assert.equal(filter.firstElementChild.tagName,'feGaussianBlur');
 assert.equal(filter.firstElementChild.getAttribute('in'),'SourceGraphic');
 assert.equal(filter.firstElementChild.getAttribute('stdDeviation'),'2.5');
 assert.equal(filter.querySelector('feOffset').getAttribute('in'),'softBackdrop');
 assert.equal(filter.querySelectorAll('feDisplacementMap').length,3);
 for(const warp of filter.querySelectorAll('feDisplacementMap'))assert.equal(warp.getAttribute('in'),'centered');
});

test('unrelated changes and updates to one row do not replace other visible mirrors',()=>{
 const f=fixture(),stop=f.state.adapter.registerLiquidGlass(f.surface);f.flush();
 const mirror=f.surface.querySelector('.liquid-dom-viewport');const untouched=mirror.querySelector('[data-index="6"]');
 const row=f.root.querySelector('[data-index="7"]');row.textContent='updated';f.observers[0].cb([{target:row.firstChild,type:'characterData'}]);f.flush();
 assert.equal(mirror.querySelector('[data-index="6"]'),untouched);
 const toolbar=f.document.createElement('div');f.root.append(toolbar);f.observers[0].cb([{target:toolbar,type:'attributes'}]);f.flush();
 assert.equal(mirror.querySelector('[data-index="6"]'),untouched);stop();
});

test('scrolling list used directly as source keeps mirror positions in scroll coordinates',()=>{
 const f=fixture(),scroller=f.root.querySelector('.message-scroll'),column=scroller.querySelector('.message-column');
 scroller.append(...column.children);column.remove();scroller.scrollTop=400;
 const stop=f.state.adapter.registerLiquidGlass(f.surface);f.flush();
 const viewport=f.surface.querySelector('.liquid-dom-viewport'),row=viewport.querySelector('[data-index="11"]');
 assert.ok(row);assert.equal(row.style.top,'1100px');assert.equal(viewport.firstElementChild.style.top,'0px');assert.match(viewport.firstElementChild.style.transform,/-400px/);
 scroller.scrollTop=500;scroller.dispatchEvent(new f.state.Event('scroll'));f.flush();
 assert.ok(viewport.querySelector('[data-index="12"]'));assert.equal(viewport.firstElementChild.style.top,'0px');assert.match(viewport.firstElementChild.style.transform,/-500px/);stop();
});

test('diagnostic modes switch the actual optical pipeline and stop updates when off',()=>{
 const f=fixture(),stop=f.state.adapter.registerLiquidGlass(f.surface);f.flush();
 const layer=f.surface.querySelector('.liquid-dom-optics'),counts=f.state.renders.length;
 f.root.dataset.glassDiagnosticMode='no-dispersion';f.root.dispatchEvent(new f.state.Event('liquid-diagnostic-mode'));f.flush();
 assert.equal(f.state.renders.at(-1)[5].monochrome,true);assert.equal(f.state.renders.length,counts+1);
 f.root.dataset.glassDiagnosticMode='edge';f.root.dispatchEvent(new f.state.Event('liquid-diagnostic-mode'));f.flush();
 assert.equal(f.state.renders.at(-1)[5].edgeOnly,true);
 f.root.dataset.glassDiagnosticMode='frost';f.root.dispatchEvent(new f.state.Event('liquid-diagnostic-mode'));f.flush();
 assert.match(layer.style.filter,/blur/);assert.equal(f.state.renders.length,counts+2);
 f.root.dataset.glassDiagnosticMode='off';f.root.dispatchEvent(new f.state.Event('liquid-diagnostic-mode'));f.flush();
 assert.equal(f.state.renders.length,counts+2);
 f.root.dataset.glassDiagnosticMode='full';f.root.dispatchEvent(new f.state.Event('liquid-diagnostic-mode'));f.flush();
 assert.match(layer.style.filter,/url/);assert.equal(f.state.renders.at(-1)[5].monochrome,false);stop();
});
test('single-path refraction actually renders one displacement',async()=>{
 const {renderFilter}=await import('../../../app/shared/visual-design/liquid-dom-optics.mjs');const w=new Window(),filter=w.document.createElementNS('http://www.w3.org/2000/svg','filter');
 w.HTMLCanvasElement.prototype.getContext=()=>({createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),putImageData(){}});w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,';
 renderFilter(filter,58,58,29,{blur:2.5},{monochrome:true,resolution:.25});assert.equal(filter.querySelectorAll('feDisplacementMap').length,1);
});

test('diagnostic samples are emitted only while collection is active',()=>{
 const f=fixture(),samples=[];f.root.addEventListener('liquid-diagnostic-sample',e=>samples.push(e.detail));
 const stop=f.state.adapter.registerLiquidGlass(f.surface);f.flush();assert.equal(samples.length,0);
 f.root.dataset.glassDiagnosticActive='true';const scroller=f.root.querySelector('.message-scroll');scroller.scrollTop=300;scroller.dispatchEvent(new f.state.Event('scroll'));f.flush();
 assert.equal(samples.length,1);assert.equal(samples[0].rows,30);assert.ok(samples[0].mirrored>0);stop();
});

test('edge mode confines displacement to four bands and keeps the blurred center',async()=>{
 const {renderFilter}=await import('../../../app/shared/visual-design/liquid-dom-optics.mjs');const w=new Window(),filter=w.document.createElementNS('http://www.w3.org/2000/svg','filter');
 w.HTMLCanvasElement.prototype.getContext=()=>({createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),putImageData(){}});w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,';
 renderFilter(filter,358,126,24,{blur:2.5},{edgeOnly:true,resolution:.25});
 const passes=[...filter.querySelectorAll('feDisplacementMap')];assert.equal(passes.length,4);
 for(const p of passes){const x=Number(p.getAttribute('x')),y=Number(p.getAttribute('y')),width=Number(p.getAttribute('width')),height=Number(p.getAttribute('height'));assert.ok(!(x<227&&x+width>227&&y<111&&y+height>111),'center must not be displaced');}
 const merge=filter.querySelector('feMerge');assert.equal(merge.firstElementChild.getAttribute('in'),'softBackdrop');assert.equal(merge.children.length,5);
});
