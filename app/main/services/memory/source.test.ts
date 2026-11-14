import { describe,it,expect } from "vitest";
import { evidenceMessages,conclusionSnapshot } from "./source";
import { conclusionParts,selectUserEvidence } from "./batch";
import { memoryAllowance,memoryVisibility,estimateMemoryTokens } from "./context";

const user=(id:string,parentId:string|null,text:string)=>({type:"message",id,parentId,timestamp:"2026-11-15T00:00:00+08:00",message:{role:"user",content:text,timestamp:100}});
const assistant=(id:string,parentId:string,text:string,stopReason="stop")=>({type:"message",id,parentId,timestamp:"2026-11-15T00:01:00+08:00",message:{role:"assistant",content:[{type:"text",text}],stopReason,timestamp:200}});
describe("conclusion provenance with the installed SDK",()=>{
  it("does not confuse tool-use progress or canceled responses with completed conclusions",async()=>{
    const progress=await evidenceMessages([user("u",null,"需求"),assistant("a","u","准备调用工具","toolUse")]);
    expect(conclusionSnapshot(progress)).toBeUndefined();
    const stopped=await evidenceMessages([user("u",null,"需求"),assistant("a","u","未完成","aborted")]);
    expect(conclusionSnapshot(stopped)).toBeUndefined();
  });
  it("follows the actual branch and SDK context edits, retaining pre-compaction evidence",async()=>{
    const entries=[user("u",null,"原本要求"),assistant("a","u","有效决定A"),assistant("b","a","废弃决定B"),
      {type:"compaction",id:"c",parentId:"a",timestamp:"2026-11-15T00:00:00Z",summary:"压缩",firstKeptEntryId:"a",tokensBefore:100},
      {type:"context_edit",id:"e",parentId:"c",timestamp:"2026-11-15T00:00:00Z",targetId:"u",replacement:{content:"用户更正后的要求"}}];
    const messages=await evidenceMessages(entries);
    expect(messages.map(m=>m.text)).toEqual(["用户更正后的要求","有效决定A"]);
    expect(conclusionSnapshot(messages)?.user?.text).toBe("用户更正后的要求");
    const omitted=await evidenceMessages([...entries,{type:"context_edit",id:"drop",parentId:"e",timestamp:"2026-11-15T00:00:00Z",targetId:"a",replacement:null}]);
    expect(conclusionSnapshot(omitted)).toBeUndefined();
  });
  it("recognizes host-verified ask_user selections but not arbitrary tool claims",async()=>{
    const result=(id:string,parent:string,toolName:string)=>({type:"message",id,parentId:parent,timestamp:"2026-11-15T00:00:00Z",message:{role:"toolResult",toolCallId:id,toolName,content:[{type:"text",text:"问题：保存方式\n用户选择：保留历史"}],details:{memoryUserEvidence:"问题：保存方式\n用户选择：保留历史"},isError:false,timestamp:200}});
    const messages=await evidenceMessages([user("u",null,"请安排"),result("t","u","ask_user"),result("fake","t","third_party"),assistant("a","fake","已确定保留历史")]);
    expect(messages.filter(m=>m.role==="user")).toHaveLength(2);
    expect(conclusionSnapshot(messages)?.user?.entryId).toBe("t");
  });
});
describe("bounded retrieval and lossless conclusion partitioning",()=>{
  it("partitions long text without silently dropping any content",()=>{
    const text=Array.from({length:40},(_,i)=>`段落${i}：保留条件，不得将讨论当完成。${"细节。".repeat(100)}\n\n`).join("");
    const parts=conclusionParts(text,500);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map(p=>p.text).join("")).toBe(text);
    expect(parts.every(p=>estimateMemoryTokens(p.text)<=500)).toBe(true);
    const huge="连续正文".repeat(3000),split=conclusionParts(huge,500);
    expect(split.map(p=>p.text).join("")).toBe(huge);
    expect(split.every(p=>p.fragmented)).toBe(true);
  });
  it("marks selected user evidence partial and never labels it the whole conversation",()=>{
    const text=`${"无关背景。".repeat(1000)}\n\n项目约定：所有复选框使用现有自绘组件。\n\n${"其他事情。".repeat(1000)}`;
    const evidence=selectUserEvidence(text,"复选框使用自绘组件",100);
    expect(evidence.partial).toBe(true);expect(evidence.text).toContain("自绘组件");
    expect(estimateMemoryTokens(evidence.text)).toBeLessThanOrEqual(105);
  });
  it("counts only model-visible host deliveries and respects remaining context",()=>{
    const delivery={memoryDelivery:{items:[{key:"global/a",revision:2}],tokens:1500}};
    const hidden={sourceEntry:{type:"custom_message",details:delivery},messages:[]};
    const actual={sourceEntry:{type:"custom_message",details:delivery},messages:[{role:"custom"}]};
    const tool={sourceEntry:{type:"message"},messages:[{role:"toolResult",details:delivery}]};
    expect(memoryVisibility([hidden]).used).toBe(0);
    const visible=memoryVisibility([actual,tool]);expect(visible.used).toBe(3000);
    expect(visible.delivered.get("global/a")).toBe(2);
    expect(memoryAllowance(visible,{tokens:99_000,contextWindow:100_000})).toBe(0);
    expect(memoryAllowance({...visible,used:4000})).toBe(0);
  });
});


it("keeps provenance stable for an unchanged text projection and invalidates changed text",async()=>{
  const original=[user("u",null,"原有偏好"),assistant("a","u","确认")];
  const before=await evidenceMessages(original);
  const same=await evidenceMessages([...original,{type:"context_edit",id:"e",parentId:"a",timestamp:new Date().toISOString(),targetId:"u",replacement:{content:"原有偏好"}}]);
  expect(same[0]?.hash).toBe(before[0]?.hash);
  const changed=await evidenceMessages([...original,{type:"context_edit",id:"e",parentId:"a",timestamp:new Date().toISOString(),targetId:"u",replacement:{content:"新偏好"}}]);
  expect(changed[0]?.hash).not.toBe(before[0]?.hash);
});
