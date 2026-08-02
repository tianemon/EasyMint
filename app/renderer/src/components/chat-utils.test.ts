import { describe, it, expect } from "vitest";
import { mapSessionMessages } from "./chat-utils";

describe("mapSessionMessages 磁盘消息映射", () => {
  it("toolCall 块(磁盘 Pi 原生格式)映射为 tool_use entry", () => {
    const mapped = mapSessionMessages([
      {
        type: "assistant",
        message: {
          created_at: 1000,
          content: [
            { type: "text", text: "我来看看" },
            {
              type: "toolCall",
              id: "call_01",
              name: "read",
              arguments: { path: "/a/b.ts" },
            },
          ],
        },
      },
    ]);
    expect(mapped).toHaveLength(1);
    const entries = mapped[0]!.entries!;
    expect(entries).toHaveLength(2);
    const tool = entries.find((e) => e.kind === "tool_use")!;
    expect(tool.name).toBe("read");
    expect(tool.id).toBe("call_01");
    expect(tool.input).toEqual({ path: "/a/b.ts" });
  });

  it("tool_use 块(流式转换格式,字段 input)同样兼容", () => {
    const mapped = mapSessionMessages([
      {
        type: "assistant",
        message: {
          created_at: 1000,
          content: [
            { type: "tool_use", id: "call_02", name: "bash", input: { command: "ls" } },
          ],
        },
      },
    ]);
    const tool = mapped[0]!.entries![0]! as { kind: string; input?: unknown };
    expect(tool.kind).toBe("tool_use");
    expect(tool.input).toEqual({ command: "ls" });
  });

  it("thinking 块映射为 thinking entry", () => {
    const mapped = mapSessionMessages([
      {
        type: "assistant",
        message: {
          created_at: 1000,
          content: [{ type: "thinking", thinking: "思考中" }],
        },
      },
    ]);
    const e = mapped[0]!.entries![0]! as { kind: string; text?: string };
    expect(e.kind).toBe("thinking");
    expect(e.text).toBe("思考中");
  });
});
