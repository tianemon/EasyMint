import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentPermissionService, readonlyDenyReason } from "./permission/agent-permission-service";
import type { CanUseToolOptions } from "./permission/agent-permission-service";

/**
 * 只读档契约（2026-09-17 定案：原"受限档"改成只读——**读自由，其余一律拒绝**）。
 *
 * 工具面采用纯读白名单，未知工具默认拒绝。高度敏感凭据仍拒绝读取，因为返回内容会进入
 * 远程模型上下文，模型请求本身也是外发通道。
 */
const cacheMock = vi.hoisted(() => ({ mode: "readonly" as string }));
vi.mock("./session-cache", () => ({ readCache: () => ({ permissionMode: cacheMock.mode }) }));
vi.mock("./sandbox/manager", () => ({
  ensureSandbox: async () => ({ ok: true }),
  isSandboxBypassed: () => false,
  isSandboxBypassedForMode: () => false,
}));

const CWD = path.join(os.homedir(), "dev", "myproj");
const opts = { signal: new AbortController().signal, toolUseID: "t" } as CanUseToolOptions;
const service = new AgentPermissionService();
const check = (name: string, input: Record<string, unknown>) => {
  const tool = service.createCanUseTool("sid-readonly", CWD);
  return tool(name, input, opts);
};

describe("只读档：读自由", () => {
  it("普通读类工具放行", async () => {
    for (const [name, input] of [
      ["read", { file_path: path.join(CWD, "src", "index.ts") }],
      ["ls", { path: os.homedir() }],
    ] as Array<[string, Record<string, unknown>]>) {
      const result = await check(name, input);
      expect(result.behavior, `${name} ${JSON.stringify(input)}`).toBe("allow");
    }
  });

  it("高度敏感凭据仍拒绝读取（模型请求也是外发通道）", async () => {
    const result = await check("Read", { file_path: path.join(os.homedir(), ".ssh", "id_rsa") });
    expect(result.behavior).toBe("deny");
  });
});

describe("只读档：其余一律拒绝", () => {
  it("执行类全部拒绝", async () => {
    for (const [name, input] of [
      ["bash", { command: "echo hi" }],
      ["powershell", { command: "Get-ChildItem" }],
      ["install_dependency", { manager: "npm", packages: ["left-pad"], scope: "project" }],
    ] as Array<[string, Record<string, unknown>]>) {
      const result = await check(name, input);
      expect(result.behavior, name).toBe("deny");
    }
  });

  it("写入类全部拒绝（连工作区内的写入也拒）", async () => {
    for (const [name, input] of [
      ["Write", { file_path: path.join(CWD, "a.txt"), content: "x" }],
      ["Edit", { file_path: path.join(CWD, "a.txt"), old_string: "a", new_string: "b" }],
    ] as Array<[string, Record<string, unknown>]>) {
      const result = await check(name, input);
      expect(result.behavior, name).toBe("deny");
    }
  });

  it("联网工具与 MCP 全部拒绝（漏掉任一条，整档的外泄保证就被抵消）", async () => {
    for (const [name, input] of [
      ["web_fetch", { url: "https://example.com" }],
      ["web_search", { query: "x" }],
      ["mcp__playwright__browser_navigate", { url: "https://example.com" }],
      ["mcp__github__push_files", { path: "a" }],
    ] as Array<[string, Record<string, unknown>]>) {
      const result = await check(name, input);
      expect(result.behavior, name).toBe("deny");
    }
  });
});

describe("只读档纯读白名单", () => {
  const EXECUTING_OR_WRITING_OR_NETWORK_TOOLS = [
    "bash", "powershell", "install_dependency",
    "write", "edit", "notebookedit",
    "mcp__anything__goes",
    "web_fetch", "web_search",
  ];

  it("每个执行/写入/联网工具都有明确分类（返回非 null）", () => {
    for (const name of EXECUTING_OR_WRITING_OR_NETWORK_TOOLS) {
      expect(readonlyDenyReason(name), name).not.toBeNull();
    }
  });

  it("明确审查过的纯读工具放行", () => {
    for (const name of ["read", "ls", "list_issues", "list_agents", "read_agent_log", "ask_user"]) {
      expect(readonlyDenyReason(name), name).toBeNull();
    }
  });

  it("统一记忆只放行查询动作，已退出注册的旧经验工具不再保留白名单", () => {
    for(const action of ["search","read","read_summary"])expect(readonlyDenyReason("memory",{action})).toBeNull();
    for(const action of ["save","update","forget","write_summary","unknown"])expect(readonlyDenyReason("memory",{action})).not.toBeNull();
    expect(readonlyDenyReason("search_experiences")).not.toBeNull();
  });

  it("可能按需下载二进制的搜索工具默认拒绝", () => {
    for (const name of ["grep", "find", "glob"]) {
      expect(readonlyDenyReason(name), name).not.toBeNull();
    }
  });

  it("所有未知工具默认拒绝，写状态的产品工具不能漏过", () => {
    for (const name of ["unknown_future_tool", "task", "use_skill", "todo_write", "todo_user", "set_task_status", "set_issue_status", "manage_skill", "import_skill", "import_mcp_server", "set_environment", "learn", "retire_experiences"]) {
      expect(readonlyDenyReason(name), name).not.toBeNull();
    }
  });
});
