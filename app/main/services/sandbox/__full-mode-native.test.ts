import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext } from "../permission/execution-context";

/**
 * 三档 → 沙盒路由的守卫（2026-09-17 甲方案定案）。
 *
 * 定案内容：**只读 / 标准两档都套 OS 沙盒，完全访问永不套**。
 * 这一条推翻了 9-16 那版"标准档不套沙盒"——那版是为了消解"什么都做不了"，
 * 但独立评估指出它"没有完成安全能力的接替"（关掉边界却没人补位）。
 * 现在的做法是**把默认档修到能干活**：边界保留，兼容性靠三件事补——
 *   ① 兼容性豁免清单（PTY 等，`sandbox/compat-policy`）
 *   ② 精确豁免（浏览器/容器这类必须自建沙盒的命令）
 *   ③ 网络白名单（过去 macOS 是 `allow network*` 全放）
 *
 * 本文件钉住的性质（顺序即重要性）：
 *   ① full 不碰 srt（wrapWithSandbox / initialize 都不调）→ 命令原样执行、无租约、宿主环境
 *   ② standard 与 readonly **都**进沙盒，且带租约
 *   ③ 违规归因 key 必须与 wrap 时一致（commandId）——不一致 = 拦截静默
 *   ④ 网络白名单非空且 strictAllowlist（防止回退到"全放网络"）
 *   ⑤ 豁免命令走原生执行，但必须带 `exemptReason`（例外可见，清单才不会悄悄腐化）
 *
 * mock 掉 srt，所以本机（macOS，跑不了真沙盒）能跑。
 */
const { wrapCalls, initCalls } = vi.hoisted(() => ({
  wrapCalls: [] as Array<{ command: string; commandId?: string }>,
  initCalls: [] as unknown[],
}));
vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    initialize: async (cfg: unknown) => { initCalls.push(cfg); },
    wrapWithSandbox: async (command: string, _binShell?: unknown, _cfg?: unknown, _signal?: unknown, options?: { commandId?: string }) => {
      wrapCalls.push({ command, commandId: options?.commandId });
      return `SANDBOXED(${command})`;
    },
    cleanupAfterCommand: () => { /* 本文件只关心路由与 key，不关心清理 */ },
    reset: async () => { /* 每个用例前重置，见 beforeEach */ },
  },
}));

import {
  ensureSandbox,
  isSandboxBypassed,
  isSandboxBypassedForMode,
  isSandboxEnabledForMode,
  releaseSandbox,
  wrapForSandbox,
} from "./manager";
import { DEVELOPMENT_ALLOWED_DOMAINS, isSandboxExcludedCommand, sshAgentSockets } from "./compat-policy";
import { buildExecutionPolicy } from "../permission/access-policy";

const WS = path.join(process.cwd(), "temp", "sandbox-mode-routing-test");
const ctx = (mode: "readonly" | "standard" | "full") => createExecutionContext(WS, mode);

describe("三档 → 沙盒路由", () => {
  beforeEach(async () => { await releaseSandbox(); });

  it("完全访问：命令原样执行，不调 srt、不出现 sandbox-exec", async () => {
    const before = wrapCalls.length;
    const spec = await wrapForSandbox("npm run dev", { context: ctx("full") });
    expect(wrapCalls.length).toBe(before);
    expect(spec.kind).toBe("shell");
    if (spec.kind !== "shell") throw new Error("非 Windows 应返回 shell 形态");
    expect(spec.command).toBe("npm run dev");
    expect(spec.command).not.toContain("sandbox-exec");
  });

  it("完全访问：没有收尾租约（没有沙盒就没有占位文件要清）", async () => {
    expect((await wrapForSandbox("echo hi", { context: ctx("full") })).release).toBeUndefined();
  });

  it("完全访问：用宿主环境执行，不做运行区 HOME/PATH 重定向", async () => {
    const spec = await wrapForSandbox("echo hi", { context: ctx("full") });
    expect(spec.env.HOME).toBe(process.env.HOME);
  });

  it("标准档进沙盒（甲方案：默认档保留内核边界）", async () => {
    const before = wrapCalls.length;
    const spec = await wrapForSandbox("echo hi", { context: ctx("standard") });
    expect(wrapCalls.length, "标准档必须走 srt").toBe(before + 1);
    expect(typeof spec.release).toBe("function");
    if (spec.kind !== "shell") throw new Error("非 Windows 应返回 shell 形态");
    expect(spec.command).toContain("SANDBOXED");
  });

  it("只读档同样进沙盒（纵深防御：主强制是判定层拒绝一切执行）", async () => {
    const before = wrapCalls.length;
    const spec = await wrapForSandbox("echo hi", { context: ctx("readonly") });
    expect(wrapCalls.length).toBe(before + 1);
    expect(typeof spec.release).toBe("function");
  });

  it("违规归因 key 与 wrap 时一致（否则拦截事件对用户静默）", async () => {
    const spec = await wrapForSandbox("echo hi", { context: ctx("standard") });
    expect(typeof spec.violationKey).toBe("string");
    expect(spec.violationKey).not.toBe("");
    // 必须是**传进 srt 的那一个**；同时两次执行不得复用同一个 key（否则互相串事件）
    expect(wrapCalls[wrapCalls.length - 1]?.commandId).toBe(spec.violationKey);
    const second = await wrapForSandbox("echo hi", { context: ctx("standard") });
    expect(second.violationKey).not.toBe(spec.violationKey);
  });

  it("ensureSandbox：标准/只读档会初始化 srt，完全访问不会", async () => {
    expect((await ensureSandbox(WS, "standard")).ok).toBe(true);
    expect(initCalls.length).toBe(1);
    await ensureSandbox(WS, "readonly");            // 幂等：已 ok 不再 init
    expect(initCalls.length).toBe(1);

    await releaseSandbox();
    expect((await ensureSandbox(WS, "full")).ok).toBe(true);
    expect(initCalls.length, "完全访问不该初始化 srt").toBe(1);
  });

  it("isSandboxEnabledForMode：只读/标准开，完全访问关", () => {
    expect(isSandboxEnabledForMode("readonly")).toBe(true);
    expect(isSandboxEnabledForMode("standard")).toBe(true);
    expect(isSandboxEnabledForMode("full")).toBe(false);
  });

  it("isSandboxBypassedForMode：只有完全访问跳过沙盒", () => {
    expect(isSandboxBypassedForMode("readonly")).toBe(false);
    expect(isSandboxBypassedForMode("full")).toBe(true);
    // 标准档：沙盒开着，所以是否跳过只取决于 Linux 的全局降级开关
    expect(isSandboxBypassedForMode("standard")).toBe(isSandboxBypassed());
  });

  it("只读档不受 Linux 全局降级开关影响（那个开关不该覆盖另一档的产品承诺）", () => {
    // 该开关是 process.platform === "linux" 时才可能为真的注入式读取器；
    // 这里只钉"只读档的判据与它无关"这一结构事实（本机非 Linux 也成立）。
    expect(isSandboxBypassedForMode("readonly")).toBe(false);
  });
});

