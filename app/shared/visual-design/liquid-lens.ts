import { createGlassOpticsEngine, type GlassOpticsEngine } from '../../../resources/visual-design/liquid-optics-engine.mjs';

export interface LiquidLensOptions { bezel?: number; thickness?: number; gain?: number }
const defaultEngine = createGlassOpticsEngine();

/** Approved C material. Engine is explicit so preview and standalone export share the same math. */
export function roundedLensMap(width:number,height:number,radius:number,options:LiquidLensOptions={},engine:GlassOpticsEngine=defaultEngine):{width:number;height:number;data:Uint8ClampedArray;reflection:Uint8ClampedArray;scale:number} {
  const {buildDisplacementLUT,renderDisplacementMap,derivative,fresnelReflectance,sdfGradient,sdfRoundedRect,surfaces}=engine;
  const physicalWidth=Math.max(1,Number.isFinite(width)?width:1),physicalHeight=Math.max(1,Number.isFinite(height)?height:1);
  const sampling=Math.min(2,512/physicalWidth,256/physicalHeight);
  const mapWidth=Math.max(1,Math.round(physicalWidth*sampling)),mapHeight=Math.max(1,Math.round(physicalHeight*sampling));
  const r=Math.max(0,Math.min(Number.isFinite(radius)?radius:0,physicalWidth/2,physicalHeight/2))*sampling;
  const bezel=Math.max(.1,Math.min(options.bezel??10,physicalWidth/2,physicalHeight/2));
  const thickness=options.thickness??.8,gain=options.gain??1.5;
  const innerWeight=(t:number)=>{const x=Math.max(0,Math.min(1,(t-.6)/.4));return 1-x*x*x*(x*(x*6-15)+10);};
  const {lut,peak}=buildDisplacementLUT(512,{baseT:thickness,surface:surfaces.squircle,fresnelFade:true});
  for(let i=0;i<lut.length;i++)lut[i]=lut[i]!*innerWeight(i/(lut.length-1));
  const data=new Uint8ClampedArray(mapWidth*mapHeight*4),reflection=new Uint8ClampedArray(data.length);
  renderDisplacementMap(data,{width:mapWidth,height:mapHeight,radius:r,bezel:bezel*sampling,lut});
  for(let y=0;y<mapHeight;y++)for(let x=0;x<mapWidth;x++){
    const depth=-sdfRoundedRect(x+.5,y+.5,mapWidth,mapHeight,r);
    if(depth<=-.5||depth>=bezel*sampling)continue;
    const t=Math.max(0,depth/(bezel*sampling)),angle=Math.atan(derivative(surfaces.squircle,t));
    const normal=sdfGradient(x+.5,y+.5,mapWidth,mapHeight,r);
    const light=Math.max(0,-normal.x*.6-normal.y*.8);
    const alpha=(fresnelReflectance(angle)*(.18+.65*light)+Math.pow(light,10)*Math.pow(1-t,5)*.12)*innerWeight(t);
    reflection.set([255,255,255,Math.round(Math.min(.8,alpha)*Math.min(1,depth+.5)*255)],(y*mapWidth+x)*4);
  }
  return{width:mapWidth,height:mapHeight,data,reflection,scale:2*peak*bezel*gain};
}
