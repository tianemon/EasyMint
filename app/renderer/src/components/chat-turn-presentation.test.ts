import { describe, expect, it } from "vitest";
import { buildTurnPresentations, buildFinalAnswerEntries, executionLabel, runningTurnPosition } from "./chat-turn-presentation";
import { mapSessionMessages, mergeConsecutiveText, piBlocksToEntries, type ChatMessage } from "./chat-utils";
import type { StreamEntry } from "./StreamPanel";
const text = (text: string, phase?: "commentary" | "final_answer"): StreamEntry => ({ kind: "text", text, phase, timestamp: 0 });
const ai = (id: number, entries: StreamEntry[], patch: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "ai", timestamp: id * 1000, entries, stopReason: "stop", ...patch });
const question: ChatMessage = { id: 1, role: "user", text: "question", timestamp: 0 };

describe("completed turn presentation", () => {
  it("retains all text blocks in the terminal message and preserves source records", () => {
    const messages = [question, ai(2, [text("checking")]), ai(3, [text("answer"), text("code")], { durationMs: 1800 })];
    const before = structuredClone(messages);
    const turn = buildTurnPresentations(messages, false).get(1)!;
    expect(turn.finalEntries.get(2)).toEqual(messages[2]!.entries);
    expect(turn.finalEntries.has(1)).toBe(false);
    expect(turn.durationMs).toBe(4800);
    expect(messages).toEqual(before);
  });
  it("separates explicitly tagged commentary within the same message", () => {
    const messages = [question, ai(2, [text("checking", "commentary"), text("answer", "final_answer"), text("details", "final_answer")])];
    expect(buildTurnPresentations(messages, false).get(1)?.finalEntries.get(1)).toEqual(messages[1]!.entries!.slice(1));
  });
  it("waits for settlement even after a model message finishes", () => {
    const messages = [ai(1, [text("checking")]), ai(2, [text("answer")], { streaming: true })];
    expect(buildTurnPresentations(messages, false).size).toBe(0);
    messages[1]!.turnOutcome = "completed";
    const running = buildTurnPresentations(messages, true);
    expect(running.size).toBe(2);
    expect(running.get(1)?.active).toBe(true);
    expect(buildFinalAnswerEntries(messages, true).size).toBe(0);
    expect(buildTurnPresentations(messages, false).size).toBe(2);
  });
  it.each(["error", "aborted", "length", "toolUse"])("keeps %s output visible", stopReason => {
    expect(buildTurnPresentations([ai(1, [text("checking")]), ai(2, [text("partial")], { stopReason, turnOutcome: "completed" })], false).size).toBe(0);
  });
  it("never treats earlier commentary as a final answer", () => {
    expect(buildFinalAnswerEntries([ai(1, [text("checking")]), ai(2, [{ kind: "thinking", text: "reasoning", timestamp: 0 }])], false).size).toBe(0);
    expect(buildFinalAnswerEntries([ai(1, [text("checking")]), ai(2, [text("checking", "commentary")])], false).size).toBe(0);
  });
  it("keeps unanswered tool requests visible", () => {
    const call: StreamEntry = { kind: "tool_use", id: "ask", name: "ask_user", input: {}, collapsed: true, timestamp: 0 };
    expect(buildTurnPresentations([ai(1, [call]), ai(2, [text("answer")])], false).size).toBe(0);
  });
  it("allows completed tool history to fold without changing inner collapse state", () => {
    const entries: StreamEntry[] = [{ kind: "tool_use", id: "read", name: "read", input: {}, collapsed: true, timestamp: 0 }, { kind: "tool_result", toolUseId: "read", content: "file", isError: false, timestamp: 0 }];
    const messages = [ai(1, entries), ai(2, [text("answer")])];
    expect(buildTurnPresentations(messages, false).size).toBe(2);
    expect(entries[0]).toHaveProperty("collapsed", true);
  });
  it("does not create an empty execution row for plain replies", () => {
    expect(buildTurnPresentations([question, ai(2, [text("answer")])], false).size).toBe(0);
  });
  it("keeps older completed turns folded while the current turn runs", () => {
    const messages = [ai(1, [text("checking")]), ai(2, [text("answer")]), question, ai(4, [text("running")])];
    const turns = buildTurnPresentations(messages, true);
    expect([...turns.keys()]).toEqual([0, 1, 3]);
    expect(turns.get(3)?.active).toBe(true);
    expect(turns.get(3)?.finalEntries.size).toBe(0);
  });
  it("does not fold uncertain legacy or failed turns", () => {
    expect(buildTurnPresentations([ai(1, [text("checking")]), ai(2, [text("answer")], { stopReason: undefined })], false).size).toBe(0);
    expect(buildTurnPresentations([ai(1, [text("checking")]), ai(2, [text("answer")], { turnOutcome: "failed" })], false).size).toBe(0);
  });
  it("folds an interrupted turn and keeps only an explicitly tagged conclusion visible", () => {
    const entries = [text("working", "commentary"), text("partial answer", "final_answer")];
    const turn = buildTurnPresentations([question, ai(2, entries, { turnOutcome: "cancelled", stopReason: "aborted", turnDurationMs: 9000 })], false).get(1)!;
    expect(turn.interrupted).toBe(true);
    expect(turn.durationMs).toBe(9000);
    expect(turn.finalEntries.get(1)).toEqual([entries[1]]);
  });
  it("folds interrupted commentary and pending tools without inventing a conclusion", () => {
    const call: StreamEntry = { kind: "tool_use", id: "bash", name: "bash", input: {}, collapsed: true, timestamp: 0 };
    const turn = buildTurnPresentations([question, ai(2, [text("working", "commentary"), call], { turnOutcome: "cancelled", stopReason: "aborted", turnDurationMs: 3000 })], false).get(1)!;
    expect(turn.interrupted).toBe(true);
    expect(turn.finalEntries.size).toBe(0);
    expect(turn.durationMs).toBe(3000);
  });
  it("folds a completed run that produced process text but no conclusion", () => {
    const turn = buildTurnPresentations([question, ai(2, [text("only commentary", "commentary")], { turnOutcome: "completed", turnDurationMs: 2000 })], false).get(1)!;
    expect(turn.finalEntries.size).toBe(0);
    expect(turn.interrupted).toBe(false);
  });
  it("folds an interrupted run even when it contains an error entry", () => {
    const entries: StreamEntry[] = [{ kind: "thinking", text: "reasoning", timestamp: 0 }, { kind: "error", data: "aborted", timestamp: 1 }];
    const turn = buildTurnPresentations([question, ai(2, entries, { turnOutcome: "cancelled", stopReason: "aborted" })], false).get(1)!;
    expect(turn.interrupted).toBe(true);
    expect(turn.finalEntries.size).toBe(0);
  });
  it("switches directly from active preview to interrupted folding while busy is still settling", () => {
    const messages = [question, ai(2, [{ kind: "thinking", text: "reasoning", timestamp: 0 }], { streaming: true, stopReason: undefined })];
    expect(buildTurnPresentations(messages, true).get(1)?.active).toBe(true);
    messages[1] = { ...messages[1]!, turnOutcome: "cancelled", stopReason: "aborted" };
    const settled = buildTurnPresentations(messages, true).get(1)!;
    expect(settled.active).toBeUndefined();
    expect(settled.interrupted).toBe(true);
  });
  it("keeps the disclosure key stable when an entry id is backfilled", () => {
    const messages = [question, ai(2, [text("working", "commentary")], { streaming: true, stopReason: undefined })];
    const before = buildTurnPresentations(messages, true).get(1)!.key;
    messages[1] = { ...messages[1]!, entryId: "uuid-after-start" };
    expect(buildTurnPresentations(messages, true).get(1)!.key).toBe(before);
  });
  it("presents all unsettled segments of the current execution as one running group", () => {
    const call: StreamEntry = { kind: "tool_use", id: "read", name: "read", input: {}, collapsed: true, timestamp: 0 };
    const notice: ChatMessage = { id: 3, role: "user", customType: "system_message", details: { kind: "delegation", startsExecution: true }, timestamp: 3000 };
    const messages = [question, ai(2, [{ kind: "thinking", text: "first", timestamp: 0 }, call], { stopReason: "toolUse", timestamp: 2000 }),
      notice, ai(4, [{ kind: "thinking", text: "second", timestamp: 0 }], { streaming: true, stopReason: undefined, timestamp: 4000 })];
    const turns = buildTurnPresentations(messages, true);
    const turn = turns.get(1)!;
    expect(turn.active).toBe(true);
    expect(turn.first).toBe(1);
    expect(turns.get(3)).toBe(turn);
  });
  it("folds in-run notifications but leaves later background events independent", () => {
    const notification = { ...question, id: 3, customType: "system_message", details: { kind: "summary" } };
    const messages = [ai(2, [text("checking")]), notification, ai(4, [text("answer")]), { ...notification, id: 5 }];
    expect([...buildTurnPresentations(messages, false).keys()]).toEqual([0, 1, 2]);
  });
  it("formats known elapsed time and leaves unknown time unspecified", () => {
    expect(executionLabel(undefined, false)).toBe("执行过程");
    expect(executionLabel(138000, false)).toBe("用时 2分钟 18秒");
    expect(executionLabel(9000, false, false, true)).toBe("执行了 9 秒被打断");
    expect(executionLabel(undefined, false, false, true)).toBe("执行过程（已打断）");
  });
});