describe("沙盒豁免（兼容性兜底）", () => {
  it("浏览器 / 容器类命令不进沙盒，且必须带可见的豁免原因", async () => {
    for (const command of ["open https://example.com", "npx playwright test", "docker compose up -d"]) {
      const spec = await wrapForSandbox(command, { context: ctx("standard") });
      expect(spec.exemptReason, command).toBeTruthy();
      expect(spec.release, command).toBeUndefined();
      expect(spec.violationKey, command).toBeUndefined();
      // 豁免 = 不进沙盒，但**运行区隔离仍然生效**（关沙盒只换执行后端，不跳过环境处理）
      expect(spec.env.HOME, command).toBe(ctx("standard").environment.HOME);
      expect(spec.env.HOME, command).not.toBe(process.env.HOME);
    }
  });

  it("普通开发命令不受豁免影响（必须仍然进沙盒）", async () => {
    for (const command of ["npm run build", "git status", "python3 -m http.server", "echo hi"]) {
      expect(isSandboxExcludedCommand(command), command).toBe(false);
    }
  });

  it("只认命令首 token，不被参数里的同名词骗到", () => {
    expect(isSandboxExcludedCommand("echo open")).toBe(false);
    expect(isSandboxExcludedCommand("git commit -m 'open the door'")).toBe(false);
    expect(isSandboxExcludedCommand("env FOO=1 open https://x")).toBe(true);
    // 包管理器的执行器要看到第二段（含子命令前缀）
    expect(isSandboxExcludedCommand("npm exec playwright test")).toBe(true);
    expect(isSandboxExcludedCommand("pnpm dlx playwright test")).toBe(true);
    // 但**装** playwright 不是运行它，不该豁免（否则等于给装包开个后门）
    expect(isSandboxExcludedCommand("npm install playwright")).toBe(false);
    expect(isSandboxExcludedCommand("npm run playwright")).toBe(false);
  });

  it("复合命令、重定向与命令替换绝不借首命令逃出沙盒", () => {
    for (const command of [
      "open https://example.com && node payload.js",
      "npx playwright test; cat ~/.ssh/id_rsa",
      "docker compose up -d | tee /tmp/out",
      "open $(cat /tmp/url)",
      "open https://example.com > /tmp/out",
    ]) {
      expect(isSandboxExcludedCommand(command), command).toBe(false);
    }
  });

  it("open 只豁免单个 http(s) URL，不开放本地文件或指定应用", () => {
    expect(isSandboxExcludedCommand("open https://example.com")).toBe(true);
    expect(isSandboxExcludedCommand("xdg-open http://example.com")).toBe(true);
    expect(isSandboxExcludedCommand("open /tmp/report.html")).toBe(false);
    expect(isSandboxExcludedCommand("open -a Terminal /tmp/x")).toBe(false);
  });
});

