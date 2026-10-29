/**
 * 系统代理接管（`services/system-proxy.ts`）的守卫测试。
 *
 * 背景（2026-09-15 实测）：Node 原生 fetch 不读系统代理、也不读 HTTPS_PROXY，于是
 * 「浏览器授权页显示成功（Chromium 走代理）、程序内换 token 被地区拦」——用户实际踩到。
 * 这里钉住三件事：
 * ① 检测解析（macOS `scutil --proxy` / Windows `reg query` 的真实输出形态）；
 * ② 本机/NO_PROXY 必须直连（乱挂代理会把本地服务打穿）；
 * ③ 检测不到代理时**一个字节都不改**（默认路径上的用户不该受这个特性影响）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  detectSystemProxy,
  detectSystemProxyExceptions,
  installSystemProxyFetch,
  parseScutilExceptions,
  parseScutilProxy,
  parseWindowsProxy,
  parseWindowsProxyOverride,
  redactProxyUrl,
  shouldBypassProxy,
} from "./system-proxy";

/** 用户机器上的真实输出（2026-09-15，VPN 客户端的系统代理） */
const SCUTIL_HTTPS = `<dictionary> {
  ExceptionsList : <array> {
    0 : localhost
    1 : 127.0.0.1/8
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 9527
  HTTPProxy : localhost
  HTTPSEnable : 1
  HTTPSPort : 9527
  HTTPSProxy : localhost
  SOCKSEnable : 1
  SOCKSPort : 9527
  SOCKSProxy : localhost
}`;

const REG_WINDOWS = `HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:7890
`;