describe("segmented execution settlement", () => {
  it.each(["steer", "system"])("keeps %s segments together after completion and history reload", trigger => {
    const boundary: ChatMessage = { id: 3, role: "user", timestamp: 2000, text: "continue",
      ...(trigger === "system" ? { customType: "system_message", details: { kind: "delegation", startsExecution: true } } : {}) };
    const messages = [question,
      ai(2, [text("first progress", "commentary")], { stopReason: "toolUse" }), boundary,
      ai(4, [text("second progress", "commentary")], { streaming: true, stopReason: undefined })];
    const key = buildTurnPresentations(messages, true).get(1)!.key;
    messages[3] = { ...messages[3]!, streaming: false, stopReason: "stop", turnOutcome: "completed", durationMs: 2000,
      entries: [text("second progress", "commentary"), text("answer", "final_answer")] };
    // Reloaded records have stop reasons, but no live turnOutcome metadata.
    for (const snapshot of [messages, messages.map(message => ({ ...message, turnOutcome: undefined }))]) {
      const turns = buildTurnPresentations(snapshot, false);
      expect(turns.get(1)?.key).toBe(key);
      expect(turns.get(3)).toBe(turns.get(1));
      expect(turns.get(1)?.active).toBeFalsy();
      expect(turns.get(1)?.durationMs).toBe(6000);
      expect([...buildFinalAnswerEntries(snapshot, false).keys()]).toEqual([3]);
    }
  });

  it.each([false, true])("keeps all segments folded after cancellation (busy=%s)", busy => {
    const messages = [question,
      ai(2, [text("first progress", "commentary")], { stopReason: "toolUse" }),
      { ...question, id: 3, timestamp: 2000 },
      ai(4, [text("second progress", "commentary")], { streaming: true, stopReason: undefined })];
    const key = buildTurnPresentations(messages, true).get(1)!.key;
    messages[3] = { ...messages[3]!, streaming: false, stopReason: "aborted", turnOutcome: "cancelled" };
    const turns = buildTurnPresentations(messages, busy);
    expect(turns.get(1)?.key).toBe(key);
    expect(turns.get(3)).toBe(turns.get(1));
    expect(turns.get(1)?.interrupted).toBe(true);
    expect(turns.get(1)?.finalEntries.size).toBe(0);
    expect(runningTurnPosition(messages)?.startedAt).toBe(0);
    const reloaded = messages.map(message => ({ ...message, turnOutcome: undefined }));
    expect(buildTurnPresentations(reloaded, false).get(1)?.interrupted).toBe(true);
  });

  it("settles earlier segmented executions independently of a new running prompt", () => {
    const messages = [question,
      ai(2, [text("first progress", "commentary")], { stopReason: "toolUse" }),
      { ...question, id: 3 }, ai(4, [text("answer")], { turnOutcome: "completed" }),
      { ...question, id: 5 }, ai(6, [text("new progress")], { streaming: true, stopReason: undefined })];
    const turns = buildTurnPresentations(messages, true);
    expect(turns.get(1)).toBeDefined();
    expect(turns.get(1)).toBe(turns.get(3));
    expect(turns.get(1)?.active).toBeFalsy();
    expect(turns.get(5)?.active).toBe(true);
    expect(turns.get(5)?.key).not.toBe(turns.get(1)?.key);
    expect(buildFinalAnswerEntries(messages, true).get(3)).toEqual(messages[3]!.entries);
  });
});

