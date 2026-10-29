/**
 * Codex 额度解析与「重置请求体」的纯函数回归。
 *
 * 样本取自 2026-10-29 用真实账号请求到的响应（`wham/usage` + `wham/rate-limit-reset-credits`），
 * 只保留结构与几个典型值——接口没有公开文档，形状一变这里就先红，比等用户报"额度显示不对"便宜。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCodexQuotaCache, consumeCodexResetCredit, consumeResetBody, fetchCodexQuota, parseCodexQuota, planFromAccessToken } from "./codex-usage";
import type { Store } from "./store";

/** 真实响应的节选（数值来自一次 plus 账号的查询） */
const USAGE = {
  plan_type: "plus",
  rate_limit: {
    allowed: false,
    limit_reached: true,
    primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_at: 1793258106, reset_after_seconds: 955 },
    secondary_window: { used_percent: 47, limit_window_seconds: 604800, reset_at: 1793541060, reset_after_seconds: 519110 },
  },
  rate_limit_reset_credits: { available_count: 2, applicable_available_count: 2 },
};

const CREDITS = {
  available_count: 2,
  total_earned_count: 0,
  credits: [
    {
      id: "RateLimitResetCredit_4ce8a1c",
      reset_type: "codex_rate_limits",
      status: "available",
      granted_at: "2026-09-29T18:34:57.866666Z",
      expires_at: "2026-10-29T18:34:57.866666Z",
      title: "Full reset (Weekly + 5 hr)",
    },
    {
      id: "RateLimitResetCredit_ee5f774",
      reset_type: "codex_rate_limits",
      status: "available",
      granted_at: "2026-10-07T22:04:46.752485Z",
      expires_at: "2026-11-06T22:04:46.752485Z",
    },
    // 已用掉的那张不该出现在可用列表里
    { id: "RateLimitResetCredit_old", status: "redeemed", expires_at: "2026-09-01T00:00:00Z" },
  ],
};

describe("parseCodexQuota", () => {
  it("5 小时 / 7 天两个窗口与原值一致，触顶窗口标 reached", () => {
    const quota = parseCodexQuota(USAGE, CREDITS);
    expect(quota.plan).toBe("plus");
    expect(quota.primary).toMatchObject({ usedPercent: 100, windowSeconds: 18000, resetAt: 1793258106, reached: true });
    expect(quota.secondary).toMatchObject({ usedPercent: 47, windowSeconds: 604800, reached: false });
  });

  it("只把 status=available 的凭据列进可用项，计数以 available_count 为准", () => {
    const quota = parseCodexQuota(USAGE, CREDITS);
    expect(quota.credits.available).toBe(2);
    expect(quota.credits.items.map((item) => item.id)).toEqual([
      "RateLimitResetCredit_4ce8a1c",
      "RateLimitResetCredit_ee5f774",
    ]);
    expect(quota.credits.items[0]).toMatchObject({ expiresAt: "2026-10-29T18:34:57.866666Z", title: "Full reset (Weekly + 5 hr)" });
  });

  it("available_count 缺失时退回数组长度（后端截断数组的情况仍以计数为准）", () => {
    expect(parseCodexQuota(USAGE, { credits: CREDITS.credits }).credits.available).toBe(2);
    expect(parseCodexQuota(USAGE, { credits: CREDITS.credits.slice(0, 1), available_count: 5 }).credits.available).toBe(5);
  });

  it("只有 window_minutes 的老形状也能算出窗口秒数", () => {
    const quota = parseCodexQuota({ rate_limit: { primary_window: { used_percent: 12, window_minutes: 300 } } }, null);
    expect(quota.primary).toMatchObject({ usedPercent: 12, windowSeconds: 18000, reached: false });
  });

  it("字段缺失 / 非对象一律降级，不抛", () => {
    expect(parseCodexQuota(null, null)).toMatchObject({ credits: { available: 0, items: [] } });
    expect(parseCodexQuota(null, null).primary).toBeUndefined();
    // 越界百分比收敛到 0–100
    expect(parseCodexQuota({ rate_limit: { primary_window: { used_percent: 137, limit_window_seconds: 18000 } } }, null).primary?.usedPercent).toBe(100);
  });
});

/** 造一个只带 payload 的 JWT（签名/头不重要，解码方只读第二段） */
function jwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
}

