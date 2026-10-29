/**
 * 让主进程的 HTTP 请求跟随系统代理。
 *
 * 为什么需要（2026-09-15 实测，别再重新推导）：
 * Node 原生 fetch（undici）**既不读 macOS 系统代理、也不读 HTTPS_PROXY**：
 *   · 同一条换 token 请求直连 → `403 unsupported_country_region_territory`（OpenAI 按出口地区拦）；
 *     经系统代理（`curl --proxy http://localhost:9527`）→ 通过。
 *   · **运行期改 process.env 无效**：undici 在启动阶段就决定要不要启用环境变量代理
 *     （NODE_USE_ENV_PROXY 必须在启动前给），所以"进程序里再设 HTTPS_PROXY"这条路走不通。
 * 于是出现最容易误判的症状：**浏览器授权页显示 Authentication successful（Chromium 走系统代理），
 * 程序内却报地区拦截** —— 那个成功页是本进程的本地回调服务发的，与换 token 无关。
 *
 * 上游 SDK 的另一半：它自己的 LLM 路径（Codex 的 WebSocket、Bedrock）**另行支持代理**，读的是
 * `https_proxy`/`all_proxy` 环境变量（见 `@earendil-works/pi-ai/dist/utils/node-http-proxy.js`
 * 的 `getProxyEnv`/`resolveHttpProxyUrlForTarget`）；只有 OAuth 换 token 这类裸全局 fetch 没人照顾。
 * 所以本模块在改写 fetch 的同时，也把小写代理变量写进 process.env 供那些路径使用。
 *
 * 策略：检测到代理才动手（检测不到 → 完全不改行为）；**环回、私有/本地网络、系统例外列表**一律直连。
 * 逃生阀：`EASYMINT_NO_SYSTEM_PROXY=1`（整个特性关掉）、`EASYMINT_PROXY_LAN=1`（只关"局域网直连"）。
 *
 * 为什么必须排除私有网络（2026-09-15 实测，用户开着 VPN 时局域网模型不可用）：
 *   · 直连 `http://192.168.5.2:8888/v1/models` → **200**（13ms）；
 *   · 经系统代理（VPN 客户端）请求同一地址 → **超时**（curl 退出码 28），而同一代理访问公网正常。
 *   代理（尤其 VPN 的隧道）通常**只管公网**，把局域网目标交给它 = 请求有去无回。
 *   命令行工具与浏览器不会踩这个坑，因为 curl/wget 认 `NO_PROXY`、Chromium 认系统例外列表；
 *   而 Node 的 fetch 两者都不认（见文件头第一段），所以这套判定只能由我们自己实现。
 */

import { execFileSync } from "node:child_process";

export interface ProxyDeps {
  platform?: string;
  env?: NodeJS.ProcessEnv;
  /** 执行系统命令取 stdout（注入以便测试）；失败应返回空串 */
  run?: (cmd: string, args: string[]) => string;
  /** 建连接代理（默认真实实现为 undici 的 ProxyAgent，动态加载以免拖慢启动） */
  createAgent?: (proxyUrl: string) => Promise<unknown>;
  /** 改写对象（测试注入；默认 globalThis） */
  target?: { fetch: typeof globalThis.fetch };
}

/** 已接管的标记挂在 target 上（而非模块级开关）：语义是「这份 fetch 已被包装过」，测试注入各自的 target 时互不干扰 */
const WRAPPED = Symbol.for("easymint.systemProxyWrapped");

type Marked = { [WRAPPED]?: string };

const LOOPBACK = /^(localhost|.*\.localhost|127(\.\d{1,3}){3}|::1|0\.0\.0\.0|\[::1\])$/i;

/**
 * 私有/本地网络地址段（命中即直连，不进代理）。
 * CGNAT 段 `100.64.0.0/10` 一并纳入：Tailscale 与不少企业 VPN 的虚拟网段取在这里，
 * 它们同属"局域网性质"——交给公网代理只会失败。
 */
const PRIVATE_V4: ReadonlyArray<readonly [string, number]> = [
  ["10.0.0.0", 8],      // RFC 1918
  ["172.16.0.0", 12],   // RFC 1918
  ["192.168.0.0", 16],  // RFC 1918
  ["169.254.0.0", 16],  // 链路本地（APIPA）
  ["100.64.0.0", 10],   // CGNAT / Tailscale 等虚拟局域网
];

