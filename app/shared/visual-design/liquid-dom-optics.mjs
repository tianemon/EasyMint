// CPU counterpart of liquid-material.agsl: geometry-only maps, never DOM capture.
// Distances are in CSS pixels; the ray equations are scale invariant.
export const defaults = {
  bevelRatio: .115, width: 1.36, sideWidth: 1.3, heightRatio: .52,
  normalStep: .04, ior: 1.5, travel: .86, sideTravel: 1.3,
  faceScale: 1, rimStrength: .23, sideRim: 1.22, rimRange: .6,
  dispersion: .006, rimDispersion: .002, thicknessGain: 1.2,
  curveGain: 1, spectralGain: 4, blur: .2,
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a,b,t) => a+(b-a)*t;
export const smoothstep = (a,b,v) => {const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t)};
export function surface(x,y,w,h,r) {
  const vx=x-w/2,vy=y-h/2,qx=Math.abs(vx)-w/2+r,qy=Math.abs(vy)-h/2+r;
  const cx=Math.max(qx,0),cy=Math.max(qy,0),length=Math.hypot(cx,cy);
  const nx=length>.001?cx/length:Number(qx>qy),ny=length>.001?cy/length:Number(qx<=qy);
  return {distance:length+Math.min(Math.max(qx,qy),0)-r,nx:Math.sign(vx)*nx,ny:Math.sign(vy)*ny,lateral:nx*nx};
}
function refract(v,n,eta) {
  const dot=v[0]*n[0]+v[1]*n[1]+v[2]*n[2],k=1-eta*eta*(1-dot*dot);
  if(k<0)return [0,0,0];
  const f=eta*dot+Math.sqrt(k);return v.map((value,i)=>eta*value-f*n[i]);
}
export function opticsAt(x,y,w,h,r,settings={}) {
  const p={...defaults,...settings},bevel=h*p.bevelRatio,baseWidth=bevel*p.width;
  const shape=surface(x,y,w,h,r),localWidth=baseWidth*mix(1,p.sideWidth,shape.lateral);
  const heightAt=(px,py)=>{const s=surface(px,py,w,h,r),t=clamp(-s.distance/(baseWidth*mix(1,p.sideWidth,s.lateral)),0,1);return baseWidth*p.heightRatio*Math.sqrt(Math.max(0,1-(1-t)*(1-t)))};
  const height=heightAt(x,y),step=localWidth*p.normalStep;
  const gx=(heightAt(x+step,y)-heightAt(x-step,y))/(2*step)*p.curveGain;
  const gy=(heightAt(x,y+step)-heightAt(x,y-step))/(2*step)*p.curveGain;
  const length=Math.hypot(gx,gy,1),normal=[-gx/length,-gy/length,1/length];
  const depth=Math.max(-shape.distance,0),t=clamp(depth/localWidth,0,1);
  const blend=1-smoothstep(.65,1,t),rim=1-smoothstep(0,p.rimRange,depth/localWidth);
  const dispersion=((1-smoothstep(.45,1,t))*p.dispersion+(1-smoothstep(0,.45,t))*p.rimDispersion)*p.spectralGain;
  const face=[w/2+(x-w/2)*p.faceScale,h/2+(y-h/2)*p.faceScale];
  function trace(ior){const inside=refract([0,0,-1],normal,1/ior),outside=refract(inside,[0,0,1],ior),nxy=Math.max(Math.hypot(normal[0],normal[1]),.001);
    const rimOffset=-bevel*p.rimStrength*mix(1,p.sideRim,shape.lateral)*rim*rim*((ior-1)/.46);
    const travel=bevel*p.travel*mix(1,p.sideTravel,shape.lateral)/Math.max(-outside[2],.025);
    return [x,y].map((v,i)=>clamp(v+inside[i]*height*p.thicknessGain/Math.max(-inside[2],.025)+outside[i]*travel+normal[i]/nxy*rimOffset,.5/3.75-48,(i===0?w:h)+48-.5/3.75));
  }
  return {point:[x,y],shape,normal,height,depth,blend,dispersion,face,trace,ior:p.ior};
}
// Same positive, channel-normalized CIE approximation as the spectral WebGL demo.
export function spectrum(count) {
  if(count===3)return [{shift:-1,weights:[1,0,0]},{shift:0,weights:[0,1,0]},{shift:1,weights:[0,0,1]}];
  const gaussian=(wave,mean,left,right)=>Math.exp(-.5*((wave-mean)/(wave<mean?left:right))**2);
  const first=420+130/count,last=680-130/count,radius=Math.max((550/first)**2-1,1-(550/last)**2),sums=[0,0,0];
  const bands=Array.from({length:count},(_,i)=>{const wave=420+260*(i+.5)/count;
    const x=1.056*gaussian(wave,599.8,37.9,31)+.362*gaussian(wave,442,16,26.7)-.065*gaussian(wave,501.1,20.4,26.2);
    const y=.821*gaussian(wave,568.8,46.9,40.5)+.286*gaussian(wave,530.9,16.3,31.1);
    const z=1.217*gaussian(wave,437,11.8,36)+.681*gaussian(wave,459,26,13.8);
    const weights=[Math.max(0,3.2406*x-1.5372*y-.4986*z),Math.max(0,-.9689*x+1.8758*y+.0415*z),Math.max(0,.0557*x-.204*y+1.057*z)];weights.forEach((v,c)=>sums[c]+=v);return {shift:((550/wave)**2-1)/radius,weights};
  });return bands.map(b=>({...b,weights:b.weights.map((v,c)=>v/sums[c])}));
}
export function sampleOffset(optic,band,gain=1) {
  const traced=optic.trace(Math.max(1.001,optic.ior+optic.dispersion*band.shift));
  return traced.map((v,i)=>(mix(optic.face[i],v,optic.blend)-optic.point[i])*gain);
}

