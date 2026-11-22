import {EventEmitter} from "node:events";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {BrowserWindow,Event as ElectronEvent} from "electron";
import {DesktopTray} from "./desktop-tray";
import {watchProjectWindow} from "./window-manager";
type MenuRow={label?:string;click?:()=>void};
const mocks=vi.hoisted(()=>({
 handlers:new Map<string,(...args:unknown[])=>unknown>(),
 trays:[] as Array<{menu:MenuRow[];popUpContextMenu:ReturnType<typeof vi.fn>;emit:(name:string,...args:unknown[])=>void;destroyed:boolean}>,
 iconMissing:false,menuBroken:false,quit:vi.fn(),
}));
vi.mock("electron",async()=>{
 const {EventEmitter:Emitter}=await import("node:events");
 class FakeTray extends Emitter {
  destroyed=false;menu:MenuRow[]=[];popUpContextMenu=vi.fn();
  constructor(){super();mocks.trays.push(this);}
  isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;}
  setToolTip(){}setImage(){}setContextMenu(menu:MenuRow[]){if(mocks.menuBroken)throw new Error("tray menu failed");this.menu=menu;}
 }
 const image={isEmpty:()=>mocks.iconMissing,resize:()=>image};
 return {app:{isPackaged:false,quit:mocks.quit},BrowserWindow:{fromWebContents:(sender:unknown)=>(sender as {owner:unknown}).owner},
  ipcMain:{handle:(name:string,fn:(...args:unknown[])=>unknown)=>mocks.handlers.set(name,fn),removeHandler:(name:string)=>mocks.handlers.delete(name)},
  Menu:{buildFromTemplate:(menu:unknown)=>menu},nativeImage:{createFromPath:()=>image},nativeTheme:Object.assign(new Emitter(),{shouldUseDarkColors:false}),Tray:FakeTray};
});
vi.mock("./ui-language",async()=>{
 const {EventEmitter:Emitter}=await import("node:events");
 return {mainUiI18n:new Emitter(),t:(key:string,params?:{name:string;number:number})=>
  key==="tray.windowInstance"?`${params?.name} (Window ${params?.number})`:key};
});
let nextWindowId=0;
class FakeWindow extends EventEmitter {
 id=++nextWindowId;url="";
 hidden=false;minimized=false;destroyed=false;webContents=Object.assign(new EventEmitter(),{
  owner:this,isDestroyed:()=>false,isCrashed:()=>false,send:vi.fn(),getURL:()=>this.url,
 });
 hide=vi.fn(()=>{this.hidden=true;});show=vi.fn(()=>{this.hidden=false;});focus=vi.fn();restore=vi.fn(()=>{this.minimized=false;});minimize=vi.fn(()=>{this.minimized=true;});
 isMinimized(){return this.minimized;}isDestroyed(){return this.destroyed;}
 asWindow(){return this as unknown as BrowserWindow;}
 close(){const event={preventDefault:vi.fn()};this.emit("close",event);return event;}
}
let tray:DesktopTray;const remember=vi.fn<()=>Promise<void>>(),createWindow=vi.fn<()=>Promise<void>>();let dismissed=false;
const names=new Map<string,string>();
const watched:FakeWindow[]=[];
const platformDescriptor=Object.getOwnPropertyDescriptor(process,"platform")!;
const options={noticeDismissed:()=>dismissed,rememberNotice:remember,createWindow,projectNames:()=>names};
function usePlatform(platform:NodeJS.Platform):void {
 tray.dispose();
 Object.defineProperty(process,"platform",{...platformDescriptor,value:platform});
 tray=new DesktopTray(options);
}
function track(projectId?:string):FakeWindow {
 const window=new FakeWindow();
 if(projectId)window.url=`file:///index.html#/project/${projectId}`;
 watchProjectWindow(window.asWindow());tray.attach(window.asWindow());watched.push(window);
 return window;
}
const nativeTray=()=>mocks.trays.at(-1)!;
const labels=()=>nativeTray().menu.flatMap(item=>item.label?[item.label]:[]);
const select=(label:string)=>nativeTray().menu.find(item=>item.label===label)!.click!();
const invoke=(name:string,window:FakeWindow,payload:unknown)=>mocks.handlers.get(name)!({sender:window.webContents},payload);
const ready=(window:FakeWindow)=>invoke("win:tray-ready",window,true);
function pending(window:FakeWindow){return window.webContents.send.mock.calls.at(-1)![1] as {id:string};}
const answer=(window:FakeWindow,extra={})=>invoke("win:tray-respond",window,{...pending(window),hide:true,dontRemind:false,...extra});
beforeEach(()=>{mocks.trays.length=0;mocks.iconMissing=false;mocks.menuBroken=false;mocks.quit.mockReset();remember.mockReset().mockResolvedValue(undefined);createWindow.mockReset().mockResolvedValue(undefined);dismissed=false;names.clear();
 tray=new DesktopTray(options);});