/** 只在局域网内解析的域名后缀（`.local` 是 RFC 6762 的 mDNS 保留后缀，Bonjour 专用） */
const LOCAL_SUFFIXES = [".local", ".lan", ".home", ".internal", ".intranet", ".corp", ".localdomain"];

/** 去掉 IPv6 字面量的方括号：`URL.hostname` 对 `http://[::1]/` 返回的是 `[::1]` */
function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** 点分十进制 → 32 位无符号整数；不是 IPv4 字面量则 undefined */
function ipv4ToInt(host: string): number | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return undefined;
  const parts = m.slice(1, 5).map((s) => Number.parseInt(s, 10));
  if (parts.some((n) => n > 255)) return undefined;
  return (((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0);
}

/** `192.168.0.0/16` 形式的网段匹配（裸 IP 视为 /32）。IPv6 或非法输入一律不匹配 */
function cidrMatch(host: string, cidr: string): boolean {
  const [net, bitsRaw] = cidr.split("/");
  const ip = ipv4ToInt(host);
  const netInt = ipv4ToInt(net ?? "");
  if (ip === undefined || netInt === undefined) return false;
  const bits = Number.parseInt(bitsRaw ?? "32", 10);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((netInt & mask) >>> 0);
}

/** IPv6 里的私有/本地段：ULA（fc00::/7）与链路本地（fe80::/10）；IPv4-mapped 按其内嵌的 IPv4 判 */
function isPrivateV6(host: string): boolean {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (mapped) return isLocalNetworkHost(mapped[1]!);
  return /^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]?:/.test(host);
}

/**
 * 是否属于"私有/本地网络"——网络层判定，与用户怎么配 NO_PROXY 无关。
 * 三类：私有地址字面量（含 CGNAT）、内网后缀域名、**不含点的单标签主机名**
 * （`http://nas:8080`、`http://mymac:1234` 这类靠 search domain / mDNS 解析的名字）。
 * 单标签判定与 Windows 代理设置的 `<local>` 记号同义，也是 Chromium 的默认行为。
 */
export function isLocalNetworkHost(hostname: string): boolean {
  const host = stripBrackets(hostname.trim().toLowerCase());
  if (!host) return false;
  if (ipv4ToInt(host) !== undefined) return PRIVATE_V4.some(([net, bits]) => cidrMatch(host, `${net}/${bits}`));
  if (host.includes(":")) return isPrivateV6(host);
  return LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix)) || !host.includes(".");
}

/** NO_PROXY / 例外列表的条目匹配。支持：`*`、裸主机名、`.suffix`、`*.suffix`、CIDR、Windows 的 `<local>` */
function matchesAnyEntry(host: string, list: string): boolean {
  return list
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") return true;
      const bare = stripBrackets(entry).replace(/:\d+$/, "");
      if (bare === "<local>") return !host.includes("."); // Windows 记号：不含点的主机名
      if (bare.includes("/")) return cidrMatch(host, bare); // 系统例外列表用 CIDR 表达网段（如 127.0.0.1/8）
      if (bare.startsWith("*.")) return host.endsWith(bare.slice(1)) || host === bare.slice(2);
      if (bare.startsWith(".")) return host.endsWith(bare) || host === bare.slice(1);
      return host === bare || host.endsWith(`.${bare}`);
    });
}

function normalizeProxyUrl(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
}

/**
 * 代理串本身能不能被 `new URL` 解析。
 *
 * 为什么要在装接管时挡一道：undici 的 `ProxyAgent` 在**构造时**就把代理地址 `new URL()` 一遍
 * （`lib/dispatcher/proxy-agent.js` 构造 → `#getUrl`），不合法即抛 `TypeError: Invalid URL`
 * （本仓 undici 7.29.1 实测）。我们的 agent 是懒构造的，所以爆点落在首个请求那一刻，错误从
 * `fetch()` 冒出来，与"目标地址不合法"同形——上游若按消息文本归类，就会把代理问题报成
 * 「Base URL 格式不正确」（`provider-test.ts` 曾如此，已一并修）。这里提前放弃接管：
 * 效果与"没检测到代理"相同（直连），而不是让**每个**请求都失败。
 */
function isParsableProxyUrl(value: string): boolean {
  try { new URL(value); return true; } catch { return false; }
}

