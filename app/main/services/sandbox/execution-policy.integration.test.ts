import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSandbox, releaseSandbox, wrapForSandbox } from "./manager";
import { createExecutionContext } from "../permission/execution-context";

describe("执行策略真实 I/O", () => {
  const root = path.join(process.cwd(), `.sandbox-policy-${process.pid}`);
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside.txt");

  /** 本文件验证的是**沙盒后端**的真实行为：载体档位 = standard（默认就套沙盒，见 sandbox/manager）。 */
  beforeAll(() => {
    fs.mkdirSync(workspace, { recursive: true });
  });

  afterAll(async () => {
    fs.rmSync(root, { recursive: true, force: true });
    await releaseSandbox();
  });

  function run(command: string, env?: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> {
    return spawnSync(command, { cwd: workspace, shell: true, env, encoding: "utf8", timeout: 30_000 });
  }

  /**
   * 模拟执行层：wrap → spawn。返回 release，**调用方必须在本例结束前 await 它**。
   *
   * 为什么每个 wrap 都必须配一次 release：srt 用 activeSandboxCount 记账（wrap +1、release -1），
   * 只要计数还 >0，cleanupAfterCommand 就一律"推迟"（不清占位文件）。测试里漏 release 会让计数
   * 只增不减，后面的清理断言全部失效——测出来的就不是真实行为了。
   * 真实执行层（前台 bash / 后台 shell / shell:exec / install_dependency）都是这么收尾的。
   */
  async function spawnSandboxed(command: string, mode: "standard" | "full") {
    const wrapped = await wrapForSandbox(command, {
      context: createExecutionContext(workspace, mode, {}, path.join(root, "runtimes")),
    });
    expect(wrapped.kind).toBe("shell");
    if (wrapped.kind !== "shell") throw new Error("本测试只覆盖 shell 规格（darwin/linux）");
    // 沙盒路径靠它收尾，退回 undefined 就等于整条清理链路空转（见 __sandbox-lease.test.ts）。
    // 完全访问不进沙盒（用户显式选择），没有 srt 租约也就不用清占位文件——故只对标准档断言。
    if (mode === "standard") { expect(typeof wrapped.release).toBe("function"); expect(wrapped.violationKey).toBeTruthy(); }
    const result = run(wrapped.command, wrapped.env);
    return { result, command: wrapped.command, release: (): Promise<void> => wrapped.release?.() ?? Promise.resolve() };
  }

  it("开启沙盒的标准档阻止工作区外写入，完全访问允许同一普通目标", async () => {
    const initialized = await ensureSandbox(workspace);
    expect(initialized).toEqual({ ok: true });

    const standardContext = createExecutionContext(workspace, "standard", {}, path.join(root, "runtimes"));

    // 前置探针：先证明**沙盒在本机能真正 apply**。
    // 否则下面"写入被拒"的断言会因 `sandbox_apply: Operation not permitted` 一起失败而**假通过**
    // ——要求失败的断言因别的原因失败而通过，是"本机绿不等于验证"的典型形态
    // （见 skill code-review §3.3；嵌套沙盒限制见 skill easymint-sandbox-srt §4）。
    const probe = await spawnSandboxed("echo sandbox-probe-ok", "standard");
    expect(
      probe.result.status,
      `沙盒无法在本机应用，本用例无法验证边界：${String(probe.result.stderr).slice(0, 120)}`,
    ).toBe(0);
    await probe.release();

    const deniedRun = await spawnSandboxed(`touch ${JSON.stringify(outside)}`, "standard");
    expect(deniedRun.result.status).not.toBe(0);
    expect(fs.existsSync(outside)).toBe(false);
    await deniedRun.release();

    const runtimeRun = await spawnSandboxed(`touch "$HOME/home-write" "$TMPDIR/tmp-write"`, "standard");
    expect(runtimeRun.result.status, String(runtimeRun.result.stderr)).toBe(0);
    expect(fs.existsSync(path.join(standardContext.runtimeRoot, "home", "home-write"))).toBe(true);
    expect(fs.existsSync(path.join(standardContext.runtimeRoot, "tmp", "tmp-write"))).toBe(true);
    await runtimeRun.release();

    const allowedRun = await spawnSandboxed(`touch ${JSON.stringify(outside)}`, "full");
    expect(allowedRun.result.status, String(allowedRun.result.stderr)).toBe(0);
    expect(fs.existsSync(outside)).toBe(true);
    await allowedRun.release();
  }, 60_000);

  it("开启沙盒的标准档允许开发服务器绑定本机端口", async () => {
    const initialized = await ensureSandbox(workspace);
    expect(initialized).toEqual({ ok: true });
    const { result, release } = await spawnSandboxed(
      `node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>s.close())'`,
      "standard",
    );
    expect(result.status, String(result.stderr)).toBe(0);
    await release();
  }, 60_000);

  it("开启沙盒的标准档在命令最内层使用项目运行区的 HOME、临时目录和 npm 缓存", async () => {
    const initialized = await ensureSandbox(workspace);
    expect(initialized).toEqual({ ok: true });
    const context = createExecutionContext(workspace, "standard", {}, path.join(root, "runtimes"));
    const { result, release } = await spawnSandboxed(
      `printf '%s\\n' "$HOME" "$TMPDIR" "$(npm config get cache)" "$(npm config get prefix)"`,
      "standard",
    );
    expect(result.status, String(result.stderr)).toBe(0);
    expect(String(result.stdout).trim().split("\n")).toEqual([
      path.join(context.runtimeRoot, "home"),
      path.join(context.runtimeRoot, "tmp"),
      path.join(context.runtimeRoot, "cache", "npm"),
      path.join(context.runtimeRoot, "tools", "npm"),
    ]);
    await release();
  }, 60_000);

  it("开启沙盒的标准档完整读写工作区配置，不继承第三方按文件名硬编码的误拦", async () => {
    const initialized = await ensureSandbox(workspace);
    expect(initialized).toEqual({ ok: true });
    const { result, release } = await spawnSandboxed(
      "mkdir -p .vscode .idea .git/hooks && touch .vscode/settings.json .idea/workspace.xml .git/config .git/hooks/pre-commit",
      "standard",
    );
    expect(result.status, String(result.stderr)).toBe(0);
    for (const relative of [".vscode/settings.json", ".idea/workspace.xml", ".git/config", ".git/hooks/pre-commit"]) {
      expect(fs.existsSync(path.join(workspace, relative))).toBe(true);
    }
    await release();
  }, 60_000);

  /**
   * 2026-09-16 变更：本用例原为「两种模式都不能改写工作区 .mcp.json」——完全访问那一半由 srt 的
   * denyWrite 提供。完全访问不再进沙盒后，那份保护移到**权限层的命令预检**
   * （`permission/agent-permission-service.ts` 的 findProtectedWriteTarget，命中 protectedControlPaths
   * 即拒绝），断言在 `__permission-full.test.ts`。这里只留只读模式的 OS 强制边界。
   */
  it("两种模式都不能把工作区兼容 MCP 配置改造成后续可执行配置（且不留幽灵占位文件）", async () => {
    const initialized = await ensureSandbox(workspace);
    expect(initialized).toEqual({ ok: true });
    const protectedFile = path.join(workspace, ".mcp.json");
    const { result, command, release } = await spawnSandboxed(
      `printf '%s' '{"mcpServers":{}}' > ${JSON.stringify(protectedFile)}`,
      "standard",
    );

    // 断言失败时自动留证据（正常路径无输出，不污染 CI 日志）。
    // 来历：2026-09-15 调查 full 模式"命令成功"时，只有一句 status=0 无从下手，
    // 最后靠 srt 的 SRT_DEBUG 才定位到它的 allowWrite 判定（详见 __srt-patch.test.ts）。
    if (result.status === 0) {
      const size = fs.existsSync(protectedFile) ? `${fs.statSync(protectedFile).size}B` : "不存在";
      const at = command.indexOf(".mcp.json");
      console.log(
        `[diag] 命令未被拒绝（status=0，文件=${size}）`
        + `\n[diag] stderr=${String(result.stderr).slice(0, 200).replace(/\n/g, " | ")}`
        + `\n[diag] 命令中的 .mcp.json 片段: ${at >= 0 ? command.slice(Math.max(0, at - 150), at + 40) : "（命令里根本没提到 .mcp.json）"}`,
      );
    }

    expect(result.status).not.toBe(0);

    // ① 安全属性：内容没被写进去。bwrap 为「不存在的 deny 路径」做 --ro-bind 时会在宿主先创建
    //    一个 0 字节文件当挂载点（srt 源码注释写明），所以允许"存在但必须为空"——内容进去了
    //    才叫把 MCP 配置改造成可执行配置。
    if (fs.existsSync(protectedFile)) {
      expect(fs.statSync(protectedFile).size).toBe(0);
    }

    // ② 收尾：release() = srt 的 cleanupAfterCommand → 占位被清掉。此前 wrapForSandbox 没给
    //    release 赋值，Linux 上工作区会一直留下幽灵 .mcp.json（v0.26.0 的 CI 就是在这里红的）。
    await release();
    expect(fs.existsSync(protectedFile)).toBe(false);
  }, 60_000);
});
