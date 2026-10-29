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

  it("baseUrl 缺 scheme → 中文格式提示，并把原文带出来（用户才知道改哪）", async () => {
    const r = await testProvider({ baseUrl: "abc" });
    expect(r.reachability.ok).toBe(false);
    expect(r.reachability.detail).toContain("需以 http:// 或 https:// 开头");
    expect(r.reachability.detail).toContain("abc");
  });

  it("只写主机名（最常见的手输形态）同样按格式问题拦下，不发请求", async () => {
    const r = await testProvider({ baseUrl: "api.deepseek.com" });
    expect(r.reachability.ok).toBe(false);
    expect(r.reachability.detail).toContain("格式不正确");
  });

  it("非 http(s) 协议单独说清楚，而不是笼统的格式错误", async () => {
    const r = await testProvider({ baseUrl: "ftp://example.com/v1" });
    expect(r.reachability.ok).toBe(false);
    expect(r.reachability.detail).toContain("只支持 http / https");
    expect(r.reachability.detail).toContain("ftp");
  });

  /**
   * 归因不能张冠李戴：`TypeError: Invalid URL` 也可能是 undici 的 ProxyAgent 解析**代理地址**
   * 失败（首次发请求才 `new URL(代理串)`）。旧实现把它报成「Base URL 格式不正确」，
   * 用户改 URL 永远改不好。现在格式问题在发请求前就判完，请求之后的解析错误改为归到代理/重定向。
   */
  it("undici 自身错误码（socks 代理握手、socket 异常）也给中文定性，原文照留", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(
      Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
    )) as typeof globalThis.fetch;
    try {
      const r = await testProvider({ baseUrl: "https://api.example.com/v1" });
      expect(r.reachability.detail).toContain("连接失败（UND_ERR_SOCKET）");
      expect(r.reachability.detail).toContain("other side closed");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("请求阶段的解析错误归到「代理或重定向」，不再甩锅给 Base URL", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError("Invalid URL"))) as typeof globalThis.fetch;
    try {
      const r = await testProvider({ baseUrl: "https://api.example.com/v1" });
      expect(r.reachability.ok).toBe(false);
      expect(r.reachability.detail).toContain("代理或重定向");
      expect(r.reachability.detail).not.toContain("Base URL 格式不正确");
      expect(r.reachability.detail).toContain("Invalid URL"); // 原文保留，排查靠它
    } finally {
      globalThis.fetch = original;
    }
  });
});
