import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Window} from 'happy-dom';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('..',import.meta.url));
const bundle=await build({stdin:{resolveDir:project,contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {Glass} from './src/ui/components/Glass';window.start=()=>{const root=createRoot(document.getElementById('root'));root.render(React.createElement(Glass,{contour:true,radius:24},'内容'));return root};`},bundle:true,write:false,format:'iife',plugins:[{name:'contour-failure',setup(b){b.onResolve({filter:/liquid-dom-optics\.mjs$/},()=>({path:'stub',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export function renderContour(){window.draws=(window.draws||0)+1;if(window.failContour)throw new Error("Canvas unavailable")}' }));}}]});
test('canvas failure keeps the frosted component and its fallback border',async()=>{
 const window=new Window(),document=window.document;window.failContour=true;document.body.innerHTML='<div id="root"></div>';
 window.HTMLElement.prototype.getBoundingClientRect=()=>({width:300,height:100,top:0,left:0,right:300,bottom:100,x:0,y:0,toJSON(){}});
 const context=vm.createContext({window,document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLIFrameElement:window.HTMLIFrameElement,Element:window.Element,Node:window.Node,ResizeObserver:class{observe(){}disconnect(){}},setTimeout,clearTimeout,queueMicrotask,console,performance});
 vm.runInContext(bundle.outputFiles[0].text,context);const root=window.start();await new Promise(resolve=>setTimeout(resolve,60));
 const glass=document.querySelector('.glass');assert.ok(glass,'glass remains mounted');assert.match(glass.className,/glass-frosted/);assert.doesNotMatch(glass.className,/has-fine-contour/);assert.equal(glass.querySelector('canvas').hidden,true);assert.match(glass.textContent,/内容/);root.unmount();window.happyDOM.abort();
});

test('unchanged dimensions reuse the contour and a later failure restores the border',async()=>{
 const window=new Window(),document=window.document;document.body.innerHTML='<div id="root"></div>';let width=300,observer;
 window.HTMLElement.prototype.getBoundingClientRect=()=>({width,height:100,top:0,left:0,right:width,bottom:100,x:0,y:0,toJSON(){}});
 const context=vm.createContext({window,document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLIFrameElement:window.HTMLIFrameElement,Element:window.Element,Node:window.Node,ResizeObserver:class{constructor(cb){observer=cb}observe(){}disconnect(){}},setTimeout,clearTimeout,queueMicrotask,console,performance});
 vm.runInContext(bundle.outputFiles[0].text,context);const root=window.start();await new Promise(resolve=>setTimeout(resolve,60));
 assert.equal(window.draws,1);assert.match(document.querySelector('.glass').className,/has-fine-contour/);observer();assert.equal(window.draws,1);
 width=301;window.failContour=true;observer();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(window.draws,2);assert.doesNotMatch(document.querySelector('.glass').className,/has-fine-contour/);assert.equal(document.querySelector('canvas').hidden,true);
 root.unmount();window.happyDOM.abort();
});
