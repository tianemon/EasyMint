import { randomUUID } from "node:crypto";
import path from "node:path";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, Tray } from "electron";
import { z } from "zod";
import type { TrayCloseResponse } from "../../shared/window-tray";
import { mainUiI18n,t } from "./ui-language";

interface TrayOptions {
  noticeDismissed:()=>boolean;
  rememberNotice:()=>Promise<void>;
  createWindow:()=>Promise<unknown>;
}

/** Only workspace windows attach here; previews and OAuth windows retain normal close behavior. */
export class DesktopTray {
  private tray:Tray|undefined;
  private windows=new Set<BrowserWindow>();
  private ready=new Set<BrowserWindow>();
  private pending=new Map<BrowserWindow,string>();
  private replying=new Set<BrowserWindow>();
  private quitting=false;
  private creating:Promise<unknown>|undefined;
  private lastWindow:BrowserWindow|undefined;
  constructor(private options:TrayOptions) {
    ipcMain.handle("win:tray-ready",(event,value)=>{
      const window=BrowserWindow.fromWebContents(event.sender);
      if(!window || !this.windows.has(window))return;
      if(z.boolean().parse(value))this.ready.add(window);
      else {this.ready.delete(window);this.pending.delete(window);}
    });
    ipcMain.handle("win:tray-respond",(event,value)=>{
      const window=BrowserWindow.fromWebContents(event.sender);
      const input=z.object({id:z.string().uuid(),hide:z.boolean(),dontRemind:z.boolean()}).strict().parse(value);
      if(!window || !this.windows.has(window))throw new Error("Window is not managed by EasyMint");
      return this.respond(window,input);
    });
    mainUiI18n.on("languageChanged",this.updateMenu);
    nativeTheme.on("updated",this.updateIcon);
    this.ensureTray();
  }
  private icon() {
    const root=path.join(__dirname,"..","..","..","assets");
    const image=process.platform==="win32"?nativeImage.createFromPath(path.join(root,"icon.ico")):
      nativeImage.createFromPath(app.isPackaged?path.join(process.resourcesPath,`appicon-${nativeTheme.shouldUseDarkColors?"dark":"light"}.png`):path.join(root,`appicon-${nativeTheme.shouldUseDarkColors?"dark":"light"}.png`));
    if(image.isEmpty())throw new Error("Tray icon is missing");
    return process.platform==="win32"?image:image.resize({width:process.platform==="darwin"?18:24,height:process.platform==="darwin"?18:24});
  }
  private updateIcon=():void=>{
    if(!this.tray || this.tray.isDestroyed())return;
    try {this.tray.setImage(this.icon());}catch(error){console.warn("[tray] Icon update failed:",error);}
  };
  private updateMenu=():void=>{
    if(!this.tray || this.tray.isDestroyed())return;
    this.tray.setContextMenu(Menu.buildFromTemplate([
      {label:t("tray.show"),click:()=>{void this.showWindows().catch(error=>console.error("[tray] Restore failed:",error));}},
      {type:"separator"},
      {label:t("tray.quit"),click:()=>{this.beginQuit();app.quit();}},
    ]));
  };
  private ensureTray():boolean {
    if(this.quitting)return false;
    if(this.tray && !this.tray.isDestroyed())return true;
    try {
      this.tray=new Tray(this.icon());
      this.tray.setToolTip("EasyMint");this.updateMenu();
      const restore=()=>{void this.showWindows().catch(error=>console.error("[tray] Restore failed:",error));};
      this.tray.on("click",restore);this.tray.on("double-click",restore);
      return true;
    } catch(error){
      console.warn("[tray] Tray unavailable, keeping the taskbar entry:",error);
      if(this.tray && !this.tray.isDestroyed())this.tray.destroy();
      this.tray=undefined;return false;
    }
  }
  attach(window:BrowserWindow):void {
    if(this.windows.has(window))return;
    this.windows.add(window);
    window.on("close",event=>{
      if(this.quitting)return;
      event.preventDefault();this.lastWindow=window;
      // Do not make an unreachable window if the tray or renderer could not start.
      if(!this.ensureTray()){window.minimize();return;}
      if(this.options.noticeDismissed()){window.hide();return;}
      if(!this.ready.has(window) || window.webContents.isDestroyed() || window.webContents.isCrashed()){window.minimize();return;}
      if(this.pending.has(window))return;
      const id=randomUUID();this.pending.set(window,id);window.webContents.send("win:tray-prompt",{id});
    });
    // A shutdown query may be cancelled by another app. Only the confirmed
    // session-end is terminal; Windows does not close these windows between them.
    // https://github.com/electron/electron/blob/v43.7.3/shell/browser/native_window_views_win.cc#L397-L427
    window.on("session-end",()=>this.beginQuit());
    window.on("closed",()=>{this.windows.delete(window);this.ready.delete(window);this.pending.delete(window);this.replying.delete(window);if(this.lastWindow===window)this.lastWindow=undefined;});
    window.webContents.on("did-start-navigation",(_event,_url,isInPlace,isMainFrame)=>{if(isMainFrame && !isInPlace){this.ready.delete(window);this.pending.delete(window);}});
    window.webContents.on("render-process-gone",()=>{this.ready.delete(window);this.pending.delete(window);});
  }
  private async respond(window:BrowserWindow,input:TrayCloseResponse):Promise<void> {
    if(this.quitting || window.isDestroyed() || this.pending.get(window)!==input.id)return;
    if(this.replying.has(window))throw new Error("Close response is already being saved");
    if(!input.hide){this.pending.delete(window);return;}
    this.replying.add(window);
    try {
      if(input.dontRemind)await this.options.rememberNotice();
      if(this.quitting || window.isDestroyed() || this.pending.get(window)!==input.id)return;
      this.pending.delete(window);
      if(this.ensureTray())window.hide();else window.minimize();
    } finally {this.replying.delete(window);}
  }
  async showWindows():Promise<void> {
    if(this.quitting)return;
    const windows=[...this.windows].filter(window=>!window.isDestroyed());
    if(!windows.length){
      if(this.creating)return this.creating.then(()=>undefined);
      const task=this.options.createWindow();this.creating=task;
      try {await task;}finally{if(this.creating===task)this.creating=undefined;}
      return;
    }
    for(const window of windows){if(window.isMinimized())window.restore();window.show();}
    (this.lastWindow && windows.includes(this.lastWindow)?this.lastWindow:windows[0])?.focus();
  }
  beginQuit():void {this.quitting=true;this.pending.clear();}
  dispose():void {
    this.beginQuit();
    if(this.tray && !this.tray.isDestroyed())this.tray.destroy();
    mainUiI18n.off("languageChanged",this.updateMenu);nativeTheme.removeListener("updated",this.updateIcon);
    ipcMain.removeHandler("win:tray-ready");ipcMain.removeHandler("win:tray-respond");
  }
}