describe("phase and terminal metadata", () => {
  it("preserves live phases without merging commentary into the final answer", () => {
    const entries = piBlocksToEntries([{ type: "text", text: "checking", phase: "commentary" }, { type: "text", text: "answer", phase: "final_answer" }]);
    expect(mergeConsecutiveText(entries)).toHaveLength(2);
  });
  it("restores phases and stop reason from saved messages", () => {
    const messages = mapSessionMessages([{ type: "assistant", message: { content: [{ type: "text", text: "answer", textSignature: '{"v":1,"id":"x","phase":"final_answer"}' }], stopReason: "stop", timestamp: 1 } }]);
    expect(messages[0]?.entries?.[0]).toHaveProperty("phase", "final_answer");
    expect(messages[0]?.stopReason).toBe("stop");
  });
  it("keeps an aborted turn folded after reopening history", () => {
    const messages = mapSessionMessages([
      { type: "user", message: { content: "question", timestamp: 1 } },
      { type: "assistant", message: { content: [{ type: "text", text: "working" }], stopReason: "aborted", timestamp: 5000 } },
    ]);
    const turn = buildTurnPresentations(messages, false).get(1)!;
    expect(turn.interrupted).toBe(true);
    expect(turn.finalEntries.size).toBe(0);
  });
  it("does not lose an empty error ending when loading history", () => {
    const messages = mapSessionMessages([{ type: "assistant", message: { content: [{ type: "text", text: "checking" }], stopReason: "stop" } }, { type: "assistant", message: { content: [], stopReason: "error" } }]);
    expect(messages[0]?.stopReason).toBe("error");
  });
});

