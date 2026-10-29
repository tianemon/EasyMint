import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Store } from "./store";
import { AgentService } from "./agent-service";

/**
 * 供应商与模型的归属规则（用户 2026-10-29 定）：
 * 1. **切换供应商 → 全部会话生效**：活跃会话重绑到新供应商（原模型名在新供应商下不存在时用它的默认模型）
 * 2. **只切模型 → 只影响该会话**，不动全局默认模型
 * 3. 解析不到模型时**抛错**而不是静默保留旧模型——静默会让界面显示与真实请求不一致
 *
 * 回归背景：旧实现按 `chat.provider` 优先解析，切换供应商后旧会话继续打旧供应商；
 * 渲染层 `.catch(() => {})` 又把失败吞掉，Codex 额度耗尽时才被发现。
 */

const mocks = vi.hoisted(() => ({
  models: new Map<string, { provider: string; id: string; contextWindow: number }>(),
  broadcast: vi.fn(),
  writeCache: vi.fn(),
}));

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("./pi-init", () => ({
  getModelRuntime: async () => ({
    getModel: (provider: string, id: string) => mocks.models.get(`${provider}:${id}`),
  }),
  // 只用于 AUTO 模型与"全局默认模型"兜底，本套用例不依赖它
  getActiveModel: async () => undefined,
}));
vi.mock("./native-config", () => ({ getNativeConfig: async () => ({ resolveProviderId: (id: string) => id }) }));
vi.mock("./session-cache", () => ({ readCache: () => undefined, writeCache: mocks.writeCache }));
vi.mock("./ipc-broadcast", () => ({ broadcast: mocks.broadcast, broadcastEvent: vi.fn() }));

const DEEPSEEK = { provider: "deepseek", id: "deepseek-chat", contextWindow: 64000 };
const CODEX = { provider: "openai-codex", id: "gpt", contextWindow: 200000 };

const store = (current: string): Store => ({
  getSettings: () => ({
    apiProviders: {
      current,
      configs: {
        deepseek: { id: "deepseek", model: "deepseek-chat" },
        "openai-codex": { id: "openai-codex", model: "gpt" },
      },
    },
  }),
}) as unknown as Store;

function chatOf(provider: string, currentModel: string) {
  let boundModel = { provider, id: currentModel };
  return {
    chatId: "chat-1",
    sessionId: "session-1",
    provider,
    currentModel,
    thinkingLevel: "off",
    session: {
      // 会话实际绑定的模型对象——rebindToCurrentProvider 按它判断是否跨供应商
      get model() { return boundModel; },
      setModel: vi.fn(async (model: typeof boundModel) => { boundModel = model; }),
      thinkingLevel: "off",
      getAvailableThinkingLevels: () => ["off"],
      getContextUsage: () => ({ contextWindow: 1000, percent: 0, tokens: 0 }),
    },
  };
}

function serviceWith(current: string, chat: ReturnType<typeof chatOf>) {
  const service = new AgentService(store(current));
  (service as unknown as { activeChats: Map<string, unknown> }).activeChats.set(chat.chatId, chat);
  return service;
}

beforeEach(() => {
  mocks.models.clear();
  mocks.broadcast.mockClear();
  mocks.writeCache.mockClear();
});

describe("provider switch and per-session model", () => {
  it("re-binds an active chat to the new provider's default model on provider switch", async () => {
    mocks.models.set("deepseek:deepseek-chat", DEEPSEEK);
    mocks.models.set("openai-codex:gpt", CODEX);
    // 会话原来绑 codex、用 gpt；全局已经切到 deepseek
    const chat = chatOf("openai-codex", "gpt");
    const service = serviceWith("deepseek", chat);

    await service.refreshActiveSessionsModel();

    // gpt 在 deepseek 下不存在 → 用 deepseek 的默认模型，而不是继续 requests 到 codex
    expect(chat.provider).toBe("deepseek");
    expect(chat.currentModel).toBe("deepseek-chat");
    expect(mocks.writeCache).toHaveBeenCalledWith("session-1", { model: "deepseek-chat" });
    expect(mocks.broadcast).toHaveBeenCalledWith("agent:model-changed", { sessionId: "session-1", provider: "deepseek", model: "deepseek-chat" });
  });

  it("resolves setModel on the global provider and rejects a model it does not have", async () => {
    mocks.models.set("deepseek:deepseek-chat", DEEPSEEK);
    mocks.models.set("openai-codex:gpt", CODEX);
    const chat = chatOf("deepseek", "deepseek-chat");
    const service = serviceWith("deepseek", chat);

    // 仍按旧会话供应商传入 codex 的 gpt：必须按全局 deepseek 解析 → 不可用 → 抛错且不改会话
    await expect(service.setModel("session-1", "gpt")).rejects.toThrow(/模型不可用/);
    expect(chat.currentModel).toBe("deepseek-chat");

    await service.setModel("session-1", "deepseek-chat");
    expect(chat.currentModel).toBe("deepseek-chat");
    expect(chat.provider).toBe("deepseek");
  });

  it("records the choice for an inactive session instead of silently dropping it", async () => {
    mocks.models.set("deepseek:deepseek-chat", DEEPSEEK);
    const service = new AgentService(store("deepseek"));
    // 会话还没激活（重启后、尚未建 session）
    await service.setModel("session-2", "deepseek-chat");
    expect(mocks.writeCache).toHaveBeenCalledWith("session-2", { model: "deepseek-chat" });
  });

  it("re-binds a chat still bound to the previous provider right before sending", async () => {
    mocks.models.set("deepseek:deepseek-chat", DEEPSEEK);
    const chat = chatOf("openai-codex", "gpt");
    const service = serviceWith("deepseek", chat);
    const rebind = (service as unknown as { rebindToCurrentProvider(c: unknown): Promise<void> });
    await rebind.rebindToCurrentProvider(chat);
    expect(chat.provider).toBe("deepseek");
    expect(chat.currentModel).toBe("deepseek-chat");
  });

  it("refuses to send when the current provider has no usable model", async () => {
    const chat = chatOf("openai-codex", "gpt");
    const service = serviceWith("deepseek", chat);
    const rebind = (service as unknown as { rebindToCurrentProvider(c: unknown): Promise<void> });
    await expect(rebind.rebindToCurrentProvider(chat)).rejects.toThrow(/没有可用模型/);
    expect(chat.currentModel).toBe("gpt");
  });
});

