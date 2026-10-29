// @vitest-environment happy-dom
import {act,createElement} from "react";
import{createRoot}from"react-dom/client";
import{expect,it,vi}from"vitest";
import{SessionStatsPopup}from"./SessionStatsPopup";
it("keeps account balance queries out of the context-ring statistics popup",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const fetchBalance=vi.fn().mockResolvedValue({balance_infos:[{currency:"CNY",total_balance:"123.45"}]});
 Object.assign(window,{electronAPI:{agent:{sessionStats:vi.fn().mockResolvedValue(null)},settings:{fetchBalance}}});
 const node=document.createElement("div");document.body.append(node);const root=createRoot(node);
 try{await act(async()=>root.render(createElement(SessionStatsPopup,{sessionId:"stats",projectPath:"/fixture",onClose:()=>{}})));
  expect(fetchBalance).not.toHaveBeenCalled();expect(document.body.textContent).not.toContain("账户余额");expect(document.body.textContent).not.toContain("123.45");
 }finally{await act(async()=>root.unmount());node.remove();vi.unstubAllGlobals();}
});