/** Build geometry maps once per size/material change; scrolling only moves live DOM. */
export function renderFilter(filter,w,h,r,settings={},options={}) {
  const pad=48,scale=options.resolution??Math.min(globalThis.devicePixelRatio||1,2),pw=Math.max(1,Math.round((w+pad*2)*scale)),ph=Math.max(1,Math.round((h+pad*2)*scale));
  const bands=options.monochrome || options.edgeOnly ? [{shift:0,weights:[1,1,1]}] : spectrum(options.bands??3),gain=options.gain??1,offsets=bands.map(()=>new Float32Array(pw*ph*2));let maxOffset=.01;
  for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){
    const px=(x+.5)*(w+pad*2)/pw-pad,py=(y+.5)*(h+pad*2)/ph-pad;
    if(surface(px,py,w,h,r).distance>1)continue;
    const optic=opticsAt(px,py,w,h,r,settings),index=(y*pw+x)*2;
    for(let b=0;b<bands.length;b++){const shift=sampleOffset(optic,bands[b],gain);offsets[b][index]=shift[0];offsets[b][index+1]=shift[1];maxOffset=Math.max(maxOffset,Math.abs(shift[0]),Math.abs(shift[1]))}
  }
  const displacementScale=maxOffset*2*255/254,doc=filter.ownerDocument;filter.replaceChildren();
  const primitive=(name,attrs)=>{const el=doc.createElementNS('http://www.w3.org/2000/svg',name);for(const [key,v]of Object.entries(attrs))el.setAttribute(key,String(v));filter.append(el);return el};
  primitive('feGaussianBlur',{in:'SourceGraphic',stdDeviation:settings.blur??defaults.blur,result:'softBackdrop','color-interpolation-filters':'sRGB'});
  primitive('feOffset',{in:'softBackdrop',dx:displacementScale/510,dy:displacementScale/510,result:'centered'});
  bands.forEach((band,b)=>{
    const canvas=doc.createElement('canvas');canvas.width=pw;canvas.height=ph;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');
    const img=ctx.createImageData(pw,ph),data=offsets[b];for(let i=0;i<pw*ph;i++){img.data[i*4]=Math.round(128+data[i*2]/displacementScale*255);img.data[i*4+1]=Math.round(128+data[i*2+1]/displacementScale*255);img.data[i*4+2]=128;img.data[i*4+3]=255}ctx.putImageData(img,0,0);
    primitive('feImage',{href:canvas.toDataURL(),x:0,y:0,width:'100%',height:'100%',preserveAspectRatio:'none',result:'map'+b});
    if (options.edgeOnly) {
      // Only process the four interior edge bands. Distortion has already tapered
      // to zero at the inner boundary, so the unchanged blurred center joins it.
      const band=Math.min(h/2,Math.ceil(h*(settings.bevelRatio??defaults.bevelRatio)*(settings.width??defaults.width)*(settings.sideWidth??defaults.sideWidth))+3);
      const horizontal=Math.min(w/2,band),vertical=Math.max(0,h-2*band);
      const regions=[[pad,pad,w,band],[pad,pad+h-band,w,band],[pad,pad+band,horizontal,vertical],[pad+w-horizontal,pad+band,horizontal,vertical]];
      const names=[];
      regions.forEach(([x,y,width,height],i)=>{if(width<=0||height<=0)return;const name='edge'+i;names.push(name);primitive('feDisplacementMap',{in:'centered',in2:'map'+b,scale:displacementScale,xChannelSelector:'R',yChannelSelector:'G',x,y,width,height,result:name,'color-interpolation-filters':'sRGB'});});
      const merge=primitive('feMerge',{'color-interpolation-filters':'sRGB'});
      for(const name of ['softBackdrop',...names]){const node=doc.createElementNS('http://www.w3.org/2000/svg','feMergeNode');node.setAttribute('in',name);merge.append(node)}
      return;
    }
    primitive('feDisplacementMap',{in:'centered',in2:'map'+b,scale:displacementScale,xChannelSelector:'R',yChannelSelector:'G',result:'bent'+b,'color-interpolation-filters':'sRGB'});
    const [red,green,blue]=band.weights;primitive('feColorMatrix',{in:'bent'+b,type:'matrix',values:`${red} 0 0 0 0  0 ${green} 0 0 0  0 0 ${blue} 0 0  0 0 0 1 0`,result:'weighted'+b,'color-interpolation-filters':bands.length===3?'sRGB':'linearRGB'});
    if(b)primitive('feComposite',{in:b===1?'weighted0':'sum'+(b-1),in2:'weighted'+b,operator:'arithmetic',k1:0,k2:1,k3:1,k4:0,result:'sum'+b,'color-interpolation-filters':bands.length===3?'sRGB':'linearRGB'});
  });
}
export function renderContour(canvas,w,h,r,{width=.5,retreat=2,darkStrength=.26,lightStrength=.24,resolution=Math.min(globalThis.devicePixelRatio||1,3)}={}) {
  const pw=Math.max(1,Math.round(w*resolution)),ph=Math.max(1,Math.round(h*resolution));canvas.width=pw;canvas.height=ph;if(!width)return;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');const img=ctx.createImageData(pw,ph);
  // The Gaussian is below 8-bit visibility outside this conservative band.
  // Skip the flat interior while retaining full corner coverage and identical pixels.
  const band=2+6*Math.max(width,.15),corner=Math.max(0,r)+band;
  const edgePixels=Math.min(pw,Math.ceil(band*pw/w)+1),cornerPixels=Math.min(pw,Math.ceil(corner*pw/w)+1);
  for(let y=0;y<ph;y++){
    const py=(y+.5)*h/ph,limit=py<=band||py>=h-band?pw:(py<=corner||py>=h-corner?cornerPixels:edgePixels);
    const spans=limit*2>=pw?[[0,pw]]:[[0,limit],[pw-limit,pw]];
    for(const [start,end] of spans)for(let x=start;x<end;x++){
      const px=(x+.5)*w/pw,s=surface(px,py,w,h,r),depth=-s.distance;
      const profile=Math.exp(-Math.pow((depth-.4)/Math.max(width,.15),2)),coverage=1-smoothstep(0,1,(s.distance+.5)*resolution);
      const dark=profile*Math.pow(s.nx,4)*darkStrength*coverage,light=profile*Math.pow(s.ny,4)*lightStrength*coverage*(retreat?smoothstep(0,retreat,Math.min(px,w-px)):1),alpha=light+dark*(1-light),k=(y*pw+x)*4;
      img.data[k]=img.data[k+1]=img.data[k+2]=alpha?Math.round(255*light/alpha):0;img.data[k+3]=Math.round(255*alpha);
    }
  }ctx.putImageData(img,0,0);
}
