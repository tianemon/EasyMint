import { describe, expect, it } from "vitest";
import { buildRunningProcessSlices } from "./chat-running-process";
import { buildTurnPresentations } from "./chat-turn-presentation";
import { buildProcessRecords, completedProcessChunks } from "./execution-process-model";
import { toolActivity } from "./tool-activity";
import type { ChatMessage } from "./chat-utils";
import type { StreamEntry } from "./StreamPanel";
const ai = (id: number, entries: StreamEntry[], patch: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "ai", timestamp: id, entries, ...patch });
const call: StreamEntry = { kind: "tool_use", id: "read", name: "read", input: {path:"/project/ChatBlocks.tsx"}, timestamp: 0, collapsed: true };
const text: StreamEntry = { kind: "text", text: "intermediate", timestamp: 1 };
const result: StreamEntry = { kind: "tool_result", toolUseId: "read", content: "file content", isError: false, timestamp: 2 };

describe("process records and original message ownership", () => {
  it("attaches late results to the original call even after an intermediate conclusion", () => {
    const messages = [ai(1, [call, text], { stopReason: "toolUse" }), ai(2, [result, { ...text, text: "continued" }], { streaming: true })];
    const rows = buildRunningProcessSlices(messages, buildTurnPresentations(messages, true));
    expect(rows.get(0)?.[0]?.entries).toEqual([call, result]);
    expect(rows.get(1)?.flatMap(slice => slice.entries)).toEqual([messages[1]!.entries![1]]);
    const records = buildProcessRecords(rows.get(0)![0]!.chunks!, true);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ state: "done", message: messages[0], entries: [call, result] });
  });
  it("does not label failed, cancelled, or missing results as successful", () => {
    const message = ai(1, [call]);
    const chunks = [{ message, entries: [call] }];
    expect(buildProcessRecords(chunks, true)[0]?.state).toBe("running");
    expect(buildProcessRecords(chunks, false, "cancelled")[0]?.state).toBe("cancelled");
    expect(buildProcessRecords(chunks, false)[0]?.state).toBe("unfinished");
    const failed = buildProcessRecords([{ message, entries: [call, { ...result, isError: true }] }], false)[0]!;
    expect(failed.state).toBe("failed");
    expect(failed.text).toContain("失败");
    expect(failed.text).not.toContain("已读取");
  });
  it("keeps nested tool state and command details without inventing a success", () => {
    const nested: StreamEntry = { ...call, nestedCalls: { complete: false, calls: [
      {id:"a",name:"bash",arguments:{command:"npm test"},status:"ok"},
      {id:"b",name:"grep",arguments:{pattern:"FIXME",path:"src"},status:"unfinished"},
    ] } };
    const records = buildProcessRecords([{message:ai(1,[nested]), entries:[nested]}], false, "cancelled");
    expect(records.map(record => record.state)).toEqual(["cancelled", "done", "cancelled"]);
    expect(records[1]?.text).toContain("npm test");
    expect(records[2]?.text).toContain("FIXME");
  });
  it("does not keep old thinking or a returned tool's unfinished nested call spinning", () => {
    const thought: StreamEntry = { kind: "thinking", text: "earlier reasoning", timestamp: 0 };
    const message = ai(1, [thought, text], { streaming: true });
    expect(buildProcessRecords([{ message, entries: [thought] }], true)[0]?.state).toBe("done");
    const returned: StreamEntry = { ...result, nestedCalls: {complete:false,calls:[{id:"nested",name:"read",status:"unfinished"}]} };
    expect(buildProcessRecords([{message:ai(1,[call,returned]),entries:[call,returned]}],true).map(record=>record.state)).toEqual(["done","unfinished"]);
  });
  it("collects the unified completed process and leaves final content in its source row", () => {
    const final: StreamEntry = { kind: "text", text: "answer", phase: "final_answer", timestamp: 3 };
    const messages = [ai(1, [call, result, text], { stopReason:"toolUse" }), ai(2, [final], {stopReason:"stop",turnOutcome:"completed"})];
    const before = structuredClone(messages);
    const turn = buildTurnPresentations(messages, false);
    const chunks = completedProcessChunks(messages, turn).get(0)!;
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.message).toBe(messages[0]);
    expect(chunks.flatMap(chunk => chunk.entries)).toEqual([call, result, text]);
    expect(turn.get(0)?.finalEntries.get(1)).toEqual([final]);
    expect(messages).toEqual(before);
  });
});

it("formats natural actions, search terms, aliases and full paths", () => {
  expect(toolActivity("read", { path: "/project/ChatBlocks.tsx" })).toMatchObject({ text:"正在读取 ChatBlocks.tsx", fullText:"正在读取 /project/ChatBlocks.tsx", icon:"read" });
  expect(toolActivity("grep", {pattern:"ask_user|question",path:"/project/src"}).text).toContain("src 中的“ask_user|question”");
  expect(toolActivity("ls", {path:"src"}).text).toBe("正在列出文件 src");
  expect(toolActivity("web_search", {query:"SDK"}).text).toBe("正在搜索网页 SDK");
  expect(toolActivity("powershell", {command:"Get-ChildItem\n-Force"}).text).toBe("正在运行命令 Get-ChildItem -Force");
  expect(toolActivity("mcp__github__search", {}).text).toContain("mcp__github__search");
});

it("preserves nested records directly, without fabricating ordinary pending tool calls", () => {
  const nested = {id:"child",name:"bash",arguments:{command:"npm test"},status:"error" as const,durationMs:7,error:"child-specific-error"};
  const parent: StreamEntry={...call,name:"codemode",durationMs:900,imagePath:"/parent.png",nestedCalls:{complete:true,calls:[nested]}};
  const message=ai(1,[parent]);
  const child=buildProcessRecords([{message,entries:[parent]}],false)[1]!;
  expect(child.state).toBe("failed");
  expect(child.entries).toEqual([]);
  expect(child.nested).toBe(nested);
  expect(child.nested?.durationMs).toBe(7);
  expect(child.nested?.error).toBe("child-specific-error");
  expect(child.message).toBe(message);
});
it("keeps original multiline commands in full tooltips while rendering a single-line summary",()=>{
  const command="printf 'a\nb'";
  const activity=toolActivity("bash",{command});
  expect(activity.text).not.toContain("\n");
  expect(activity.fullText).toContain(command);
});
