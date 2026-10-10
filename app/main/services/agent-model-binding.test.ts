import { describe, expect, it, vi } from "vitest";
import type { Store } from "./store";
import { AgentService } from "./agent-service";

const mocks = vi.hoisted(() => ({
  model: { provider: "new-provider", id: "new-model", contextWindow: 10000 },
  broadcast: vi.fn(), writeCache: vi.fn(),
}));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("./pi-init", () => ({ getModelRuntime: async () => ({ getModel: () => mocks.model }), getActiveModel: async () => mocks.model }));
vi.mock("./native-config", () => ({ getNativeConfig: async () => ({ resolveProviderId: (id: string) => id }) }));
vi.mock("./session-cache", () => ({ readCache: () => undefined, writeCache: mocks.writeCache }));
vi.mock("./ipc-broadcast", () => ({ broadcast: mocks.broadcast, broadcastEvent: vi.fn() }));

describe("selected model identity binding", () => {
  it("changes provider and model together in the host, cache and UI notification", async () => {
    const store = { getSettings: () => ({ apiProviders: { current: "new-provider", configs: { "new-provider": { id: "new-provider" } } } }) } as unknown as Store;
    const service = new AgentService(store);
    const chat = { chatId: "chat", sessionId: "session", provider: "old-provider", currentModel: "old-model", session: {
      setModel: vi.fn(async () => {}), thinkingLevel: "off", getAvailableThinkingLevels: () => ["off"], getContextUsage: () => ({ contextWindow: 10000, percent: 0, tokens: 0 }),
    } };
    (service as unknown as { activeChats: Map<string, typeof chat> }).activeChats.set("chat", chat);
    await service.setModel("session", "new-model", "new-provider");
    expect(chat.provider).toBe("new-provider"); expect(chat.currentModel).toBe("new-model");
    expect(mocks.writeCache).toHaveBeenCalledWith("session", { provider: "new-provider", model: "new-model" });
    expect(mocks.broadcast).toHaveBeenCalledWith("agent:model-changed", { sessionId: "session", provider: "new-provider", model: "new-model" });
  });
});
