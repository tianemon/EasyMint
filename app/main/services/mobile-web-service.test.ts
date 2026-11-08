import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// mobile-web-service 间接依赖 paths.ts 的 `app`（仅 resolveStaticRoot 会用到，测试注入静态根不会调用）。
vi.mock("electron", () => ({ app: { isPackaged: false } }));

import {
  startMobileWebService,
  stopMobileWebService,
  getMobileWebStatus,
  mobileWebController,
  MOBILE_WEB_WS_PORT,
  registerPairOffer,
  resolvePairOffer,
  type MobileWebControllerDeps,
  type PairLinkPayload,
} from "./mobile-web-service";

const LAN_IP = "192.168.1.10";
let fixture: string;
let root: string;
let port: number;

function write(relative: string, content: string): void {
  const file = path.join(fixture, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** 借内核分配一个空闲端口（服务要求端口 >= 1024，且 Host 端口必须等于配置端口，不能用 0）。 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const value = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(value));
    });
  });
}

interface Response {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** 用原生 http 发请求，便于自定义 Host / Origin / Sec-Fetch-Site（fetch 会改写 Host）。 */
function request(
  targetPort: number,
  requestPath: string,
  opts: { method?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: targetPort,
      path: requestPath,
      method: opts.method ?? "GET",
      headers: { Host: `127.0.0.1:${targetPort}`, ...opts.headers },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.once("error", reject);
    req.end();
  });
}

async function start(): Promise<void> {
  await startMobileWebService({
    staticRoot: root,
    port,
    lanAddresses: () => [LAN_IP],
    hostname: "testhost",
  });
}

beforeEach(async () => {
  const parent = path.resolve("temp/tests");
  fs.mkdirSync(parent, { recursive: true });
  fixture = fs.mkdtempSync(path.join(parent, "mobile-web-"));
  root = path.join(fixture, "dist");
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  write("dist/index.html", "<!doctype html><html>SPA-ROOT</html>");
  write("dist/assets/index-ABC12345.js", "console.log('hashed asset')");
  write("dist/app.css", "body{color:red}");
  write("dist/.env", "SECRET_TOKEN");
  write("outside.html", "OUTSIDE_SECRET");
  port = await freePort();
});

afterEach(async () => {
  await stopMobileWebService();
  fs.rmSync(fixture, { recursive: true, force: true });
});