/**
 * 当前生效的系统代理（`http://host:port`，未接管时为 undefined）。
 *
 * 只读接管时留下的标记，不重新探测——探测要跑 `scutil` / `reg query`，逐请求付不起这个成本。
 * 用途：把网络失败归因到"代理"时要有据可依（见 `provider-test.ts` 的失败详情）。
 * `target` 只为测试注入而暴露：接管标记挂在被包装的那份 fetch 上，默认就是 globalThis。
 */
export function currentSystemProxy(target: object = globalThis): string | undefined {
  const marked = (target as Marked)[WRAPPED];
  return typeof marked === "string" ? marked : undefined;
}

/**
 * 把代理 URL 里的凭据打码，**只用于日志/界面**（`http://user:pass@proxy:8080` → `http://***@proxy:8080`）。
 *
 * 为什么需要：代理既可能来自 `https_proxy` 环境变量，也可能来自系统设置，两处都允许
 * `user:pass@host` 形态（企业代理常见）。启动日志会打印代理地址——原样打印等于把密码写进
 * 用户截图、反馈贴、CI 日志。脱敏只动 userinfo 段，主机与端口保持原样（排查时这才是要看的信息）。
 *
 * 三种情况原样返回：无 userinfo、空串、解析不出 scheme 的字符串（宁可少脱敏也不改写语义）。
 */
export function redactProxyUrl(raw: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([\s\S]*)$/i.exec(raw.trim());
  if (!m) return raw;
  const authority = m[2] ?? "";
  const at = authority.lastIndexOf("@"); // 密码里可能含 @：取最后一个才是主机名分隔符
  if (at === -1) return raw;
  return `${m[1]}***@${authority.slice(at + 1)}${m[3]}`;
}

/**
 * 解析 macOS `scutil --proxy` 的输出（纯函数：用真实输出做回归，见 __system-proxy.test.ts）。
 * 优先 HTTPS 条目——它同样是一个 HTTP CONNECT 代理；undici 的 ProxyAgent 不支持 SOCKS，故不取 SOCKS。
 */
export function parseScutilProxy(out: string): string | undefined {
  const value = (key: string): string | undefined =>
    out.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "m"))?.[1]?.trim();
  const enabled = (key: string): boolean => value(key) === "1";
  if (enabled("HTTPSEnable")) {
    const host = value("HTTPSProxy");
    const port = value("HTTPSPort");
    return host && port ? `http://${host}:${port}` : undefined;
  }
  if (enabled("HTTPEnable")) {
    const host = value("HTTPProxy");
    const port = value("HTTPPort");
    return host && port ? `http://${host}:${port}` : undefined;
  }
  return undefined;
}

/**
 * 解析 Windows 注册表 `Internet Settings` 的 `reg query` 输出（纯函数）。
 * ProxyServer 有两种形态：`host:port` 与按协议列举的 `http=host:port;https=host:port`。
 */
export function parseWindowsProxy(out: string): string | undefined {
  if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(out)) return undefined;
  const server = out.match(/ProxyServer\s+REG_SZ\s+(.+?)\s*$/im)?.[1];
  if (!server) return undefined;
  const perProtocol = server.match(/(?:^|;)\s*https=([^;]+)/i)?.[1];
  const host = (perProtocol ?? server.split(";")[0]?.replace(/^[a-z]+=/i, "") ?? "").trim();
  return host ? `http://${host}` : undefined;
}

/** 旁路判定的附加依据 */
export interface BypassOptions {
  /** 系统代理自带的例外列表（macOS `ExceptionsList` / Windows `ProxyOverride`），支持 CIDR 与 `<local>` */
  exceptions?: readonly string[];
  /** 私有/本地网络是否直连。默认 true；`EASYMINT_PROXY_LAN=1` 时传 false（少数环境要求局域网也走代理） */
  bypassLocalNetwork?: boolean;
}

/**
 * 命中即直连：本机/环回、私有本地网络、NO_PROXY 列表、系统例外列表。
 * 判定顺序无关紧要——四者都是"不该进代理"的独立理由。
 */
export function shouldBypassProxy(hostname: string, noProxy: string, opts: BypassOptions = {}): boolean {
  if (LOOPBACK.test(hostname)) return true;
  const host = stripBrackets(hostname.toLowerCase());
  if (opts.bypassLocalNetwork !== false && isLocalNetworkHost(host)) return true;
  return matchesAnyEntry(host, noProxy)
    || (opts.exceptions?.length ? matchesAnyEntry(host, opts.exceptions.join(",")) : false);
}

