import { createServer, type Server } from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testProvider } from "./provider-test";

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
    if (url === "/ok/models") return send(200, { data: [{ id: "m1" }, { id: "m2" }] });
    if (url === "/ok/v1/models") return send(404, { error: "not found" });
    if (url === "/ok/chat/completions") return send(200, { choices: [] });
    if (url === "/both/models") return send(200, { data: [{ id: "m1" }] });
    if (url === "/both/v1/models") return send(200, { models: [{ id: "m2" }] });
    if (url === "/both/v1/messages") return send(200, { content: [] });
    if (url === "/both/chat/completions") return send(200, { choices: [] });
    if (url === "/auth/models") return send(401, { error: "bad key" });
    if (url === "/auth/v1/models") return send(403, { error: "forbidden" });
    if (url === "/v1suffix/v1/models") return send(200, { data: [{ id: "m1" }] });
    if (url === "/v1suffix/v1/messages") return send(200, { content: [] });
    if (url === "/modelerr/models") return send(200, { data: [{ id: "m1" }] });
    if (url === "/modelerr/v1/models") return send(404, {});
    if (url === "/modelerr/chat/completions") return send(400, { error: { message: "model not found" } });
    send(500, { error: "unhandled" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => { server.close(); });

describe("testProvider", () => {
  it("401 也算地址可达，只探测到 O 系", async () => {
    const r = await testProvider({ baseUrl: `${base}/ok`, apiKey: "k" });
    expect(r.reachability.ok).toBe(true);
    expect(r.reachability.httpStatus).toBe(401);
    expect(r.modelList.openai).toMatchObject({ ok: true, modelCount: 2 });
    expect(r.modelList.anthropic.ok).toBe(false);
    expect(r.modelList.anthropic.detail).toContain("无模型列表接口");
    expect(r.keyCheck).toBeUndefined();
  });

  it("两种协议都通", async () => {
    const r = await testProvider({ baseUrl: `${base}/both`, apiKey: "k" });
    expect(r.modelList.openai.ok).toBe(true);
    expect(r.modelList.anthropic.ok).toBe(true);
  });

  it("401/403 表述为认证被拒绝，不断言 Key 无效", async () => {
    const r = await testProvider({ baseUrl: `${base}/auth`, apiKey: "bad" });
    expect(r.modelList.openai.detail).toBe("认证被拒绝（Key 可能无效，也可能是网关限制）");
    expect(r.modelList.anthropic.detail).toBe("认证被拒绝（Key 可能无效，也可能是网关限制）");
  });

  it("地址不可达时只标地址，后续步骤不探测", async () => {
    const r = await testProvider({ baseUrl: "http://127.0.0.1:49999", apiKey: "k" });
    expect(r.reachability.ok).toBe(false);
    expect(r.reachability.detail).toContain("连接被拒绝");
    expect(r.modelList.openai.detail).toBe("地址不可达，未探测");
  });

  it("baseUrl 已含 /v1 时不重复拼接", async () => {
    const before = seen.length;
    const r = await testProvider({ baseUrl: `${base}/v1suffix/v1`, apiKey: "k" });
    expect(r.modelList.anthropic.ok).toBe(true);
    expect(seen.slice(before)).not.toContain("GET /v1suffix/v1/v1/models");
  });

  it("勾选校验 + 有模型 → 走 O 系最小请求", async () => {
    const r = await testProvider({ baseUrl: `${base}/both`, apiKey: "k", model: "m1", apiType: "openai-completions", verifyKey: true });
    expect(r.keyCheck).toMatchObject({ ok: true, protocol: "openai", detail: "密钥有效" });
  });

  it("勾选校验 + apiType=anthropic 且两协议都通 → 走 A 系", async () => {
    const r = await testProvider({ baseUrl: `${base}/both`, apiKey: "k", model: "m1", apiType: "anthropic-messages", verifyKey: true });
    expect(r.keyCheck).toMatchObject({ ok: true, protocol: "anthropic" });
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
});
