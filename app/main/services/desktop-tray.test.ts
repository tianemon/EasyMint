import {EventEmitter} from "node:events";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {BrowserWindow,Event as ElectronEvent} from "electron";
import {DesktopTray} from "./desktop-tray";
const mocks=vi.hoisted(()=>({handlers:new Map<string,(...args:unknown[])=>unknown>(),trays:[] as Array<{menu:Array<{click?:()=>void}>;emit:(name:string)=>void;destroyed:boolean}>,iconMissing:false,menuBroken:false,quit:vi.fn()}));
vi.mock("electron",async()=>{
 const {EventEmitter:Emitter}=await import("node:events");
 class FakeTray extends Emitter {
  destroyed=false;menu:Array<{click?:()=>void}>=[];
  constructor(){super();mocks.trays.push(this);}
  isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;}
  setToolTip(){}setImage(){}setContextMenu(menu:Array<{click?:()=>void}>){if(mocks.menuBroken)throw new Error("tray menu failed");this.menu=menu;}
 }
 const image={isEmpty:()=>mocks.iconMissing,resize:()=>image};
 return {app:{isPackaged:false,quit:mocks.quit},BrowserWindow:{fromWebContents:(sender:unknown)=>(sender as {owner:unknown}).owner},
  ipcMain:{handle:(name:string,fn:(...args:unknown[])=>unknown)=>mocks.handlers.set(name,fn),removeHandler:(name:string)=>mocks.handlers.delete(name)},
  Menu:{buildFromTemplate:(menu:unknown)=>menu},nativeImage:{createFromPath:()=>image},nativeTheme:Object.assign(new Emitter(),{shouldUseDarkColors:false}),Tray:FakeTray};
});
vi.mock("./ui-language",async()=>{const {EventEmitter:Emitter}=await import("node:events");return {mainUiI18n:new Emitter(),t:(key:string)=>key};});
class FakeWindow extends EventEmitter {
 hidden=false;minimized=false;destroyed=false;webContents=Object.assign(new EventEmitter(),{owner:this,isDestroyed:()=>false,isCrashed:()=>false,send:vi.fn()});
 hide=vi.fn(()=>{this.hidden=true;});show=vi.fn(()=>{this.hidden=false;});focus=vi.fn();restore=vi.fn(()=>{this.minimized=false;});minimize=vi.fn(()=>{this.minimized=true;});
 isMinimized(){return this.minimized;}isDestroyed(){return this.destroyed;}
 asWindow(){return this as unknown as BrowserWindow;}
 close(){const event={preventDefault:vi.fn()};this.emit("close",event);return event;}
}
let tray:DesktopTray;const remember=vi.fn<()=>Promise<void>>(),createWindow=vi.fn<()=>Promise<void>>();let dismissed=false;
const invoke=(name:string,window:FakeWindow,payload:unknown)=>mocks.handlers.get(name)!({sender:window.webContents},payload);
const ready=(window:FakeWindow)=>invoke("win:tray-ready",window,true);
function pending(window:FakeWindow){return window.webContents.send.mock.calls.at(-1)![1] as {id:string};}
const answer=(window:FakeWindow,extra={})=>invoke("win:tray-respond",window,{...pending(window),hide:true,dontRemind:false,...extra});
beforeEach(()=>{mocks.trays.length=0;mocks.iconMissing=false;mocks.menuBroken=false;mocks.quit.mockReset();remember.mockReset().mockResolvedValue(undefined);createWindow.mockReset().mockResolvedValue(undefined);dismissed=false;
 tray=new DesktopTray({noticeDismissed:()=>dismissed,rememberNotice:remember,createWindow});});
afterEach(()=>tray.dispose());
describe("close to tray lifecycle",()=>{
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
  first.close();second.close();second.minimized=true;await tray.showWindows();expect(first.show).toHaveBeenCalledOnce();expect(second.restore).toHaveBeenCalledOnce();expect(second.focus).toHaveBeenCalledOnce();
  mocks.trays[0]!.menu.at(-1)!.click!();expect(mocks.quit).toHaveBeenCalledOnce();expect(first.close().preventDefault).not.toHaveBeenCalled();
  tray.dispose();tray=new DesktopTray({noticeDismissed:()=>true,rememberNotice:remember,createWindow});const shutdown=new FakeWindow();tray.attach(shutdown.asWindow());shutdown.emit("session-end",{} as ElectronEvent);expect(shutdown.close().preventDefault).not.toHaveBeenCalled();
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
