/**
 * 归位迁移的**读取面**守卫：迁移失败（best-effort，不阻断启动）时的回落行为。
 *
 * 为什么单独一个文件：迁移测试只验「搬得对不对」，而真正会伤到用户的是
 * 「搬不动的那段时间里读写指向不一致」。实测踩过一次——`readUserMcpServers()`
 * 做了回落（扫描能看到旧位置的 server），但 `getMcpServerConfig()` 仍固定读新位置，
 * 于是扫描列出用户级 server、点进去却说「配置已不存在」：`__mcp-scope.test.ts` 两条用例红。
 *
 * 本文件锚定的不变量：**读与写必须落在同一个生效文件上**。否则用户在设置页改一个 server 时，
 * 配置会被劈成两份（旧文件里的原有条目 + 新文件里刚写的一条），下次读新文件非空就不再回落，
 * 其余 server 看起来"消失"。新版凭据的 URL 隔离与密文往返由 mcp-auth-store.test.ts 覆盖。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => os.tmpdir() },

}));

const roots: string[] = [];
let home: string;

function writeAt(dir: string, name: string, content: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

function servers(dir: string, name: string): string[] {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return [];
  return Object.keys((JSON.parse(fs.readFileSync(file, "utf8")).mcpServers ?? {}) as Record<string, unknown>);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-fallback-"));
  roots.push(home);
  process.env.EASYMINT_HOME = home;
});

afterEach(() => {
  delete process.env.EASYMINT_HOME;
  for (const dir of roots.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  vi.resetModules();
});

async function loadService() {
  vi.resetModules();
  return import("./mcp-service");
}

describe("MCP 配置：迁移未完成时的回落读写", () => {
  it("只有旧位置有配置时，扫描 / 取定义 / 写入 / 路径提示全部指向旧文件", async () => {
    writeAt(home, "mcp.json", JSON.stringify({
      mcpServers: { "legacy-a": { type: "stdio", command: "a", args: [] } },
    }));
    const mcp = await loadService();

    // 扫描能看到旧位置的 server（迁移未完成不应表现为"配置全没了"）
    expect(mcp.scanMcpServers().map((s) => s.name)).toEqual(["legacy-a"]);
    // 取定义也必须能取到 —— 这一条曾因漏回落而红：状态显示「配置已不存在」
    expect(mcp.getMcpServerConfig("legacy-a")?.command).toBe("a");
    // 写入落在同一份文件上，不劈成两份
    expect(mcp.saveMcpServer("legacy-b", { type: "stdio", command: "b", args: [] }).ok).toBe(true);
    expect(servers(home, "mcp.json").sort()).toEqual(["legacy-a", "legacy-b"]);
    expect(fs.existsSync(path.join(home, "agent", "mcp.json"))).toBe(false);
    // 界面提示的路径就是正在被读的那份，用户照着去编辑才有效
    expect(mcp.getMcpConfigPath()).toBe(path.join(home, "mcp.json"));
  });

  it("新位置已有配置时完全接管旧位置", async () => {
    writeAt(path.join(home, "agent"), "mcp.json", JSON.stringify({
      mcpServers: { current: { type: "stdio", command: "c", args: [] } },
    }));
    writeAt(home, "mcp.json", JSON.stringify({
      mcpServers: { stale: { type: "stdio", command: "s", args: [] } },
    }));
    const mcp = await loadService();

    expect(mcp.getMcpConfigPath()).toBe(path.join(home, "agent", "mcp.json"));
    expect(mcp.scanMcpServers().map((s) => s.name)).toEqual(["current"]);
    expect(mcp.saveMcpServer("added", { type: "stdio", command: "d", args: [] }).ok).toBe(true);
    expect(servers(path.join(home, "agent"), "mcp.json").sort()).toEqual(["added", "current"]);
    // 旧文件原样保留（破坏性删除交由迁移/用户处理），但不再被读
    expect(servers(home, "mcp.json")).toEqual(["stale"]);
  });

  it("两边都没有配置时，新位置是首选落点", async () => {
    const mcp = await loadService();
    expect(mcp.getMcpConfigPath()).toBe(path.join(home, "agent", "mcp.json"));
    expect(mcp.saveMcpServer("fresh", { type: "stdio", command: "f", args: [] }).ok).toBe(true);
    expect(servers(path.join(home, "agent"), "mcp.json")).toEqual(["fresh"]);
  });
});
