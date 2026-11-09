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

test('accepted contour keeps the middle clear with horizontal light and lateral dark edges',async()=>{
 const {renderContour}=await import('../../../../app/shared/visual-design/liquid-dom-optics.mjs');let image;
 const canvas={width:0,height:0,getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(value){image=value}})};
 renderContour(canvas,100,60,16,{resolution:2});
 const pixel=(x,y)=>[...image.data.slice((y*canvas.width+x)*4,(y*canvas.width+x)*4+4)];
 assert.equal(pixel(100,60)[3],0);
 const top=pixel(100,1),side=pixel(1,60);
 assert.ok(top[3]>0&&top[0]>200,'top should be bright');assert.ok(side[3]>0&&side[0]<30,'side should be dark');
});

test('optimized contour matches the original visible pixels across sizes and radii',async()=>{
 const {renderContour,surface,smoothstep}=await import('../../../../app/shared/visual-design/liquid-dom-optics.mjs');
 for(const [w,h,r,width,resolution] of [[100,60,16,.5,2],[59,59,29.5,.5,3],[358,150,24,.5,2],[80,40,0,1.5,1],[17,9,4,.1,1]]){
  let img;const canvas={width:0,height:0,getContext:()=>({createImageData:(a,b)=>({data:new Uint8ClampedArray(a*b*4)}),putImageData(v){img=v}})};
  renderContour(canvas,w,h,r,{width,resolution});
  const pw=canvas.width,ph=canvas.height;
  for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){
   const px=(x+.5)*w/pw,py=(y+.5)*h/ph,s=surface(px,py,w,h,r),depth=-s.distance;
   const profile=Math.exp(-(((depth-.4)/Math.max(width,.15))**2)),coverage=1-smoothstep(0,1,(s.distance+.5)*resolution);
   const dark=profile*Math.abs(s.nx)**4*.26*coverage,light=profile*Math.abs(s.ny)**4*.24*coverage*smoothstep(0,2,Math.min(px,w-px));
   const alpha=light+dark*(1-light),expected=Math.round(255*alpha),index=(y*pw+x)*4;
   assert.equal(img.data[index+3],expected,`alpha at ${w}x${h} (${x},${y})`);
   if(expected)assert.equal(img.data[index],Math.round(255*light/alpha),`color at ${w}x${h} (${x},${y})`);
  }
 }
});