/** 执行系统命令取 stdout（默认实现；失败返回空串——检测不到代理是正常情况，不该抛） */
function defaultRun(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: "utf-8", timeout: 3000 });
  } catch {
    return "";
  }
}

/** macOS 的代理设置（代理与例外列表都在这一份输出里） */
const SCUTIL = ["/usr/sbin/scutil", ["--proxy"]] as const;
/** Windows 的当前用户 Internet 设置（ProxyServer 与 ProxyOverride 都在这里） */
const REG_INTERNET_SETTINGS = [
  "reg",
  ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
] as const;

/** 代理来源顺序：显式环境变量 → 系统设置。Linux 只认环境变量（桌面环境的图形设置不作为来源） */
export function detectSystemProxy(deps: ProxyDeps = {}): string | undefined {
  const env = deps.env ?? process.env;
  const fromEnv = env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY
    || env.all_proxy || env.ALL_PROXY;
  if (fromEnv) return normalizeProxyUrl(fromEnv);

  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? defaultRun;
  if (platform === "darwin") return parseScutilProxy(run(SCUTIL[0], [...SCUTIL[1]]));
  if (platform === "win32") {
    return parseWindowsProxy(run(REG_INTERNET_SETTINGS[0], [...REG_INTERNET_SETTINGS[1]]));
  }
  return undefined;
}

/**
 * macOS `ExceptionsList`（形如 `0 : localhost`、`1 : 127.0.0.1/8` 的顺序编号行）。
 * **值可以是 CIDR** —— 这正是系统表达"这段地址不走代理"的方式，也是本模块自动旁路之外的第二道依据。
 */
export function parseScutilExceptions(out: string): string[] {
  const block = /ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/i.exec(out)?.[1];
  if (!block) return [];
  return block
    .split("\n")
    .map((line) => line.replace(/^\s*\d+\s*:\s*/, "").trim())
    .filter(Boolean);
}

/** Windows `ProxyOverride`（`;` 分隔；`<local>` 是"不含点的主机名"的记号） */
export function parseWindowsProxyOverride(out: string): string[] {
  if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(out)) return [];
  const value = /ProxyOverride\s+REG_SZ\s+(.+?)\s*$/im.exec(out)?.[1];
  return value ? value.split(";").map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * 系统代理自带的例外列表。
 * 代理来自环境变量时返回空——那种情况下"例外"以 NO_PROXY 为准，系统设置里那份与它无关。
 * 读不到（Linux、命令失败）返回空数组，不影响其它判据。
 */
export function detectSystemProxyExceptions(deps: ProxyDeps = {}): string[] {
  const env = deps.env ?? process.env;
  if (env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY
    || env.all_proxy || env.ALL_PROXY) return [];

  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? defaultRun;
  if (platform === "darwin") return parseScutilExceptions(run(SCUTIL[0], [...SCUTIL[1]]));
  if (platform === "win32") {
    return parseWindowsProxyOverride(run(REG_INTERNET_SETTINGS[0], [...REG_INTERNET_SETTINGS[1]]));
  }
  return [];
}

/** 安装结果。`installed: false` 时 reason 说明原因（正常启动路径上都会打印一行） */
export interface ProxyInstallResult {
  installed: boolean;
  proxy?: string;
  reason: string;
}

/**
 * 写进 env 的 NO_PROXY 默认值：环回 + 内网后缀 + 私网网段。
 *
 * 为什么要写这份：这些变量会被**子进程继承**（沙盒里执行的命令），curl 7.86+ 认 CIDR 写法，
 * 于是 `curl http://192.168.5.2:8888/...` 这类命令也能正确直连——否则它会跟着代理超时。
 * ⚠️ 但别把它当成我们自己的依据：私网直连由 `shouldBypassProxy()` 在代码层判定。
 * 上游 SDK 读 `no_proxy` 时只做**纯字符串后缀匹配**（`@earendil-works/pi-ai` 的
 * `shouldProxyHostname`），CIDR 与 IP 段在那里表达不出来——CIDR 条目对它只是"写了不匹配"，无害。
 */
const DEFAULT_NO_PROXY = [
  "localhost", "127.0.0.1", "::1",
  ...LOCAL_SUFFIXES,
  ...PRIVATE_V4.map(([net, bits]) => `${net}/${bits}`),
].join(",");