describe("网络面（过去是 allow network* 全放）", () => {
  it("白名单非空、且不含过宽模式（`*` 会被 srt 的 schema 判为不安全）", () => {
    expect(DEVELOPMENT_ALLOWED_DOMAINS.length).toBeGreaterThan(20);
    for (const domain of DEVELOPMENT_ALLOWED_DOMAINS) {
      expect(domain, domain).not.toBe("*");
      expect(domain.endsWith(".*"), domain).toBe(false);
    }
    // 主流生态必须在列，否则"装不上依赖"会立刻把用户推回关沙盒
    for (const required of ["registry.npmjs.org", "pypi.org", "github.com", "crates.io", "proxy.golang.org"]) {
      expect(DEVELOPMENT_ALLOWED_DOMAINS, required).toContain(required);
    }
    // 国内镜像（npmmirror）三条缺一不可：registry 只给元数据，tarball 走 cdn 子域，裸域是 Electron 镜像入口。
    // 2026-09-17 实测：只列 registry 域时 `npm i` 报 E403 卡在 cdn.npmmirror.com（元数据通、包不通）。
    for (const required of ["registry.npmmirror.com", "npmmirror.com", "*.npmmirror.com"]) {
      expect(DEVELOPMENT_ALLOWED_DOMAINS, required).toContain(required);
    }
  });

  it("沙盒配置带白名单 + strictAllowlist（未知域名直接拒绝，不落回调）", () => {
    // ⚠️ 直接读 buildExecutionPolicy 的产物，不用 `ensureSandbox` + mock 记录：
    // ensureSandbox 幂等（已 ok 就不再 init），靠"最后一次 init 的记录"会读到旧配置 ——
    // 那样断言会**永远绿**（改坏了也不红，实测过）。
    const cfg = buildExecutionPolicy(createExecutionContext(WS, "standard"));
    expect(cfg.network?.allowedDomains?.length ?? 0).toBeGreaterThan(20);
    expect(cfg.network?.strictAllowlist).toBe(true);
    // 开发服务器必须能监听本机端口
    expect(cfg.network?.allowLocalBinding).toBe(true);
    // PTY 是"交互式工具在沙盒里还能正常工作"的最低要求（Codex 的 base policy 同样开了）
    expect(cfg.allowPty).toBe(true);
  });
});

/**
 * ssh-agent 通道（2026-09-17 用户拍到："标准档要能 push，但不想把私钥放进会话"）。
 *
 * 机制：放行 agent 的 unix socket + 运行区预置 `known_hosts` ⇒ git 用 agent 签名、私钥不进会话。
 * ⚠️ 前提是 **agent 里有身份**（`ssh-add`）——agent 为空时 ssh 会退回读 `~/.ssh/id_*`，
 * 而运行区里没有私钥，于是失败（这是设计，不是 bug）。
 */
describe("ssh-agent 通道", () => {
  it("Windows 不扫 unix socket（那边的 agent 是 named pipe，不走 seatbelt 的 socket 放行）", () => {
    expect(sshAgentSockets("win32")).toEqual([]);
  });

  it("沙盒配置只放行 agent socket，绝不打开 allowAllUnixSockets", () => {
    const cfg = buildExecutionPolicy(createExecutionContext(WS, "standard"));
    // ⚠️ 这两个字段都在 `network` 里（不在顶层）——写错层级会让断言**永远绿**，实测踩过
    // 全放会把 docker.sock 这类"能控制宿主服务"的 socket 一起交出去 —— 这是有意不开的
    expect(cfg.network?.allowAllUnixSockets ?? false).toBe(false);
    expect(Array.isArray(cfg.network?.allowUnixSockets)).toBe(true);
    // 放行的每一条都必须是 ssh-agent（本机没有 agent 时为空数组，同样成立）
    for (const socket of cfg.network?.allowUnixSockets ?? []) {
      expect(socket, "只该放行 ssh-agent 的 socket").toContain("Listeners");
    }
  });

  it("运行区只预置 known_hosts，不复制任何私钥或 authorized_keys", () => {
    // ⚠️ 必须用**一次性 runtimeBaseRoot**：种子逻辑是幂等的（目标已存在就跳过），
    // 复用真实运行区会让这条断言在"已初始化过"的情况下**测不到新逻辑**（实测踩过：
    // 改成复制整个 .ssh 目录后测试照样绿）。
    // 而 baseRoot 的父目录会被 `assertPrivateDirectory` chmod 0700 —— 不能直接放系统临时目录
    // （会 EPERM），所以先建一个自己的私有目录再放进去。
    const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "em-base-"));
    const baseRoot = path.join(sandboxRoot, "runtimes");
    try {
      const ctx = createExecutionContext(WS, "standard", {}, baseRoot);
      const sshDir = path.join(ctx.environment.HOME ?? "", ".ssh");
      if (!fs.existsSync(sshDir)) return; // 本机没有 ~/.ssh/known_hosts 时这份断言无从谈起（CI 容器常见）
      const entries = fs.readdirSync(sshDir);
      expect(entries).toEqual(["known_hosts"]);
      expect(entries.some((name) => name.startsWith("id_") || name === "authorized_keys" || name === "config")).toBe(false);
    } finally {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });
});