describe("planFromAccessToken", () => {
  it("从 JWT 的 auth claims 读 chatgpt_plan_type（Pro 账号即 pro）", () => {
    expect(planFromAccessToken(jwt({ "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } }))).toBe("pro");
  });

  it("顶层也认；解不开或没有该字段就 undefined（界面只是不显示括号）", () => {
    expect(planFromAccessToken(jwt({ chatgpt_plan_type: "plus" }))).toBe("plus");
    expect(planFromAccessToken(jwt({ sub: "x" }))).toBeUndefined();
    expect(planFromAccessToken("not-a-jwt")).toBeUndefined();
    expect(planFromAccessToken("")).toBeUndefined();
  });
});

describe("consumeResetBody", () => {
  it("指定凭据时带 credit_id；不指定时让后端自己挑（官方客户端行为）", () => {
    expect(consumeResetBody("RateLimitResetCredit_x", "req-1")).toEqual({ redeem_request_id: "req-1", credit_id: "RateLimitResetCredit_x" });
    expect(consumeResetBody(undefined, "req-1")).toEqual({ redeem_request_id: "req-1" });
  });
});

/**
 * 请求接线：凭据直读 auth.json（不经模型运行时），两个端点各一次请求，头里必须带
 * Authorization + chatgpt-account-id；失败要降级成 reason 而不是抛。
 */
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "codex-usage-"));
const STORE = {} as Store;

function writeAuth(entry: Record<string, unknown> | null): void {
  const dir = path.join(HOME, "agent");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "auth.json");
  if (entry === null) { fs.rmSync(file, { force: true }); return; }
  fs.writeFileSync(file, JSON.stringify({ "openai-codex": entry }));
}

beforeEach(() => {
  process.env.EASYMINT_HOME = HOME;
  clearCodexQuotaCache();
  writeAuth({ type: "oauth", access: "access-token", accountId: "acct-1", expires: Date.now() + 86400000 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EASYMINT_HOME;
  clearCodexQuotaCache();
});

describe("fetchCodexQuota", () => {
  it("带齐两个请求：usage + 重置凭据，头里有 Authorization 与账号 id", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", (async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers ?? {} });
      return { ok: true, status: 200, json: async () => (url.endsWith("/wham/usage") ? USAGE : CREDITS) };
    }) as unknown as typeof fetch);

    const result = await fetchCodexQuota(STORE, { force: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quota.primary?.usedPercent).toBe(100);
    expect(result.quota.credits.available).toBe(2);

    const urls = calls.map((c) => new URL(c.url).pathname).sort();
    expect(urls).toEqual(["/backend-api/wham/rate-limit-reset-credits", "/backend-api/wham/usage"]);
    for (const call of calls) {
      expect(call.headers.authorization).toBe("Bearer access-token");
      expect(call.headers["chatgpt-account-id"]).toBe("acct-1");
    }
  });

  it("凭据缺失或已过期 → no-credential（不抛、不发请求）", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    writeAuth(null);
    expect(await fetchCodexQuota(STORE, { force: true })).toEqual({ ok: false, reason: "no-credential" });

    writeAuth({ type: "oauth", access: "expired", expires: Date.now() - 1000 });
    expect(await fetchCodexQuota(STORE, { force: true })).toEqual({ ok: false, reason: "no-credential" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("401/403 → reauth（登录失效，界面据此提示重新登录）", async () => {
    vi.stubGlobal("fetch", (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch);
    expect(await fetchCodexQuota(STORE, { force: true })).toEqual({ ok: false, reason: "reauth" });
  });

  it("额度端点可用、凭据明细端点挂了 → 仍然给额度（计数退化为 0）", async () => {
    vi.stubGlobal("fetch", (async (url: string) => (url.endsWith("/wham/usage")
      ? { ok: true, status: 200, json: async () => USAGE }
      : { ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch);
    const result = await fetchCodexQuota(STORE, { force: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quota.credits.available).toBe(0);
    expect(result.quota.secondary?.usedPercent).toBe(47);
  });

  it("usage 端点没带 plan_type 时，用凭据里的套餐声明兜底", async () => {
    writeAuth({ type: "oauth", access: jwt({ "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } }), accountId: "acct-1", expires: Date.now() + 86400000 });
    vi.stubGlobal("fetch", (async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith("/wham/usage") ? { rate_limit: USAGE.rate_limit } : CREDITS),
    })) as unknown as typeof fetch);

    const result = await fetchCodexQuota(STORE, { force: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quota.plan).toBe("pro");
    expect(result.quota.secondary?.usedPercent).toBe(47);
  });

  it("60 秒缓存：第二次不带 force 不再发请求", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: true, status: 200, json: async () => (url.endsWith("/wham/usage") ? USAGE : CREDITS),
    }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    await fetchCodexQuota(STORE, { force: true });
    const first = fetchSpy.mock.calls.length;
    await fetchCodexQuota(STORE);
    expect(fetchSpy.mock.calls.length).toBe(first);
  });
});

describe("consumeCodexResetCredit", () => {
  const okFetch = (code: string) => vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ code, windows_reset: 2 }),
  }));

  it("POST 到 consume，body 带幂等键与 credit_id，并按结果码回传窗口数", async () => {
    const fetchSpy = okFetch("reset");
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    const result = await consumeCodexResetCredit(STORE, "RateLimitResetCredit_x");
    expect(result).toEqual({ code: "reset", windowsReset: 2 });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, { method: string; body: string; headers: Record<string, string> }];
    expect(url).toBe("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body) as { redeem_request_id: string; credit_id: string };
    expect(body.credit_id).toBe("RateLimitResetCredit_x");
    expect(body.redeem_request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("网络失败保留同一个幂等键，重试不会变成第二次消耗", async () => {
    const ids: string[] = [];
    vi.stubGlobal("fetch", (async (_url: string, init: { body: string }) => {
      ids.push((JSON.parse(init.body) as { redeem_request_id: string }).redeem_request_id);
      throw new Error("socket hang up");
    }) as unknown as typeof fetch);
    await consumeCodexResetCredit(STORE, "RateLimitResetCredit_x");
    await consumeCodexResetCredit(STORE, "RateLimitResetCredit_x");
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);   // 同一次逻辑消耗复用 uuid
  });

  it("终态（no_credit 等）后清掉幂等键：下一次点击是一次新的消耗", async () => {
    const ids: string[] = [];
    vi.stubGlobal("fetch", (async (_url: string, init: { body: string }) => {
      ids.push((JSON.parse(init.body) as { redeem_request_id: string }).redeem_request_id);
      return { ok: true, status: 200, json: async () => ({ code: "no_credit" }) };
    }) as unknown as typeof fetch);
    await consumeCodexResetCredit(STORE, "RateLimitResetCredit_x");
    await consumeCodexResetCredit(STORE, "RateLimitResetCredit_x");
    expect(ids[0]).not.toBe(ids[1]);
  });
});
