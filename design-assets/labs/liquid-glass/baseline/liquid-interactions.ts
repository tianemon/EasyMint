import type { roundedLensMap } from './liquid-lens';

/** Self-contained for source export. The pure lens generator is an explicit dependency. */
export function mountLiquidShowcase(root:HTMLElement,english:boolean,makeLens:typeof roundedLensMap):()=>void {
  const scroll=root.querySelector<HTMLElement>('[data-ios-scroll]')!;
  const controls=root.querySelector<HTMLElement>('[data-ios-controls]')!;
  const overlay=root.querySelector<HTMLElement>('[data-ios-player-overlay]')!;
  const tabs=root.querySelector<HTMLElement>('[data-ios-tabs]')!;
  const defs=root.querySelector<SVGDefsElement>('[data-ios-filters]')!;
  const svgNS='http://www.w3.org/2000/svg';
  const prefix=`ios-${Math.random().toString(36).slice(2,9)}`;
  const optics=[...root.querySelectorAll<HTMLElement>('[data-ios-optic]')];
  const filters=new Map<HTMLElement,{id:string;size:string;image:SVGFEImageElement;filter:SVGFilterElement}>();
  const reduced=matchMedia('(prefers-reduced-transparency:reduce)');
  let disposed=false,openFrame=0,frame=0,pointerFrame=0,closeTimer:ReturnType<typeof setTimeout>|undefined,noticeTimer:ReturnType<typeof setTimeout>|undefined;
  let previousScroll=0,activeTab='home',searching=false,playing=false,currentTrack=0;
  let focusOrigin:HTMLElement|null=null;
  let tabDrag:{pointerId:number;x:number}|null=null;
  const originals=[...root.querySelectorAll<HTMLElement>('.ios-home-pane .ios-album')];
  const playSvg='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>';
  const pauseSvg='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3v14H7zm7 0h3v14h-3Z"/></svg>';
  const say=(a:string,b:string)=>{const notice=root.querySelector<HTMLElement>('.ios-notice');if(!notice)return;clearTimeout(noticeTimer);notice.textContent=english?a:b;notice.hidden=false;noticeTimer=setTimeout(()=>{notice.hidden=true;},2300);};
  const setPlaying=(next:boolean)=>{playing=next;root.dataset.iosPlaying=String(next);root.querySelectorAll<HTMLElement>('[data-ios-play]').forEach(button=>{button.setAttribute('aria-pressed',String(next));const svg=button.querySelector('svg');if(svg)svg.outerHTML=next?pauseSvg:playSvg;});};
  const setTrack=(source:HTMLElement)=>{
    const title=source.dataset.iosTitle??'',artist=source.dataset.iosArtist??'',kind=source.dataset.iosArt??'blue';
    currentTrack=Math.max(0,Number(source.dataset.iosAlbum)||0);
    root.querySelectorAll('[data-ios-now-title]').forEach(node=>{node.textContent=title;});
    root.querySelectorAll('[data-ios-now-artist]').forEach(node=>{node.textContent=artist;});
    const cover=source.querySelector('.ios-cover');
    for(const target of root.querySelectorAll('.ios-mini-open>.ios-cover,.ios-player-art>.ios-cover'))if(cover)target.outerHTML=cover.outerHTML;
    root.dataset.iosTrack=kind;setPlaying(true);
  };
  const chooseTab=(name:string)=>{
    activeTab=name;
    root.querySelectorAll<HTMLElement>('[data-ios-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.iosTab===name)));
    root.querySelectorAll<HTMLElement>('[data-ios-pane]').forEach(pane=>{pane.hidden=pane.dataset.iosPane!==name;});
    const title=root.querySelector('[data-ios-heading]');
    const selected=tabs.querySelector<HTMLElement>(`[data-ios-tab="${name}"]`);
    if(title)title.textContent=selected?.textContent?.trim()??'';
    scroll.scrollTop=0;root.dataset.iosMinimized='false';schedule();
  };
  const closeSearch=()=>{
    searching=false;root.dataset.iosSearching='false';
    const form=root.querySelector<HTMLElement>('[data-ios-search-form]')!;form.hidden=true;
    const launch=root.querySelector<HTMLElement>('[data-ios-search-open]')!;launch.setAttribute('aria-expanded','false');
    tabs.inert=false;launch.inert=false;
    root.querySelectorAll<HTMLElement>('[data-ios-album]').forEach(album=>{album.hidden=false;});
    root.querySelector<HTMLElement>('[data-ios-search-empty]')!.hidden=true;
    launch.focus({preventScroll:true});schedule();
  };
  const openSearch=()=>{
    if(activeTab!=='home')chooseTab('home');
    searching=true;root.dataset.iosSearching='true';root.dataset.iosMinimized='false';
    root.querySelector<HTMLElement>('[data-ios-search-form]')!.hidden=false;
    const launch=root.querySelector<HTMLElement>('[data-ios-search-open]')!;launch.setAttribute('aria-expanded','true');
    tabs.inert=true;launch.inert=true;
    root.querySelector<HTMLInputElement>('[data-ios-query]')!.focus({preventScroll:true});schedule();
  };
  const closePlayer=()=>{
    root.dataset.iosPlayerOpen='false';clearTimeout(closeTimer);
    const finish=()=>{overlay.hidden=true;scroll.inert=false;controls.inert=false;if(focusOrigin?.isConnected)focusOrigin.focus({preventScroll:true});schedule();};
    if(matchMedia('(prefers-reduced-motion:reduce)').matches)finish();else closeTimer=setTimeout(finish,300);
  };
  const openPlayer=()=>{
    clearTimeout(closeTimer);focusOrigin=document.activeElement instanceof HTMLElement?document.activeElement:null;
    overlay.hidden=false;scroll.inert=true;controls.inert=true;
    openFrame=requestAnimationFrame(()=>{if(disposed)return;root.dataset.iosPlayerOpen='true';overlay.querySelector<HTMLElement>('[data-ios-collapse]')?.focus({preventScroll:true});schedule();});
  };
  const adapt=()=>{
    const content=[...scroll.querySelectorAll<HTMLElement>('[data-ios-tone]')].filter(node=>!node.closest('[hidden]')).map(card=>({tone:card.dataset.iosTone,box:(card.querySelector('.ios-cover')??card).getBoundingClientRect()}));
    for(const optic of optics) {
      const box=optic.getBoundingClientRect();if(!box.width||!box.height)continue;
      // Keep the film colour fixed. Only glyph contrast follows the
      // background, continuously; crossing a content edge never swaps surface themes.
      const player=!!optic.closest('[data-ios-player-overlay]');
      optic.style.setProperty('--ios-ink-blend',player?'100%':'0%');
      if(reduced.matches)continue;
      const width=Math.round(optic.offsetWidth),height=Math.round(optic.offsetHeight),radius=Math.min(parseFloat(getComputedStyle(optic).borderTopLeftRadius)||28,width/2,height/2);
      const size=`${width}:${height}:${Math.round(radius)}`;
      let entry=filters.get(optic);
      if(entry?.size===size)continue;
      if(!entry){
        const filter=document.createElementNS(svgNS,'filter');const id=`${prefix}-${filters.size}`;
        filter.id=id;filter.setAttribute('filterUnits','userSpaceOnUse');filter.setAttribute('color-interpolation-filters','sRGB');filter.setAttribute('x','0');filter.setAttribute('y','0');
        const image=document.createElementNS(svgNS,'feImage');image.setAttribute('preserveAspectRatio','none');image.setAttribute('result','lens');
        const displacement=document.createElementNS(svgNS,'feDisplacementMap');displacement.setAttribute('in','SourceGraphic');displacement.setAttribute('in2','lens');displacement.setAttribute('scale','32');displacement.setAttribute('xChannelSelector','R');displacement.setAttribute('yChannelSelector','G');
        displacement.setAttribute('result','refracted');
        // Refract the sharp backdrop at the rim, independently of centre diffusion.
        const edgeMask=document.createElementNS(svgNS,'feColorMatrix');edgeMask.setAttribute('in','lens');edgeMask.setAttribute('type','matrix');edgeMask.setAttribute('values','0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0');edgeMask.setAttribute('result','edgeMask');
        const diffusion=document.createElementNS(svgNS,'feGaussianBlur');diffusion.setAttribute('in','SourceGraphic');diffusion.setAttribute('stdDeviation',root.dataset.effect==='subtle'?'0.35':'5');diffusion.setAttribute('result','diffused');
        const edge=document.createElementNS(svgNS,'feComposite');edge.setAttribute('in','refracted');edge.setAttribute('in2','edgeMask');edge.setAttribute('operator','in');edge.setAttribute('result','edge');
        const centre=document.createElementNS(svgNS,'feComposite');centre.setAttribute('in','diffused');centre.setAttribute('in2','edgeMask');centre.setAttribute('operator','out');centre.setAttribute('result','centre');
        const combine=document.createElementNS(svgNS,'feComposite');combine.setAttribute('in','edge');combine.setAttribute('in2','centre');combine.setAttribute('operator','arithmetic');combine.setAttribute('k2','1');combine.setAttribute('k3','1');
        filter.append(image,displacement,edgeMask,diffusion,edge,centre,combine);defs.append(filter);entry={id,size:'',image,filter};filters.set(optic,entry);
      }
      const map=makeLens(width,height,radius,root.dataset.effect==='subtle'?18:13);
      const canvas=document.createElement('canvas');canvas.width=map.width;canvas.height=map.height;
      const context=canvas.getContext('2d');if(!context)continue;
      const pixels=context.createImageData(map.width,map.height);pixels.data.set(map.data);context.putImageData(pixels,0,0);
      entry.filter.setAttribute('width',String(width));entry.filter.setAttribute('height',String(height));entry.image.setAttribute('width',String(width));entry.image.setAttribute('height',String(height));entry.image.setAttribute('href',canvas.toDataURL());entry.size=size;
      optic.style.setProperty('--ios-lens-filter',`url(#${entry.id})`);
    }
    for(const glyph of root.querySelectorAll<HTMLElement>('.ios-tab>svg,.ios-tab>span,.ios-mini-open strong,.ios-mini-open small,.ios-mini-play svg,.ios-search-launch>svg')){
      const box=glyph.getBoundingClientRect();if(!box.width||!box.height)continue;
      let coverage=0;
      for(const card of content){const b=card.box;if(card.tone==='dark')coverage+=Math.max(0,Math.min(box.right,b.right)-Math.max(box.left,b.left))*Math.max(0,Math.min(box.bottom,b.bottom)-Math.max(box.top,b.top));}
      const amount=Math.min(1,coverage/(box.width*box.height));
      glyph.style.setProperty('--ios-glyph-blend',`${Math.round(amount*amount*(3-2*amount)*100)}%`);
    }
    const selected=tabs.querySelector<HTMLElement>('[aria-pressed="true"]');
    if(selected&&!tabDrag){tabs.style.setProperty('--ios-tab-left',`${selected.offsetLeft}px`);tabs.style.setProperty('--ios-tab-width',`${selected.offsetWidth}px`);}
  };
  function schedule(){if(disposed)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(adapt);}
  const observer=new ResizeObserver(schedule);observer.observe(root);optics.forEach(node=>observer.observe(node));
  const onScroll=()=>{const next=scroll.scrollTop;if(!searching&&Math.abs(next-previousScroll)>3){root.dataset.iosMinimized=String(next>70&&next>previousScroll);}previousScroll=next;schedule();};
  const onPointer=(event:PointerEvent)=>{
    if(tabDrag?.pointerId===event.pointerId){
      tabDrag.x=event.clientX;
      const bounds=tabs.getBoundingClientRect(),selected=tabs.querySelector<HTMLElement>('[aria-pressed="true"]');
      const scale=tabs.offsetWidth?bounds.width/tabs.offsetWidth:1;
      if(selected&&scale>0){const left=Math.max(6,Math.min(tabs.clientWidth-selected.offsetWidth-6,(event.clientX-bounds.left)/scale-selected.offsetWidth/2));tabs.style.setProperty('--ios-tab-left',`${left}px`);}
    }
    if(event.pointerType==='touch')return;const optic=event.target instanceof Element?event.target.closest<HTMLElement>('[data-ios-optic]'):null;if(!optic||!root.contains(optic))return;
    const b=optic.getBoundingClientRect();const x=Math.max(0,Math.min(100,(event.clientX-b.left)/b.width*100)),y=Math.max(-30,Math.min(100,(event.clientY-b.top)/b.height*100));
    cancelAnimationFrame(pointerFrame);pointerFrame=requestAnimationFrame(()=>{optic.style.setProperty('--ios-light-x',`${x}%`);optic.style.setProperty('--ios-light-y',`${y}%`);});
  };
  const onTabDown=(event:PointerEvent)=>{
    if(event.button!==0)return;
    const button=event.target instanceof Element?event.target.closest<HTMLElement>('[data-ios-tab]'):null;
    if(!button||!tabs.contains(button))return;
    tabDrag={pointerId:event.pointerId,x:event.clientX};root.dataset.iosDragging='true';
    tabs.setPointerCapture(event.pointerId);
  };
  const onTabEnd=(event:PointerEvent)=>{
    if(tabDrag?.pointerId!==event.pointerId)return;
    const x=event.clientX;tabDrag=null;root.dataset.iosDragging='false';
    if(tabs.hasPointerCapture(event.pointerId))tabs.releasePointerCapture(event.pointerId);
    if(event.type==='pointerup'){
      const buttons=[...tabs.querySelectorAll<HTMLElement>('[data-ios-tab]')];
      const button=buttons.reduce<HTMLElement|undefined>((best,candidate)=>{const b=candidate.getBoundingClientRect(),a=best?.getBoundingClientRect();return !a||Math.abs(x-b.left-b.width/2)<Math.abs(x-a.left-a.width/2)?candidate:best;},undefined);
      if(button){chooseTab(button.dataset.iosTab!);button.focus({preventScroll:true});}
    }
    schedule();
  };
  const onClick=(event:Event)=>{
    const target=event.target instanceof Element?event.target.closest<HTMLElement>('button'):null;if(!target||!root.contains(target))return;
    if(target.dataset.iosTab)chooseTab(target.dataset.iosTab);
    if(target.hasAttribute('data-ios-album'))setTrack(target);
    if(target.hasAttribute('data-ios-play'))setPlaying(!playing);
    if(target.hasAttribute('data-ios-next')||target.hasAttribute('data-ios-prev')){const step=target.hasAttribute('data-ios-next')?1:-1;const source=originals[(currentTrack+step+originals.length)%originals.length];if(source)setTrack(source);}
    if(target.hasAttribute('data-ios-expand'))openPlayer();
    if(target.hasAttribute('data-ios-collapse'))closePlayer();
    if(target.hasAttribute('data-ios-search-open'))openSearch();
    if(target.hasAttribute('data-ios-search-close'))closeSearch();
    if(target.hasAttribute('data-ios-like')||target.hasAttribute('data-ios-shuffle')||target.hasAttribute('data-ios-repeat'))target.setAttribute('aria-pressed',String(target.getAttribute('aria-pressed')!=='true'));
    if(target.hasAttribute('data-ios-info'))say('Player interaction study. No audio is streamed.','播放器交互示例，不会加载或播放真实音频');
    schedule();
  };
  const onInput=(event:Event)=>{
    const input=event.target;if(!(input instanceof HTMLInputElement))return;
    if(input.hasAttribute('data-ios-query')){
      const query=input.value.trim().toLocaleLowerCase();let visible=0;
      root.querySelectorAll<HTMLElement>('.ios-home-pane [data-ios-album]').forEach(album=>{album.hidden=!`${album.dataset.iosTitle} ${album.dataset.iosArtist}`.toLocaleLowerCase().includes(query);if(!album.hidden)visible++;});
      root.querySelector<HTMLElement>('[data-ios-search-empty]')!.hidden=visible>0;
    }
    if(input.type==='range')input.style.setProperty('--ios-progress',`${Number(input.value)/Number(input.max)*100}%`);
    if(input.hasAttribute('data-ios-progress')){
      const value=Number(input.value),remaining=root.querySelector('[data-ios-remaining]'),output=root.querySelector('[data-ios-time]');if(output)output.textContent=`${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;if(remaining){const left=249-value;remaining.textContent=`−${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;}
    }
  };
  const onKey=(event:KeyboardEvent)=>{
    if(event.key==='Escape'&&!overlay.hidden){event.preventDefault();event.stopPropagation();closePlayer();return;}
    if(event.key==='Escape'&&searching){event.preventDefault();event.stopPropagation();closeSearch();return;}
    if(event.key==='Tab'&&!overlay.hidden){const focusable=[...overlay.querySelectorAll<HTMLElement>('button,input')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)&&event.target instanceof HTMLElement&&event.target.hasAttribute('data-ios-tab')){
      const buttons=[...tabs.querySelectorAll<HTMLElement>('[data-ios-tab]')],index=buttons.indexOf(event.target);const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
      event.preventDefault();const button=buttons[next];if(button){chooseTab(button.dataset.iosTab!);button.focus();}
    }
  };
  const onSubmit=(event:Event)=>{if(event.target instanceof Element&&event.target.matches('[data-ios-search-form]'))event.preventDefault();};
  root.addEventListener('click',onClick);root.addEventListener('input',onInput);root.addEventListener('keydown',onKey);root.addEventListener('submit',onSubmit);root.addEventListener('pointermove',onPointer);root.addEventListener('pointerdown',onTabDown);root.addEventListener('pointerup',onTabEnd);root.addEventListener('pointercancel',onTabEnd);scroll.addEventListener('scroll',onScroll,{passive:true});reduced.addEventListener('change',schedule);schedule();
  return()=>{disposed=true;cancelAnimationFrame(openFrame);root.removeEventListener('click',onClick);root.removeEventListener('input',onInput);root.removeEventListener('keydown',onKey);root.removeEventListener('submit',onSubmit);root.removeEventListener('pointermove',onPointer);root.removeEventListener('pointerdown',onTabDown);root.removeEventListener('pointerup',onTabEnd);root.removeEventListener('pointercancel',onTabEnd);if(tabDrag&&tabs.hasPointerCapture(tabDrag.pointerId))tabs.releasePointerCapture(tabDrag.pointerId);scroll.removeEventListener('scroll',onScroll);reduced.removeEventListener('change',schedule);observer.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(pointerFrame);clearTimeout(closeTimer);clearTimeout(noticeTimer);filters.forEach(entry=>entry.filter.remove());scroll.inert=false;controls.inert=false;};
}
