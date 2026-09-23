import { describe, expect, it } from "vitest";
import { needsDeferredStop, resolveSendSessionId, shouldSteerSend, stopTarget } from "./chat-utils";

describe("重新生成后立即打断", () => {
  it("新 chatId 尚未返回时不拿旧 id 停止；回包后补发中止并保留提问", () => {
    const intent = {
      awaitingChatId: true,
      preservePromptOnStop: true,
      stopRequested: true,
      abortIssued: false,
    };
    expect(stopTarget("old-chat", intent)).toEqual({ chatId: null, rewind: false });
    expect(needsDeferredStop(intent)).toBe(true);
    intent.abortIssued = true;
    expect(needsDeferredStop(intent)).toBe(false);
  });

  it("新 chatId 已知时直接中止；普通发送沿用无输出撤回", () => {
    expect(stopTarget("new-chat", { awaitingChatId: false, preservePromptOnStop: true }))
      .toEqual({ chatId: "new-chat", rewind: false });
    expect(stopTarget("new-chat", { awaitingChatId: false, preservePromptOnStop: false }))
      .toEqual({ chatId: "new-chat", rewind: true });
  });

  it("旧回合的退出事件不应清掉新回合的待停止请求（同一 chatId 会复用）", () => {
    expect(needsDeferredStop({ stopRequested: true, abortIssued: false })).toBe(true);
  });

  it("撤回成功后的重发不能被残留 busy 状态改送为插话", () => {
    expect(shouldSteerSend({ forceNewTurn: true, busy: true, chatId: "old-chat", existingSession: true })).toBe(false);
    expect(shouldSteerSend({ busy: true, chatId: "old-chat", existingSession: true })).toBe(true);
  });

  it("首条发送回包后旧闭包仍无 existingSid，下一条要接到刚创建的会话", () => {
    const sessionId = resolveSendSessionId(undefined, "created-session", "__new_tab");
    expect(sessionId).toBe("created-session");
    expect(shouldSteerSend({ busy: true, chatId: "chat-1", existingSession: !!sessionId })).toBe(true);
  });
});
