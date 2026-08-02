import { describe, it, expect } from "vitest";
import { systemMessage } from "./prompts";

describe("systemMessage 系统消息结构化构造", () => {
  it("构造 sendCustomMessage 参数:customType 统一 system_message,display: true", () => {
    const payload = systemMessage("delegation", "[系统消息]-[Agent执行结果]\n● T1 — 完成");
    expect(payload.customType).toBe("system_message");
    expect(payload.display).toBe(true);
    expect(payload.content).toContain("[系统消息]");
    expect(payload.details).toEqual({ kind: "delegation" });
  });

  it("kind 细分 + extra 附加字段", () => {
    const payload = systemMessage("shell", "x", { exitCode: 0 });
    expect(payload.details).toEqual({ kind: "shell", exitCode: 0 });
  });

  it("kind 枚举覆盖全部系统消息类型", () => {
    for (const kind of ["delegation", "shell", "project-created", "flow", "handoff", "summary"] as const) {
      const payload = systemMessage(kind, "content");
      expect(payload.details.kind).toBe(kind);
    }
  });
});
