/**
 * 项目级 MCP server 审批身份（回归锚点）。
 *
 * 保护两条：
 * ① 审批绑定服务器**定义**——同名条目改了 command/args/url 必须重新确认，否则共享仓库里
 *    别人改过的 .mcp.json 同名条目会静默挪用用户先前那次「确认」；
 * ② 旧审批记录（无指纹）**无感迁移**——升级不把用户已确认的 server 打回「待确认」，但旧键
 *    必须被消费掉，否则以后改定义再也不会转待确认。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));

// EASYMINT_HOME 必须在加载被测模块**之前**设好：EM_SETTINGS 是模块级常量（加载时求值）
const home = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-approval-home-"));
process.env.EASYMINT_HOME = home;
const SETTINGS = path.join(home, "em-settings.json");

let mcp: typeof import("./mcp-service");
beforeAll(async () => { mcp = await import("./mcp-service"); });

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

/** 建一个临时项目目录并写入 MCP 配置；relFile 决定作用域（.easymint/mcp.json = 项目级 / .mcp.json = 兼容来源） */
function projectWith(servers: Record<string, unknown>, relFile = path.join(".easymint", "mcp.json")): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-proj-"));
  dirs.push(dir);
  writeServers(dir, servers, relFile);
  return dir;
}

function writeServers(dir: string, servers: Record<string, unknown>, relFile = path.join(".easymint", "mcp.json")): void {
  const file = path.join(dir, relFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }, null, 2));
}

function writeApproved(approved: string[]): void {
  fs.writeFileSync(SETTINGS, JSON.stringify({ mcp: { approved } }, null, 2));
}

function readApproved(): string[] {
  return (JSON.parse(fs.readFileSync(SETTINGS, "utf8")) as { mcp: { approved: string[] } }).mcp.approved;
}

function pending(dir: string, name: string): boolean | undefined {
  const s = mcp.scanMcpServers(dir).find((x) => x.name === name);
  if (!s) throw new Error(`扫描不到 server「${name}」`);
  return s.pendingApproval;
}

const STDIO = (args: string[]) => ({ type: "stdio", command: "npx", args });

describe("项目级 MCP 审批身份", () => {
  it("首次使用待确认，确认后不再待确认（项目级与项目根 .mcp.json 两种来源）", () => {
    writeApproved([]);
    for (const rel of [path.join(".easymint", "mcp.json"), ".mcp.json"]) {
      const dir = projectWith({ srv: STDIO(["a"]) }, rel);
      expect(pending(dir, "srv"), rel).toBe(true);
      mcp.approveMcpServer(dir, "srv");
      expect(pending(dir, "srv"), rel).toBeFalsy();
      // 定义没动 → 再扫多少次都不回到待确认
      expect(pending(dir, "srv"), rel).toBeFalsy();
    }
  });

  it("改了 command / args / url 的同名 server 重新待确认；未改的不受影响", () => {
    writeApproved([]);
    const dir = projectWith({
      kept: STDIO(["same"]),
      argsChanged: STDIO(["one"]),
      cmdChanged: { type: "stdio", command: "npx", args: ["same"] },
      urlChanged: { type: "http", url: "https://old.example/mcp" },
    });
    for (const name of ["kept", "argsChanged", "cmdChanged", "urlChanged"]) mcp.approveMcpServer(dir, name);
    expect(pending(dir, "kept")).toBeFalsy();

    writeServers(dir, {
      kept: STDIO(["same"]),
      argsChanged: STDIO(["two"]),
      cmdChanged: { type: "stdio", command: "node", args: ["same"] },
      urlChanged: { type: "http", url: "https://new.example/mcp" },
    });

    expect(pending(dir, "kept")).toBeFalsy();
    expect(pending(dir, "argsChanged")).toBe(true);
    expect(pending(dir, "cmdChanged")).toBe(true);
    expect(pending(dir, "urlChanged")).toBe(true);

    // 再确认一次 → 新定义成为基线，此后又稳定
    mcp.approveMcpServer(dir, "argsChanged");
    expect(pending(dir, "argsChanged")).toBeFalsy();
  });

  it("旧审批记录（无指纹）首次扫描即无感迁移：不待确认、落指纹、旧键被消费", () => {
    const dir = projectWith({ legacy: STDIO(["x"]) });
    writeApproved([`${dir}::legacy`]); // 升级前的记录形态

    expect(pending(dir, "legacy")).toBeFalsy(); // 用户无感：不出现「待确认」

    const entries = readApproved();
    expect(entries).toHaveLength(1);
    const prefix = `${dir}::legacy::`;
    expect(entries[0]!.slice(0, prefix.length)).toBe(prefix);
    expect(entries[0]!.slice(prefix.length)).toMatch(/^[0-9a-f]{32}$/); // 采纳当前定义为基线

    // 旧键已消费：定义再变仍转回待确认（留着旧键会变成永久放行）
    writeServers(dir, { legacy: STDIO(["y"]) });
    expect(pending(dir, "legacy")).toBe(true);
  });
});
