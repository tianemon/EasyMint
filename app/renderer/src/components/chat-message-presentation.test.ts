import { describe, expect, it } from "vitest";
import { startsMessageIdentity } from "./chat-message-presentation";
import type { ChatMessage } from "./chat-utils";

const ai = (id: number, patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role: "ai", timestamp: id, entries: [{ kind: "text", text: "reply", timestamp: id }], ...patch,
});
const user = (id: number, patch: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "user", timestamp: id, text: "question", ...patch });

const messageIdentityStarts = (messages: ChatMessage[]) => messages.map((_, index) => startsMessageIdentity(messages, index));

describe("message identity presentation", () => {
  it("groups consecutive replies without merging or mutating their action targets", () => {
    const messages = [user(1), ai(2), ai(3), ai(4)];
    const before = structuredClone(messages);
    expect(messageIdentityStarts(messages)).toEqual([true, true, false, false]);
    expect(messages).toEqual(before);
  });
  it("starts a new heading after a question or a system notification", () => {
    expect(messageIdentityStarts([ai(1), user(2), ai(3), user(4, { customType: "system_message" }), ai(5)]))
      .toEqual([true, true, true, true, true]);
  });
  it("keeps agent, model and provider boundaries visible", () => {
    expect(messageIdentityStarts([ai(1), ai(2, { agentRole: "designer" }), ai(3, { agentRole: "designer" }), ai(4), ai(5, { model: "other" }), ai(6, { model: "other", provider: "other" })]))
      .toEqual([true, true, false, true, true, true]);
  });
  it("does not let an invisible streaming placeholder consume the first heading", () => {
    expect(messageIdentityStarts([ai(1, { entries: [] }), ai(2), ai(3, { entries: [] }), ai(4)]))
      .toEqual([true, true, true, false]);
  });
  it.each(["outOfContext", "imageStripped", "forwarded"] as const)("keeps %s identity and warning context visible", flag => {
    expect(messageIdentityStarts([ai(1), ai(2, { [flag]: true }), ai(3)]))
      .toEqual([true, true, true]);
  });
});
