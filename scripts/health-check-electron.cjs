/** Build main/preload/renderer first, then run with Electron. Uses only temporary app data and a loopback model fixture. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');
const started = performance.now();
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'em-runtime-health-'));
const project = path.join(root, 'project');
const reportFile = process.argv[2] && path.resolve(process.argv[2]);
process.env.EASYMINT_HOME = root;
process.env.PI_CODING_AGENT_DIR = path.join(root, 'agent');
app.disableHardwareAcceleration();
const report = { electron: process.versions.electron, node: process.versions.node, isolatedData: true, requests: 0, checks: [], timingsMs: {}, memoryMB: [] };
let mainWindow;
let server;
const sockets = new Set();
const write = (name, data) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(data)); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout=15000) { const end=performance.now()+timeout; while(performance.now()<end) { const r=await fn(); if(r) return r; await sleep(30); } throw new Error('Health check wait timed out'); }
const js = source => mainWindow.webContents.executeJavaScript(source, true);
function check(ok, label) { if(!ok) throw new Error(label); report.checks.push(label); }
const watchdog = setTimeout(() => finish(new Error('Runtime health check exceeded 90 seconds')), 90000);
async function finish(error) {
  clearTimeout(watchdog);
  report.ok = !error;
  if(error) report.error = error.message;
  if(reportFile) { fs.mkdirSync(path.dirname(reportFile),{recursive:true}); fs.writeFileSync(reportFile, JSON.stringify(report,null,2)); }
  console.log('[health-check]',JSON.stringify(report));
  for(const socket of sockets) socket.destroy();
  server?.close();
  // Explicit exit avoids waiting on intentionally held fixture requests or app background discovery.
  fs.rmSync(root,{recursive:true,force:true});
  app.exit(error ? 1 : 0);
}
const loadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = function(url, ...args) {
  if(url.startsWith('http://localhost:5173')) url = pathToFileURL(path.join(repo,'app/renderer/dist/index.html')).href + new URL(url).hash;
  return loadURL.call(this,url,...args);
};
app.on('browser-window-created', (_event, win) => {
  if(mainWindow) return;
  mainWindow=win; win.hide(); win.webContents.setBackgroundThrottling(false);
  win.webContents.openDevTools=()=>{};
  win.webContents.on('render-process-gone', (_e,details)=>finish(new Error('Renderer exited: '+details.reason)));
  win.webContents.on('did-fail-load', (_e,code,description)=>finish(new Error('Renderer load failed: '+code+' '+description)));
  win.webContents.once('did-finish-load',()=>run().catch(finish));
});
async function run() {
  report.timingsMs.rendererLoaded=Math.round(performance.now()-started);
  await js('window.electronAPI.settings.get()');
  await until(()=>js('document.getElementById("root")?.innerText.length > 20'));
  report.timingsMs.uiReady=Math.round(performance.now()-started);
  await js('globalThis.__healthEvents=[]; globalThis.__healthUnsubs=[window.electronAPI.agent.onStream(e=>__healthEvents.push(e)),window.electronAPI.agent.onExit(e=>__healthEvents.push({...e,type:"health-exit"}))]; void 0;');
  const send=async(text,sessionId,permissionMode="readonly") => {
    await js('__healthEvents.length=0');
    const t=performance.now();
    const result=await js(`window.electronAPI.agent.sendMessage(${JSON.stringify(project)},${JSON.stringify(text)},{sessionId:${JSON.stringify(sessionId??null)},permissionMode:${JSON.stringify(permissionMode)},preferredProvider:"health-fixture",model:"health-model",thinkingLevel:"off"})`);
    await until(()=>js(`__healthEvents.some(e=>e.type==="health-exit" && e.sessionId===${JSON.stringify(result.sessionId)})`));
    return {...result,elapsed:Math.round(performance.now()-t),events:await js('__healthEvents')};
  };
  const first=await send('__READ_TOOL__');
  report.timingsMs.firstTurn=first.elapsed;
  check(first.events.some(e=>e.type==='tool_progress'&&e.toolName==='read') && report.toolReadVerified, 'real SDK tool execution reached renderer IPC');
  check(first.events.some(e=>e.type==='health-exit'&&e.code===0), 'first turn completed successfully');
  check(report.prompt.mintIdentityCount===1&&report.prompt.permissionSections===1,'wire-level prompt has one Mint identity and one permission section');
  check(await js(`window.electronAPI.agent.chatStatus(${JSON.stringify(first.sessionId)})`)==='idle','completed turn is idle');
  report.timingsMs.warmTurns=[];
  for(let i=0;i<3;i++) report.timingsMs.warmTurns.push((await send('warm health '+i,first.sessionId)).elapsed);
  await send('__WRITE_TOOL__',first.sessionId);
  check(fs.readFileSync(path.join(project,'fixture.txt'),'utf8')==='HEALTH_FILE_CONTENT','readonly mode blocks actual write execution');
  await send('__WRITE_TOOL__',first.sessionId,'standard');
  check(fs.readFileSync(path.join(project,'fixture.txt'),'utf8')==='HEALTH_UPDATED','send options apply readonly to standard transition');
  fs.writeFileSync(path.join(project,'fixture.txt'),'HEALTH_RESTRICTED');
  await send('__WRITE_TOOL__',first.sessionId,'readonly');
  check(fs.readFileSync(path.join(project,'fixture.txt'),'utf8')==='HEALTH_RESTRICTED','standard to readonly transition revokes write permission');
  await js('__healthEvents.length=0');
  const pending=await js(`window.electronAPI.agent.sendMessage(${JSON.stringify(project)},"__HANG__",{sessionId:${JSON.stringify(first.sessionId)},permissionMode:"readonly"})`);
  await until(()=>Promise.resolve(report.hangingRequest));
  const abortStart=performance.now();
  const stopped=await js(`window.electronAPI.agent.abort(${JSON.stringify(pending.chatId)},{clearQueue:true,rewind:true})`);
  report.timingsMs.abort=Math.round(performance.now()-abortStart);
  check(!stopped.stopTimedOut,'held HTTP request can be stopped');
  check(await js(`window.electronAPI.agent.chatStatus(${JSON.stringify(first.sessionId)})`)==='idle','stopped turn returns to idle');
  await js(`window.electronAPI.agent.killSession(${JSON.stringify(first.sessionId)})`);
  const resumed=await send('resume health',first.sessionId);
  check(resumed.sessionId===first.sessionId,'closed session resumes with the same ID');
  await js(`window.electronAPI.agent.killSession(${JSON.stringify(first.sessionId)})`);
  for(let i=0;i<10;i++) {
    const r=await send('cycle health '+i);
    await js(`window.electronAPI.agent.killSession(${JSON.stringify(r.sessionId)})`);
    if(i%3===0) report.memoryMB.push(Math.round(process.memoryUsage().heapUsed/1024/1024));
  }
  check((await js('window.electronAPI.agent.activeSessions()')).length===0,'all 10 repeated sessions release their active registrations');
  const sdk=await import('@earendil-works/pi-coding-agent');
  const history=sdk.SessionManager.create(project);
  for(let i=0;i<500;i++) history.appendMessage({role:'user',content:[{type:'text',text:'HEALTH_HISTORY_'+i+' '+('content '.repeat(120))}],timestamp:Date.now()+i});
  history.appendSessionInfo('Health Long History');
  const historyStart=performance.now();
  const messages=await js(`window.electronAPI.conv.messages(${JSON.stringify(history.getSessionId())},${JSON.stringify(project)})`);
  report.timingsMs.history500Read=Math.round(performance.now()-historyStart);
  check(Array.isArray(messages)&&messages.length===500,'500-message history survives real disk parsing and renderer IPC');
  report.frameMs=await js('new Promise(resolve=>{const a=[];let last=performance.now();function step(t){a.push(t-last);last=t;if(a.length<90)requestAnimationFrame(step);else{a.sort((x,y)=>x-y);resolve({p50:Math.round(a[45]),p95:Math.round(a[85]),max:Math.round(a[89])});}}requestAnimationFrame(step);})');
  await js('__healthUnsubs.forEach(fn=>fn())');
  await finish();
}
server=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req) raw+=part;
  if(!raw) {res.writeHead(200);res.end('{}');return;}
  report.requests++;
  const data=JSON.parse(raw);
  if(!report.prompt){const text=(data.messages??[]).filter(m=>['system','developer'].includes(m.role)).map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n'); report.prompt={chars:text.length,mintIdentityCount:(text.match(/你叫 Mint/g)??[]).length,permissionSections:(text.match(/<permission_rules>/g)??[]).length,toolCount:data.tools?.length??0};}
  if(data.messages?.some(m=>m.role==='tool'&&JSON.stringify(m.content).includes('HEALTH_FILE_CONTENT'))) report.toolReadVerified=true;
  const lastUserIndex=(data.messages??[]).findLastIndex(m=>m.role==='user');
  const lastUser=data.messages?.[lastUserIndex];
  const hasToolResult=data.messages?.slice(lastUserIndex+1).some(m=>m.role==='tool');
  if(JSON.stringify(lastUser??{}).includes('__HANG__')) {report.hangingRequest=true; return;}
  const needsRead=JSON.stringify(lastUser??{}).includes('__READ_TOOL__')&&!hasToolResult;
  const needsWrite=JSON.stringify(lastUser??{}).includes('__WRITE_TOOL__')&&!hasToolResult;
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
  const delta=(needsRead||needsWrite)?{role:'assistant',tool_calls:[{index:0,id:'health-read',type:'function',function:{name:needsWrite?'write':'read',arguments:JSON.stringify({path:path.join(project,'fixture.txt'),...(needsWrite?{content:'HEALTH_UPDATED'}:{})})}}]}:{role:'assistant',content:'HEALTH_OK'};
  const chunk=(delta,finish_reason)=>({id:'health-completion',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'health-model',choices:[{index:0,delta,finish_reason}]});
  res.write('data: '+JSON.stringify(chunk(delta,null))+'\n\n');
  res.write('data: '+JSON.stringify(chunk({},(needsRead||needsWrite)?'tool_calls':'stop'))+'\n\n');
  res.end('data: [DONE]\n\n');
});
server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
server.listen(0,'127.0.0.1',()=>{
  fs.mkdirSync(project,{recursive:true});fs.writeFileSync(path.join(project,'fixture.txt'),'HEALTH_FILE_CONTENT');
  write('em-settings.json',{migration:{schemaVersion:1,nativeConfigVersion:1},project:{setupComplete:true,lastId:'health-project'},mcp:{hidden:['codegraph','playwright']}});
  write('projects.json',{projects:[{id:'health-project',name:'Health Fixture',path:project,status:'development',createdAt:new Date().toISOString(),lastOpenedAt:new Date().toISOString()}]});
  write('agent/models.json',{providers:{'health-fixture':{api:'openai-completions',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',models:[{id:'health-model',name:'Health Model',reasoning:false,input:['text'],contextWindow:128000,maxTokens:4096}]}}});
  write('agent/auth.json',{'health-fixture':{type:'api_key',key:'fixture-only'}});
  write('agent/settings.json',{defaultProvider:'health-fixture',defaultModel:'health-model',defaultThinkingLevel:'off'});
  write('agent/mcp.json',{mcpServers:{}});
  require(path.join(repo,'app/main/dist/main.cjs'));
});
