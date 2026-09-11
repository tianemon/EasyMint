import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { Store } from "./store";
import {
  loginProvider,
  logoutProvider,
  respondAuthInput,
  cancelAuthLogin,
  getProviderAuthStatus,
} from "./provider-auth";
import type { ProviderAuthEventMessage } from "../../shared/provider-auth";

/**
 * 账号登录桥接层：真账号登录无法自动测（要用用户账号走浏览器），这里锁住桥接语义——
 * 事件转发、输入回填、取消、同 requestId 去重、状态查询。
 */

const mocks = vi.hoisted(() => {
  const broadcasts: ProviderAuthEventMessage[] = [];
  const openExternal = vi.fn(async () => {});
  const login = vi.fn<(providerId: string, type: string, interaction: AuthInteraction) => Promise<unknown>>();
  const logout = vi.fn(async () => {});
  const listCredentials = vi.fn(async () => [] as Array<{ providerId: string; type: "api_key" | "oauth" }>);
  let checkAuthResult: { type: "api_key" | "oauth"; source?: string } | undefined;
  const checkAuth = vi.fn(async () => checkAuthResult);
  const providers = [
    { id: "anthropic", name: "Anthropic", auth: { oauth: {} } },
    { id: "openai-codex", name: "OpenAI Codex", auth: { oauth: {} } },
    { id: "deepseek", name: "DeepSeek", auth: { apiKey: {} } },
  ];
  return {
    broadcasts,
    openExternal,
    login,
    logout,
    listCredentials,
    checkAuth,
    providers,
    setCheckAuthResult: (v: { type: "api_key" | "oauth"; source?: string } | undefined) => { checkAuthResult = v; },
  };
});

vi.mock("electron", () => ({ shell: { openExternal: mocks.openExternal } }));
vi.mock("./ipc-broadcast", () => ({
  broadcast: (_channel: string, data: unknown) => { mocks.broadcasts.push(data as ProviderAuthEventMessage); },
}));
vi.mock("./pi-init", () => ({
  getModelRuntime: async () => ({
    getProviders: () => mocks.providers,
    getProvider: (id: string) => mocks.providers.find((p) => p.id === id),
    login: mocks.login,
    logout: mocks.logout,
    checkAuth: mocks.checkAuth,
    listCredentials: mocks.listCredentials,
  }),
}));

const store = {} as Store;
const events = () => mocks.broadcasts.map((b) => b.event);
/** 本文件用过的 requestId：跨用例清场用（在途登录会挡住同供应商的下一次登录） */
const REQUEST_IDS = ["req-1", "req-2", "req-3", "req-4", "req-5", "req-6", "req-7a", "req-7b", "req-8", "req-9", "req-10"];

beforeEach(async () => {
  for (const id of REQUEST_IDS) cancelAuthLogin(id);
  // 中止后清理在下一个宏任务跑完；不等它会把上一条用例的在途登录带到下一条
  await new Promise((r) => setTimeout(r, 0));
  mocks.broadcasts.length = 0;
  mocks.login.mockReset();
  mocks.logout.mockReset();
  mocks.listCredentials.mockReset();
  mocks.listCredentials.mockResolvedValue([]);
  mocks.setCheckAuthResult(undefined);
  mocks.openExternal.mockClear();
});

describe("getProviderAuthStatus", () => {
  it("不传 providerIds 时只返回支持账号登录的供应商", async () => {
    const list = await getProviderAuthStatus(store);
    expect(list.map((s) => s.providerId)).toEqual(["anthropic", "openai-codex"]);
    expect(list.every((s) => s.supportsOAuth)).toBe(true);
    expect(list[0]?.type).toBeNull();
  });

  it("带出认证方式与凭据落盘情况", async () => {
    mocks.setCheckAuthResult({ type: "oauth", source: "OAuth" });
    mocks.listCredentials.mockResolvedValue([{ providerId: "anthropic", type: "oauth" }]);
    const [anthropic] = await getProviderAuthStatus(store, ["anthropic"]);
    expect(anthropic).toMatchObject({ providerId: "anthropic", type: "oauth", hasCredential: true, source: "OAuth" });
  });

  it("单个供应商检查失败时降级为未配置，不影响其他条目", async () => {
    mocks.checkAuth.mockRejectedValueOnce(new Error("boom"));
    const list = await getProviderAuthStatus(store, ["anthropic", "openai-codex"]);
    expect(list.map((s) => s.type)).toEqual([null, null]);
  });
});