describe("mobile web static service", () => {
  it("仅 GET/HEAD，其余方法 405 且带 Allow", async () => {
    await start();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await request(port, "/", { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.allow).toBe("GET, HEAD");
    }
  });

  it("拒绝路径越界（含编码的 ..）且不泄露目录外文件", async () => {
    await start();
    // WHATWG URL 会规范化 `%2e%2e/`（退化成根目录内 404），而带编码斜杠的
    // `%2e%2e%2f` 会在解码后出现真实的 `..`，由 inside() 拦截——两者都必须拒绝且不泄露目录外文件。
    for (const p of ["/%2e%2e/outside.html", "/%2e%2e%2foutside.html", "/%2e%2e/%2e%2e/outside.html"]) {
      const res = await request(port, p);
      expect([403, 404], p).toContain(res.status);
      expect(res.body).not.toContain("OUTSIDE_SECRET");
    }
    // 无扩展名的越界路径同样必须 404：否则被 URL 规范化成根内路由后走 SPA 回退返回 index.html。
    for (const p of ["/%2e%2e/%2e%2e/etc/passwd", "/assets/../../../../etc/passwd"]) {
      const res = await request(port, p);
      expect(res.status, p).toBe(404);
      expect(res.body).not.toContain("OUTSIDE_SECRET");
    }
    expect((await request(port, "/%00etc")).status).toBe(400);
    expect((await request(port, "/back%5cslash")).status).toBe(400);
  });

  it("Host / Origin / Sec-Fetch-Site 白名单：不匹配一律 403", async () => {
    await start();
    // 默认 Host 127.0.0.1:<port> 命中白名单
    expect((await request(port, "/")).status).toBe(200);
    // LAN IP 与本机名命中白名单
    expect((await request(port, "/", { headers: { Host: `${LAN_IP}:${port}` } })).status).toBe(200);
    expect((await request(port, "/", { headers: { Host: `testhost.local:${port}` } })).status).toBe(200);
    // 端口不等于配置端口
    expect((await request(port, "/", { headers: { Host: `127.0.0.1:${port + 1}` } })).status).toBe(403);
    // 非白名单主机名：不带端口与带正确端口都必须拒绝（后者才真正校验主机名白名单，
    // 不被端口不匹配掩盖——变异测试去掉 hostSet 检查时这条会变红）
    expect((await request(port, "/", { headers: { Host: "attacker.test" } })).status).toBe(403);
    expect((await request(port, "/", { headers: { Host: `attacker.test:${port}` } })).status).toBe(403);
    // 跨站读取
    expect((await request(port, "/", { headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
    // 非同源 Origin
    expect((await request(port, "/", { headers: { Origin: "https://attacker.test" } })).status).toBe(403);
    // 同源 Origin 放行
    expect((await request(port, "/", { headers: { Origin: `http://${LAN_IP}:${port}` } })).status).toBe(200);
  });

  it("GET /health 返回 204、无响应体、不带业务信息", async () => {
    await start();
    const res = await request(port, "/health");
    expect(res.status).toBe(204);
    expect(res.body).toBe("");
    expect(res.headers["content-type"]).toBeUndefined();
  });

  it("动态 CSP 含 connect-src ws://<每个LAN-IP>:47778 且禁用内联/嵌套", async () => {
    await start();
    const res = await request(port, "/");
    const csp = String(res.headers["content-security-policy"] ?? "");
    expect(csp).toContain(`connect-src 'self' ws://${LAN_IP}:${MOBILE_WEB_WS_PORT}`);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("SPA 路由回退 index.html，且 index.html 为 no-store", async () => {
    await start();
    for (const p of ["/", "/index.html", "/some/route", "/nested/deep/link"]) {
      const res = await request(port, p);
      expect(res.status, p).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).toContain("SPA-ROOT");
    }
  });

  it("带内容哈希的静态资源长缓存 immutable；普通资源 no-cache；隐藏/MIME 外文件 404", async () => {
    await start();
    const hashed = await request(port, "/assets/index-ABC12345.js");
    expect(hashed.status).toBe(200);
    expect(hashed.headers["content-type"]).toContain("text/javascript");
    expect(hashed.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(hashed.body).toContain("hashed asset");

    const plain = await request(port, "/app.css");
    expect(plain.status).toBe(200);
    expect(plain.headers["cache-control"]).toBe("no-cache");

    for (const p of ["/.env", "/.git/config", "/missing.js", "/app.exe"]) {
      const res = await request(port, p);
      expect(res.status, p).toBe(404);
      expect(res.body).not.toContain("SECRET_TOKEN");
    }
  });

  it("同源 module Worker 脚本请求（Sec-Fetch-Dest: worker + Origin）被放行", async () => {
    // Web 前端用 `new Worker(new URL('worker-*.js', import.meta.url), {type:'module'})`，
    // 浏览器会带 Sec-Fetch-Dest: worker / Sec-Fetch-Site: same-origin / Origin 发同源请求。
    // 校验只看 Host+端口、cross-site、Origin 同源，不收紧 Sec-Fetch-Dest，故应放行。
    write("dist/assets/worker-AB12CD34.js", "self.onmessage=()=>{}");
    await start();
    const res = await request(port, "/assets/worker-AB12CD34.js", {
      headers: {
        Host: `${LAN_IP}:${port}`,
        Origin: `http://${LAN_IP}:${port}`,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Dest": "worker",
        "Sec-Fetch-Mode": "cors",
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/javascript");
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("HEAD 返回状态与头但无响应体", async () => {
    await start();
    const res = await request(port, "/", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.body).toBe("");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("页面内配对端点：返回一份新的配对材料（不依赖 URL 里的短码）", async () => {
    await startMobileWebService({
      staticRoot: root, port, lanAddresses: () => [LAN_IP], hostname: "testhost",
      createPairingPayload: async () => ({
        version: 1, token: "token-1", pcId: "pc-1", pcName: "Mac",
        addresses: [LAN_IP], port: 47_778, publicKey: "pub-1", expiresAt: Date.now() + 60_000,
      }),
    });
    const response = await request(port, "/pair/new.json", { headers: { "Sec-Fetch-Site": "same-origin" } });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const payload = JSON.parse(response.body) as Record<string, unknown>;
    // 与 /pair/<code>.json 同形的 8 字段：手机直接拿它 init，不需要再换基短码
    expect(Object.keys(payload).sort()).toEqual(
      ["addresses", "expiresAt", "pcId", "pcName", "port", "publicKey", "token", "version"],
    );
  });

  it("配对端点没有签发能力时返回 503，而不是挂住", async () => {
    await startMobileWebService({ staticRoot: root, port, lanAddresses: () => [LAN_IP], hostname: "testhost" });
    const response = await request(port, "/pair/new.json", { headers: { "Sec-Fetch-Site": "same-origin" } });
    expect(response.status).toBe(503);
  });

  it("配对端点按 IP 限流：连续请求第 6 次起 429", async () => {
    await startMobileWebService({
      staticRoot: root, port, lanAddresses: () => [LAN_IP], hostname: "testhost",
      createPairingPayload: async () => ({
        version: 1, token: "t", pcId: "p", pcName: "Mac",
        addresses: [LAN_IP], port: 47_778, publicKey: "k", expiresAt: Date.now() + 60_000,
      }),
    });
    const call = () => request(port, "/pair/new.json", { headers: { "Sec-Fetch-Site": "same-origin" } });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await call()).status);
    // 这条路径等于「谁都能让电脑弹一次确认框」：一个窗口内最多 5 次，第 6 次起 429。
    // 配额随服务启动重置，所以这里可以精确断言。
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });

  it("页面内配对端点：返回一份新的配对材料（不依赖 URL 里的短码）", async () => {
    await startMobileWebService({
      staticRoot: root, port, lanAddresses: () => [LAN_IP], hostname: "testhost",
      createPairingPayload: async () => ({
        version: 1, token: "token-1", pcId: "pc-1", pcName: "Mac",
        addresses: [LAN_IP], port: 47_778, publicKey: "pub-1", expiresAt: Date.now() + 60_000,
      }),
    });
    const response = await request(port, "/pair/new.json", { headers: { "Sec-Fetch-Site": "same-origin" } });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const payload = JSON.parse(response.body) as Record<string, unknown>;
    // 与 /pair/<code>.json 同形的 8 字段：手机直接拿它 init，不需要再换基短码
    expect(Object.keys(payload).sort()).toEqual(
      ["addresses", "expiresAt", "pcId", "pcName", "port", "publicKey", "token", "version"],
    );
  });

  it("配对端点没有签发能力时返回 503，而不是挂住", async () => {
    await startMobileWebService({ staticRoot: root, port, lanAddresses: () => [LAN_IP], hostname: "testhost" });
    const response = await request(port, "/pair/new.json", { headers: { "Sec-Fetch-Site": "same-origin" } });
    expect(response.status).toBe(503);
  });

  it("配对端点按 IP 限流：连续请求第 6 次起 429", async () => {
    await startMobileWebService({
      staticRoot: root, port, lanAddresses: () => [LAN_IP], hostname: "testhost",
      createPairingPayload: async () => ({
        version: 1, token: "t", pcId: "p", pcName: "Mac",
        addresses: [LAN_IP], port: 47_778, publicKey: "k", expiresAt: Date.now() + 60_000,
      }),
    });
    const call = () => request(port, "/pair/new.json", { headers: { "Sec-Fetch-Site": "same-origin" } });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await call()).status);
    // 这条路径等于「谁都能让电脑弹一次确认框」：一个窗口内最多 5 次，第 6 次起 429。
    // 配额随服务启动重置，所以这里可以精确断言。
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });

  it("端口占用 / 非法端口 / 缺产物目录都明确报错，不静默降级", async () => {
    // 非 1024-65535 的整数
    await expect(startMobileWebService({ staticRoot: root, port: 80 })).rejects.toThrow(/Invalid mobile web port/);
    await expect(startMobileWebService({ staticRoot: root, port: 70_000 })).rejects.toThrow(/Invalid mobile web port/);
    // 产物目录缺失 / 不完整
    await expect(startMobileWebService({ staticRoot: path.join(fixture, "missing") })).rejects.toThrow(/static root is missing/);
    const incomplete = path.join(fixture, "incomplete");
    fs.mkdirSync(incomplete);
    await expect(startMobileWebService({ staticRoot: incomplete })).rejects.toThrow(/build is incomplete/);
    // 外部进程占用端口 → EADDRINUSE 明确抛出
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(port, "0.0.0.0", () => resolve()));
    try {
      await expect(startMobileWebService({ staticRoot: root, port })).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("getMobileWebStatus 反映运行态，stop 后可重新启动", async () => {
    expect(getMobileWebStatus().running).toBe(false);
    await start();
    expect(getMobileWebStatus()).toMatchObject({ running: true, port, staticRoot: root });
    await stopMobileWebService();
    expect(getMobileWebStatus().running).toBe(false);
    await start();
    expect(getMobileWebStatus().running).toBe(true);
  });

  it("静态根位于符号链接路径下时资源仍可访问（root 与 realpath 前缀一致）", async () => {
    // 复现 macOS /var → /private/var 这类软链：若不把静态根也 realpath，
    // resolveStaticFile 会把「root 内的资源」误判成越界，所有静态资源 404。
    const link = path.join(fixture, "linked-dist");
    fs.symlinkSync(root, link, "dir");
    await startMobileWebService({
      staticRoot: link,
      port,
      lanAddresses: () => [LAN_IP],
      hostname: "testhost",
    });
    const index = await request(port, "/");
    expect(index.status).toBe(200);
    expect(index.body).toContain("SPA-ROOT");
    const asset = await request(port, "/assets/index-ABC12345.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });
});

// ── PWA manifest 与桌面图标 ────────────────────────────────────────────────
describe("PWA manifest 与桌面图标静态资源", () => {
  const MANIFEST_BODY = JSON.stringify({
    name: "EasyMint Remote",
    short_name: "EasyMint",
    start_url: "/",
    display: "standalone",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  });

  // 自己写产物到注入的临时静态根，不依赖 Web 前端 dist。
  beforeEach(() => {
    write("dist/manifest.webmanifest", MANIFEST_BODY);
    write("dist/icon-192.png", "PNG-192-BYTES");
    write("dist/icon-512.png", "PNG-512-BYTES");
    write("dist/apple-touch-icon.png", "PNG-APPLE-TOUCH-BYTES");
  });

  it("GET /manifest.webmanifest 返回 application/manifest+json、body 原样、no-cache 不带 immutable", async () => {
    await start();
    const res = await request(port, "/manifest.webmanifest");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/manifest+json");
    expect(res.body).toBe(MANIFEST_BODY);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["cache-control"]).not.toContain("immutable");
  });

  it("GET 图标返回 image/png；apple-touch-icon 不被隐藏文件拦截、同样 no-cache 不带 immutable", async () => {
    await start();
    for (const p of ["/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"]) {
      const res = await request(port, p);
      expect(res.status, p).toBe(200);
      expect(res.headers["content-type"], p).toContain("image/png");
      // apple-touch-icon.png 的 `touch-icon` 段会被哈希正则误命中，需确认未被扣上 immutable。
      expect(res.headers["cache-control"], p).toBe("no-cache");
      expect(res.headers["cache-control"], p).not.toContain("immutable");
    }
  });

  it("HEAD /manifest.webmanifest 状态与头一致、无响应体", async () => {
    await start();
    const get = await request(port, "/manifest.webmanifest");
    const head = await request(port, "/manifest.webmanifest", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.status).toBe(get.status);
    expect(head.headers["content-type"]).toBe(get.headers["content-type"]);
    expect(head.headers["cache-control"]).toBe(get.headers["cache-control"]);
    expect(head.body).toBe("");
  });

  it("POST /manifest.webmanifest 走既有方法校验：405 且带 Allow", async () => {
    await start();
    const res = await request(port, "/manifest.webmanifest", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET, HEAD");
  });

  it("命中端点走既有 Host 校验：非白名单 Host 请求 manifest 403", async () => {
    await start();
    const res = await request(port, "/manifest.webmanifest", { headers: { Host: `attacker.test:${port}` } });
    expect(res.status).toBe(403);
  });

  it("命中端点走既有 Sec-Fetch-Site 校验：cross-site 请求 manifest 403", async () => {
    await start();
    const res = await request(port, "/manifest.webmanifest", { headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(res.status).toBe(403);
  });
});

describe("MobileWebController", () => {
  it("开启失败（EADDRINUSE）时回滚磁盘开关，设置值与运行态保持一致", async () => {
    // 占用端口，让 startMobileWebService 监听失败
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(port, "0.0.0.0", () => resolve()));
    const prevRoot = process.env.EM_MOBILE_WEB_ROOT;
    process.env.EM_MOBILE_WEB_ROOT = root; // 注入临时静态根，不依赖 Web 前端产物
    let settings: { mobileWebEnabled: boolean; mobileWebPort: number } = { mobileWebEnabled: false, mobileWebPort: port };
    const store = {
      getSettings: () => ({ ...settings }),
      saveSettings: (next: { mobileWebEnabled: boolean; mobileWebPort: number }) => { settings = { ...next }; },
    };
    const deps = {
      store,
      remoteTerminalService: {
        ensureStarted: async () => {},
        isRunning: () => false,
        emit: () => true,
        listDevices: () => [],
      },
      broadcast: () => {},
      isWindows: false,
    };
    mobileWebController.configure(deps as unknown as MobileWebControllerDeps);
    try {
      await expect(mobileWebController.setEnabled(true)).rejects.toThrow();
      expect(settings.mobileWebEnabled).toBe(false);
      expect(mobileWebController.getStatus().enabled).toBe(false);
      expect(mobileWebController.getStatus().running).toBe(false);
    } finally {
      if (prevRoot === undefined) delete process.env.EM_MOBILE_WEB_ROOT;
      else process.env.EM_MOBILE_WEB_ROOT = prevRoot;
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
      await stopMobileWebService();
    }
  });
});

// ── 短码查表端点（S2/S3）────────────────────────────────────────────────────
function pairPayload(overrides: Partial<PairLinkPayload> = {}): PairLinkPayload {
  return {
    version: 1,
    token: "test-token",
    pcId: "test-pc",
    pcName: "Test PC",
    addresses: [LAN_IP],
    port: MOBILE_WEB_WS_PORT,
    publicKey: "test-pubkey",
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe("pair link /pair/<code>.json 端点", () => {
  it("命中返回与旧 #pair= payload 同形的 8 字段对象、application/json、no-store", async () => {
    const payload = pairPayload();
    const { code } = registerPairOffer(payload);
    await start();
    const res = await request(port, `/pair/${code}.json`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = JSON.parse(res.body);
    expect(body).toEqual(payload);
    expect(typeof body.version).toBe("number");
    expect(typeof body.token).toBe("string");
    expect(typeof body.pcId).toBe("string");
    expect(typeof body.pcName).toBe("string");
    expect(Array.isArray(body.addresses)).toBe(true);
    expect(typeof body.port).toBe("number");
    expect(typeof body.publicKey).toBe("string");
    expect(typeof body.expiresAt).toBe("number");
  });

  it("短码过期前可重复读（不承担 token 一次性消费语义）", async () => {
    const { code } = registerPairOffer(pairPayload());
    await start();
    expect((await request(port, `/pair/${code}.json`)).status).toBe(200);
    expect((await request(port, `/pair/${code}.json`)).status).toBe(200);
  });

  it("格式合法但未登记的 code 返回 404 空体", async () => {
    await start();
    const res = await request(port, "/pair/AAAAAAAAAA.json");
    expect(res.status).toBe(404);
    expect(res.body).toBe("");
  });

  it("非法短码（长度/字符不符）一律 404 空体", async () => {
    await start();
    for (const p of ["/pair/abc.json", "/pair/abcdefghijk.json", "/pair/abcd!fghij.json"]) {
      const res = await request(port, p);
      expect(res.status, p).toBe(404);
      expect(res.body, p).toBe("");
    }
  });

  it("过期短码返回 404 空体", async () => {
    const { code } = registerPairOffer(pairPayload({ expiresAt: Date.now() - 1_000 }));
    await start();
    const res = await request(port, `/pair/${code}.json`);
    expect(res.status).toBe(404);
    expect(res.body).toBe("");
  });

  it("命中端点走既有方法校验：POST 405 且带 Allow", async () => {
    const { code } = registerPairOffer(pairPayload());
    await start();
    const res = await request(port, `/pair/${code}.json`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET, HEAD");
  });

  it("命中端点走既有 Host 校验：非白名单 Host 403", async () => {
    const { code } = registerPairOffer(pairPayload());
    await start();
    const res = await request(port, `/pair/${code}.json`, { headers: { Host: `attacker.test:${port}` } });
    expect(res.status).toBe(403);
  });

  it("HEAD 命中返回状态与头、无响应体", async () => {
    const { code } = registerPairOffer(pairPayload());
    await start();
    const res = await request(port, `/pair/${code}.json`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.body).toBe("");
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("合法 /pair/ 路径不被越界检测误伤，含编码 .. 仍 404 空体", async () => {
    const { code } = registerPairOffer(pairPayload());
    await start();
    expect((await request(port, `/pair/${code}.json`)).status).toBe(200);
    for (const p of ["/pair/%2e%2e/outside.json", "/pair/../outside.json"]) {
      const res = await request(port, p);
      expect(res.status, p).toBe(404);
      expect(res.body, p).toBe("");
    }
  });
});


it("开网页通道会让共享桥接端口按需起来（端口共享，不是 App 专属）", async () => {
  const freePort = await new Promise<number>((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "0.0.0.0", () => {
      const address = probe.address();
      const chosen = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(chosen));
    });
  });
  const prevRoot = process.env.EM_MOBILE_WEB_ROOT;
  process.env.EM_MOBILE_WEB_ROOT = root;
  let bridgeSyncs = 0;
  let settings: { mobileWebEnabled: boolean; mobileWebPort: number } = { mobileWebEnabled: false, mobileWebPort: freePort };
  mobileWebController.configure({
    store: {
      getSettings: () => ({ ...settings }),
      saveSettings: (next: { mobileWebEnabled: boolean; mobileWebPort: number }) => { settings = { ...next }; },
    },
    ensureBridge: async () => { bridgeSyncs += 1; },
    remoteTerminalService: {
      ensureStarted: async () => {},
      isRunning: () => false,
      emit: () => true,
      listDevices: () => [],
    },
    broadcast: () => {},
    isWindows: false,
  } as unknown as MobileWebControllerDeps);
  try {
    await mobileWebController.setEnabled(true);
    // 浏览器要连 47778，所以网页通道开启时要请求同步共享端口（由两个开关合算）
    expect(bridgeSyncs).toBeGreaterThan(0);
    expect(mobileWebController.getStatus().running).toBe(true);
    // 端口是否真的在听由 remoteTerminalService 决定，这里如实透传
    expect(mobileWebController.getStatus().bridgeReady).toBe(false);
  } finally {
    if (prevRoot === undefined) delete process.env.EM_MOBILE_WEB_ROOT;
    else process.env.EM_MOBILE_WEB_ROOT = prevRoot;
    await stopMobileWebService();
  }
});

describe("短码表容量 / 过期惰性清理", () => {
  it("容量上限：连续登记超过上限后最早条目被淘汰、最新条目仍可读", () => {
    const codes: string[] = [];
    for (let i = 0; i < 64; i++) codes.push(registerPairOffer(pairPayload()).code);
    expect(resolvePairOffer(codes[0])).toBeNull();
    expect(resolvePairOffer(codes[63])).not.toBeNull();
  });

  it("过期条目惰性清理：过期读返回 null，且不永久占用容量", () => {
    const expired = registerPairOffer(pairPayload({ expiresAt: Date.now() - 1_000 }));
    expect(resolvePairOffer(expired.code)).toBeNull();
    for (let i = 0; i < 40; i++) registerPairOffer(pairPayload({ expiresAt: Date.now() - 1_000 }));
    const fresh = registerPairOffer(pairPayload());
    expect(resolvePairOffer(fresh.code)).not.toBeNull();
  });

  it("浏览器通道关着时拒绝签发短码（否则会指向一个连不上的配对）", async () => {
    let settings: { mobileWebEnabled: boolean; mobileWebPort: number } = {
      mobileWebEnabled: false, mobileWebPort: MOBILE_WEB_WS_PORT,
    };
    let offers = 0;
    mobileWebController.configure({
      store: {
        getSettings: () => ({ ...settings }),
        saveSettings: (next: { mobileWebEnabled: boolean; mobileWebPort: number }) => { settings = { ...next }; },
      },
      remoteTerminalService: {
        // 开关关着就不该走到签发：走到这里等于又把 47778 拉起来了
        createPairingOffer: async () => { offers += 1; throw new Error("不该被调用"); },
        ensureStarted: async () => {},
        isRunning: () => true,
        emit: () => true,
        listDevices: () => [],
      },
      broadcast: () => {},
      isWindows: false,
    } as unknown as MobileWebControllerDeps);

    await expect(mobileWebController.createPairLink()).rejects.toThrow(/浏览器/);
    expect(offers).toBe(0);
  });
});