describe("代理检测", () => {
  it("macOS scutil：优先 HTTPS 条目，关闭时回落到 HTTP", () => {
    expect(parseScutilProxy(SCUTIL_HTTPS)).toBe("http://localhost:9527");
    expect(parseScutilProxy(SCUTIL_HTTPS.replace("HTTPSEnable : 1", "HTTPSEnable : 0")))
      .toBe("http://localhost:9527"); // 落到 HTTP 条目，同样是 9527
    expect(parseScutilProxy(SCUTIL_HTTPS.replace(/HTTPSEnable : 1/, "HTTPSEnable : 0")
      .replace("HTTPEnable : 1", "HTTPEnable : 0"))).toBeUndefined();
    expect(parseScutilProxy("")).toBeUndefined();
  });

  it("macOS scutil：SOCKS-only 不算（undici 的 ProxyAgent 不支持 SOCKS）", () => {
    const socksOnly = `<dictionary> {
  HTTPEnable : 0
  HTTPSEnable : 0
  SOCKSEnable : 1
  SOCKSPort : 1080
  SOCKSProxy : localhost
}`;
    expect(parseScutilProxy(socksOnly)).toBeUndefined();
  });

  it("Windows reg query：ProxyEnable=0 时不认，两种 ProxyServer 形态都认", () => {
    expect(parseWindowsProxy(REG_WINDOWS)).toBe("http://127.0.0.1:7890");
    expect(parseWindowsProxy(REG_WINDOWS.replace("0x1", "0x0"))).toBeUndefined();
    expect(parseWindowsProxy(
      '    ProxyEnable    REG_DWORD    0x1\n    ProxyServer    REG_SZ    http=127.0.0.1:7890;https=127.0.0.1:7891\n',
    )).toBe("http://127.0.0.1:7891");
  });

  it("来源顺序：环境变量优先于系统设置；darwin 走 scutil", () => {
    const run = vi.fn(() => SCUTIL_HTTPS);
    expect(detectSystemProxy({ platform: "darwin", env: { https_proxy: "http://env:1" }, run }))
      .toBe("http://env:1");
    expect(run).not.toHaveBeenCalled();
    expect(detectSystemProxy({ platform: "darwin", env: {}, run })).toBe("http://localhost:9527");
    // 无协议头的写法补成 http://
    expect(detectSystemProxy({ platform: "linux", env: { ALL_PROXY: "127.0.0.1:1080", https_proxy: "" } }))
      .toBe("http://127.0.0.1:1080");
    expect(detectSystemProxy({ platform: "linux", env: {} })).toBeUndefined();
  });

  it("本机与 NO_PROXY 一律直连（否则本地服务会被代理打穿）", () => {
    const no = "";
    for (const host of ["localhost", "127.0.0.1", "127.0.0.53", "::1", "app.localhost"]) {
      expect(shouldBypassProxy(host, no)).toBe(true);
    }
    expect(shouldBypassProxy("auth.openai.com", no)).toBe(false);
    expect(shouldBypassProxy("api.example.com", "example.com")).toBe(true);
    expect(shouldBypassProxy("example.com", ".example.com")).toBe(true);
    expect(shouldBypassProxy("other.com", "*")).toBe(true);
    expect(shouldBypassProxy("notexample.com", "example.com")).toBe(false);
  });

  it("私有/本地网络一律直连：RFC1918 + 链路本地 + CGNAT（Tailscale）", () => {
    const no = "";
    const local = [
      "10.0.0.1", "10.255.255.254",                                  // 10/8
      "172.16.0.1", "172.31.255.254",                                // 172.16/12（两端）
      "192.168.0.1", "192.168.5.2", "192.168.255.254",               // 192.168/16
      "169.254.1.1",                                                 // 链路本地（APIPA）
      "100.64.0.1", "100.127.255.254",                               // CGNAT 100.64/10（Tailscale 常用）
    ];
    for (const host of local) expect(shouldBypassProxy(host, no), host).toBe(true);

    // 边界外必须仍然走代理——这是最容易写错的一段（相邻网段只差一位）
    const remote = [
      "9.255.255.255", "11.0.0.0",                                   // 10/8 两侧
      "172.15.255.255", "172.32.0.0",                                // 172.16/12 两侧
      "192.167.255.255", "192.169.0.0",                              // 192.168/16 两侧
      "100.63.255.255", "100.128.0.0",                               // 100.64/10 两侧
      "8.8.8.8", "1.1.1.1", "128.0.0.1",                             // 公网（含环回的邻居段）
    ];
    for (const host of remote) expect(shouldBypassProxy(host, no), host).toBe(false);
  });

  it("IPv6：ULA / 链路本地 / IPv4-mapped 按内嵌地址判", () => {
    const no = "";
    for (const host of ["fc00::1", "fd12:3456:789a::1", "fe80::1", "febf::1", "[fd00::5]"]) {
      expect(shouldBypassProxy(host, no), host).toBe(true);
    }
    expect(shouldBypassProxy("::ffff:192.168.1.5", no)).toBe(true);   // IPv4-mapped 到私网
    for (const host of ["2001:db8::1", "2606:4700::1111", "::ffff:8.8.8.8"]) {
      expect(shouldBypassProxy(host, no), host).toBe(false);
    }
  });

  it("内网域名与单标签主机名直连（`nas`、`box.local` 这类靠 mDNS / search domain 解析的名字）", () => {
    const no = "";
    for (const host of ["nas", "mymac", "box.local", "printer.lan", "svc.internal", "git.corp", "db.home"]) {
      expect(shouldBypassProxy(host, no), host).toBe(true);
    }
    for (const host of ["auth.openai.com", "api.deepseek.com", "192-168-1-5.example.com"]) {
      expect(shouldBypassProxy(host, no), host).toBe(false);
    }
  });

  it("系统例外列表（macOS ExceptionsList / Windows ProxyOverride）也参与判定", () => {
    expect(parseScutilExceptions(SCUTIL_HTTPS)).toEqual(["localhost", "127.0.0.1/8"]);
    expect(parseScutilExceptions("")).toEqual([]);

    // macOS 用 CIDR 表达网段——这条以前不生效（旧实现只做字符串比较），现在必须认
    const ex = ["localhost", "127.0.0.1/8", "192.168.0.0/16"];
    expect(shouldBypassProxy("127.0.0.5", "", { exceptions: ex })).toBe(true);
    expect(shouldBypassProxy("192.168.7.7", "", { exceptions: ex })).toBe(true);
    // 例外列表与"私网自动旁路"是两套机制，必须能各自独立验证：
    // ① 用公网段的 CIDR 作例外，命中它纯粹是列表的功劳（私网规则不会碰到公网地址）
    const exPublic = ["203.0.113.0/24"];
    expect(shouldBypassProxy("203.0.113.9", "", { exceptions: exPublic })).toBe(true);
    expect(shouldBypassProxy("203.0.114.9", "", { exceptions: exPublic })).toBe(false);
    // ② 关掉私网自动旁路后，例外列表里那条仍然救得回它
    expect(shouldBypassProxy("192.168.7.7", "", { exceptions: ex, bypassLocalNetwork: false })).toBe(true);

    // Windows：`<local>` 等价于"不含点的主机名"，`*.suffix` 是通配后缀
    const winOut = `    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:7890
    ProxyOverride  REG_SZ    *.corp.example.com;wiki;<local>
`;
    const winEx = parseWindowsProxyOverride(winOut);
    expect(winEx).toContain("<local>");
    expect(shouldBypassProxy("git.corp.example.com", "", { exceptions: winEx })).toBe(true);
    expect(shouldBypassProxy("public.example.com", "", { exceptions: winEx })).toBe(false);
    // ProxyEnable=0 时不取例外（代理本来就没启用）
    expect(parseWindowsProxyOverride(winOut.replace("0x1", "0x0"))).toEqual([]);
  });

  it("局域网直连可被 EASYMINT_PROXY_LAN=1 关掉，但环回永远直连", () => {
    const off = { bypassLocalNetwork: false };
    expect(shouldBypassProxy("192.168.5.2", "", off)).toBe(false);
    expect(shouldBypassProxy("nas", "", off)).toBe(false);
    expect(shouldBypassProxy("127.0.0.1", "", off)).toBe(true);      // 环回不受该开关影响
    expect(shouldBypassProxy("localhost", "", off)).toBe(true);
    // 显式 NO_PROXY 仍然生效（用户怎么写就怎么算）
    expect(shouldBypassProxy("192.168.5.2", "192.168.5.2", off)).toBe(true);
  });

  it("系统例外列表只在代理来自系统设置时读取（env 代理的例外以 NO_PROXY 为准）", () => {
    const run = vi.fn(() => SCUTIL_HTTPS);
    expect(detectSystemProxyExceptions({ platform: "darwin", env: {}, run })).toEqual(["localhost", "127.0.0.1/8"]);
    expect(run).toHaveBeenCalledTimes(1);

    const run2 = vi.fn(() => SCUTIL_HTTPS);
    expect(detectSystemProxyExceptions({ platform: "darwin", env: { https_proxy: "http://env:1" }, run: run2 })).toEqual([]);
    expect(run2).not.toHaveBeenCalled();
    expect(detectSystemProxyExceptions({ platform: "linux", env: {} })).toEqual([]);
  });
});