afterEach(()=>{
 tray.dispose();
 for(const window of watched.splice(0))window.emit("closed");
 Object.defineProperty(process,"platform",platformDescriptor);
});
describe("close to tray lifecycle",()=>{
 it("quits the application only for the matching window and ignores the notice preference",async()=>{
  const window=new FakeWindow(),other=new FakeWindow();tray.attach(window.asWindow());tray.attach(other.asWindow());ready(window);window.close();
  const request=pending(window);
  await invoke("win:tray-respond",other,{...request,hide:false,dontRemind:false,quit:true});
  expect(mocks.quit).not.toHaveBeenCalled();
  await invoke("win:tray-respond",window,{...request,hide:false,dontRemind:false,quit:true});
  expect(mocks.quit).toHaveBeenCalledOnce();expect(remember).not.toHaveBeenCalled();expect(window.hide).not.toHaveBeenCalled();
  expect(window.close().preventDefault).not.toHaveBeenCalled();
 });
 it("deduplicates native closes, cancels safely and persists the notice choice only on confirmation",async()=>{
  const window=new FakeWindow();tray.attach(window.asWindow());ready(window);
  expect(window.close().preventDefault).toHaveBeenCalledOnce();window.close();expect(window.webContents.send).toHaveBeenCalledOnce();expect(window.hide).not.toHaveBeenCalled();
  await answer(window,{hide:false,dontRemind:true});expect(remember).not.toHaveBeenCalled();expect(window.hidden).toBe(false);
  window.close();await answer(window,{dontRemind:true});expect(remember).toHaveBeenCalledOnce();expect(window.hidden).toBe(true);
  dismissed=true;window.show();window.close();expect(window.hidden).toBe(true);expect(window.webContents.send).toHaveBeenCalledTimes(2);
 });
 it("rejects responses from other windows or stale tokens and preserves the prompt after a failed save",async()=>{
  const first=new FakeWindow(),other=new FakeWindow();tray.attach(first.asWindow());tray.attach(other.asWindow());ready(first);first.close();const request=pending(first);
  await invoke("win:tray-respond",other,{...request,hide:true,dontRemind:true});expect(remember).not.toHaveBeenCalled();expect(first.hidden).toBe(false);
  remember.mockRejectedValueOnce(new Error("disk readonly"));await expect(answer(first,{dontRemind:true})).rejects.toThrow("disk readonly");expect(first.hidden).toBe(false);
  await answer(first,{dontRemind:true});expect(first.hidden).toBe(true);expect(remember).toHaveBeenCalledTimes(2);
 });
 it("does not persist or hide a second time on repeated replies while storage is pending",async()=>{
  const window=new FakeWindow();tray.attach(window.asWindow());ready(window);window.close();
  let release!:()=>void;remember.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
  const saving=answer(window,{dontRemind:true});await expect(answer(window,{dontRemind:true})).rejects.toThrow("already");
  tray.beginQuit();release();await saving;expect(window.hide).not.toHaveBeenCalled();expect(window.close().preventDefault).not.toHaveBeenCalled();
 });
 it("restores all workspace windows and allows quit, system logout and update exits to bypass hiding",async()=>{
  const first=new FakeWindow(),second=new FakeWindow();tray.attach(first.asWindow());tray.attach(second.asWindow());dismissed=true;
  first.close();expect(first.hidden).toBe(true);expect(second.hidden).toBe(false);
  second.close();second.minimized=true;await tray.showWindows();expect(first.show).toHaveBeenCalledOnce();expect(second.restore).toHaveBeenCalledOnce();expect(second.focus).toHaveBeenCalledOnce();
  mocks.trays[0]!.menu.at(-1)!.click!();expect(mocks.quit).toHaveBeenCalledOnce();expect(first.close().preventDefault).not.toHaveBeenCalled();
  tray.dispose();tray=new DesktopTray(options);const shutdown=new FakeWindow();tray.attach(shutdown.asWindow());shutdown.emit("session-end",{} as ElectronEvent);expect(shutdown.close().preventDefault).not.toHaveBeenCalled();
 });
 it("keeps tray restoration and close behavior after a cancelled Windows shutdown query",async()=>{
  const window=new FakeWindow();tray.attach(window.asWindow());dismissed=true;window.close();
  window.emit("query-session-end",{} as ElectronEvent);await tray.showWindows();expect(window.hidden).toBe(false);
  expect(window.close().preventDefault).toHaveBeenCalledOnce();expect(window.hidden).toBe(true);
 });
 it("uses taskbar minimization when the renderer or tray cannot safely support hiding",()=>{
  const window=new FakeWindow();tray.attach(window.asWindow());window.close();expect(window.minimize).toHaveBeenCalledOnce();expect(window.hide).not.toHaveBeenCalled();
  ready(window);mocks.trays[0]!.destroyed=true;mocks.iconMissing=true;window.close();expect(window.minimize).toHaveBeenCalledTimes(2);expect(window.webContents.send).not.toHaveBeenCalled();
 });
 it("invalidates old renderer responses on reload but retains readiness across hash navigation",async()=>{
  const window=new FakeWindow();tray.attach(window.asWindow());ready(window);window.webContents.emit("did-start-navigation",{},"file:///index.html#/p",true,true);window.close();expect(window.webContents.send).toHaveBeenCalledOnce();
  window.webContents.emit("did-start-navigation",{},"file:///index.html",false,true);await answer(window);expect(window.hide).not.toHaveBeenCalled();window.close();expect(window.minimize).toHaveBeenCalledOnce();
 });
 it("does not retain a partially initialized tray or intercept closes of auxiliary windows",()=>{
  mocks.trays[0]!.destroyed=true;mocks.menuBroken=true;const window=new FakeWindow();tray.attach(window.asWindow());ready(window);window.close();
  expect(window.minimize).toHaveBeenCalledOnce();expect(mocks.trays.at(-1)!.destroyed).toBe(true);
  const auxiliary=new FakeWindow();expect(auxiliary.close().preventDefault).not.toHaveBeenCalled();
 });
 it("merges concurrent launcher activations when no workspace window survives",async()=>{
  let release!:()=>void;createWindow.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
  const first=tray.showWindows(),second=tray.showWindows();expect(createWindow).toHaveBeenCalledOnce();release();await Promise.all([first,second]);
 });
});

