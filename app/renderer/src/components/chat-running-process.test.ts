import { describe, expect, it } from "vitest";
import { buildRunningProcessSlices } from "./chat-running-process";
import { buildTurnPresentations } from "./chat-turn-presentation";
import { displayToolAction, type ChatMessage } from "./chat-utils";
import type { StreamEntry, TextEntry } from "./StreamPanel";

const text = (text: string): TextEntry => ({ kind: "text", text, timestamp: 0 });
const thought: StreamEntry = { kind: "thinking", text: "reasoning", timestamp: 0 };
const call = (id: string, name = "bash"): StreamEntry => ({ kind: "tool_use", id, name, input: { command: "npm test" }, collapsed: true, timestamp: 0 });
const result = (toolUseId: string): StreamEntry => ({ kind: "tool_result", toolUseId, content: "done", isError: false, timestamp: 0 });
const ai = (id: number, entries: StreamEntry[]): ChatMessage => ({ id, role: "ai", entries, timestamp: id, streaming: true });
const slices = (messages: ChatMessage[]) => buildRunningProcessSlices(messages, buildTurnPresentations(messages, true));

describe("ordered running process", () => {
  it("folds separate tool/thought segments around each intermediate conclusion", () => {
    const messages = [ai(1, [thought, call("a"), result("a"), text("first conclusion"), thought, call("b"), result("b"), text("second conclusion"), thought])];
    const before = structuredClone(messages);
    const row = slices(messages).get(0)!;
    expect(row.map(slice => [!!slice.key, !!slice.header, slice.entries.length])).toEqual([
      [true, true, 3], [false, false, 1], [true, true, 3], [false, false, 1], [true, true, 1],
    ]);
    expect(new Set(row.filter(slice => slice.key).map(slice => slice.key)).size).toBe(3);
    expect(messages).toEqual(before);
  });

  it("shares one disclosure across message rows and keeps its key during stream growth", () => {
    const messages = [ai(1, [thought]), ai(2, [call("a"), result("a")]), ai(3, [text("progress")])];
    const rows = slices(messages);
    expect(rows.get(0)?.[0]?.key).toBe(rows.get(1)?.[0]?.key);
    expect(rows.get(1)?.[0]?.header).toBe(false);
    messages[0] = ai(1, [{ ...thought, text: "more reasoning" }]);
    expect(slices(messages).get(0)?.[0]?.key).toBe(rows.get(0)?.[0]?.key);
    expect(rows.get(2)?.[0]?.key).toBeUndefined();
  });

  it("keeps questions and their answers in order while running, folds them after completion", () => {
    const ask = call("ask", "ask_user");
    const answer = result("ask");
    const final = { ...text("final conclusion"), phase: "final_answer" as const };
    const messages = [ai(1, [thought, ask]), ai(2, [answer, thought, text("intermediate"), call("a"), result("a"), final])];
    const rows = slices(messages);
    expect(rows.get(0)?.[1]).toMatchObject({ entries: [ask], key: undefined });
    expect(rows.get(1)?.[0]).toMatchObject({ entries: [answer], key: undefined });
    messages[1] = { ...messages[1]!, streaming: false, stopReason: "stop", turnOutcome: "completed" };
    const completed = buildTurnPresentations(messages, false);
    expect(buildRunningProcessSlices(messages, completed).size).toBe(0);
    expect(completed.get(0)?.finalEntries.get(1)).toEqual([final]);
    expect(completed.get(0)?.finalEntries.has(0)).toBe(false);
  });

  it("does not absorb user messages sent during execution", () => {
    const messages = [ai(1, [thought]), { id: 2, role: "user" as const, timestamp: 2, text: "clarification" }, ai(3, [thought, text("progress")])];
    const rows = slices(messages);
    expect(rows.has(1)).toBe(false);
    expect(rows.get(0)?.[0]?.key).not.toBe(rows.get(2)?.[0]?.key);
  });

  it("leaves pending questions to the interactive live card instead of duplicating their input", () => {
    const row = slices([ai(1, [thought, call("pending", "ask_user")])]).get(0)!;
    expect(row.flatMap(slice => slice.entries)).toEqual([thought]);
  });

  it("keeps only the latest final conclusion when a run resumes after an earlier final phase", () => {
    const messages = [ai(1, [{ ...text("earlier conclusion"), phase: "final_answer" }, call("a"), result("a")]),
      { ...ai(2, [{ ...text("latest conclusion"), phase: "final_answer" }]), streaming: false, stopReason: "stop", turnOutcome: "completed" as const }];
    const turn = buildTurnPresentations(messages, false).get(0)!;
    expect([...turn.finalEntries.keys()]).toEqual([1]);
    expect(turn.finalEntries.get(1)).toEqual(messages[1]!.entries);
  });
});

it("shows concrete commands and external tool names without embedded newlines", () => {
  expect(displayToolAction("bash", { command: "npm test\n-- --run" })).toContain("bash · npm test -- --run");
  expect(displayToolAction("mcp__github__search")).toContain("mcp__github__search");
  expect(displayToolAction("read", { path: "/project/readme.md" })).toContain("/project/readme.md");
});