describe("loginProvider", () => {
  it("把授权链接事件转给界面并尝试打开浏览器", async () => {
    mocks.login.mockImplementation(async (_p: string, _t: string, interaction: AuthInteraction) => {
      interaction.notify({ type: "auth_url", url: "https://example.com/auth", instructions: "english text" });
      return { type: "oauth" };
    });
    const r = await loginProvider(store, "anthropic", "req-1");
    expect(r.ok).toBe(true);
    expect(events()).toEqual([{ kind: "browser", url: "https://example.com/auth" }]);
    expect(mocks.openExternal).toHaveBeenCalledWith("https://example.com/auth");
  });

  it("SDK 英文文案不进事件（只按类型给结构化数据）", async () => {
    mocks.login.mockImplementation(async (_p: string, _t: string, interaction: AuthInteraction) => {
      interaction.notify({ type: "info", message: "Follow the instructions in your browser" });
      interaction.notify({ type: "progress", message: "Exchanging authorization code for tokens..." });
      return { type: "oauth" };
    });
    await loginProvider(store, "anthropic", "req-2");
    expect(events()).toEqual([{ kind: "progress" }]);
  });

  it("设备码事件带出 userCode 与验证地址", async () => {
    mocks.login.mockImplementation(async (_p: string, _t: string, interaction: AuthInteraction) => {
      interaction.notify({ type: "device_code", userCode: "ABCD-1234", verificationUri: "https://example.com/device", expiresInSeconds: 900 });
      return { type: "oauth" };
    });
    await loginProvider(store, "openai-codex", "req-3");
    expect(events()[0]).toMatchObject({ kind: "device_code", userCode: "ABCD-1234" });
  });

  it("需要输入时向界面发 prompt，界面回填后流程继续", async () => {
    mocks.login.mockImplementation(async (_p: string, _t: string, interaction: AuthInteraction) => {
      const code = await interaction.prompt({ type: "manual_code", message: "paste code", placeholder: "http://localhost" });
      expect(code).toBe("code-123");
      return { type: "oauth" };
    });
    const run = loginProvider(store, "anthropic", "req-4");
    await vi.waitFor(() => expect(events().length).toBe(1));
    expect(events()[0]).toMatchObject({ kind: "prompt", promptType: "manual_code", placeholder: "http://localhost" });
    expect(respondAuthInput("req-4", "code-123")).toBe(true);
    await expect(run).resolves.toMatchObject({ ok: true });
  });

  it("界面取消 → 中止流程并标记 canceled", async () => {
    mocks.login.mockImplementation(async (_p: string, _t: string, interaction: AuthInteraction) =>
      new Promise((_resolve, reject) => {
        interaction.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    const run = loginProvider(store, "anthropic", "req-5");
    await vi.waitFor(() => expect(mocks.login).toHaveBeenCalled());
    expect(cancelAuthLogin("req-5")).toBe(true);
    await expect(run).resolves.toMatchObject({ ok: false, canceled: true });
  });

  it("同一 requestId 重复发起共用同一次登录（StrictMode 挂载期双调用）", async () => {
    let finish: (v: unknown) => void = () => {};
    mocks.login.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const a = loginProvider(store, "anthropic", "req-6");
    const b = loginProvider(store, "anthropic", "req-6");
    await vi.waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    finish({ type: "oauth" });
    await expect(Promise.all([a, b])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });

  it("同供应商已有在途登录时不再起第二次", async () => {
    let finish: (v: unknown) => void = () => {};
    mocks.login.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = loginProvider(store, "anthropic", "req-7a");
    const second = await loginProvider(store, "anthropic", "req-7b");
    expect(second.ok).toBe(false);
    expect(second.error).toContain("正在登录中");
    finish({ type: "oauth" });
    await first;
  });

  it("不支持账号登录的供应商直接报错，不调 SDK", async () => {
    const r = await loginProvider(store, "deepseek", "req-8");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("不支持账号登录");
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("未知供应商直接报错", async () => {
    const r = await loginProvider(store, "nope", "req-9");
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toContain("未知供应商");
  });
});

describe("logoutProvider", () => {
  it("调 SDK 退出并返回成功", async () => {
    await expect(logoutProvider(store, "anthropic")).resolves.toEqual({ ok: true });
    expect(mocks.logout).toHaveBeenCalledWith("anthropic");
  });

  it("先中止在途登录，避免退出后凭据又被写回", async () => {
    mocks.login.mockImplementation(async (_p: string, _t: string, interaction: AuthInteraction) =>
      new Promise((_resolve, reject) => {
        interaction.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    const run = loginProvider(store, "anthropic", "req-10");
    await vi.waitFor(() => expect(mocks.login).toHaveBeenCalled());
    await logoutProvider(store, "anthropic");
    await expect(run).resolves.toMatchObject({ canceled: true });
  });

  it("退出失败返回错误原因", async () => {
    mocks.logout.mockRejectedValue(new Error("store exploded"));
    await expect(logoutProvider(store, "anthropic")).resolves.toEqual({ ok: false, error: "store exploded" });
  });

  it("未知供应商不调 SDK", async () => {
    await expect(logoutProvider(store, "nope")).resolves.toMatchObject({ ok: false });
    expect(mocks.logout).not.toHaveBeenCalled();
  });
});