it("formats the live clock and locates it before the first assistant output", () => {
  expect(executionLabel(0, false, true)).toBe("已执行 0分钟 0秒");
  expect(executionLabel(61000, false, true)).toBe("已执行 1分钟 1秒");
  expect(runningTurnPosition([question])).toEqual({ first: -1, startedAt: 0 });
  expect(runningTurnPosition([question, ai(2, [text("checking")]), ai(3, [text("reply")])])).toEqual({ first: 1, startedAt: 0 });
});


describe("system-triggered execution boundaries", () => {
  const notice = (id: number, kind: string, startsExecution?: boolean): ChatMessage => ({
    id, role: "user", customType: "system_message", timestamp: 600000,
    details: { kind, ...(startsExecution === undefined ? {} : { startsExecution }) },
  });
  const prior = () => [question, ai(2, [text("checking")], { stopReason: "toolUse" }),
    ai(3, [text("original conclusion")], { turnOutcome: "completed", durationMs: 1000 })];

  it.each([true, undefined])("preserves prior conclusions during and after a learn continuation (marker=%s)", marker => {
    const messages = [...prior(), notice(4, "learn", marker)];
    const running = buildTurnPresentations(messages, true);
    expect(running.get(1)?.finalEntries.get(2)?.[0]).toHaveProperty("text", "original conclusion");
    expect(runningTurnPosition(messages)).toEqual({ first: -1, startedAt: 600000 });
    messages.push(ai(5, [text("evaluating")], { timestamp: 601000, stopReason: "toolUse" }),
      ai(6, [text("learn conclusion")], { timestamp: 602000, durationMs: 1000 }));
    const finished = buildTurnPresentations(messages, false);
    expect(finished.get(1)?.finalEntries.get(2)?.[0]).toHaveProperty("text", "original conclusion");
    expect(finished.get(4)?.finalEntries.get(5)?.[0]).toHaveProperty("text", "learn conclusion");
    expect(finished.get(4)?.durationMs).toBe(3000);
    expect(finished.get(1)?.key).not.toBe(finished.get(4)?.key);
  });
  it("keeps explicitly marked in-run notifications in their current execution", () => {
    const messages = [question, ai(2, [text("checking")]), notice(3, "delegation", false), ai(4, [text("answer")])];
    const turns = buildTurnPresentations(messages, false);
    expect([...turns.keys()]).toEqual([1, 2, 3]);
    expect(turns.get(1)?.finalEntries.has(3)).toBe(true);
    expect(runningTurnPosition(messages)).toEqual({ first: 1, startedAt: 0 });
  });
  it("protects unmarked legacy answers before a background continuation", () => {
    const messages = [question, ai(2, [text("checking")]), ai(3, [text("original conclusion")]),
      notice(4, "shell"), ai(5, [text("background conclusion")])];
    const turns = buildTurnPresentations(messages, false);
    expect(turns.get(1)?.finalEntries.get(2)?.[0]).toHaveProperty("text", "original conclusion");
    expect(turns.has(4)).toBe(false); // A plain independent reply needs no fold heading.
    expect(runningTurnPosition(messages)).toEqual({ first: 4, startedAt: 600000 });
  });
  it("starts initialization timing before any assistant output", () => {
    expect(runningTurnPosition([notice(1, "project-created")])).toEqual({ first: -1, startedAt: 600000 });
  });
  it("retains execution markers when reopening a saved session", () => {
    const messages = mapSessionMessages([{ type: "user", message: { content: "background result", customType: "system_message", details: { kind: "shell", startsExecution: true }, timestamp: 600000 } }]);
    expect(runningTurnPosition(messages)).toEqual({ first: -1, startedAt: 600000 });
  });
});

