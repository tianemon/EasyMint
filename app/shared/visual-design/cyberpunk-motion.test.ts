import {afterEach,describe,expect,it,vi} from 'vitest';
import {mountCyberpunkMotion} from './cyberpunk-motion';

afterEach(()=>vi.unstubAllGlobals());
describe('cyberpunk projection lifecycle',()=>{
  it('tolerates an unavailable canvas context without allocating animation resources',()=>{
    const request=vi.fn();vi.stubGlobal('requestAnimationFrame',request);
    const root={querySelector:()=>({getContext:()=>null})} as unknown as HTMLElement;
    expect(()=>mountCyberpunkMotion(root,false,[])()).not.toThrow();expect(request).not.toHaveBeenCalled();
  });
  it('stops when inactive, offscreen or hidden, resumes once, and releases all observers/listeners',()=>{
    const callbacks:Record<string,()=>void>={},observers:Array<{disconnect:ReturnType<typeof vi.fn>}>=[];
    const node=()=>({addEventListener:vi.fn(),removeEventListener:vi.fn()});
    const holder={...node(),getBoundingClientRect:()=>({width:0,height:0})};
    const canvas={parentElement:holder,dataset:{},getContext:()=>({})};
    const root={...node(),dataset:{paused:'false',effect:'standard'},querySelector:()=>canvas} as unknown as HTMLElement;
    const doc={hidden:false,addEventListener:vi.fn((name:string,fn:()=>void)=>{callbacks[name]=fn;}),removeEventListener:vi.fn()};
    const media={matches:false,addEventListener:vi.fn((_name:string,fn:()=>void)=>{callbacks.motionPreference=fn;}),removeEventListener:vi.fn()},request=vi.fn(()=>11),cancel=vi.fn();
    vi.stubGlobal('document',doc);vi.stubGlobal('matchMedia',()=>media);vi.stubGlobal('devicePixelRatio',2);vi.stubGlobal('requestAnimationFrame',request);vi.stubGlobal('cancelAnimationFrame',cancel);
    vi.stubGlobal('ResizeObserver',class{disconnect=vi.fn();constructor(){observers.push(this);}observe=vi.fn();});
    vi.stubGlobal('MutationObserver',class{disconnect=vi.fn();constructor(callback:()=>void){callbacks.mutation=callback;observers.push(this);}observe=vi.fn();});
    vi.stubGlobal('IntersectionObserver',class{disconnect=vi.fn();constructor(callback:(entries:unknown[])=>void){callbacks.offscreen=()=>callback([{isIntersecting:false}]);callbacks.onscreen=()=>callback([{isIntersecting:true}]);observers.push(this);}observe=vi.fn();});
    const dispose=mountCyberpunkMotion(root,false,[]);
    expect(request).toHaveBeenCalledTimes(1);
    root.dataset.paused='true';callbacks.mutation!();expect(request).toHaveBeenCalledTimes(1);
    root.dataset.paused='false';callbacks.mutation!();expect(request).toHaveBeenCalledTimes(2);
    callbacks.offscreen!();expect(request).toHaveBeenCalledTimes(2);
    callbacks.onscreen!();expect(request).toHaveBeenCalledTimes(3);
    doc.hidden=true;callbacks.visibilitychange!();expect(request).toHaveBeenCalledTimes(3);
    media.matches=true;doc.hidden=false;callbacks.visibilitychange!();expect(request).toHaveBeenCalledTimes(3);
    media.matches=false;callbacks.motionPreference!();expect(request).toHaveBeenCalledTimes(4);
    dispose();expect(cancel).toHaveBeenCalled();expect(observers).toHaveLength(3);observers.forEach(observer=>expect(observer.disconnect).toHaveBeenCalledTimes(1));
    expect(root.removeEventListener).toHaveBeenCalledWith('click',expect.any(Function));expect(holder.removeEventListener).toHaveBeenCalledWith('pointermove',expect.any(Function));expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange',expect.any(Function));
    callbacks.onscreen!();expect(request).toHaveBeenCalledTimes(4);
  });
});
