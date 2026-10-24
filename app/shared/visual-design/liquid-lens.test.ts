import { describe, expect, it } from 'vitest';
import { roundedLensMap } from './liquid-lens';
import { createGlassOpticsEngine } from '../../../resources/visual-design/liquid-optics-engine.mjs';

describe('C optical material',()=>{
  it('keeps the centre clear and refracts the rounded rim inward symmetrically',()=>{
    const map=roundedLensMap(320,64,32);
    const offset=(x:number,y:number)=>(Math.min(map.height-1,Math.floor(y/64*map.height))*map.width+Math.min(map.width-1,Math.floor(x/320*map.width)))*4;
    const pixel=(x:number,y:number)=>[...map.data.slice(offset(x,y),offset(x,y)+2)];
    const alpha=(x:number,y:number)=>map.reflection[offset(x,y)+3]!;
    expect(pixel(160,32)).toEqual([128,128]);
    expect(pixel(100,32)).toEqual([128,128]);
    expect(pixel(1,1)).toEqual([128,128]);
    expect(alpha(160,32)).toBe(0);expect(alpha(1,1)).toBe(0);
    const left=pixel(7,32),right=pixel(312,32),top=pixel(160,7),bottom=pixel(160,56);
    expect(left[0]).toBeGreaterThan(128);expect(right[0]).toBeLessThan(128);
    expect(top[1]).toBeGreaterThan(128);expect(bottom[1]).toBeLessThan(128);
    expect(Math.abs(left[0]!+right[0]!-256)).toBeLessThanOrEqual(1);
    expect(Math.abs(top[1]!+bottom[1]!-256)).toBeLessThanOrEqual(1);
    expect(alpha(160,0)).toBeGreaterThan(alpha(160,4));
    expect(alpha(160,0)).toBeGreaterThan(alpha(160,63));
    expect(alpha(160,9)).toBeLessThanOrEqual(1);expect(alpha(160,10)).toBe(0);
  });
  it('uses the requested defaults and preserves displacement when the inner shoulder fades',()=>{
    const options={bezel:10,thickness:.8,gain:1.5};
    const implicit=roundedLensMap(312,68,34),explicit=roundedLensMap(312,68,34,options);
    expect(implicit).toEqual(explicit);
    const strong=roundedLensMap(312,68,34,{...options,gain:2});
    expect(strong.scale/implicit.scale).toBeCloseTo(2/1.5);
    expect(strong.data).toEqual(implicit.data);
    expect(strong.reflection).toEqual(implicit.reflection);
    expect(roundedLensMap(312,68,34,{...options,thickness:1.2}).scale).toBeGreaterThan(implicit.scale);
  });
  it('is deterministic and bounds allocation while retaining the aspect ratio',()=>{
    const first=roundedLensMap(1200,900,30),second=roundedLensMap(1200,900,30);
    expect(first.width).toBeLessThanOrEqual(512);expect(first.height).toBe(256);
    expect(first.width/first.height).toBeCloseTo(1200/900,2);
    expect(first.data).toEqual(second.data);expect(first.reflection).toEqual(second.reflection);
    const tiny=roundedLensMap(1,1,50);
    expect(tiny.data.length).toBe(16);expect(Number.isFinite(tiny.scale)).toBe(true);
  });
  it('serializes the same engine and generator without requiring bundler scope',()=>{
    const engine=new Function(`return (${createGlassOpticsEngine.toString()})();`)();
    const standalone=new Function(`return (${roundedLensMap.toString()});`)();
    const generated=standalone(312,68,34,{},engine);
    const preview=roundedLensMap(312,68,34);
    expect(generated).toEqual(preview);
  });
});