describe("接管 fetch", () => {
  const makeTarget = () => {
    const calls: Array<{ url: string; init?: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (input: unknown, init?: Record<string, unknown>) => {
      const url = typeof input === "string" ? input : (input as URL).href;
      calls.push({ url, init });
      return new Response("ok");
    });
    return { target: { fetch: fetchImpl as unknown as typeof fetch }, calls, fetchImpl };
  };

  it("检测到代理：非本机请求补 dispatcher，本机请求保持原样", async () => {
    const { target, calls } = makeTarget();
    const agent = { name: "agent" };
    const createAgent = vi.fn(async () => agent);
    const env: NodeJS.ProcessEnv = {};

    const r = installSystemProxyFetch({ platform: "darwin", env, run: () => SCUTIL_HTTPS, createAgent, target });
    expect(r).toMatchObject({ installed: true, proxy: "http://localhost:9527" });

    await target.fetch("https://auth.openai.com/oauth/token", { method: "POST" });
    await target.fetch("http://127.0.0.1:5199/api");
    await target.fetch("http://localhost:1455/auth/callback");

    expect(calls[0].init?.dispatcher).toBe(agent);
    expect(calls[1].init?.dispatcher).toBeUndefined();
    expect(calls[2].init?.dispatcher).toBeUndefined();
    expect(createAgent).toHaveBeenCalledTimes(1); // agent 只建一次，后续复用
    // 代理变量写进 env：SDK 自己的 LLM 路径（Codex WebSocket / Bedrock）读的是这些
    expect(env.https_proxy).toBe("http://localhost:9527");
    expect(env.no_proxy).toContain("localhost");
  });

  it("局域网模型服务直连：VPN 的代理不会把它吞掉（用户 2026-09-15 实际踩到）", async () => {
    const { target, calls } = makeTarget();
    const agent = { name: "agent" };
    installSystemProxyFetch({
      platform: "darwin", env: {}, run: () => SCUTIL_HTTPS, createAgent: async () => agent, target,
    });

    await target.fetch("http://192.168.5.2:8888/v1/models");            // 局域网里的模型服务
    await target.fetch("http://mymac:11434/api/tags");                  // 单标签主机名（mDNS / search domain）
    await target.fetch("http://box.local:1234/v1/chat/completions");    // 内网后缀
    await target.fetch("https://api.deepseek.com/v1/chat/completions"); // 公网仍须走代理

    expect(calls.slice(0, 3).map((c) => c.init?.dispatcher)).toEqual([undefined, undefined, undefined]);
    expect(calls[3].init?.dispatcher).toBe(agent);
  });

  it("EASYMINT_PROXY_LAN=1：连局域网也走代理（少数环境的显式选择）", async () => {
    const { target, calls } = makeTarget();
    const agent = { name: "agent" };
    const env: NodeJS.ProcessEnv = { EASYMINT_PROXY_LAN: "1" };
    installSystemProxyFetch({
      platform: "darwin", env, run: () => SCUTIL_HTTPS, createAgent: async () => agent, target,
    });

    await target.fetch("http://192.168.5.2:8888/v1/models");
    await target.fetch("http://127.0.0.1:5199/api"); // 环回不受该开关影响

    expect(calls[0].init?.dispatcher).toBe(agent);
    expect(calls[1].init?.dispatcher).toBeUndefined();
    // 开关关掉"局域网直连"时，NO_PROXY 默认值必须同步退回"只剩环回"——
    // 否则默认串里的私网 CIDR 会把开关顶回去（两份默认值自相矛盾）
    expect(env.no_proxy).not.toContain("192.168.0.0/16");
    expect(env.no_proxy).toContain("localhost");
  });

  it("调用方自带 dispatcher 时不覆盖（那条路怎么走由调用方决定）", async () => {
    const { target, calls } = makeTarget();
    const mine = { name: "caller-agent" };
    installSystemProxyFetch({
      platform: "darwin", env: {}, run: () => SCUTIL_HTTPS, createAgent: async () => ({ name: "ours" }), target,
    });

    await target.fetch("https://api.deepseek.com/v1/chat/completions", { dispatcher: mine } as never);

    expect(calls[0].init?.dispatcher).toBe(mine);
  });

  it("写进 env 的 NO_PROXY 覆盖内网后缀与私网网段（子进程里的 curl 靠它直连）", () => {
    const { target } = makeTarget();
    const env: NodeJS.ProcessEnv = {};
    installSystemProxyFetch({
      platform: "darwin", env, run: () => SCUTIL_HTTPS, createAgent: async () => ({}), target,
    });
    for (const entry of [".local", ".lan", ".internal", "192.168.0.0/16", "10.0.0.0/8", "100.64.0.0/10"]) {
      expect(env.no_proxy, entry).toContain(entry);
    }
    expect(env.no_proxy).toContain("localhost");
    expect(env.NO_PROXY).toBe(env.no_proxy);
  });

  it("用户已显式设置的代理变量不被覆盖", () => {
    const { target } = makeTarget();
    const env: NodeJS.ProcessEnv = { https_proxy: "http://user:1" };
    installSystemProxyFetch({ platform: "darwin", env: { ...env }, run: () => SCUTIL_HTTPS, createAgent: async () => ({}), target });
    expect(env.https_proxy).toBe("http://user:1");
  });

  it("没检测到代理 → 不接管、不改任何环境变量", async () => {
    const { target, calls } = makeTarget();
    const env: NodeJS.ProcessEnv = {};
    const r = installSystemProxyFetch({ platform: "linux", env, run: () => "", createAgent: vi.fn(), target });
    expect(r.installed).toBe(false);
    expect(r.reason).toContain("未检测到");
    await target.fetch("https://auth.openai.com/oauth/token");
    expect(calls[0].init?.dispatcher).toBeUndefined();
    expect(env.https_proxy).toBeUndefined();
  });

  it("逃生阀：EASYMINT_NO_SYSTEM_PROXY=1 时不接管（即使有代理）", async () => {
    const { target, calls } = makeTarget();
    const env: NodeJS.ProcessEnv = { EASYMINT_NO_SYSTEM_PROXY: "1" };
    const r = installSystemProxyFetch({ platform: "darwin", env, run: () => SCUTIL_HTTPS, createAgent: vi.fn(), target });
    expect(r.installed).toBe(false);
    await target.fetch("https://auth.openai.com/oauth/token");
    expect(calls[0].init?.dispatcher).toBeUndefined();
  });
});

