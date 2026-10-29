/**
 * 回调端口预检——只锁两件事：
 * ① 探测本身判得准（空着 = null，被占 = EADDRINUSE）；
 * ② 登记表只放**端口写死**的供应商（anthropic 绑不上会退到随机端口，登记了反而误报）。
 *
 * 为什么不测 EACCES：那是 Windows 的 Winsock 10013（系统端口保留），macOS 造不出来，
 * 按代码路径给的理由见 oauth-loopback.ts 顶部；这里只用"被占用"验证 errno 透传没丢。
 */
import { describe, expect, it, vi } from "vitest";
import net from "node:net";
import { FIXED_LOOPBACK_PORTS, oauthCallbackHost, probeLoopbackPort } from "./oauth-loopback";

/** 取一个当前空闲的端口：让系统分配后再立刻释放 */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe("probeLoopbackPort", () => {
  it("端口空着返回 null（探测自己会释放，不留占用）", async () => {
    const port = await freePort();
    expect(await probeLoopbackPort(port)).toBeNull();
    // 再探一次仍然可用：证明上一次探测确实松手了
    expect(await probeLoopbackPort(port)).toBeNull();
  });

  it("已有监听时返回 EADDRINUSE 并带出端口号", async () => {
    const holder = net.createServer();
    await new Promise<void>((resolve) => { holder.listen({ port: 0, host: "127.0.0.1" }, () => resolve()); });
    const port = (holder.address() as net.AddressInfo).port;
    const blocked = await probeLoopbackPort(port);
    await new Promise<void>((resolve) => { holder.close(() => resolve()); });
    expect(blocked).toEqual({ port, code: "EADDRINUSE" });
  });
});

describe("FIXED_LOOPBACK_PORTS", () => {
  it("openai-codex 的 1455 必须登记（redirect_uri 写死，没有退路）", () => {
    expect(FIXED_LOOPBACK_PORTS["openai-codex"]).toBe(1455);
  });

  it("anthropic 不登记：它绑不上会退到随机空闲端口，登记只会误报", () => {
    expect(FIXED_LOOPBACK_PORTS.anthropic).toBeUndefined();
  });
});

/**
 * host 必须与 SDK 同口径，否则探测结论和"浏览器能不能跳回来"无关：
 * SDK 是 `PI_OAUTH_CALLBACK_HOST || "127.0.0.1"`（pi-ai 的 getCallbackHost）。
 */
describe("探测的绑定地址与 SDK 同口径", () => {
  it("认 PI_OAUTH_CALLBACK_HOST；空值回落 127.0.0.1", () => {
    vi.stubEnv("PI_OAUTH_CALLBACK_HOST", "127.0.0.1");
    expect(oauthCallbackHost()).toBe("127.0.0.1");
    vi.stubEnv("PI_OAUTH_CALLBACK_HOST", "");
    expect(oauthCallbackHost()).toBe("127.0.0.1");
    vi.stubEnv("PI_OAUTH_CALLBACK_HOST", "::1");
    expect(oauthCallbackHost()).toBe("::1");
    vi.unstubAllEnvs();
    delete process.env.PI_OAUTH_CALLBACK_HOST;
    expect(oauthCallbackHost()).toBe("127.0.0.1");
  });

  /**
   * 探测必须"探测完就把端口还回去"：紧接着要绑这个端口的是 SDK 的回调服务。
   * 这里不等 tick、探测一返回就立刻绑，绑不上就说明探测留了残留。
   */
  it("探测返回后，端口可以立刻被别人绑定", async () => {
    const port = await freePort();
    expect(await probeLoopbackPort(port)).toBeNull();
    const holder = net.createServer();
    await new Promise<void>((resolve, reject) => {
      holder.once("error", reject);
      holder.listen({ port, host: "127.0.0.1" }, () => resolve());
    });
    await new Promise<void>((resolve) => { holder.close(() => resolve()); });
  });
});
