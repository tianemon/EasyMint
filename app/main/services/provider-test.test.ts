import { createServer, type Server } from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testProvider } from "./provider-test";

/**
 * 2026-09-09 起 testProvider 只做连通测试：GET base 拿到任何 HTTP 状态即连通。
 */
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/ok") { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return; }
    if (req.url === "/plain") { res.writeHead(200, { "content-type": "text/plain" }); res.end("hi"); return; }
    res.writeHead(500, { "content-type": "application/json" }); res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => { server.close(); });

describe("testProvider", () => {
  it("任何 HTTP 状态都算连通(401 也算)", async () => {
    const r = await testProvider({ baseUrl: `${base}/ok` });
    expect(r.reachability.ok).toBe(true);
    expect(r.reachability.httpStatus).toBe(401);
    expect(r.reachability.detail).toContain("401");
  });

  it("200 也算连通且带耗时", async () => {
    const r = await testProvider({ baseUrl: `${base}/plain` });
    expect(r.reachability.ok).toBe(true);
    expect(r.reachability.detail).toContain("200");
    expect(r.reachability.ms).toBeGreaterThanOrEqual(0);
  });

  it("地址不可达:标记失败并给出可读原因", async () => {
    const r = await testProvider({ baseUrl: "http://127.0.0.1:49999" });
    expect(r.reachability.ok).toBe(false);
    expect(r.reachability.detail).toContain("连接被拒绝");
  });

  it("baseUrl 非法 → 中文格式提示，不透出英文原始错误", async () => {
    const r = await testProvider({ baseUrl: "abc" });
    expect(r.reachability.ok).toBe(false);
    expect(r.reachability.detail).toBe("Base URL 格式不正确（需以 http 开头）");
  });
});
