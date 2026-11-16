import { expect, it } from "vitest";
import { digestMessages, renderSessionFallback, worthRemembering } from "./session-digest";

const messages = [
  { role: "user", text: "你好" },
  { role: "assistant", text: "你好，我是 Mint。" },
  { role: "user", text: "把记忆模块的注入改成尾部增量，别动系统前缀" },
  { role: "assistant", text: "已改成尾部增量：内容未变不注入，变了只发差量。" },
];

it("轮数只算助手有结论的条目，并取最后一轮问答", () => {
  const digest = digestMessages(messages);
  expect(digest.turns).toBe(2);
  expect(digest.lastUser).toContain("尾部增量");
  expect(digest.lastAssistant).toContain("只发差量");
});

it("超长文本截断，避免把整段结论搬进项目背景", () => {
  const digest = digestMessages([{ role: "assistant", text: "长".repeat(500) }]);
  expect(digest.lastAssistant!.length).toBeLessThanOrEqual(160);
  expect(digest.lastAssistant!.endsWith("…")).toBe(true);
});

it("纯问候不算值得记的项目进展", () => {
  expect(worthRemembering(digestMessages([{ role: "user", text: "你好" }, { role: "assistant", text: "在" }]))).toBe(false);
  expect(worthRemembering(digestMessages(messages))).toBe(true);
});

it("轮数不足时也判为不值得记", () => {
  expect(worthRemembering({ turns: 1, lastUser: "改一下注入顺序" }, 2)).toBe(false);
});

it("降级文本只给路标，不复述技术细节", () => {
  const text = renderSessionFallback(digestMessages(messages));
  expect(text).toContain("上次会话你的要求：");
  expect(text).toContain("上次结论：");
  expect(text.split("\n")).toHaveLength(2);
});

it("空会话不产出任何文本", () => {
  const empty = digestMessages([]);
  expect(empty).toEqual({ turns: 0 });
  expect(renderSessionFallback(empty)).toBe("");
});
