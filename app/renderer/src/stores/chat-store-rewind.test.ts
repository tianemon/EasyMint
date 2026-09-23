import { afterEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chat-store";

const sid = "rewind-ui-test";

afterEach(() => useChatStore.getState().evictSession(sid));

describe("truncateAfter", () => {
  it("撤回后只保留要重发的提问及其前文，同时清掉已删除消息的错误卡", () => {
    useChatStore.getState().loadSession(sid, [
      { id: 1, role: "user", text: "第一问" },
      { id: 2, role: "ai", text: "第一答" },
      { id: 3, role: "user", text: "第二问", entryId: "prompt" },
      { id: 4, role: "ai", text: "旧回答" },
    ]);
    useChatStore.getState().addFlowError(sid, { kind: "round", message: "旧错误", anchorMsgId: 4 });

    useChatStore.getState().truncateAfter(sid, 3);

    expect(useChatStore.getState().messagesBySession[sid]!.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(useChatStore.getState().errorsBySession[sid]).toEqual([]);
    expect(useChatStore.getState().messagesBySession[sid]![2]!.entryId).toBe("prompt");

    // 重发复用这条提问；新答复接在它后面，id 不与已删除的气泡冲突。
    useChatStore.getState().setMessageEntryId(sid, 3, undefined);
    useChatStore.getState().appendUserMsg(sid, { role: "ai", text: "新回答" });
    expect(useChatStore.getState().messagesBySession[sid]!.map((m) => m.text)).toEqual(["第一问", "第一答", "第二问", "新回答"]);
    expect(useChatStore.getState().messagesBySession[sid]![3]!.id).toBeGreaterThan(4);
  });

  it("锚点已被会话切换移除时不裁剪其它消息", () => {
    useChatStore.getState().loadSession(sid, [{ id: 1, role: "user", text: "保留" }]);
    useChatStore.getState().truncateAfter(sid, 99);
    expect(useChatStore.getState().messagesBySession[sid]).toHaveLength(1);
  });
});

describe("truncateFrom", () => {
  it("普通新消息无回答就打断时，页面从该提问起同步撤回", () => {
    useChatStore.getState().loadSession(sid, [
      { id: 1, role: "user", text: "旧提问" },
      { id: 2, role: "ai", text: "旧回答" },
      { id: 3, role: "user", text: "被打断的提问" },
      { id: 4, role: "user", text: "被丢弃的插话" },
    ]);
    useChatStore.getState().addFlowError(sid, { kind: "send", message: "旧错误", anchorMsgId: 4 });

    useChatStore.getState().truncateFrom(sid, 3);

    expect(useChatStore.getState().messagesBySession[sid]!.map((m) => m.id)).toEqual([1, 2]);
    expect(useChatStore.getState().errorsBySession[sid]).toEqual([]);
  });
});
