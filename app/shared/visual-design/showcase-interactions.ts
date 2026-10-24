/** Self-contained so generated HTML and React previews execute the very same behaviour. */
export function mountShowcase(root: HTMLElement, english = false): () => void {
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
  let cart = 0,workStatus=root.querySelector<HTMLElement>('[data-sc-status][aria-pressed="true"]')?.dataset.scStatus??'0',workQuery=root.querySelector<HTMLInputElement>('[data-sc-search]')?.value.toLocaleLowerCase()??'';
  let breathingTimer:ReturnType<typeof setInterval>|undefined;
  let duration=root.dataset.style==='soft'?([2,5,10][[...root.querySelectorAll('[data-sc-hour]')].findIndex(node=>node.getAttribute('aria-pressed')==='true')]??2):2,breathStarted=0,breathElapsed=Number(root.dataset.breathElapsed)||0,focusRemaining=Number(root.dataset.focusRemaining)||1500,focusStarted=0;
  let focusTimer:ReturnType<typeof setInterval>|undefined;
  const mark=(selector:string,target:HTMLElement)=>root.querySelectorAll(selector).forEach(button=>button.setAttribute('aria-pressed',String(button===target)));
  const filterWork=()=>{
    let count=0;
    root.querySelectorAll<HTMLElement>('[data-sc-work-item]').forEach(row=>{row.hidden=!(workStatus==='0'||row.dataset.status===workStatus)||!row.textContent?.toLocaleLowerCase().includes(workQuery);if(!row.hidden)count++;});
    const output=root.querySelector('[data-sc-result-count]');if(output)output.textContent=`${count} ${english?'projects':'个项目'}`;
  };
  const filterCommunity=()=>{
    const saved=root.querySelector('[data-sc-view="2"][aria-pressed="true"]');
    const topic=root.querySelector<HTMLElement>('[data-sc-topic][aria-pressed="true"]')?.dataset.scTopic??'0';
    let count=0;
    root.querySelectorAll<HTMLElement>('.material-post').forEach(post=>{post.hidden=!!saved&&!post.querySelector('[data-sc-toggle][aria-pressed="true"]')||topic!=='0'&&post.dataset.scTopicItem!==topic;if(!post.hidden)count++;});
    let empty=root.querySelector<HTMLElement>('[data-sc-empty]');
    if(!empty&&root.querySelector('.material-discussions')){empty=document.createElement('p');empty.dataset.scEmpty='true';empty.className='scene-muted';root.querySelector('.material-discussions')!.append(empty);}
    if(empty){empty.textContent=english?'No discussions in this view yet. Save a discussion or choose another topic.':'这里还没有讨论，收藏一条讨论或切换主题试试。';empty.hidden=count>0;}
  };
  const say = (en: string, zh: string) => {
    const notice = root.querySelector<HTMLElement>('.sc-notice');
    if (!notice) return;
    clearTimeout(noticeTimer);
    notice.textContent = english ? en : zh;
    notice.hidden = false;
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 2800);
  };
  const workspace = (name: string) => {
    root.querySelector('[data-gx-more]')?.setAttribute('aria-expanded',String(name==='about'));
    root.querySelectorAll('[data-gx-workspace]').forEach(button => button.setAttribute('aria-pressed', String(button.getAttribute('data-gx-workspace') === name)));
    root.querySelectorAll<HTMLElement>('[data-gx-panel]').forEach(panel => { panel.hidden = panel.dataset.gxPanel !== name; });
    reveal(root.querySelector(`[data-gx-panel="${name}"]`));
  };
  const reducedMotion=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
  const transitions=new Set<Animation>();
  const reveal=(panel:HTMLElement|null)=>{
    if(!panel||reducedMotion())return;
    const style=root.dataset.style;
    const frames:Keyframe[]=style==='skeuomorphism'?[{opacity:.3,transform:'perspective(900px) rotateY(-12deg)',transformOrigin:'0 50%'},{opacity:1,transform:'perspective(900px) rotateY(0deg)',transformOrigin:'0 50%'}]:style==='claymorphism'?[{opacity:.6,transform:'translateY(10px) scale(.95)'},{opacity:1,transform:'translateY(-2px) scale(1.015)',offset:.7},{opacity:1,transform:'none'}]:style==='retro'?[{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0 0 0)'}]:style==='tech'?[{opacity:.2,clipPath:'inset(0 0 100% 0)'},{opacity:1,clipPath:'inset(0 0 0 0)'}]:[{opacity:.25,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}];
    const animation=panel.animate?.(frames,{duration:style==='skeuomorphism'?450:style==='claymorphism'?420:260,easing:'cubic-bezier(.22,.8,.2,1)'});
    if(animation){transitions.add(animation);void animation.finished.then(()=>transitions.delete(animation),()=>transitions.delete(animation));}
  };
  const sceneVisibility=new IntersectionObserver(entries=>{root.dataset.motionVisible=String(entries[0]?.isIntersecting??true);});sceneVisibility.observe(root);
  const pageVisibility=()=>{root.dataset.pageHidden=String(document.hidden);};document.addEventListener('visibilitychange',pageVisibility);pageVisibility();
  const hiddenByRoute=new Set<HTMLElement>(),shownByRoute=new Set<HTMLElement>(),focusedRoute=new Set<HTMLElement>();
  const sceneNav=[...root.querySelectorAll<HTMLElement>('.scene-header nav a')];
  const resetRoute=()=>{
    hiddenByRoute.forEach(node=>{node.hidden=false;});hiddenByRoute.clear();shownByRoute.forEach(node=>{node.hidden=true;});shownByRoute.clear();
    focusedRoute.forEach(node=>node.classList.remove('scene-route-focus'));focusedRoute.clear();
    root.querySelector('[data-sc-route-heading]')?.remove();delete root.dataset.sceneRoute;
  };
  sceneNav[0]?.setAttribute('aria-current','page');
  const navigate=(target:HTMLElement)=>{
    resetRoute();
    sceneNav.forEach(link=>{if(link===target)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
    const isHome=target===sceneNav[0]||target.classList.contains('scene-brand');
    if(isHome){sceneNav[0]?.setAttribute('aria-current','page');root.scrollIntoView({block:'start',behavior:'auto'});reveal(root.querySelector('#scene-main'));return;}
    const href=target.getAttribute('href'),destination=href?root.querySelector<HTMLElement>(href):null;
    if(!destination)return;
    root.dataset.sceneRoute='detail';
    let branch:HTMLElement=destination;
    while(branch.parentElement&&branch!==root){
      if(branch.hidden){shownByRoute.add(branch);branch.hidden=false;}
      const parent=branch.parentElement;
      for(const node of parent.children){
        if(!(node instanceof HTMLElement)||node===branch||node.matches('.scene-header,.scene-footer,.sc-notice'))continue;
        if(!node.hidden){node.hidden=true;hiddenByRoute.add(node);}
      }
      if(parent!==root){parent.classList.add('scene-route-focus');focusedRoute.add(parent);}
      branch=parent;
    }
    const heading=document.createElement('div');heading.dataset.scRouteHeading='true';heading.className='scene-route-heading';
    const title=document.createElement('h2');title.textContent=target.textContent?.trim()??'';heading.append(title);root.querySelector('.scene-header')?.after(heading);
    root.scrollIntoView({block:'start',behavior:'auto'});reveal(destination);
  };
  const paperTitle=root.dataset.paperOriginalTitle??root.querySelector('.paper-page h1')?.innerHTML??'';if(root.dataset.style==='skeuomorphism')root.dataset.paperOriginalTitle=paperTitle;
  const dayHabits=new Map<number,boolean[]>();let habitDay=0;
  const click = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button,a') : null;
    if (!target || !root.contains(target)) return;
    if(target.hasAttribute('data-sc-toggle')){
      const selected=target.getAttribute('aria-pressed')!=='true';target.setAttribute('aria-pressed',String(selected));if(root.dataset.style==='material')filterCommunity();
      if(root.dataset.style==='soft'){root.dataset.evening=String(selected);const phase=root.querySelector('[data-sc-breath-phase]');if(phase)phase.textContent=english?(selected?'Let the day settle.':'Find your rhythm'):(selected?'让今天，慢慢沉静下来。':'找到自己的节奏');}
      if(root.dataset.style==='neumorphism'){
        const panel=root.querySelector<HTMLElement>('[data-sc-neu-settings]');if(panel){panel.hidden=!selected;target.setAttribute('aria-expanded',String(selected));reveal(panel);}
      }
    }
    if(target.hasAttribute('data-sc-directory-topic')){
      const view=root.querySelector<HTMLElement>('[data-sc-view="0"]');view?.click();
      root.querySelector<HTMLElement>(`[data-sc-topic="${target.dataset.scDirectoryTopic}"]`)?.click();return;
    }
    if(target.hasAttribute('data-sc-topic')){mark('[data-sc-topic]',target);if(root.dataset.style==='material'){filterCommunity();reveal(root.querySelector('.material-discussions'));}if(root.dataset.style==='soft'){const prompt=root.querySelector('.soft-journal label>span');if(prompt)prompt.textContent=(english?['What helped you feel calm?','What would help you rest?','What are you looking forward to?']:['是什么，让你感到平静？','什么能让你休息一下？','此刻，你在期待什么？'])[Number(target.dataset.scTopic)]??'';reveal(root.querySelector('.soft-journal label'));}}
    if(target.hasAttribute('data-sc-view')){
      mark('[data-sc-view]',target);
      if(root.dataset.style==='material'){
        filterCommunity();const directory=root.querySelector<HTMLElement>('[data-sc-topic-directory]'),posts=root.querySelector<HTMLElement>('.material-discussions');
        if(directory)directory.hidden=target.dataset.scView!=='1';if(posts)posts.hidden=target.dataset.scView==='1';
        root.querySelectorAll<HTMLElement>('.material-feed>.scene-tabs,.material-compose-hint').forEach(node=>{node.hidden=target.dataset.scView==='1';});
        reveal(target.dataset.scView==='1'?directory:posts);
      }
      if(root.dataset.style==='skeuomorphism'){
        const index=target.dataset.scView,heading=root.querySelector<HTMLElement>('.paper-page h1');
        root.querySelectorAll<HTMLElement>('.paper-page>.scene-eyebrow,.paper-page>.scene-checklist').forEach(node=>{node.hidden=index!=='0';});
        const writing=root.querySelector<HTMLElement>('.paper-writing'),ideas=root.querySelector<HTMLElement>('[data-sc-paper-ideas]');
        if(writing)writing.hidden=index==='2';if(ideas)ideas.hidden=index!=='2';const stamp=root.querySelector<HTMLElement>('.paper-save-stamp');if(stamp)stamp.hidden=index==='2';
        if(heading){heading.hidden=index==='2';if(index==='0')heading.innerHTML=paperTitle;else heading.textContent=english?'Notes, worth keeping.':'把此刻，留在纸上。';}
        reveal(root.querySelector('.paper-page'));
      }
      if(root.dataset.style==='neumorphism'){
        const presets=[[50,50,50,50,50,50,50],[68,73,64,55,46,42,38],[40,45,66,78,72,53,45]];
        root.querySelectorAll<HTMLInputElement>('.neu-eq-bars input').forEach((input,index)=>{input.value=String(presets[Number(target.dataset.scView)]?.[index]??50);});
      }
      if(root.dataset.style==='business'){
        const index=target.dataset.scView??'0';
        const heading=root.querySelector('h1');if(heading)heading.textContent=target.textContent?.trim()??'';
        root.querySelectorAll<HTMLElement>('.business-summary,.business-toolbar,.business-table,.business-bottom').forEach(node=>{node.hidden=node.classList.contains('business-summary')?index!=='0':index!=='1';});
        root.querySelectorAll<HTMLElement>('[data-sc-business-panel]').forEach(panel=>{panel.hidden=panel.dataset.scBusinessPanel!==index;});
        reveal(root.querySelector('.business-main'));
      }
    }
    if(target.hasAttribute('data-sc-status')){mark('[data-sc-status]',target);workStatus=target.dataset.scStatus!;filterWork();}
    if(target.hasAttribute('data-sc-programme')){mark('[data-sc-programme]',target);const group=['ALL','TALKS','LIVE'][Number(target.dataset.scProgramme)];root.querySelectorAll<HTMLElement>('[data-sc-programme-item]').forEach(row=>{row.hidden=group!=='ALL'&&row.dataset.scProgrammeItem!==group;});}
    if(target.hasAttribute('data-sc-lesson')){
      if(root.dataset.sceneRoute){resetRoute();sceneNav.forEach((link,i)=>{if(i===0)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});}
      mark('[data-sc-lesson]',target);const index=Number(target.dataset.scLesson),feature=root.querySelector<HTMLElement>('.learning-feature');
      const title=feature?.querySelector('h2');if(title)title.textContent=target.querySelector('strong')?.textContent??'';
      const descriptions=english?['Discover familiar objects from new angles through light, shadow and perspective.','Build a personal palette by exploring warm, cool and complementary colours.','Turn a circle, a line and a little imagination into something new.','Bring shape, colour and composition together in your own poster.']:['用光影和透视，发现日常物件不一样的一面。','探索冷暖与互补色，搭配属于你自己的配色。','一个圆、一条线，加上一点想象，会变成什么？','将形状、色彩与构图组合，完成你的第一张创意海报。'];
      const challenges=english?['Draw the same cup from three different viewpoints.','Choose three colours and use them to express a mood.','Draw an object using three geometric shapes.','Design a poster using your favourite shapes and colours.']:['挑战：从三个不同角度画出同一个杯子。','挑战：选择三种颜色，表达你此刻的心情。','挑战：用三个几何形状画一件物品。','挑战：用喜欢的形状和色彩，设计一张海报。'];
      const description=feature?.querySelector(':scope>p'),eyebrow=feature?.querySelector(':scope>.scene-eyebrow');if(description)description.textContent=descriptions[index]??'';if(eyebrow)eyebrow.textContent=`LESSON 0${index+1} / ${[8,12,15,20][index]} MIN`;
      if(feature)feature.dataset.lesson=String(index);
      const detail=feature?.querySelector<HTMLElement>('.sc-post-detail');if(detail){detail.hidden=true;const p=detail.querySelector('p');if(p)p.textContent=challenges[index]??'';}
      feature?.querySelector('[data-sc-expand]')?.setAttribute('aria-expanded','false');feature?.scrollIntoView({block:'nearest',behavior:reducedMotion()?'auto':'smooth'});reveal(feature??null);
    }
    if(target.hasAttribute('data-sc-mission-tab')){
      mark('[data-sc-mission-tab]',target);const index=target.dataset.scMissionTab??'0';root.dataset.missionView=index;
      root.querySelectorAll<HTMLElement>('[data-sc-mission-panel]').forEach(panel=>{panel.hidden=panel.dataset.scMissionPanel!==index;});
      const log=root.querySelector<HTMLElement>('.mission-log');if(log)log.hidden=index!=='0';
      reveal(root.querySelector(`[data-sc-mission-panel="${index}"]`));
    }
    if(target.hasAttribute('data-sc-previous')||target.hasAttribute('data-sc-next')){
      const tracks=[...root.querySelectorAll<HTMLElement>('[data-sc-track]')];const current=tracks.findIndex(track=>track.getAttribute('aria-pressed')==='true');
      if(tracks.length)tracks[(current+(target.hasAttribute('data-sc-next')?1:-1)+tracks.length)%tracks.length]?.click();
      else say('Track changed in this audio-control study.','已在音频控制示例中切换曲目');
    }
    if(target.hasAttribute('data-sc-breath')){
      clearInterval(breathingTimer);const running=target.getAttribute('aria-pressed')!=='true';target.setAttribute('aria-pressed',String(running));root.dataset.breathing=String(running);
      const label=root.querySelector('[data-sc-breath-label]'),phase=root.querySelector('[data-sc-breath-phase]'),clock=root.querySelector('[data-breath-clock]'),progress=root.querySelector<HTMLElement>('[data-breath-progress]');
      if(running){if(breathElapsed>=duration*60)breathElapsed=0;breathStarted=Date.now()-breathElapsed*1000;if(label)label.textContent=english?'Pause practice':'暂停练习';const tick=()=>{breathElapsed=Math.floor((Date.now()-breathStarted)/1000);root.dataset.breathElapsed=String(breathElapsed);const left=Math.max(0,duration*60-breathElapsed);if(clock)clock.textContent=`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;if(progress)progress.style.width=`${Math.min(100,breathElapsed/(duration*60)*100)}%`;if(!left){clearInterval(breathingTimer);root.dataset.breathing='false';target.setAttribute('aria-pressed','false');if(label)label.textContent=english?'Practice again':'再练习一次';if(phase)phase.textContent=english?'A moment, just for you.':'谢谢你，留给自己这一刻。';return;}if(phase)phase.textContent=english?(Math.floor(breathElapsed/4)%2?'Breathe out':'Breathe in'):(Math.floor(breathElapsed/4)%2?'缓缓呼气':'慢慢吸气');};tick();breathingTimer=setInterval(tick,1000);}
      else {if(label)label.textContent=english?'Continue practice':'继续呼吸';if(phase)phase.textContent=english?'Paused. Continue at your own pace.':'已暂停，按自己的节奏继续。';}
    }
    if (target.hasAttribute('data-gx-workspace')) workspace(target.dataset.gxWorkspace!);
    if (target.hasAttribute('data-gx-date')) {
      root.querySelectorAll('[data-gx-date]').forEach(button => button.setAttribute('aria-pressed', String(button === target)));
      workspace('calendar');const day=target.textContent?.trim()??'24',title=root.querySelector('[data-gx-panel="calendar"]>.gx-eyebrow');if(title)title.textContent=english?`OCTOBER ${day} / SCHEDULE`:`10月${day}日 / 日程安排`;
    }
    if (target.hasAttribute('data-gx-file')) say('File selected in this preview.', '已在预览中选中文件');
    if (target.hasAttribute('data-gx-more')) {workspace('about');target.setAttribute('aria-expanded','true');}
    if (target.hasAttribute('data-gx-add-task')) {
      workspace('overview');
      const existing = root.querySelector<HTMLInputElement>('[data-gx-task-input]');
      if (existing) { existing.focus(); return; }
      const form = document.createElement('form'); form.className = 'gx-task-entry'; form.dataset.gxTaskForm = 'true';
      const input = document.createElement('input'); input.dataset.gxTaskInput = 'true'; input.required = true;
      input.placeholder = english ? 'One thing to do…' : '想要完成的一件事……'; input.setAttribute('aria-label', english ? 'New task' : '新任务');
      const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = english ? 'Add' : '添加';
      form.append(input, submit); root.querySelector('[data-gx-task-list]')?.after(form); input.focus();
    }
    if(sceneNav.includes(target)||target.classList.contains('scene-brand')){event.preventDefault();navigate(target);return;}
    if (target.matches('a[href^="#"]')) {
      const destination = root.querySelector<HTMLElement>(target.getAttribute('href')!);
      if (destination) { event.preventDefault(); destination.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
    }
    if (target.hasAttribute('data-sc-add')) {
      cart++;
      const count = root.querySelector('[data-sc-cart-count]');
      if (count) count.textContent = String(cart);
      say('Added to your bag.', '已加入购物袋');
    }
    if (target.hasAttribute('data-sc-bag')) say(`Your bag contains ${cart} items.`, `购物袋中有 ${cart} 件物品`);
    if (target.hasAttribute('data-sc-filter')) {
      root.querySelectorAll('[data-sc-filter]').forEach(button => button.setAttribute('aria-pressed', String(button === target)));
      root.querySelectorAll<HTMLElement>('[data-sc-product]').forEach(product => { product.hidden = target.dataset.scFilter !== '0' && product.dataset.scProduct !== (target.dataset.scFilter === '1' ? 'Home' : 'Carry'); });
    }
    if (target.hasAttribute('data-sc-play')) {
      const playing = root.dataset.playing !== 'true';
      root.dataset.playing = String(playing);
      root.querySelectorAll('[data-sc-play]').forEach(button => button.setAttribute('aria-pressed', String(playing)));
      if(root.dataset.style==='bento'){
        clearInterval(focusTimer);
        const label=root.querySelector('.dayboard-focus [data-sc-play]>span:last-child'),output=root.querySelector('.dayboard-focus>small');
        if(label)label.textContent=english?(playing?'Pause focus':'Begin focus'):(playing?'暂停专注':'开始专注');
        if(!playing&&focusStarted){focusRemaining=Math.max(0,focusRemaining-Math.floor((Date.now()-focusStarted)/1000));focusStarted=0;}
        if(playing){if(!focusRemaining)focusRemaining=1500;focusStarted=Date.now();const budget=focusRemaining;const tick=()=>{const left=Math.max(0,budget-Math.floor((Date.now()-focusStarted)/1000));if(output)output.textContent=`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')} / 25:00`;if(!left){clearInterval(focusTimer);focusRemaining=0;focusStarted=0;root.dataset.playing='false';target.setAttribute('aria-pressed','false');if(label)label.textContent=english?'Begin focus':'开始专注';}};tick();focusTimer=setInterval(tick,1000);}
        say(playing?'Focus session started.':'Focus session paused.',playing?'专注计时已开始':'专注计时已暂停');
      }else say(playing ? 'Player controls started. This sample has no audio.' : 'Playback paused.', playing ? '播放状态已开启，此示例无音频' : '已暂停播放');
    }
    if (target.hasAttribute('data-sc-track')) {
      root.querySelectorAll('[data-sc-track]').forEach(button => button.setAttribute('aria-pressed', String(button === target)));
      const name = root.querySelector('[data-sc-now]');
      if (name) name.textContent = target.querySelector('strong')?.childNodes[0]?.textContent ?? '';
    }
    if (target.hasAttribute('data-sc-expand')) {
      const detail = target.closest('article,.edition-feature')?.querySelector<HTMLElement>('.sc-post-detail');
      if (detail) { detail.hidden = !detail.hidden; target.setAttribute('aria-expanded', String(!detail.hidden)); }
    }
    if (target.hasAttribute('data-sc-like')) {
      const liked = target.getAttribute('aria-pressed') !== 'true';
      target.setAttribute('aria-pressed', String(liked));
      const count = target.querySelector('span');
      if (count) count.textContent = String(Number(count.textContent) + (liked ? 1 : -1));
    }
    if (target.hasAttribute('data-sc-ritual') || target.hasAttribute('data-sc-hour')) {
      const selector = target.hasAttribute('data-sc-ritual') ? '[data-sc-ritual]' : '[data-sc-hour]';
      root.querySelectorAll(selector).forEach(button => button.setAttribute('aria-pressed', String(button === target)));
      if(selector==='[data-sc-hour]'&&root.dataset.style==='soft'){duration=[2,5,10][[...root.querySelectorAll('[data-sc-hour]')].indexOf(target)]??2;clearInterval(breathingTimer);breathElapsed=0;root.dataset.breathElapsed='0';root.dataset.breathing='false';root.querySelector('[data-sc-breath]')?.setAttribute('aria-pressed','false');const label=root.querySelector('[data-sc-breath-label]'),clock=root.querySelector('[data-breath-clock]'),bar=root.querySelector<HTMLElement>('[data-breath-progress]'),phase=root.querySelector('[data-sc-breath-phase]');if(label)label.textContent=english?'Begin breathing':'开始呼吸';if(clock)clock.textContent=`${duration}:00`;if(bar)bar.style.width='0%';if(phase)phase.textContent=english?'Find your rhythm':'找到自己的节奏';}
      if(selector==='[data-sc-hour]'&&root.dataset.style==='bento'){
        const index=[...root.querySelectorAll('[data-sc-hour]')].indexOf(target),agenda=root.querySelector('.dayboard-calendar>p');
        if(agenda)agenda.textContent=(english?['10:30 — Design catch-up','14:00 — Prototype review','09:00 — Focus time','16:00 — Team sharing','11:00 — Weekly review','No plans. A day for yourself.','A quiet Sunday.']:['10:30 — 设计碰头会','14:00 — 原型评审','09:00 — 安静创作','16:00 — 团队分享','11:00 — 本周回顾','没有安排，留给自己的一天','安静的星期日'])[index]??'';
        reveal(root.querySelector('.dayboard-calendar>p'));
      }
      if(selector==='[data-sc-hour]'&&root.dataset.style==='claymorphism'){
        const checks=[...root.querySelectorAll<HTMLInputElement>('[data-sc-habit]')];dayHabits.set(habitDay,checks.map(check=>check.checked));habitDay=[...root.querySelectorAll('[data-sc-hour]')].indexOf(target);
        const states=dayHabits.get(habitDay)??[false,false,false];checks.forEach((check,i)=>{check.checked=states[i]??false;});
        const count=states.filter(Boolean).length,output=root.querySelector('[data-sc-habit-count]'),fill=root.querySelector<HTMLElement>('[data-sc-habit-fill]');if(output)output.textContent=String(count);if(fill)fill.style.width=`${count/3*100}%`;
        const note=root.querySelector('.clay-habits>p');if(note)note.textContent=english?`October ${26+habitDay>31?1:26+habitDay} · ${count} of 3 habits complete`:`${26+habitDay>31?'11月1':`10月${26+habitDay}`}日 · 已完成 ${count} / 3 个习惯`;reveal(root.querySelector('.clay-habits'));
      }
      if (selector === '[data-sc-ritual]') say('Your session is ready. Take your time.', '已经为你准备好了，按自己的节奏开始');
    }
    if (target.hasAttribute('data-sc-ticket')) say('Your spot is saved in this preview.', '此预览中已为你预留席位');
    if (target.hasAttribute('data-sc-diagnostic')) {
      clearTimeout(diagnosticTimer);
      root.dataset.diagnosing = 'true';
      target.setAttribute('aria-busy', 'true');
      diagnosticTimer = setTimeout(() => { root.dataset.diagnosing = 'false'; target.removeAttribute('aria-busy');const phase=root.querySelector('[data-cyber-scan-phase]');if(phase&&root.querySelector<HTMLElement>('[data-cyber-canvas]')?.dataset.motionState==='paused')phase.textContent=english?'Scan complete':'扫描完成'; say('Diagnostic complete. All systems nominal.', '诊断完成，各系统运行正常'); }, root.dataset.style==='tech'?4500:1100);
    }
    if (target.hasAttribute('data-sc-compose')) {
      const current = root.querySelector<HTMLInputElement>('[data-sc-draft]');
      if (current) { current.focus(); return; }
      const form = document.createElement('form');
      form.className = 'sc-subscribe';
      form.dataset.scComposer = 'true';
      const input = document.createElement('input');
      input.dataset.scDraft = 'true'; input.required = true;
      input.placeholder = english ? 'Write a title…' : '写一个标题……';
      input.setAttribute('aria-label', english ? 'Title' : '标题');
      const submit = document.createElement('button');
      submit.type = 'submit'; submit.className = 'sc-button'; submit.textContent = english ? 'Add' : '添加';
      form.append(input, submit); target.closest('section,header')?.after(form); input.focus();
    }
    if (target.hasAttribute('data-sc-pause')) {
      const paused = root.dataset.paused !== 'true';
      root.dataset.paused = String(paused); target.setAttribute('aria-pressed', String(paused));
      target.textContent = english ? paused ? 'Play motion' : 'Pause motion' : paused ? '播放动效' : '暂停动效';
    }
  };
  const submit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !root.contains(form)) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (form.hasAttribute('data-gx-task-form')) {
      const input = form.querySelector<HTMLInputElement>('[data-gx-task-input]');
      if (input?.value.trim()) {
        const label = document.createElement('label'); label.className = 'gx-task';
        const check = document.createElement('input'); check.type = 'checkbox';
        const text = document.createElement('span'); text.textContent = input.value.trim(); label.append(check, text);
        root.querySelector('[data-gx-task-list]')?.append(label); input.value = ''; input.focus();
        say('Task added.', '任务已添加');
      }
      return;
    }
    if (form.hasAttribute('data-sc-composer')) {
      const draft = form.querySelector<HTMLInputElement>('[data-sc-draft]');
      if (draft?.value.trim()) {
        const title=draft.value.trim();
        if(root.dataset.style==='material'){
          const item=root.querySelector('.material-post')!.cloneNode(true) as HTMLElement;
          item.querySelector('h2')!.textContent=title;item.querySelector('header strong')!.textContent=english?'You':'你';
          item.querySelector('.scene-avatar')!.textContent='J';item.querySelectorAll('[aria-pressed]').forEach(button=>button.setAttribute('aria-pressed','false'));
          item.querySelector('[data-sc-like] span')!.textContent='0';root.querySelector('.material-discussions')!.prepend(item);
          root.querySelectorAll('[data-sc-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.getAttribute('data-sc-view')==='0')));filterCommunity();
        }else if(root.dataset.style==='business'){
          const item=root.querySelector('[data-sc-work-item]')!.cloneNode(true) as HTMLElement;
          item.querySelector('strong')!.textContent=title;item.querySelector<HTMLInputElement>('input')!.checked=false;item.querySelector('.business-owner')!.textContent=english?'You':'你';item.querySelector('span:last-child')!.textContent=english?'UNSCHEDULED':'待排期';root.querySelector('.business-table')!.append(item);filterWork();
        }else if(root.dataset.style==='bento'){
          const label=document.createElement('label'),check=document.createElement('input'),text=document.createElement('span');check.type='checkbox';text.textContent=title;label.append(check,text);root.querySelector('.dayboard-tasks .scene-checklist')!.append(label);
          const count=root.querySelector('.dayboard-tasks .scene-section-title small');if(count)count.textContent=String(root.querySelectorAll('.dayboard-tasks input').length).padStart(2,'0');
        }else{const item=document.createElement('p');item.className='sc-task';item.textContent=title;form.after(item);}
        draft.value = '';
        say('Added to this preview.', '已添加到当前预览');
      }
    } else { say('You are on the list. This preview sends no email.', '订阅成功，此预览不会发送邮件'); }
  };
  const input=(event:Event)=>{
    const node=event.target;if(!(node instanceof HTMLInputElement))return;
    if(node.hasAttribute('data-sc-search')){workQuery=node.value.toLocaleLowerCase();filterWork();}
    if(node.type==='range'){
      const output=node.closest('label')?.querySelector('output');if(output)output.textContent=`${node.value}%`;
      if(node.hasAttribute('data-sc-volume-range')){root.style.setProperty('--audio-volume',node.value);const volume=root.querySelector('[data-sc-volume]');if(volume)volume.textContent=node.value;}
    }
    if(node.hasAttribute('data-sc-habit')){
      reveal(root.querySelector('.clay-flower'));
      const count=root.querySelectorAll('[data-sc-habit]:checked').length,total=root.querySelectorAll('[data-sc-habit]').length;
      const output=root.querySelector('[data-sc-habit-count]'),fill=root.querySelector<HTMLElement>('[data-sc-habit-fill]');if(output)output.textContent=String(count);if(fill)fill.style.width=`${count/total*100}%`;
    }
  };
  if(root.dataset.style==='soft'){const clock=root.querySelector('[data-breath-clock]');const left=Math.max(0,duration*60-breathElapsed);if(clock)clock.textContent=`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;}
  root.addEventListener('click', click); root.addEventListener('submit', submit); root.addEventListener('input',input);
  return () => { root.removeEventListener('click', click); root.removeEventListener('submit', submit);root.removeEventListener('input',input);if(root.dataset.style==='bento'){if(focusStarted)focusRemaining=Math.max(0,focusRemaining-Math.floor((Date.now()-focusStarted)/1000));root.dataset.focusRemaining=String(focusRemaining);root.dataset.playing='false';root.querySelector('[data-sc-play]')?.setAttribute('aria-pressed','false');const label=root.querySelector('.dayboard-focus [data-sc-play]>span:last-child');if(label)label.textContent=english?'Continue focus':'继续专注';}if(root.dataset.style==='soft'){root.dataset.breathing='false';root.querySelector('[data-sc-breath]')?.setAttribute('aria-pressed','false');const label=root.querySelector('[data-sc-breath-label]');if(label&&breathElapsed>0)label.textContent=english?'Continue practice':'继续呼吸';}clearInterval(breathingTimer);clearInterval(focusTimer); clearTimeout(noticeTimer); clearTimeout(diagnosticTimer);transitions.forEach(animation=>animation.cancel());sceneVisibility.disconnect();document.removeEventListener('visibilitychange',pageVisibility);resetRoute();sceneNav.forEach(link=>link.removeAttribute('aria-current')); };
}
