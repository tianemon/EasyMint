import { describe, expect, it, vi } from "vitest";
import { SessionCoordinator } from "./session-coordinator";
import { getSessionInfo, getSessionMessages } from "./session-service";
import type { AgentService } from "./agent-service";
import type { ProjectService } from "./project-service";

vi.mock("./agent-service", () => ({ getPendingAskSnapshots: () => [] }));
vi.mock("./window-manager", () => ({ listOpenProjectIds: () => ["project-1"] }));
vi.mock("./session-service", () => ({
  getSessionInfo: vi.fn(),
  getSessionMessages: vi.fn(),
}));
vi.mock("./session-cache", () => ({ readCache: () => null }));
vi.mock("./background-shell/registry", () => ({ backgroundShellRegistry: { list: () => [] } }));
vi.mock("./task/registry", () => ({ getRunningSummary: () => ({ tasks: [] }) }));

describe("远程快照 usage", () => {
  it("assistant 历史消息与流式事件字段一致，不修改桌面读取到的原对象", async () => {
    const nativeMessage = { role: "assistant", content: [], usage: { input: 12, output: 8, cacheRead: 4, cacheWrite: 2 } };
    const nativeEntry = { type: "assistant", uuid: "a", session_id: "s", message: nativeMessage, parent_tool_use_id: null };
    vi.mocked(getSessionInfo).mockResolvedValue({ sessionId: "s" } as Awaited<ReturnType<typeof getSessionInfo>>);
    vi.mocked(getSessionMessages).mockResolvedValue([nativeEntry] as Awaited<ReturnType<typeof getSessionMessages>>);
    const coordinator = new SessionCoordinator(
      { get: () => ({ id: "project-1", path: "/tmp/p", exists: true }) } as unknown as ProjectService,
      { getChatStatus: () => "idle", getThinkingInfo: () => null, peekBufferedStream: () => [] } as unknown as AgentService,
    );

    const snapshot = await coordinator.getSessionSnapshot("project-1", "s");
    expect((snapshot.messages[0].message as typeof nativeMessage).usage).toEqual({
      inputTokens: 12, outputTokens: 8, cacheReadTokens: 4, cacheWriteTokens: 2,
    });
    expect(nativeMessage.usage).toEqual({ input: 12, output: 8, cacheRead: 4, cacheWrite: 2 });
  });
});
