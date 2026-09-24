/**
 * 项目级 MCP 定义来源（scope）回归锚点。
 *
 * 保护目标：`loadOneServer` 取定义必须按**扫描结果自带的 scope** 读文件。漏了 scope 时
 * `getMcpServerConfig` 只读用户级 `~/.easymint/mcp.json` → EM 项目级与项目根 `.mcp.json`
 * 的定义恒取不到，状态被写成「配置已不存在」，项目级 MCP 配了也不通。
 *
 * 用例怎么分辨「读的是哪个文件」：三个来源各配一条**互不相同、且不存在**的命令，定义一旦被取到，
 * connect 阶段就会以 `未找到命令 "<cmd>"` 失败——错误文本里的命令名即来源指纹。命令不存在同时
 * 保证不会真的拉起子进程（不依赖宿主沙箱行为）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));

const mocks = vi.hoisted(() => ({
  wrapForSandbox: vi.fn(async () => {
    throw new Error("测试替身：不应到达拉起子进程那一步");
  }),
}));

// 沙盒替掉：本文件只验「定义取自哪个文件」，走到 spawn 没有意义，也免得真去初始化 srt
vi.mock("../sandbox/manager", () => ({
  isSandboxBypassedForMode: () => true,
  ensureSandbox: async () => ({ ok: true }),
  annotateSandboxFailures: (s: string) => s,
  wrapForSandbox: mocks.wrapForSandbox,
}));

const home = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-scope-home-"));
process.env.EASYMINT_HOME = home;

let adapter: typeof import("./mcp-adapter");
let mcp: typeof import("../mcp-service");

/** 各来源独有的命令名——出现在状态错误里就说明定义取自该文件 */
const CMD = {
  userOnly: "em-probe-user-only",
  userShared: "em-probe-user-shared",
  projectOnly: "em-probe-project-only",
  projectShared: "em-probe-project-shared",
  compatOnly: "em-probe-compat-only",
};

beforeAll(async () => {
  fs.writeFileSync(path.join(home, "em-settings.json"), JSON.stringify({ mcp: { approved: [] } }, null, 2));
  fs.writeFileSync(path.join(home, "mcp.json"), JSON.stringify({
    mcpServers: {
      "user-only": stdio(CMD.userOnly),
      "shared-name": stdio(CMD.userShared),
    },
  }, null, 2));
  adapter = await import("./mcp-adapter");
  mcp = await import("../mcp-service");
});

// 注意必须带花括号：钩子返回函数会被 vitest 当成清理回调执行（返回 spy 等于把 spy 当收尾跑）
beforeEach(() => { mocks.wrapForSandbox.mockClear(); });
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

function stdio(command: string) {
  return { type: "stdio", command, args: [] as string[], timeout: 500 };
}

function writeServers(file: string, servers: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }, null, 2));
}

/** 三来源齐备的项目：EM 项目级独有的 proj-only、项目根 .mcp.json 独有的 compat-only，
 *  以及用户级与 EM 项目级同名的 shared-name（用于验优先级） */
function projectFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-scope-proj-"));
  writeServers(path.join(dir, ".easymint", "mcp.json"), {
    "proj-only": stdio(CMD.projectOnly),
    "shared-name": stdio(CMD.projectShared),
  });
  writeServers(path.join(dir, ".mcp.json"), { "compat-only": stdio(CMD.compatOnly) });
  return dir;
}

function statusMap(dir: string): Map<string, { state: string; error?: string }> {
  return new Map(adapter.getMcpStatus(dir).map((s) => [s.name, { state: s.state, error: s.error }]));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("项目级 MCP 取定义带 scope", () => {
  it("loadMcpTools：EM 项目级与项目根 .mcp.json 的定义都能取到，不再「配置已不存在」", async () => {
    const dir = projectFixture();
    const scopes = new Map(mcp.scanMcpServers(dir).map((s) => [s.name, s.scope]));
    expect(scopes.get("proj-only")).toBe("project");
    expect(scopes.get("compat-only")).toBe("project-compat");
    mcp.approveMcpServer(dir, "proj-only");
    mcp.approveMcpServer(dir, "compat-only");

    await adapter.loadMcpTools(dir, () => "standard", "scope-load");

    const st = statusMap(dir);
    expect(st.get("proj-only")?.error).toContain(CMD.projectOnly);
    expect(st.get("compat-only")?.error).toContain(CMD.compatOnly);
    for (const s of st.values()) expect(s.error ?? "").not.toContain("配置已不存在");
    // 定义被取到后走到 connect 的「命令不存在」分支即止，没有拉起子进程
    expect(mocks.wrapForSandbox).not.toHaveBeenCalled();
  });

  it("用户级行为不变：同名时仍取用户级定义", async () => {
    const dir = projectFixture();

    await adapter.loadMcpTools(dir, () => "standard", "scope-user");

    const st = statusMap(dir);
    expect(st.get("user-only")?.error).toContain(CMD.userOnly);
    expect(mcp.scanMcpServers(dir).find((s) => s.name === "shared-name")?.scope).toBe("user");
    expect(st.get("shared-name")?.error).toContain(CMD.userShared);
    expect(st.get("shared-name")?.error ?? "").not.toContain(CMD.projectShared);
  });

  it("按需入口只读取指定项目级 server 的定义", async () => {
    const dir = projectFixture();
    mcp.approveMcpServer(dir, "proj-only");
    await expect(adapter.loadMcpServerTools("proj-only", dir, () => "standard", "scope-lazy"))
      .rejects.toThrow(CMD.projectOnly);
    expect(statusMap(dir).get("user-only")?.error).toBeUndefined();
    expect(mocks.wrapForSandbox).not.toHaveBeenCalled();
  });

  it("门卫仍有效：未确认的项目级 server 取不到工具、状态停「待确认」", async () => {
    const dir = projectFixture();

    const tools = await adapter.loadMcpTools(dir, () => "standard", "scope-gate");

    expect(tools).toEqual([]);
    const st = statusMap(dir);
    expect(st.get("proj-only")?.state).toBe("pending");
    expect(st.get("proj-only")?.error).toBe("待确认后启用");
    expect(st.get("compat-only")?.state).toBe("pending");
    expect(mocks.wrapForSandbox).not.toHaveBeenCalled();
  });

  it("retryMcpServer 与状态探测同走 scanManifest 的来源，不只 loadMcpTools 一致", async () => {
    const retryDir = projectFixture();
    mcp.approveMcpServer(retryDir, "proj-only");
    const r = await adapter.retryMcpServer("proj-only", retryDir);
    expect(r.error ?? "").toContain(CMD.projectOnly);

    const probeDir = projectFixture();
    mcp.approveMcpServer(probeDir, "proj-only");
    adapter.ensureStatusProbe(probeDir);
    await waitUntil(() => statusMap(probeDir).get("proj-only")?.state !== "connecting");
    expect(statusMap(probeDir).get("proj-only")?.error ?? "").toContain(CMD.projectOnly);
  });
});
