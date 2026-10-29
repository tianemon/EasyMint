import { describe, expect, it } from "vitest";
import { applySubagentEvent, mergeSubagentHistory, updateSubagentActivity } from "./subagent-transcript";
import type { ChatMessage } from "./chat-utils";
const call = { type:"tool_use",id:"read-1",name:"read",input:{path:"src/a.ts"} };
const event = (patch: Partial<StreamEvent>): StreamEvent => ({type:"message",sessionId:"child",seq:0,runId:"fixture-run",timestamp:1000,...patch});
const nextId = () => -1;

describe("subagent transcript reconciliation", () => {
  it("keeps tool results when a final assistant snapshot arrives, and upserts repeated result events", () => {
    let messages=applySubagentEvent([],event({blocks:[call],partial:true}),nextId);
    const result=event({type:"tool_result",toolCallId:"read-1",toolName:"read",content:"file body"});
    messages=applySubagentEvent(messages,result,nextId);
    messages=applySubagentEvent(messages,result,nextId);
    messages=applySubagentEvent(messages,event({blocks:[call],partial:false,stopReason:"toolUse"}),nextId);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.entries!.filter(e=>e.kind==="tool_result")).toHaveLength(1);
    expect(messages[0]!.streaming).toBe(false);
    expect(messages[0]!.stopReason).toBe("toolUse");
  });
  it("does not append a second copy when a live message has already reached disk", () => {
    const live=applySubagentEvent([],event({blocks:[{type:"text",text:"draft"}],partial:true}),nextId);
    const disk:ChatMessage[]=[{...live[0]!,id:1,keyId:"disk-uuid",entryId:"disk-entry",entries:[{kind:"text",text:"draft complete",timestamp:1000}],streaming:undefined,stopReason:"stop"}];
    const merged=mergeSubagentHistory(disk,live);
    expect(merged).toHaveLength(1);expect(merged[0]!.id).toBe(live[0]!.id);expect(merged[0]!.entryId).toBe("disk-entry");
    expect(merged[0]!.entries).toEqual(disk[0]!.entries);
  });
  it("preserves newer output and tool results across a stale in-flight disk read", () => {
    const draft=applySubagentEvent([],event({blocks:[call],partial:true}),nextId);
    const disk:ChatMessage[]=[{...draft[0]!,id:1,keyId:"disk-uuid",streaming:undefined}];
    let live=applySubagentEvent(draft,event({blocks:[call,{type:"text",text:"new conclusion"}],partial:false,stopReason:"stop"}),nextId);
    live=applySubagentEvent(live,event({type:"tool_result",toolCallId:"read-1",content:"file body"}),nextId);
    const merged=mergeSubagentHistory(disk,live);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.entries).toEqual(live[0]!.entries);
    expect(merged[0]!.stopReason).toBe("stop");
  });
  it("keeps ordered system notifications and cancellation identity", () => {
    let messages=applySubagentEvent([],event({blocks:[{type:"text",text:"progress",phase:"commentary"}]}),nextId);
    messages=applySubagentEvent(messages,event({type:"custom_event",timestamp:2000,customType:"system_message",details:{kind:"shell"},text:"notice"}),()=>-2);
    messages=applySubagentEvent(messages,event({type:"turn_end",outcome:"cancelled"}),nextId);
    expect(messages[0]!.turnOutcome).toBe("cancelled");
    expect(messages[1]!.customType).toBe("system_message");
    expect(messages[1]!.text).toBe("notice");
  });
  it("tracks parallel tools independently and retains arguments on progress-only updates", () => {
    let activity=updateSubagentActivity({tools:[]},event({type:"tool_progress",toolCallId:"a",toolName:"read",toolArgs:{path:"a.ts"}}));
    activity=updateSubagentActivity(activity,event({type:"tool_progress",toolCallId:"b",toolName:"bash",toolArgs:{command:"npm test"}}));
    activity=updateSubagentActivity(activity,event({type:"tool_progress",toolCallId:"a",toolName:"read"}));
    expect(activity.tools.at(-1)?.args).toEqual({path:"a.ts"});
    activity=updateSubagentActivity(activity,event({type:"tool_done",toolCallId:"a"}));
    expect(activity.tools.at(-1)?.id).toBe("b");
    expect(updateSubagentActivity(activity,event({type:"turn_end"})).tools).toEqual([]);
  });
  it("uses nested tool identity without losing the owning process segment", () => {
    let activity=updateSubagentActivity({tools:[]},event({type:"tool_progress",toolCallId:"outer",toolName:"codemode"}));
    activity=updateSubagentActivity(activity,event({type:"nested_tool",parentToolCallId:"outer",toolCallId:"inner",toolName:"bash",toolArgs:{command:"git diff"},nestedPhase:"start"}));
    expect(activity.tools.at(-1)?.id).toBe("outer/inner");
    expect(activity.tools.at(-1)?.args).toEqual({command:"git diff"});
    expect(updateSubagentActivity(activity,event({type:"tool_done",toolCallId:"outer"})).tools).toEqual([]);
  });
});
