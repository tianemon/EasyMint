import { describe, it, expect } from "vitest";
import { ResultCollector } from "./collector";

function updateEvent(msgId: string, text: string) {
  return {
    type: "message_update",
    message: { id: msgId, role: "assistant", content: [{ type: "text", text }] },
  } as any;
}

function endEvent(msgId: string, text: string) {
  return {
    type: "message_end",
    message: { id: msgId, role: "assistant", content: [{ type: "text", text }] },
  } as any;
}

describe("ResultCollector 消息收集", () => {
  it("多帧累积全文只保留最后一帧(复现旧 push bug)", () => {
    const c = new ResultCollector();
    c.onEvent(updateEvent("m1", "用户在"));
    c.onEvent(updateEvent("m1", "用户在做一个总结性的感慨"));
    expect(c.getText()).toBe("用户在做一个总结性的感慨");
  });

  it("多条消息(多 turn)独立收集,join 不重复", () => {
    const c = new ResultCollector();
    c.onEvent(updateEvent("m1", "第一轮文本"));
    c.onEvent(updateEvent("m2", "第二轮文本"));
    expect(c.getText()).toBe("第一轮文本\n\n第二轮文本");
  });

  it("agent_end 同 id 最终消息覆盖中间快照", () => {
    const c = new ResultCollector();
    c.onEvent(updateEvent("m1", "中间快照"));
    c.onEvent({ type: "agent_end", messages: [{ id: "m1", role: "assistant", content: [{ type: "text", text: "最终完整回复" }] }] } as any);
    expect(c.getText()).toBe("最终完整回复");
  });

  it("空内容帧被忽略,不产生空结果", () => {
    const c = new ResultCollector();
    c.onEvent({ type: "message_update", message: { id: "m1", role: "assistant", content: [] } } as any);
    expect(c.getText()).toBe("");
    c.onEvent(endEvent("m1", "完整"));
    expect(c.getText()).toBe("完整");
  });

  it("buildStructuredOutput 组装 yield 数据", () => {
    const c = new ResultCollector();
    c.onEvent(endEvent("m1", "完成"));
    const out = c.buildStructuredOutput(
      [{ type: "result", data: { files_created: ["a.ts"], summary: "完成" } }],
      { files_created: ["string"], summary: "string" },
    );
    expect(out?.status).toBe("valid");
    expect(out?.data).toMatchObject({ files_created: ["a.ts"], summary: "完成" });
  });

  it("无 yield 或未传 schema 时返回 undefined", () => {
    const c = new ResultCollector();
    expect(c.buildStructuredOutput([], { a: "string" })).toBeUndefined();
    expect(c.buildStructuredOutput([{ data: { a: 1 } }], undefined)).toBeUndefined();
  });
});
