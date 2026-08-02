import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "./chat-store";

describe("chat-store 流式消息锚定", () => {
  beforeEach(() => {
    useChatStore.setState({ messagesBySession: {}, msgIdBySession: {} });
  });

  it("历史会话后新 turn：两帧累计全文只保留最后一帧（复现旧拼接 bug）", () => {
    // 历史会话：user + ai（2 条 entries，模拟上轮 AI 回复）
    useChatStore.getState().loadSession("s1", [
      { id: 1, role: "user", text: "旧问题" },
      { id: 2, role: "ai", entries: [{ kind: "text", text: "旧回答A" }, { kind: "tool_use", id: "t1", name: "read", input: {} }] },
    ]);
    // 用户发新消息 → store 最后一条是 user 消息（旧实现的 turnIdx 从此处开始错位）
    useChatStore.getState().appendUserMsg("s1", { role: "user", text: "在做一个总结性的感慨" });
    // turn_start → 创建本 turn 锚点消息
    const msgId = useChatStore.getState().startAiMessage("s1");
    // message 帧 1：部分文本
    useChatStore.getState().replaceAiEntriesById("s1", msgId, [{ kind: "text", text: "用户在" }]);
    // message 帧 2：Pi 发的是累积全文 → 全量替换，不允许拼接出重复
    useChatStore.getState().replaceAiEntriesById("s1", msgId, [{ kind: "text", text: "用户在做一个总结性的感慨" }]);

    const msgs = useChatStore.getState().messagesBySession["s1"]!;
    expect(msgs).toHaveLength(4);
    const ai = msgs.find((m) => m.id === msgId)!;
    expect(ai.entries).toHaveLength(1);
    expect(ai.entries![0]!.text).toBe("用户在做一个总结性的感慨");
    // 历史 AI 消息未被触碰
    expect(msgs.find((m) => m.id === 2)!.entries).toHaveLength(2);
  });

  it("同一 turn 内 message 帧全量替换：thinking 先到、text 帧后到不叠加", () => {
    const msgId = useChatStore.getState().startAiMessage("s1");
    // thinking 事件先到
    useChatStore.getState().appendAiEntryById("s1", msgId, { kind: "thinking", text: "思考中", timestamp: 1 });
    // message 帧（blocks 含 thinking + text 完整快照）→ 全量替换
    useChatStore.getState().replaceAiEntriesById("s1", msgId, [
      { kind: "thinking", text: "思考中", timestamp: 2 },
      { kind: "text", text: "最终回答", timestamp: 2 },
    ]);
    // 再来的 thinking 累积全文 → 替换已有 thinking 条目
    useChatStore.getState().appendAiEntryById("s1", msgId, { kind: "thinking", text: "思考完毕", timestamp: 3 });

    const msgs = useChatStore.getState().messagesBySession["s1"]!;
    const ai = msgs[msgs.length - 1]!;
    expect(ai.entries).toHaveLength(2);
    expect(ai.entries![0]!.text).toBe("思考完毕");
    expect(ai.entries![1]!.text).toBe("最终回答");
  });

  it("replaceAiEntriesById 锚点不存在时回退到最后一条 AI 或新建", () => {
    useChatStore.getState().appendUserMsg("s1", { role: "user", text: "hi" });
    const id = useChatStore.getState().replaceAiEntriesById("s1", 999, [{ kind: "text", text: "回复" }]);
    const msgs = useChatStore.getState().messagesBySession["s1"]!;
    expect(msgs[msgs.length - 1]!.id).toBe(id);
    expect(msgs[msgs.length - 1]!.entries).toEqual([{ kind: "text", text: "回复" }]);
    expect(msgs[msgs.length - 1]!.streaming).toBe(true);
  });

  it("appendAiEntry 兜底（无锚点路径）：文本拼接不重复创建条目", () => {
    const id = useChatStore.getState().appendAiEntry("s1", { kind: "text", text: "第一段", timestamp: 1 });
    useChatStore.getState().appendAiEntryById("s1", id, { kind: "text", text: "第二段", timestamp: 2 });
    const msgs = useChatStore.getState().messagesBySession["s1"]!;
    const ai = msgs.find((m) => m.id === id)!;
    expect(ai.entries).toHaveLength(1);
    expect(ai.entries![0]!.text).toBe("第一段第二段");
  });

  it("loadSession 合并排除 streaming 临时消息（磁盘数据是真相源）", () => {
    const id = useChatStore.getState().startAiMessage("s1");
    useChatStore.getState().replaceAiEntriesById("s1", id, [{ kind: "text", text: "流式中的临时内容" }]);
    // 磁盘落盘后的最终消息
    useChatStore.getState().loadSession("s1", [
      { id: 1, role: "user", text: "问题" },
      { id: 2, role: "ai", entries: [{ kind: "text", text: "最终落盘内容" }] },
    ]);
    const msgs = useChatStore.getState().messagesBySession["s1"]!;
    // streaming 临时消息被排除，只有磁盘消息
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.entries![0]!.text).toBe("最终落盘内容");
  });
});