describe("tray window selection",()=>{
 it("opens a Windows menu for multiple windows and restores only the chosen one",()=>{
  usePlatform("win32");dismissed=true;
  names.set("one","研发");names.set("two","文档");
  const first=track("one"),second=track("two");
  first.close();second.close();second.minimized=true;
  nativeTray().emit("click",{}, {},{x:100,y:50});
  expect(nativeTray().popUpContextMenu).toHaveBeenCalledWith(nativeTray().menu,{x:100,y:50});
  expect(labels()).toEqual(["研发","文档","tray.showAll","tray.quit"]);
  expect(first.hidden && second.hidden).toBe(true);
  select("文档");
  expect(first.hidden).toBe(true);expect(first.show).not.toHaveBeenCalled();
  expect(second.restore).toHaveBeenCalledOnce();expect(second.focus).toHaveBeenCalledOnce();
  select("tray.showAll");
  expect(first.hidden).toBe(false);expect(second.hidden).toBe(false);
 });
 it("refreshes the native Mac menu without automatically restoring all windows",()=>{
  usePlatform("darwin");dismissed=true;
  names.set("one","原名称");names.set("two","其他项目");
  const first=track("one"),second=track("two");
  first.close();second.close();
  names.set("one","研发 R&D");
  nativeTray().emit("mouse-down");
  nativeTray().emit("click");
  expect(labels()).toEqual(["研发 R&&D","其他项目","tray.showAll","tray.quit"]);
  expect(first.hidden && second.hidden).toBe(true);
  select("研发 R&&D");
  expect(first.focus).toHaveBeenCalledOnce();expect(second.hidden).toBe(true);
 });
 it("keeps named and unnamed windows distinct and ignores stale menu items",()=>{
  usePlatform("win32");dismissed=true;
  names.set("one","R&D");
  const first=track("one"),second=track("one"),workspace=track();
  expect(labels()).toEqual(["R&&D (Window 1)","R&&D (Window 2)","tray.workspace","tray.showAll","tray.quit"]);
  const stale=nativeTray().menu[1]!.click!;
  second.destroyed=true;second.emit("closed");
  stale();
  expect(second.show).not.toHaveBeenCalled();
  expect(labels()).toEqual(["R&&D","tray.workspace","tray.showAll","tray.quit"]);
  workspace.destroyed=true;workspace.emit("closed");first.close();
  nativeTray().emit("click",{}, {},{x:100,y:50});
  expect(first.hidden).toBe(false);expect(nativeTray().popUpContextMenu).not.toHaveBeenCalled();
 });
 it("tracks main-frame project switches without letting an iframe change the tray label",()=>{
  names.set("one","初始项目");names.set("two","切换后的项目");
  const first=track("one");track();
  first.webContents.emit("did-navigate-in-page",{},"file:///preview#other",false);
  expect(labels()[0]).toBe("初始项目");
  first.webContents.emit("did-navigate-in-page",{},"file:///index.html#/project/two",true);
  expect(labels()[0]).toBe("切换后的项目");
 });
});
