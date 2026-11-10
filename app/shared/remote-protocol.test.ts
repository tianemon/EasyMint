import { describe, expect, it } from "vitest";
import { parseRemoteEnvelope, remoteCommandEnvelopeSchema } from "./remote-protocol";

describe("remote protocol", () => {
  it("接受版本化命令封装", () => {
    const parsed = remoteCommandEnvelopeSchema.parse({
      version: 1,
      connectionId: "connection-1",
      sequence: 1,
      sentAt: Date.now(),
      kind: "command",
      requestId: "request-1",
      projectId: "project-1",
      payload: { command: "session.list", data: {} },
    });
    expect(parsed.payload.command).toBe("session.list");
  });

  it("拒绝未知协议版本和额外字段", () => {
    expect(() => parseRemoteEnvelope({
      version: 2,
      connectionId: "connection-1",
      sequence: 1,
      sentAt: Date.now(),
      kind: "event",
      payload: {},
    })).toThrow();

    expect(() => parseRemoteEnvelope({
      version: 1,
      connectionId: "connection-1",
      sequence: 1,
      sentAt: Date.now(),
      kind: "event",
      payload: {},
      unexpected: true,
    })).toThrow();
  });

  it("接受列全部项目与打开项目窗口命令", () => {
    for (const command of ["project.list", "project.open"] as const) {
      const parsed = remoteCommandEnvelopeSchema.parse({
        version: 1,
        connectionId: "connection-1",
        sequence: 1,
        sentAt: Date.now(),
        kind: "command",
        requestId: "request-1",
        projectId: "project-1",
        payload: { command, data: {} },
      });
      expect(parsed.payload.command).toBe(command);
    }
  });
});