/**
 * `EASYMINT_PROXY_LAN=1`（要求局域网也走代理）时用的 NO_PROXY：只剩环回。
 * 必须与上一份区分开——否则默认串里的私网 CIDR 会把那个开关顶回去（NO_PROXY 说直连、
 * 开关说走代理，判定取"任一命中即直连"，结果开关失效）。
 */
const LOOPBACK_ONLY_NO_PROXY = "localhost,127.0.0.1,::1";

/**
 * 让主进程的 fetch 跟随系统代理（幂等；须在网络请求发生前调用，见文件头说明）。
 *
 * 只对**该走代理**的目标补 dispatcher：环回、私有本地网络（含 CGNAT）、NO_PROXY、系统例外列表
 * 一律直连——因此不影响与本地服务（vite dev server、**局域网里的模型服务**等）的通信。
 */
export function installSystemProxyFetch(deps: ProxyDeps = {}): ProxyInstallResult {
  const env = deps.env ?? process.env;
  const target = deps.target ?? globalThis;
  if ((target as Marked)[WRAPPED]) return { installed: false, reason: "已安装" };
  if (env.EASYMINT_NO_SYSTEM_PROXY === "1") {
    return { installed: false, reason: "已由 EASYMINT_NO_SYSTEM_PROXY=1 关闭" };
  }
  const proxy = detectSystemProxy({ ...deps, env });
  if (!proxy) return { installed: false, reason: "未检测到系统代理" };
  if (!isParsableProxyUrl(proxy)) {
    console.warn(`[system-proxy] 系统代理地址无法解析，已忽略（按直连处理）：${redactProxyUrl(proxy)}`);
    return { installed: false, reason: "系统代理地址无法解析" };
  }

  // 局域网直连默认开启：代理（尤其 VPN 隧道）通常只管公网，把局域网目标交给它会超时。
  // 少数环境要求"连内网也走代理"时用 EASYMINT_PROXY_LAN=1 关掉——那是显式的用户选择，
  // 此时 NO_PROXY 的默认值也一并退回"只剩环回"，免得两份默认值互相打架。
  const bypassLocalNetwork = env.EASYMINT_PROXY_LAN !== "1";
  const noProxy = env.no_proxy || env.NO_PROXY
    || (bypassLocalNetwork ? DEFAULT_NO_PROXY : LOOPBACK_ONLY_NO_PROXY);
  const exceptions = detectSystemProxyExceptions({ ...deps, env });
  const createAgent = deps.createAgent ?? (async (url: string) => {
    // 动态加载：undici 约 2MB，没代理时不该为它付启动成本（本模块只在检测到代理后才走到这里）
    const { ProxyAgent } = await import("undici");
    return new ProxyAgent(url);
  });

  const original = target.fetch.bind(target);
  let agentPromise: Promise<unknown> | undefined;
  const ensureAgent = (): Promise<unknown> => (agentPromise ??= createAgent(proxy));

  target.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let hostname: string | undefined;
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      hostname = new URL(url).hostname;
    } catch {
      hostname = undefined; // 解析不了就按原样发，别把好好的请求拦死
    }
    // 已带 dispatcher 的调用方自己决定走哪条路，不覆盖（此前会无条件覆盖，等于废掉调用方的选择）
    if (!hostname || (init as { dispatcher?: unknown } | undefined)?.dispatcher
      || shouldBypassProxy(hostname, noProxy, { exceptions, bypassLocalNetwork })) {
      return original(input, init);
    }
    const dispatcher = await ensureAgent();
    return original(input, { ...(init ?? {}), dispatcher } as RequestInit);
  }) as typeof globalThis.fetch;

  // 小写优先：SDK 的 getProxyEnv 先读小写，再读大写（大写一并写，兼容其它按惯例读大写变量的库）
  for (const [key, value] of [
    ["https_proxy", proxy], ["http_proxy", proxy], ["all_proxy", proxy], ["no_proxy", noProxy],
    ["HTTPS_PROXY", proxy], ["HTTP_PROXY", proxy], ["ALL_PROXY", proxy], ["NO_PROXY", noProxy],
  ] as const) {
    if (!env[key]) env[key] = value;
  }

  (target as Marked)[WRAPPED] = proxy;
  return { installed: true, proxy, reason: "已接管主进程 fetch" };
}
