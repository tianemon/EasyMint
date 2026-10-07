/**
 * `EASYMINT_HOME` 覆盖的回归锚点。
 *
 * 保护目标：全局数据目录只由 `emHome()` 决定，且**模块级常量**（加载时求值）也采纳该变量——
 * 漏掉任一处就会出现「一半数据在新目录、一半在旧目录」。`npm run dev:isolated` 依赖这个能力。
 */
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));

import { emHome, emAgentDir, resolveHome } from "../utils/paths";
import { DATA_DIR } from "./store";
import { getMcpConfigPath } from "./mcp-service";

describe("EASYMINT_HOME 覆盖", () => {
  it("emHome() 与各模块的模块级常量都采纳该变量；未设时回落 ~/.easymint", () => {
    const override = process.env.EASYMINT_HOME?.trim();
    const expected = override ? resolveHome(override) : path.join(os.homedir(), ".easymint");
    console.log(`EASYMINT_HOME=${override ?? "（未设）"} → 解析为 ${emHome()}`);
    expect(emHome()).toBe(expected);
    // 模块级常量（加载时求值）同样采纳
    expect(DATA_DIR).toBe(expected);
    // MCP 配置随 EM_HOME 一起平移。注意这里只断言"落在 emHome 之下"而不是"必须在 agent 层"：
    // getMcpConfigPath() 返回的是**生效路径**——归位迁移 best-effort，旧位置仍有配置时
    // 会沿用旧位置（见 mcp-service 的 userMcpPath），此时它就是 emHome/mcp.json。
    // 锚住"绝不写到 emHome 之外"才是本文件要防的（漏一处 = 一半数据在新目录、一半在旧目录）。
    expect(emAgentDir()).toBe(path.join(expected, "agent"));
    expect([path.join(expected, "agent", "mcp.json"), path.join(expected, "mcp.json")])
      .toContain(getMcpConfigPath());
  });
});
