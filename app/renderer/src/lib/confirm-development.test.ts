import { expect, it } from "vitest";
import { hasConfirmDevelopment, matchesConfirmDevelopment } from "./confirm-development";
it("isolates requests between projects and chats and rejects legacy unscoped events", () => {
  const request = { projectPath: "/a", sessionId: "one" };
  expect(matchesConfirmDevelopment(request, "/a", "one")).toBe(true);
  expect(matchesConfirmDevelopment(request, "/a", "two")).toBe(false);
  expect(matchesConfirmDevelopment(request, "/b", "one")).toBe(false);
  expect(matchesConfirmDevelopment(request, "/a", null)).toBe(false);
  expect(matchesConfirmDevelopment({} as never, "/a", "one")).toBe(false);
});
it("restores only the matching successful confirmation, not failed or pending calls", () => {
  const use = { kind: "tool_use", id: "call", name: "show_confirm_dev" };
  const result = { kind: "tool_result", toolUseId: "call", content: "Development confirmation ready" };
  expect(hasConfirmDevelopment([use])).toBe(false);
  expect(hasConfirmDevelopment([use, { ...result, toolUseId: "other" }])).toBe(false);
  expect(hasConfirmDevelopment([use, { ...result, isError: true }])).toBe(false);
  expect(hasConfirmDevelopment([use, { ...result, content: "请先准备 task.json" }])).toBe(false);
  expect(hasConfirmDevelopment([use, result])).toBe(true);
  expect(hasConfirmDevelopment([{ ...use, name: "other_tool" }, result])).toBe(false);
  expect(hasConfirmDevelopment([{ ...use, id: undefined }, { ...result, toolUseId: undefined }])).toBe(false);
});

it("restores a successful request through actual history mapping even after an AI explanation", async () => {
  const { mapSessionMessages } = await import("../components/chat-utils");
  const { confirmationEntries } = await import("./confirm-development");
  const history = mapSessionMessages([
    { type: "user", message: { role: "user", content: "Prepare development" } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "ready", name: "show_confirm_dev", input: {} }] } },
    { type: "toolResult", message: { toolCallId: "ready", toolName: "show_confirm_dev", content: [{ type: "text", text: "Development confirmation ready" }], isError: false } },
    { type: "assistant", message: { content: [{ type: "text", text: "The plan is ready. Confirm to begin." }] } },
  ]);
  expect(hasConfirmDevelopment(history.at(-1)!.entries ?? [])).toBe(false);
  expect(hasConfirmDevelopment(confirmationEntries(history))).toBe(true);
  const consumed = history.map(message => ({ ...message, entries: message.entries?.filter(entry => !(entry.kind === "tool_use" && entry.name === "show_confirm_dev")) }));
  expect(hasConfirmDevelopment(confirmationEntries(consumed))).toBe(false);
  expect(hasConfirmDevelopment(confirmationEntries([...history, { role: "user" }]))).toBe(false);
});
