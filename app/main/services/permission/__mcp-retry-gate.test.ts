/**
 * MCP 重试门卫（适配器层回归锚点）。
 *
 * 保护目标：待确认的项目级 server 即使被**直接调用** `retryMcpServer` 也不得被拉起——
 * `loadOneServer` → `connect` 会 spawn 子进程。界面只是不给待确认行「重试」按钮，
 * 门卫必须落在适配器层，UI 以后变化绕不过去。
 *
 * 沙盒三处被替掉：`wrapForSandbox` 是 spawn 前最后一步，本用例断言它不被调用即「没到拉起
 * 子进程那一步」；替掉也免得真去初始化 srt（绕过沙盒档与完全访问档的行为一致）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));

const mocks = vi.hoisted(() => ({ wrapForSandbox: vi.fn() }));

vi.mock("../../sandbox/manager", () => ({
  isSandboxBypassedForMode: () => true,
  ensureSandbox: async () => ({ ok: true }),
  annotateSandboxFailures: (s: string) => s,
  wrapForSandbox: mocks.wrapForSandbox,
}));

const home = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-gate-home-"));
process.env.EASYMINT_HOME = home;
const MARKER = path.join(home, "spawned.marker");

let adapter: typeof import("./mcp-adapter");
let mcp: typeof import("../mcp-service");
beforeAll(async () => {
  fs.writeFileSync(path.join(home, "em-settings.json"), JSON.stringify({ mcp: { approved: [] } }, null, 2));
  adapter = await import("./mcp-adapter");
  mcp = await import("../mcp-service");
});
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

/** 一条真能被执行的 stdio 定义：命令存在（node 绝对路径），被拉起时会留下标记文件 */
function projectWithGateServer(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-gate-proj-"));
  const file = path.join(dir, ".easymint", "mcp.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    mcpServers: {
      gate: {
        type: "stdio",
        command: process.execPath,
        args: ["-e", `require('fs').writeFileSync(${JSON.stringify(MARKER)}, '1')`],
        timeout: 800,
      },
    },
  }, null, 2));
  return dir;
}

function statusOf(dir: string, name: string): string | undefined {
  return adapter.getMcpStatus(dir).find((s) => s.name === name)?.state;
}

describe("MCP 重试门卫", () => {
  it("待确认的 server：retry 直接拒绝，不进入拉起子进程那一步", async () => {
    const dir = projectWithGateServer();
    expect(mcp.scanMcpServers(dir).find((s) => s.name === "gate")?.pendingApproval).toBe(true);

    const r = await adapter.retryMcpServer("gate", dir);

    expect(r.ok).toBe(false);
    expect(r.error).toContain("尚未确认启用");
    expect(mocks.wrapForSandbox).not.toHaveBeenCalled();
    expect(fs.existsSync(MARKER)).toBe(false);
    expect(statusOf(dir, "gate")).toBe("pending");
  });

  it("确认之后同一条调用不再被门卫拦住（走完 loadOneServer）", async () => {
    const dir = projectWithGateServer();
    mcp.approveMcpServer(dir, "gate");

    const r = await adapter.retryMcpServer("gate", dir);

    // 门卫只拦待确认：确认过的 server 必须继续走到拉取流程（错误换成连接层的，状态不再停在待确认）
    expect(r.error ?? "").not.toContain("尚未确认启用");
    expect(statusOf(dir, "gate")).not.toBe("pending");
  });
});