describe("provider binding at the real sendMessage entry", () => {
  const interceptPrompt = (service: AgentService) => vi.spyOn(service as unknown as { launchPrompt(session: {model:{provider:string;id:string}}, ...args: unknown[]): void }, "launchPrompt").mockImplementation(() => {});
  const send = (service: AgentService, sessionId = "session-1") => service.sendMessage(process.cwd(), "next message", sessionId, undefined, {} as Parameters<AgentService["sendMessage"]>[4]);

  it("actually starts the reused old session with the new provider's model",async()=>{
    mocks.models.set("deepseek:deepseek-chat",DEEPSEEK);
    const chat=chatOf("openai-codex","gpt"),service=serviceWith("deepseek",chat);
    const start=interceptPrompt(service);
    await send(service);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]![0].model).toBe(DEEPSEEK);
    expect(chat.session.setModel).toHaveBeenCalledWith(DEEPSEEK);
  });

  it("uses the current provider even when both providers have the same model id",async()=>{
    const next={...DEEPSEEK,id:"shared"};
    mocks.models.set("deepseek:shared",next);
    mocks.models.set("openai-codex:shared",{...CODEX,id:"shared"});
    const chat=chatOf("openai-codex","shared"),service=serviceWith("deepseek",chat);
    const start=interceptPrompt(service);
    await send(service);
    expect(start.mock.calls[0]![0].model).toBe(next);
  });

  it("rebinds a session skipped during an active run before its next send",async()=>{
    mocks.models.set("deepseek:deepseek-chat",DEEPSEEK);
    const chat=chatOf("openai-codex","gpt"),service=serviceWith("deepseek",chat);
    const active=(service as unknown as {activePromptSessions:Set<string>}).activePromptSessions;
    active.add(chat.sessionId);
    await service.refreshActiveSessionsModel();
    expect(chat.session.model.provider).toBe("openai-codex");
    active.delete(chat.sessionId);
    const start=interceptPrompt(service);
    await send(service);
    expect(start.mock.calls[0]![0].model.provider).toBe("deepseek");
  });

  it("refreshes multiple old sessions without changing the global default on a per-session model choice",async()=>{
    mocks.models.set("deepseek:deepseek-chat",DEEPSEEK);
    const alternative={...DEEPSEEK,id:"deepseek-reasoner"};mocks.models.set("deepseek:deepseek-reasoner",alternative);
    const one=chatOf("openai-codex","gpt"),two={...chatOf("openai-codex","gpt"),chatId:"chat-2",sessionId:"session-2"};
    const service=serviceWith("deepseek",one);
    (service as unknown as {activeChats:Map<string,unknown>}).activeChats.set(two.chatId,two);
    await service.refreshActiveSessionsModel();
    await service.setModel(one.sessionId,"deepseek-reasoner");
    const start=interceptPrompt(service);
    await send(service,one.sessionId);await send(service,two.sessionId);
    expect(one.session.model).toBe(alternative);expect(two.session.model).toBe(DEEPSEEK);
    expect(start.mock.calls.map(([session])=>session.model.provider)).toEqual(["deepseek","deepseek"]);
    expect((service as unknown as {store:Store}).store.getSettings().apiProviders?.configs.deepseek?.model).toBe("deepseek-chat");
  });

  it("never starts an old provider request when the new provider cannot resolve a model",async()=>{
    const chat=chatOf("openai-codex","gpt"),service=serviceWith("deepseek",chat);
    const start=interceptPrompt(service);
    await expect(send(service)).rejects.toThrow(/没有可用模型/);
    expect(start).not.toHaveBeenCalled();
  });
});
