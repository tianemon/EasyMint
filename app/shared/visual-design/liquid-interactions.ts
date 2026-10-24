import type { roundedLensMap } from './liquid-lens';
import type { renderLiquidIcon } from './liquid-icons';

/** Self-contained for source export. The pure lens generator is an explicit dependency. */
export function mountLiquidShowcase(root:HTMLElement,english:boolean,makeLens:typeof roundedLensMap,makeIcon:typeof renderLiquidIcon):()=>void {
  const scroll=root.querySelector<HTMLElement>('[data-ios-scroll]')!;
  const controls=root.querySelector<HTMLElement>('[data-ios-controls]')!;
  const overlay=root.querySelector<HTMLElement>('[data-ios-player-overlay]')!;
  const tabs=root.querySelector<HTMLElement>('[data-ios-tabs]')!;
  const defs=root.querySelector<SVGDefsElement>('[data-ios-filters]')!;
  const svgNS='http://www.w3.org/2000/svg';
  const prefix=`ios-${Math.random().toString(36).slice(2,9)}`;
  const optics=[...root.querySelectorAll<HTMLElement>('[data-ios-optic]')];
  const filters=new Map<HTMLElement,{id:string;size:string;image:SVGFEImageElement;filter:SVGFilterElement;displacement:SVGFEDisplacementMapElement}>();
  const reduced=matchMedia('(prefers-reduced-transparency:reduce)');
  let disposed=false,openFrame=0,frame=0,pointerFrame=0,closeTimer:ReturnType<typeof setTimeout>|undefined,noticeTimer:ReturnType<typeof setTimeout>|undefined;
  let previousScroll=0,activeTab=root.querySelector<HTMLElement>('[data-ios-tab][aria-pressed="true"]')?.dataset.iosTab??'home',searching=root.dataset.iosSearching==='true',playing=root.dataset.iosPlaying==='true',currentTrack=Number(root.dataset.iosIndex)||0;
  let focusOrigin:HTMLElement|null=null;
  let tabDrag:{pointerId:number;x:number}|null=null;
  const originals=[...root.querySelectorAll<HTMLElement>('.ios-home-pane .ios-album')];
  const playSvg=makeIcon('play');
  const pauseSvg=makeIcon('pause');
  const say=(a:string,b:string)=>{const notice=root.querySelector<HTMLElement>('.ios-notice');if(!notice)return;clearTimeout(noticeTimer);notice.textContent=english?a:b;notice.hidden=false;noticeTimer=setTimeout(()=>{notice.hidden=true;},2300);};
  const liked=new Set<number>((root.dataset.iosLiked??'').split(',').filter(Boolean).map(Number));let likedOnly=root.dataset.iosLibraryFilter==='liked';
  const queue=document.createElement('section');queue.className='ios-queue-view';queue.hidden=true;queue.dataset.overlayEscape='true';
  root.querySelector('.ios-player-sheet')?.append(queue);
  const filterLibrary=()=>{root.querySelectorAll<HTMLElement>('.ios-library-list>[data-ios-album]').forEach(row=>{row.hidden=likedOnly&&!liked.has(Number(row.dataset.iosAlbum));});let empty=root.querySelector<HTMLElement>('.ios-liked-empty');if(!empty){empty=document.createElement('p');empty.className='ios-liked-empty';empty.textContent=english?'Like a track in the player to keep it here.':'在播放器里喜欢一首歌，它就会来到这里。';root.querySelector('[data-ios-pane="library"]')?.append(empty);}empty.hidden=!likedOnly||liked.size>0;};
  const libraryFilters=document.createElement('div');libraryFilters.className='ios-library-filters';libraryFilters.innerHTML=`<button type="button" data-ios-library-filter="all" aria-pressed="true">${english?'All music':'全部音乐'}</button><button type="button" data-ios-library-filter="liked" aria-pressed="false">${english?'Favourites':'喜欢的音乐'}</button>`;root.querySelector('[data-ios-pane="library"]>.ios-section-title')?.after(libraryFilters);
  const showQueue=(shown:boolean)=>{const sheet=queue.parentElement;if(!sheet)return;for(const node of sheet.children)if(node instanceof HTMLElement&&!node.matches('.ios-player-top,.ios-queue-view'))node.hidden=shown;queue.hidden=!shown;if(shown){const rows=root.querySelectorAll<HTMLElement>('.ios-library-list>[data-ios-album]');queue.innerHTML=`<header><h2>${english?'Up next':'接下来播放'}</h2><button type="button" data-ios-queue-close>${english?'Back to player':'返回播放器'}</button></header><div class="ios-library-list">${[...rows].map((row,i)=>`<button type="button" data-ios-queue-track="${i}" aria-pressed="${i===currentTrack}">${row.innerHTML}</button>`).join('')}</div>`;}schedule();};
  const setPlaying=(next:boolean)=>{playing=next;root.dataset.iosPlaying=String(next);root.querySelectorAll<HTMLElement>('[data-ios-play]').forEach(button=>{button.setAttribute('aria-pressed',String(next));const svg=button.querySelector('svg');if(svg)svg.outerHTML=next?pauseSvg:playSvg;});};
  const setTrack=(source:HTMLElement)=>{
    const title=source.dataset.iosTitle??'',artist=source.dataset.iosArtist??'',kind=source.dataset.iosArt??'blue';
    currentTrack=Math.max(0,Number(source.dataset.iosAlbum)||0);root.dataset.iosIndex=String(currentTrack);
    root.querySelectorAll('[data-ios-now-title]').forEach(node=>{node.textContent=title;});
    root.querySelectorAll('[data-ios-now-artist]').forEach(node=>{node.textContent=artist;});
    const cover=source.querySelector('.ios-cover');
    for(const target of root.querySelectorAll('.ios-mini-open>.ios-cover,.ios-player-art>.ios-cover'))if(cover)target.outerHTML=cover.outerHTML;
    root.dataset.iosTrack=kind;root.querySelector('[data-ios-like]')?.setAttribute('aria-pressed',String(liked.has(currentTrack)));const progress=root.querySelector<HTMLInputElement>('[data-ios-progress]');if(progress){progress.value='0';progress.style.setProperty('--ios-progress','0%');}root.querySelector('[data-ios-time]')!.textContent='0:00';root.querySelector('[data-ios-remaining]')!.textContent='−4:09';setPlaying(true);
  };
  const chooseTab=(name:string)=>{
    activeTab=name;
    root.querySelectorAll<HTMLElement>('[data-ios-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.iosTab===name)));
    root.querySelectorAll<HTMLElement>('[data-ios-pane]').forEach(pane=>{pane.hidden=pane.dataset.iosPane!==name;});
    const title=root.querySelector('[data-ios-heading]');
    const selected=tabs.querySelector<HTMLElement>(`[data-ios-tab="${name}"]`);
    if(title)title.textContent=selected?.textContent?.trim()??'';if(name==='library')filterLibrary();
    scroll.scrollTop=0;root.dataset.iosMinimized='false';schedule();
  };
  const closeSearch=()=>{
    searching=false;root.dataset.iosSearching='false';
    const form=root.querySelector<HTMLElement>('[data-ios-search-form]')!;form.hidden=true;
    const launch=root.querySelector<HTMLElement>('[data-ios-search-open]')!;launch.setAttribute('aria-expanded','false');
    tabs.inert=false;launch.inert=false;
    root.querySelectorAll<HTMLElement>('[data-ios-album]').forEach(album=>{album.hidden=false;});
    root.querySelector<HTMLElement>('[data-ios-search-empty]')!.hidden=true;filterLibrary();
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
      if(reduced.matches||optic.hasAttribute('data-ios-search-form'))continue;
      const width=Math.round(optic.offsetWidth),height=Math.round(optic.offsetHeight),radius=Math.min(parseFloat(getComputedStyle(optic).borderTopLeftRadius)||28,width/2,height/2);
      const size=`${width}:${height}:${Math.round(radius)}`;
      let entry=filters.get(optic);
      if(entry?.size===size)continue;
      if(!entry){
        const filter=document.createElementNS(svgNS,'filter');const id=`${prefix}-${filters.size}`;
        filter.id=id;filter.setAttribute('filterUnits','userSpaceOnUse');filter.setAttribute('color-interpolation-filters','sRGB');filter.setAttribute('x','0');filter.setAttribute('y','0');
        const image=document.createElementNS(svgNS,'feImage');image.setAttribute('preserveAspectRatio','none');image.setAttribute('result','lens');
        const displacement=document.createElementNS(svgNS,'feDisplacementMap');displacement.setAttribute('in','SourceGraphic');displacement.setAttribute('in2','lens');displacement.setAttribute('scale','32');displacement.setAttribute('xChannelSelector','R');displacement.setAttribute('yChannelSelector','G');
        const diffusion=document.createElementNS(svgNS,'feGaussianBlur');diffusion.setAttribute('stdDeviation',root.dataset.effect==='subtle'?'0.25':'3');
        filter.append(image,displacement,diffusion);defs.append(filter);entry={id,size:'',image,filter,displacement};filters.set(optic,entry);
      }
      const map=makeLens(width,height,radius);
      const canvas=document.createElement('canvas');canvas.width=map.width;canvas.height=map.height;
      const context=canvas.getContext('2d');if(!context)continue;
      const pixels=context.createImageData(map.width,map.height);pixels.data.set(map.data);context.putImageData(pixels,0,0);
      entry.filter.setAttribute('width',String(width));entry.filter.setAttribute('height',String(height));entry.image.setAttribute('width',String(width));entry.image.setAttribute('height',String(height));entry.image.setAttribute('href',canvas.toDataURL());entry.displacement.setAttribute('scale',String(map.scale));entry.size=size;
      const light=optic.querySelector<HTMLElement>('.ios-optic-light');
      if(light){pixels.data.set(map.reflection);context.putImageData(pixels,0,0);light.style.backgroundImage=`url(${canvas.toDataURL()})`;}
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
    if(target.hasAttribute('data-ios-next')||target.hasAttribute('data-ios-prev')){const step=target.hasAttribute('data-ios-next')?(root.querySelector('[data-ios-shuffle]')?.getAttribute('aria-pressed')==='true'?1+Math.floor(Math.random()*Math.max(1,originals.length-1)):1):-1;const source=originals[(currentTrack+step+originals.length)%originals.length];if(source)setTrack(source);}
    if(target.hasAttribute('data-ios-expand'))openPlayer();
    if(target.hasAttribute('data-ios-collapse'))closePlayer();
    if(target.hasAttribute('data-ios-search-open'))openSearch();
    if(target.hasAttribute('data-ios-search-close'))closeSearch();
    if(target.hasAttribute('data-ios-like')||target.hasAttribute('data-ios-shuffle')||target.hasAttribute('data-ios-repeat')){const selected=target.getAttribute('aria-pressed')!=='true';target.setAttribute('aria-pressed',String(selected));if(target.hasAttribute('data-ios-like')){if(selected)liked.add(currentTrack);else liked.delete(currentTrack);root.dataset.iosLiked=[...liked].join(',');filterLibrary();}else say(selected?(target.hasAttribute('data-ios-shuffle')?'Shuffle enabled.':'Repeat track enabled.'):'Playback mode disabled.',selected?(target.hasAttribute('data-ios-shuffle')?'已开启随机播放，下一首将使用随机顺序':'已开启单曲循环'):'已关闭此播放模式');}
    if(target.hasAttribute('data-ios-info'))showQueue(!!queue.hidden);
    if(target.hasAttribute('data-ios-queue-close'))showQueue(false);
    if(target.hasAttribute('data-ios-queue-track')){const source=originals[Number(target.dataset.iosQueueTrack)];if(source)setTrack(source);showQueue(false);}
    if(target.hasAttribute('data-ios-see-all'))chooseTab('browse');
    if(target.hasAttribute('data-ios-see-recent'))chooseTab('library');
    if(target.hasAttribute('data-ios-library-filter')){likedOnly=target.dataset.iosLibraryFilter==='liked';root.dataset.iosLibraryFilter=target.dataset.iosLibraryFilter!;libraryFilters.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button===target)));filterLibrary();}
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
    if(event.key==='Escape'&&!queue.hidden){event.preventDefault();event.stopPropagation();showQueue(false);return;}
    if(event.key==='Escape'&&!overlay.hidden){event.preventDefault();event.stopPropagation();closePlayer();return;}
    if(event.key==='Escape'&&searching){event.preventDefault();event.stopPropagation();closeSearch();return;}
    if(event.key==='Tab'&&!overlay.hidden){const focusable=[...overlay.querySelectorAll<HTMLElement>('button,input')].filter(node=>!node.closest('[hidden]')&&node.getBoundingClientRect().width>0&&!(node instanceof HTMLButtonElement&&node.disabled));const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)&&event.target instanceof HTMLElement&&event.target.hasAttribute('data-ios-tab')){
      const buttons=[...tabs.querySelectorAll<HTMLElement>('[data-ios-tab]')],index=buttons.indexOf(event.target);const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
      event.preventDefault();const button=buttons[next];if(button){chooseTab(button.dataset.iosTab!);button.focus();}
    }
  };
  const onSubmit=(event:Event)=>{if(event.target instanceof Element&&event.target.matches('[data-ios-search-form]'))event.preventDefault();};
  libraryFilters.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String((button as HTMLElement).dataset.iosLibraryFilter===(likedOnly?'liked':'all'))));filterLibrary();tabs.inert=searching;root.querySelector<HTMLElement>('[data-ios-search-open]')!.inert=searching;scroll.inert=!overlay.hidden;controls.inert=!overlay.hidden;
  const playbackTimer=setInterval(()=>{if(!playing)return;const input=root.querySelector<HTMLInputElement>('[data-ios-progress]');if(!input)return;let next=Number(input.value)+1;if(next>=249){if(root.querySelector('[data-ios-repeat]')?.getAttribute('aria-pressed')==='true')next=0;else{const step=root.querySelector('[data-ios-shuffle]')?.getAttribute('aria-pressed')==='true'?1+Math.floor(Math.random()*Math.max(1,originals.length-1)):1;const source=originals[(currentTrack+step)%originals.length];if(source)setTrack(source);next=0;}}input.value=String(next);input.dispatchEvent(new Event('input',{bubbles:true}));},1000);
  root.addEventListener('click',onClick);root.addEventListener('input',onInput);root.addEventListener('keydown',onKey);root.addEventListener('submit',onSubmit);root.addEventListener('pointermove',onPointer);root.addEventListener('pointerdown',onTabDown);root.addEventListener('pointerup',onTabEnd);root.addEventListener('pointercancel',onTabEnd);scroll.addEventListener('scroll',onScroll,{passive:true});reduced.addEventListener('change',schedule);schedule();
  return()=>{disposed=true;clearInterval(playbackTimer);showQueue(false);queue.remove();libraryFilters.remove();root.querySelector('.ios-liked-empty')?.remove();cancelAnimationFrame(openFrame);root.removeEventListener('click',onClick);root.removeEventListener('input',onInput);root.removeEventListener('keydown',onKey);root.removeEventListener('submit',onSubmit);root.removeEventListener('pointermove',onPointer);root.removeEventListener('pointerdown',onTabDown);root.removeEventListener('pointerup',onTabEnd);root.removeEventListener('pointercancel',onTabEnd);if(tabDrag&&tabs.hasPointerCapture(tabDrag.pointerId))tabs.releasePointerCapture(tabDrag.pointerId);scroll.removeEventListener('scroll',onScroll);reduced.removeEventListener('change',schedule);observer.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(pointerFrame);clearTimeout(closeTimer);clearTimeout(noticeTimer);filters.forEach((entry,optic)=>{entry.filter.remove();optic.style.removeProperty('--ios-lens-filter');optic.querySelector<HTMLElement>('.ios-optic-light')?.style.removeProperty('background-image');});scroll.inert=false;controls.inert=false;};
}
