import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
const block=source.slice(source.indexOf('let restingViewportHeight'),source.indexOf('\nsyncViewport();'));
const compiled=await transform(block+'\nglobalThis.measure=syncViewport;', {loader:'ts',format:'iife'});
function fixture(){
 class Element{matches(selector){return this.editable&&selector.includes('textarea')}}
 const attrs={},style={setProperty:(key,value)=>attrs[key]=value,removeProperty:key=>delete attrs[key]};
 const root={dataset:{},style},viewport={width:390,height:800},win={innerHeight:800,innerWidth:390,visualViewport:viewport};
 const doc={documentElement:root,activeElement:null};const ctx={window:win,document:doc,HTMLElement:Element};vm.createContext(ctx);vm.runInContext(compiled.code,ctx);
 return {ctx,win,doc,root,viewport,attrs,focus(){const el=new Element();el.editable=true;doc.activeElement=el}};
}
test('focus and viewport shrink toggle keyboard spacing even when layout also resizes',()=>{
 const f=fixture();f.ctx.measure();assert.equal(f.root.dataset.keyboard,undefined);f.focus();f.ctx.measure();
 f.win.innerHeight=500;f.viewport.height=500;f.ctx.measure();assert.equal(f.root.dataset.keyboard,'open');assert.equal(f.attrs['--vvh'],'500px');
 f.win.innerHeight=800;f.viewport.height=800;f.ctx.measure();assert.equal(f.root.dataset.keyboard,undefined);assert.equal(f.attrs['--vvh'],undefined);
});
test('normal toolbar resize without focused editor does not enable keyboard spacing',()=>{
 const f=fixture();f.viewport.height=720;f.win.innerHeight=720;f.ctx.measure();assert.equal(f.root.dataset.keyboard,undefined);
 f.focus();f.ctx.measure();assert.equal(f.root.dataset.keyboard,undefined);
});
test('rotation re-baselines the viewport while an editor is focused',()=>{
 const f=fixture();f.focus();f.viewport.width=800;f.viewport.height=390;f.win.innerHeight=390;f.ctx.measure();assert.equal(f.root.dataset.keyboard,undefined);
});
