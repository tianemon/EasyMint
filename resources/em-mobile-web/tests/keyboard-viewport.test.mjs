import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
const block=source.slice(source.indexOf('function syncViewport()'),source.indexOf('\nsyncViewport();'));
const compiled=await transform(block+'\nglobalThis.measure=syncViewport;', {loader:'ts',format:'iife'});
function fixture(){
 class Element{matches(selector){return this.editable&&selector.includes('textarea')}}
 const attrs={},style={setProperty:(key,value)=>attrs[key]=value,removeProperty:key=>delete attrs[key]};
 const root={dataset:{},style},viewport={width:390,height:800},win={innerHeight:800,innerWidth:390,visualViewport:viewport};
 const doc={documentElement:root,activeElement:null};const ctx={window:win,document:doc,HTMLElement:Element};vm.createContext(ctx);vm.runInContext(compiled.code,ctx);
 return {ctx,win,doc,root,viewport,attrs,focus(){const el=new Element();el.editable=true;doc.activeElement=el}};
}
test('restore prior viewport handling when visual viewport shrinks',()=>{
 const f=fixture();f.ctx.measure();assert.equal(f.attrs['--vvh'],undefined);f.focus();
 f.viewport.height=500;f.ctx.measure();assert.equal(f.attrs['--vvh'],'500px');
 f.viewport.height=800;f.ctx.measure();assert.equal(f.attrs['--vvh'],undefined);
});
test('a layout already resized by the browser is not resized a second time',()=>{
 const f=fixture();f.focus();f.win.innerHeight=500;f.viewport.height=500;f.ctx.measure();assert.equal(f.attrs['--vvh'],undefined);
});
