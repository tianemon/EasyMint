import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {defaults,opticsAt,sampleOffset,spectrum} from '../../../../app/shared/visual-design/liquid-dom-optics.mjs';
import {spectrumUniforms} from '../webgl/spectrum.mjs';
const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} vs ${b}`);
test('shared baseline parameters stay aligned with the approved WebGL preset',async()=>{
 const preset=JSON.parse(await readFile(new URL('../../../../resources/visual-design/liquid-template-preset.json',import.meta.url),'utf8'));
 for(const [key,value]of Object.entries(defaults))if(key in preset.parameters)near(value,preset.parameters[key]);
});
test('8-band weights and IOR shifts match the WebGL spectral extension',()=>{
 const actual=spectrum(8),expected=spectrumUniforms(8);
 actual.forEach((band,i)=>{band.weights.forEach((v,c)=>near(v,expected[i*4+c]));near(band.shift,expected[i*4+3])});
 for(let c=0;c<3;c++)near(actual.reduce((sum,b)=>sum+b.weights[c],0),1);
});
test('flat face remains stationary, edge paths stay finite and mirror symmetrically',()=>{
 const bands=spectrum(8),w=358,h=126,r=32;
 const center=opticsAt(w/2,h/2,w,h,r);assert.deepEqual(center.normal,[-0,-0,1]);
 for(const band of bands)sampleOffset(center,band).forEach(v=>near(v,0));
 let max=0;
 for(let y=1;y<h;y+=5)for(let x=1;x<w;x+=5){const p=opticsAt(x,y,w,h,r),mirror=opticsAt(w-x,y,w,h,r);
  for(const band of bands){const a=sampleOffset(p,band),b=sampleOffset(mirror,band);a.forEach(v=>{assert.ok(Number.isFinite(v));max=Math.max(max,Math.abs(v))});near(a[0],-b[0]);near(a[1],b[1])}
 }
 assert.ok(max>1&&max<48,`unexpected displacement ${max}`);
});
test('refraction tapers into the stationary face and zero gain disables all offsets',()=>{
 const w=358,h=126,r=32,band=spectrum(3)[0],boundary=h*defaults.bevelRatio*defaults.width;
 const inside=sampleOffset(opticsAt(w/2,boundary-.001,w,h,r),band),outside=sampleOffset(opticsAt(w/2,boundary+.001,w,h,r),band);
 inside.forEach((v,i)=>near(v,outside[i],.001));
 sampleOffset(opticsAt(1,h/2,w,h,r),band,0).forEach(v=>near(v,0));
});
test('8-bit map centering compensation removes its half-unit neutral bias',()=>{
 const scale=31,neutral=128,offset=scale*(neutral/255-.5)-scale/510;near(offset,0);
});
