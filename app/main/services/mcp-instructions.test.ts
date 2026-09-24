import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "./mcp-service";

// getMcpConfigPath 决定落盘目录（模块每次调用现取，所以可以是懒的）；
// definitionFingerprint 用假的：让"配置变了"在测试里可控。
const state = vi.hoisted(() => ({ dir: "" }));
vi.mock("./mcp-service", () => ({
  definitionFingerprint: (cfg: { v?: string }) => `fp-${cfg.v ?? ""}`,
  getMcpConfigPath: () => `${state.dir}/mcp.json`,
}));

import { MAX_INSTRUCTIONS_CHARS, readMcpInstructions, writeMcpInstructions } from "./mcp-instructions";

const store = () => join(state.dir, "mcp-instructions.json");
const cfg = (v: string) => ({ v } as unknown as McpServerConfig);
const entries = () => JSON.parse(readFileSync(store(), "utf-8")).entries as Record<string, string>;

beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), "em-instr-"));
});
afterEach(() => {
  rmSync(state.dir, { recursive: true, force: true });
});

describe("MCP server 自述缓存", () => {
  it("写入后能读回；没存过返回 undefined", () => {
    expect(readMcpInstructions("github", cfg("1"), "/p")).toBeUndefined();
    writeMcpInstructions("github", cfg("1"), "/p", "# GitHub\n\nProvides tools to interact with GitHub.");
    expect(readMcpInstructions("github", cfg("1"), "/p")).toContain("Provides tools");
  });

  it("配置变了就失效——不会拿旧 server 的自述去描述新配置", () => {
    writeMcpInstructions("github", cfg("1"), "/p", "旧说明");
    expect(readMcpInstructions("github", cfg("2"), "/p")).toBeUndefined();
  });

  it("同 server 换配置时清掉旧条目，文件不随改动次数增长", () => {
    writeMcpInstructions("github", cfg("1"), "/p", "第一版");
    writeMcpInstructions("github", cfg("2"), "/p", "第二版");
    writeMcpInstructions("github", cfg("3"), "/p", "第三版");
    expect(Object.keys(entries())).toHaveLength(1);
    expect(readMcpInstructions("github", cfg("3"), "/p")).toBe("第三版");

    // 不同项目下的同名 server 互不影响
    writeMcpInstructions("github", cfg("3"), "/other", "另一个项目");
    expect(Object.keys(entries())).toHaveLength(2);
  });

  it("文件不存在或已损坏都当空——自述是纯增益，不能因此报错", () => {
    expect(readMcpInstructions("github", cfg("1"), "/p")).toBeUndefined();
    writeFileSync(store(), "{ 这不是 JSON");
    expect(() => readMcpInstructions("github", cfg("1"), "/p")).not.toThrow();
    expect(readMcpInstructions("github", cfg("1"), "/p")).toBeUndefined();
  });

  it("空白自述不落盘；超长的按上限截断", () => {
    writeMcpInstructions("github", cfg("1"), "/p", "   \n  ");
    expect(readMcpInstructions("github", cfg("1"), "/p")).toBeUndefined();

    writeMcpInstructions("github", cfg("1"), "/p", "x".repeat(MAX_INSTRUCTIONS_CHARS + 500));
    expect(readMcpInstructions("github", cfg("1"), "/p")).toHaveLength(MAX_INSTRUCTIONS_CHARS);
  });

  it("配置为 null（server 已被删掉）时读不到", () => {
    writeMcpInstructions("github", cfg("1"), "/p", "说明");
    expect(readMcpInstructions("github", null, "/p")).toBeUndefined();
  });
});
