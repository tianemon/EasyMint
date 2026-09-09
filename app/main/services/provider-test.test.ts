import { createServer, type Server } from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testProvider } from "./provider-test";

/**
 * 2026-09-09 起 testProvider 只做两件事：地址可达（连通）+ 可选 Key 校验。
 * 不做模型列表测试（各家模型列表接口不同），不再推断「支持协议」。
 */
let server: Server;
let base = "";
const seen: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    seen.push(`${req.method} ${url}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url === "/ok") return send(401, { error: "unauthorized" });
    if (url === "/ok/chat/completions") return send(200, { choices: [] });
    if (url === "/both") return send(200, {});
    if (url === "/both/chat/completions") return send(200, { choices: [] });
    if (url === "/both/v1/chat/completions") return send(200, { choices: [] });
    if (url === "/both/v1/messages") return send(200, { content: [] });
    // 裸域名 + 端点挂在 /v1 下
    if (url === "/v1only") return send(200, {});
    if (url === "/v1only/v1/chat/completions") return send(200, { choices: [] });
    if (url === "/v1suffix/v1/messages") return send(200, { content: [] });
    if (url === "/modelerr") return send(200, {});
    if (url === "/modelerr/v1/chat/completions") return send(400, { error: { message: "model not found" } });
    send(500, { error: "unhandled" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => { server.close(); });

describe("testProvider", () => {
  it("任何 HTTP 状态都算连通(401 也算)", async () => {
    const r = await testProvider({ baseUrl: `${base}/ok`, apiKey: "k" });
    expect(r.reachability.ok).toBe(true);
    expect(r.reachability.httpStatus).toBe(401);
    expect(r.keyCheck).toBeUndefined();
  });

  it("不勾选校验时不发任何模型/消息请求", async () => {
    const before = seen.length;
    await testProvider({ baseUrl: `${base}/ok`, apiKey: "k" });
    const calls = seen.slice(before);
    expect(calls).toHaveLength(1); // 只有 GET /ok
    expect(calls[0]).toBe("GET /ok");
  });

  it("地址不可达:只标连通失败,不做后续探测", async () => {
    const r = await testProvider({ baseUrl: "http://127.0.0.1:49999", apiKey: "k" });
    expect(r.reachability.ok).toBe(false);
    expect(r.reachability.detail).toContain("连接被拒绝");
    expect(r.keyCheck).toBeUndefined();
  });

  it("勾选校验 + openai-completions → POST {base}/v1/chat/completions", async () => {
    const r = await testProvider({ baseUrl: `${base}/both`, apiKey: "k", model: "m1", apiType: "openai-completions", verifyKey: true });
    expect(r.keyCheck).toMatchObject({ ok: true, protocol: "openai", detail: "密钥有效" });
    expect(seen).toContain("POST /both/v1/chat/completions");
  });

  it("baseUrl 已含 /v1 → 不再重复拼接", async () => {
    const before = seen.length;
    const r = await testProvider({ baseUrl: `${base}/v1suffix/v1`, apiKey: "k", model: "m1", apiType: "anthropic-messages", verifyKey: true });
    expect(r.keyCheck).toMatchObject({ ok: true, protocol: "anthropic" });
    expect(seen.slice(before)).not.toContain("POST /v1suffix/v1/v1/messages");
  });

  it("裸域名 base → 校验端点归一化到 /v1", async () => {
    const r = await testProvider({ baseUrl: `${base}/v1only`, apiKey: "k", model: "m1", apiType: "openai-completions", verifyKey: true });
    expect(r.keyCheck).toMatchObject({ ok: true, protocol: "openai" });
    expect(seen).toContain("POST /v1only/v1/chat/completions");
  });

  it("apiType=anthropic-messages → 走 A 系端点与请求头", async () => {
    const r = await testProvider({ baseUrl: `${base}/both`, apiKey: "k", model: "m1", apiType: "anthropic-messages", verifyKey: true });
    expect(r.keyCheck).toMatchObject({ ok: true, protocol: "anthropic" });
    expect(seen).toContain("POST /both/v1/messages");
  });

  it("勾选校验 + 未填模型 → 直接返回未填写", async () => {
    const r = await testProvider({ baseUrl: `${base}/ok`, apiKey: "k", verifyKey: true });
    expect(r.keyCheck).toMatchObject({ ok: false, detail: "未填写模型 id，无法校验密钥" });
  });

  it("400 提到 model → 提示模型 id 可能不正确", async () => {
    const r = await testProvider({ baseUrl: `${base}/modelerr`, apiKey: "k", model: "nope", verifyKey: true });
    expect(r.keyCheck?.ok).toBe(false);
    expect(r.keyCheck?.detail).toContain("模型 id 可能不正确");
  });

  it("baseUrl 非法 → 中文格式提示，不透出英文原始错误", async () => {
    const r = await testProvider({ baseUrl: "abc", apiKey: "k" });
    expect(r.reachability.ok).toBe(false);
    expect(r.reachability.detail).toBe("Base URL 格式不正确（需以 http 开头）");
  });
});