it("keeps the active execution start anchored while thinking and tool messages are appended", () => {
  const messages = [question, ai(2, [text("checking", "commentary")], { stopReason: "toolUse" })];
  expect(runningTurnPosition(messages)?.first).toBe(1);
  messages.push(ai(3, [{kind:"thinking",text:"reasoning",timestamp:0}], {stopReason:"toolUse"}));
  messages.push(ai(4, [text("working", "commentary")], {streaming:true,stopReason:undefined}));
  expect(runningTurnPosition(messages)?.first).toBe(1);
  expect(buildFinalAnswerEntries(messages,true).size).toBe(0);
});

it("keeps the execution disclosure key stable from running to completion", () => {
  const thinking: StreamEntry = { kind: "thinking", text: "reasoning", timestamp: 0 };
  const messages = [question, ai(2, [thinking, text("working", "commentary")], { streaming: true, stopReason: undefined })];
  const running = buildTurnPresentations(messages, true).get(1)!;
  expect(running.active).toBe(true);
  messages[1] = { ...messages[1]!, entries: [thinking, text("working", "commentary"), text("answer", "final_answer")], streaming: false, stopReason: "stop", turnOutcome: "completed" };
  const completed = buildTurnPresentations(messages, false).get(1);
  expect(completed?.key).toBe(running.key);
  expect(completed?.active).toBeUndefined();
});