describe("代理地址脱敏（日志用）", () => {
  it("带凭据的代理：只打码 userinfo，主机与端口保持原样（排查要看的是后者）", () => {
    // 企业代理常见形态；原样打印等于把密码写进用户截图、反馈贴、CI 日志
    expect(redactProxyUrl("http://user:pass@proxy.corp:8080")).toBe("http://***@proxy.corp:8080");
    expect(redactProxyUrl("http://user:pass@proxy.corp:8080")).not.toContain("pass");
    // 只有用户名（无密码）同样算凭据
    expect(redactProxyUrl("http://token@127.0.0.1:9527")).toBe("http://***@127.0.0.1:9527");
  });

  it("无凭据/空串/解析不出 scheme：原样返回（少脱敏也不改写语义）", () => {
    expect(redactProxyUrl("http://127.0.0.1:9527")).toBe("http://127.0.0.1:9527");
    expect(redactProxyUrl("")).toBe("");
    expect(redactProxyUrl("proxy.corp:8080")).toBe("proxy.corp:8080");
  });
});

/**
 * 代理串本身不合法时**不要接管**。
 *
 * 起因：undici 的 ProxyAgent 在首次发请求时才 `new URL(代理地址)`，不合法就抛
 * `TypeError: Invalid URL`——与"目标地址不合法"同形，上游容易把代理问题报成
 * 「Base URL 格式不正确」（用户实测的那条看不懂的报错）。与其让**每个**请求都失败并
 * 误导归因，不如放弃接管（与"没检测到代理"同效），并在启动日志里留下脱敏后的值。
 */
