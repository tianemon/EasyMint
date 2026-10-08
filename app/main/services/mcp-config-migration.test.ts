/**
 * MCP 配置归位迁移的守卫测试。
 *
 * 关注三件事：① 旧文件真的搬到了 agent/；② **新位置已有数据时不覆盖**（保守，
 * 宁可留两份也不丢用户当前配置）；③ 幂等——重复执行不报错也不二次搬动。
 * 已停用的凭据和服务器自述文件不再复制，历史文件保持原样。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));

const roots: string[] = [];
let home: string;

function writeAt(dir: string, name: string, content: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-migrate-"));
  roots.push(home);
  process.env.EASYMINT_HOME = home;
});

afterEach(() => {
  vi.restoreAllMocks(); syncBuiltinESMExports();
  delete process.env.EASYMINT_HOME;
  for (const dir of roots.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  vi.resetModules();
});

async function loadMigration() {
  vi.resetModules();
  return (await import("./mcp-config-migration")).migrateMcpConfigFiles;
}

describe("MCP 配置归位迁移", () => {
  it.each([false, true])("只迁移 mcp.json，不复制或修改已停用的凭据与自述（已有副本：%s）", async (existing) => {
    writeAt(home, "mcp.json", JSON.stringify({ mcpServers: { a: { command: "x" } } }));
    writeAt(home, "mcp-oauth.json", JSON.stringify({ srv: { tokens: "enc" } }));
    writeAt(home, "mcp-instructions.json", JSON.stringify({ srv: "自述" }));
    const agent = path.join(home, "agent");
    if (existing) {
      writeAt(agent, "mcp-auth.json", "historical-credentials");
      writeAt(agent, "mcp-instructions.json", "historical-instructions");
    }

    const migrate = await loadMigration();
    const r = migrate();

    expect(r.failed).toEqual([]);
    expect(r.moved).toEqual(["mcp.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(agent, "mcp.json"), "utf8")).mcpServers.a.command).toBe("x");
    if (existing) {
      expect(fs.readFileSync(path.join(agent, "mcp-auth.json"), "utf8")).toBe("historical-credentials");
      expect(fs.readFileSync(path.join(agent, "mcp-instructions.json"), "utf8")).toBe("historical-instructions");
    } else {
      expect(fs.existsSync(path.join(agent, "mcp-auth.json"))).toBe(false);
      expect(fs.existsSync(path.join(agent, "mcp-instructions.json"))).toBe(false);
    }
    // 源备份保留；新位置（包括空配置）一旦有效就接管，不会因删除末项而复活旧定义。
    expect(fs.existsSync(path.join(home, "mcp.json"))).toBe(true);
    expect(fs.readFileSync(path.join(home, "mcp-oauth.json"), "utf8")).toBe(JSON.stringify({ srv: { tokens: "enc" } }));
    expect(fs.readFileSync(path.join(home, "mcp-instructions.json"), "utf8")).toBe(JSON.stringify({ srv: "自述" }));
  });

  it("新位置已有配置时不覆盖、不删除旧文件", async () => {
    writeAt(home, "mcp.json", JSON.stringify({ mcpServers: { old: {} } }));
    writeAt(path.join(home, "agent"), "mcp.json", JSON.stringify({ mcpServers: { current: {} } }));

    const migrate = await loadMigration();
    const r = migrate();

    expect(r.moved).toEqual([]);
    expect(r.skipped).toContain("mcp.json");
    // 当前配置原样保留，旧文件也留着（破坏性删除交由用户手工确认）
    expect(JSON.parse(fs.readFileSync(path.join(home, "agent", "mcp.json"), "utf8")).mcpServers).toHaveProperty("current");
    expect(fs.existsSync(path.join(home, "mcp.json"))).toBe(true);
  });

  it("幂等：重复执行不报错也不二次搬动", async () => {
    writeAt(home, "mcp.json", JSON.stringify({ mcpServers: {} }));
    const migrate = await loadMigration();

    expect(migrate().moved).toEqual(["mcp.json"]);
    const second = migrate();
    expect(second.moved).toEqual([]);
    expect(second.failed).toEqual([]);
    expect(fs.existsSync(path.join(home, "agent", "mcp.json"))).toBe(true);
  });

  it("无旧文件时是空操作（不凭空建目录外的任何东西）", async () => {
    const migrate = await loadMigration();
    const r = migrate();
    expect(r).toEqual({ moved: [], skipped: [], failed: [] });
  });

  it("项目级配置不在迁移范围内（本来已对齐 CONFIG_DIR_NAME）", async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-proj-"));
    roots.push(project);
    const projectMcp = path.join(project, ".easymint", "mcp.json");
    writeAt(path.join(project, ".easymint"), "mcp.json", JSON.stringify({ mcpServers: { p: {} } }));
    writeAt(project, ".mcp.json", JSON.stringify({ mcpServers: { q: {} } }));

    const migrate = await loadMigration();
    migrate();

    // 两个项目级来源都原地不动
    expect(fs.existsSync(projectMcp)).toBe(true);
    expect(fs.existsSync(path.join(project, ".mcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(home, "agent", "mcp.json"))).toBe(false);
  });

  it("never overwrites a destination created between existence check and migration", async () => {
    const old = JSON.stringify({ mcpServers: { old: { command: "old" } } });
    const current = JSON.stringify({ mcpServers: { current: { command: "current" } } });
    writeAt(home, "mcp.json", old);
    fs.mkdirSync(path.join(home, "agent"));
    const destination = path.join(home, "agent", "mcp.json");
    const migrate = await loadMigration();
    const exists = fs.existsSync;
    let raced = false;
    vi.spyOn(fs, "existsSync").mockImplementation(file => {
      if (String(file) === destination && !raced) {
        raced = true;
        // Another running instance writes its configuration immediately after the observed miss.
        fs.writeFileSync(destination, current);
        return false;
      }
      return exists(file);
    });
    syncBuiltinESMExports();
    migrate();
    expect(raced).toBe(true);
    expect(fs.readFileSync(destination, "utf8")).toBe(current);
    expect(fs.readFileSync(path.join(home, "mcp.json"), "utf8")).toBe(old);
  });
});
