/** Original procedural globe. The archived HUD study informs art direction, not drawing code. */
export function mountCyberpunkMotion(root:HTMLElement,english=false,coastlines:number[][][]):()=>void {
  const targetCanvas=root.querySelector<HTMLCanvasElement>('[data-cyber-canvas]');
  if(!targetCanvas)return ()=>{};
  const canvas:HTMLCanvasElement=targetCanvas;
  const context=canvas.getContext('2d',{alpha:false});if(!context)return ()=>{};
  const ctx:CanvasRenderingContext2D=context;
  const holder=canvas.parentElement!,holographic=root.dataset.effect==='standard';
  const reduced=matchMedia('(prefers-reduced-motion:reduce)');
  let width=0,height=0,dpr=1,raf=0,last=0,time=0,visible=true,scanAt=-100,selected=Number(root.querySelector<HTMLElement>('[data-cyber-node][aria-pressed="true"]')?.dataset.cyberNode)||0,pointerX=0,pointerY=0,disposed=false,userPaused=root.dataset.cyberPaused==='true',yawBase=selected?-[139.7,103.8,8.7,-74,151.2][selected]!*Math.PI/180+.1:-1.85,currentYaw=yawBase;
  const globePoints:Array<[number,number,number]>=[];
  const inside=(x:number,y:number,polygon:number[][])=>{let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i]!,b=polygon[j]!;if((a[1]!>y)!==(b[1]!>y)&&x<(b[0]!-a[0]!)*(y-a[1]!)/(b[1]!-a[1]!)+a[0]!)yes=!yes;}return yes;};
  const vector=(lon:number,lat:number):[number,number,number]=>{const a=lon*Math.PI/180,b=lat*Math.PI/180;return [Math.cos(b)*Math.sin(a),-Math.sin(b),Math.cos(b)*Math.cos(a)];};
  for(let lat=-60;lat<78;lat+=3.2)for(let lon=-180;lon<180;lon+=3.2)if(coastlines.some(p=>inside(lon,lat,p)))globePoints.push(vector(lon,lat));
  const nodes=[[139.7,35.7],[103.8,1.3],[8.7,50.1],[-74,40.7],[151.2,-33.9]].map(([lon,lat])=>vector(lon!,lat!));
  const labels=['TOKYO / 07','SINGAPORE / 03','FRANKFURT / 02','NEW YORK / 04','SYDNEY / 08'];
  const stars=Array.from({length:58},(_,i)=>({x:(i*71.37%997)/997,y:(i*37.91%991)/991,a:.1+(i%5)*.06}));
  const grid:Array<Array<[number,number,number]>>=[];
  for(let lat=-60;lat<=60;lat+=20)grid.push(Array.from({length:73},(_,i)=>vector(-180+i*5,lat)));
  for(let lon=-180;lon<180;lon+=30)grid.push(Array.from({length:37},(_,i)=>vector(lon,-90+i*5)));
  const resize=()=>{const box=holder.getBoundingClientRect();width=box.width;height=box.height;dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(width*dpr));canvas.height=Math.max(1,Math.round(height*dpr));if(reduced.matches)draw(time);};
  const observer=new ResizeObserver(resize);observer.observe(holder);
  const intersection=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??true;sync();});intersection.observe(holder);
  const frameText=(text:string,x:number,y:number,size=8,alpha=.65)=>{ctx.globalAlpha=alpha;ctx.font=`${size}px ui-monospace,monospace`;ctx.fillStyle='#8de9ef';ctx.fillText(text,x,y);ctx.globalAlpha=1;};
  function draw(t:number){
    if(width<1||height<1)return;
    const sx=width/640,sy=height/440,scale=Math.min(sx,sy),ox=(width-640*scale)/2,oy=(height-440*scale)/2;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle=holographic?'#020d12':'#03090d';ctx.fillRect(0,0,width,height);
    ctx.translate(ox,oy);ctx.scale(scale,scale);
    const cx=320+pointerX*5,cy=215+pointerY*3,r=holographic?145:132;
    const targetYaw=yawBase+t*(holographic?.075:.045);currentYaw=reduced.matches||userPaused?targetYaw:currentYaw+(targetYaw-currentYaw)*.055;const yaw=currentYaw,tilt=holographic?-.18:-.07;
    const project=(v:readonly number[],lift=1)=>{const a=v[0]!*Math.cos(yaw)+v[2]!*Math.sin(yaw),z=-v[0]!*Math.sin(yaw)+v[2]!*Math.cos(yaw),b=v[1]!*Math.cos(tilt)-z*Math.sin(tilt),depth=v[1]!*Math.sin(tilt)+z*Math.cos(tilt);return {x:cx+a*r*lift,y:cy+b*r*lift,z:depth};};
    for(const star of stars){ctx.globalAlpha=star.a*(.7+.3*Math.sin(t*.7+star.x*10));ctx.fillStyle='#b8f9ff';ctx.fillRect(star.x*640,star.y*440,1,1);}ctx.globalAlpha=1;
    // Perspective floor is a distinguishing part of the neon mode.
    if(!holographic){ctx.strokeStyle='#1b5b6440';ctx.lineWidth=.55;for(let n=-7;n<=7;n++){ctx.beginPath();ctx.moveTo(cx+n*23,cy+84);ctx.lineTo(cx+n*100,437);ctx.stroke();}for(let n=0;n<9;n++){const y=cy+85+Math.pow((n+t*.14)%9/9,2)*137;ctx.beginPath();ctx.moveTo(55,y);ctx.lineTo(585,y);ctx.stroke();}}
    const halo=ctx.createRadialGradient(cx,cy,r*.6,cx,cy,r*1.65);halo.addColorStop(0,holographic?'#24e9ec16':'#02cbd50a');halo.addColorStop(1,'#00c9d500');ctx.fillStyle=halo;ctx.fillRect(cx-r*1.7,cy-r*1.7,r*3.4,r*3.4);
    const body=ctx.createRadialGradient(cx-r*.4,cy-r*.4,5,cx,cy,r);body.addColorStop(0,holographic?'#126673':'#071d28');body.addColorStop(.66,holographic?'#073440':'#04121c');body.addColorStop(1,holographic?'#082732':'#02080d');ctx.fillStyle=body;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
    // Grid and coast contours rotate in three dimensions, rather than spinning a flat disc.
    for(const line of grid){ctx.beginPath();let started=false;for(const v of line){const p=project(v);if(p.z>-.02){if(!started)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);started=true;}else started=false;}ctx.strokeStyle=holographic?'#53cfd636':'#24e6ef65';ctx.lineWidth=.55;ctx.stroke();}
    if(holographic){for(const v of globePoints){const p=project(v,1.003);if(p.z<0)continue;ctx.globalAlpha=.25+p.z*.65;ctx.fillStyle='#89ffff';ctx.fillRect(p.x,p.y,1.4,1.4);}ctx.globalAlpha=1;}
    else for(const coast of coastlines){ctx.beginPath();let started=false;for(let i=0;i<=coast.length;i++){const pair=coast[i%coast.length]!,p=project(vector(pair[0]!,pair[1]!));if(p.z>0){if(!started)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);started=true;}else started=false;}ctx.strokeStyle='#53f8ee';ctx.shadowColor='#02f3ed';ctx.shadowBlur=5;ctx.lineWidth=.9;ctx.stroke();ctx.shadowBlur=0;}
    ctx.strokeStyle=holographic?'#83ffff99':'#39f6fccc';ctx.lineWidth=1;ctx.shadowColor='#2af4ed';ctx.shadowBlur=holographic?13:5;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;
    // Precision radial scale and independent moving instrument arcs.
    for(let i=0;i<96;i++){const a=i*Math.PI/48,rr=r+21,end=rr+(i%8===0?9:3);ctx.strokeStyle=i%8===0?'#93f4f3aa':'#4dc2ce45';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(cx+Math.sin(a)*rr,cy+Math.cos(a)*rr);ctx.lineTo(cx+Math.sin(a)*end,cy+Math.cos(a)*end);ctx.stroke();}
    for(let i=0;i<3;i++){ctx.strokeStyle=i===1?'#6bfdf370':'#4dcedb40';ctx.lineWidth=i===1?2:.6;ctx.beginPath();ctx.arc(cx,cy,r+13+i*10,t*(i%2?-.12:.08)+i*2,t*(i%2?-.12:.08)+i*2+1.05);ctx.stroke();}
    if(holographic){ctx.save();ctx.translate(cx,cy);ctx.rotate(-.32);for(let i=0;i<2;i++){ctx.beginPath();ctx.ellipse(0,0,r+47+i*12,36+i*12,0,t*.1+i*Math.PI,t*.1+i*Math.PI+Math.PI*1.7);ctx.strokeStyle=i?'#62f3f84a':'#a4fffd9c';ctx.lineWidth=i?.6:1.1;ctx.stroke();}ctx.restore();}
    // A live scanner reveals a moving illuminated strip on the sphere.
    const scanY=cy-r+((t*(holographic?18:27))%(r*2));ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();const scan=ctx.createLinearGradient(0,scanY-28,0,scanY+2);scan.addColorStop(0,'#1ff5ef00');scan.addColorStop(1,holographic?'#65ffff40':'#38f7ff18');ctx.fillStyle=scan;ctx.fillRect(cx-r,scanY-28,r*2,30);ctx.strokeStyle='#aaffff80';ctx.beginPath();ctx.moveTo(cx-r,scanY);ctx.lineTo(cx+r,scanY);ctx.stroke();ctx.restore();
    const origin=project(nodes[selected]!);
    nodes.forEach((node,i)=>{const p=project(node);if(p.z<0)return;const pulse=(t*.65+i*.19)%1;ctx.strokeStyle=`rgba(91,255,245,${(1-pulse)*.6})`;ctx.beginPath();ctx.arc(p.x,p.y,4+pulse*15,0,Math.PI*2);ctx.stroke();ctx.fillStyle=i===selected?'#efffff':'#4bfff1';ctx.shadowColor='#35fff2';ctx.shadowBlur=i===selected?13:6;ctx.beginPath();ctx.arc(p.x,p.y,i===selected?3.5:2.1,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
      if(origin.z>0&&i!==selected){const controlX=(origin.x+p.x)/2,controlY=Math.min(origin.y,p.y)-40;ctx.strokeStyle='#4ff5ed45';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(origin.x,origin.y);ctx.quadraticCurveTo(controlX,controlY,p.x,p.y);ctx.stroke();const f=(t*.22+i*.2)%1,x=(1-f)**2*origin.x+2*(1-f)*f*controlX+f*f*p.x,y=(1-f)**2*origin.y+2*(1-f)*f*controlY+f*f*p.y;ctx.fillStyle='#b6ffff';ctx.beginPath();ctx.arc(x,y,1.8,0,Math.PI*2);ctx.fill();}
    });
    if(origin.z>0){ctx.strokeStyle='#83efeb90';ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(origin.x,origin.y);ctx.lineTo(origin.x+28,origin.y-25);ctx.lineTo(Math.min(585,origin.x+110),origin.y-25);ctx.stroke();ctx.setLineDash([]);frameText(labels[selected]!,Math.min(495,origin.x+34),origin.y-33,8,.9);}
    const age=performance.now()/1000-scanAt;if(age>=0&&age<4.5){const f=age/4.5;ctx.strokeStyle=`rgba(155,255,251,${1-f})`;ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,10+f*r*1.6,0,Math.PI*2);ctx.stroke();if(age>2.3){ctx.strokeStyle='#d9ffff';const target=origin.z>0?origin:{x:cx,y:cy};const rr=14+Math.max(0,4-age)*6;ctx.strokeRect(target.x-rr,target.y-rr,rr*2,rr*2);frameText('SIGNAL LOCKED',cx-40,cy+r+48,9,.9);}}
    ctx.strokeStyle='#77d9db55';ctx.lineWidth=.7;for(const [x,y,dx,dy] of [[26,38,19,19],[614,38,-19,19],[26,402,19,-19],[614,402,-19,-19]]){ctx.beginPath();ctx.moveTo(x!,y!+dy!);ctx.lineTo(x!,y!);ctx.lineTo(x!+dx!,y!);ctx.stroke();}
    frameText(holographic?'VOLUMETRIC / HOLOGRAPHIC PROJECTION':'NEON / VECTOR SIGNAL MESH',29,26,8,.8);frameText('NXS · LIVE SIMULATION',430,26,7,.5);frameText('GLOBAL RELAY / ENCRYPTED',29,425,7,.6);frameText(`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t)%60).padStart(2,'0')} / TRACKING`,470,425,7,.65);
    const phase=root.querySelector('[data-cyber-scan-phase]');if(phase){const label=age<0||age>=4.5?(english?'LINK ESTABLISHED':'链路已连接'):age<1.4?(english?'PROBING RELAYS':'正在探测中继'):age<2.8?(english?'TRACING ROUTE':'正在追踪路径'):(english?'SIGNAL LOCKED':'信号已锁定');if(phase.textContent!==label)phase.textContent=label;}
    const output=root.querySelector('[data-cyber-live-rate]');if(output)output.textContent=(1696.1+Math.sin(t*.7)*24+Math.sin(t*1.9)*6).toFixed(1);
  }
  const tick=(now:number)=>{raf=0;if(disposed)return;if(!last)last=now;const dt=Math.min((now-last)/1000,.1);if(now-last>=1000/30){time+=dt;last=now;draw(time);}raf=requestAnimationFrame(tick);};
  function sync(){cancelAnimationFrame(raf);raf=0;last=0;if(disposed)return;const running=!document.hidden&&visible&&root.dataset.paused!=='true'&&!reduced.matches&&!userPaused;canvas.dataset.motionState=running?'running':'paused';if(running)raf=requestAnimationFrame(tick);else draw(time);}
  const onClick=(event:Event)=>{const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-cyber-node],[data-sc-diagnostic],[data-cyber-motion-toggle]'):null;if(!target)return;if(target.hasAttribute('data-cyber-motion-toggle')){userPaused=!userPaused;root.dataset.cyberPaused=String(userPaused);target.setAttribute('aria-pressed',String(userPaused));target.textContent=english?(userPaused?'RESUME':'PAUSE'):(userPaused?'继续':'暂停');sync();return;}if(target.hasAttribute('data-cyber-node')){selected=Number(target.dataset.cyberNode)||0;root.querySelectorAll('[data-cyber-node]').forEach(button=>button.setAttribute('aria-pressed',String(button===target)));const name=root.querySelector('[data-cyber-node-title]');if(name)name.textContent=labels[selected]!;const latency=[2,18,82,14,36][selected]??2;root.dataset.cyberLatency=String(latency).padStart(2,'0');const latencyOutput=root.querySelector('.mission-telemetry>div:nth-child(2)>strong');if(latencyOutput?.firstChild)latencyOutput.firstChild.textContent=root.dataset.cyberLatency; yawBase=-[139.7,103.8,8.7,-74,151.2][selected]!*Math.PI/180+.1-time*(holographic?.075:.045);scanAt=reduced.matches||userPaused?-100:performance.now()/1000;}else scanAt=performance.now()/1000;draw(time);};
  const pointer=(event:PointerEvent)=>{if(reduced.matches)return;const box=holder.getBoundingClientRect();pointerX=(event.clientX-box.left)/box.width-.5;pointerY=(event.clientY-box.top)/box.height-.5;};
  const leave=()=>{pointerX=0;pointerY=0;};
  const state=new MutationObserver(sync);state.observe(root,{attributes:true,attributeFilter:['data-paused']});
  root.addEventListener('click',onClick);holder.addEventListener('pointermove',pointer);holder.addEventListener('pointerleave',leave);document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);resize();sync();
  return ()=>{disposed=true;cancelAnimationFrame(raf);observer.disconnect();intersection.disconnect();state.disconnect();root.removeEventListener('click',onClick);holder.removeEventListener('pointermove',pointer);holder.removeEventListener('pointerleave',leave);document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);};
}