describe("代理地址无法解析时不接管", () => {
  const makeTarget = () => {
    const calls: Array<{ url: string; init?: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (input: unknown, init?: Record<string, unknown>) => {
      const url = typeof input === "string" ? input : (input as URL).href;
      calls.push({ url, init });
      return new Response("ok");
    });
    return { target: { fetch: fetchImpl as unknown as typeof fetch }, calls };
  };

  it("env 里是残缺的代理地址 → installed:false，fetch 保持原样", async () => {
    const { target, calls } = makeTarget();
    const original = target.fetch;
    const env: NodeJS.ProcessEnv = { https_proxy: "http://" }; // 有 scheme 无主机
    const r = installSystemProxyFetch({ platform: "darwin", env, run: () => "", target });
    expect(r).toMatchObject({ installed: false, reason: "系统代理地址无法解析" });
    expect(target.fetch).toBe(original);
    await target.fetch("https://api.example.com/v1");
    expect(calls[0].init?.dispatcher).toBeUndefined();
    // 失败也不该把残缺值写进 env 交给子进程/SDK
    expect(env.HTTPS_PROXY).toBeUndefined();
  });

  it("正常代理地址照旧接管（守住守卫本身不过度拒绝）", async () => {
    const { target } = makeTarget();
    const env: NodeJS.ProcessEnv = { https_proxy: "127.0.0.1:7890" }; // 缺 scheme 会被补成 http://
    const r = installSystemProxyFetch({ platform: "darwin", env, run: () => "", createAgent: async () => ({}), target });
    expect(r).toMatchObject({ installed: true, proxy: "http://127.0.0.1:7890" });
  });
});
