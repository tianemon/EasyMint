/**
 * 一次性迁移：MCP 配置文件归位到 Pi 的 agentDir 层。
 *
 * ⚠️【待移除的一次性代码】迁移跑够之后应**整体删除**（清理清单）：
 *   1. 本文件与其测试 `mcp-config-migration.test.ts`
 *   2. `app/main/index.ts` 里的 `migrateMcpConfigFiles` 调用块与 import
 *   3. `mcp-service.ts` 的 `legacyMcpPath` + 保留的旧版 OAuth 凭据（新版按 URL 绑定账号，不接管无 URL 的旧令牌）
 *      与两处的回落读取分支（`readUserMcpServers` / `loadCreds`）
 *   移除时机：从含本迁移的版本起发布 2~3 个 minor 版本（EM 无遥测，取保守值）。
 *
 * 背景：EM 的构想是「只把 `~/.pi` 换成 `~/.easymint`，其余层级不变」。
 * `settings.json` / `auth.json` / `models.json` / `sessions` 一直遵守（都在 `~/.easymint/agent/`），
 * 但 MCP 那批文件当初是 EM 自己从零实现的（Pi 1.0.4 之前没有内置 MCP），落在了 `emHome()` 根下。
 * Pi 1.0.4 起内置 MCP 从 `getAgentDir()` 读 `mcp.json`，留着旧位就会与 SDK 读到的文件分裂成两份。
 *
 * 设计要点（与 `session-dir-migration` 同口径）：
 * - **幂等**：排他复制到新位置，保留源备份；并发创建的新文件也绝不覆盖。
 * - **best-effort**：单个文件失败只记日志、保持原样，不阻断启动（下次启动自动重试）。
 * - **不碰项目级**：`<项目>/.easymint/mcp.json` 本来就对齐（`CONFIG_DIR_NAME` 定制为 `.easymint`），
 *   项目根 `.mcp.json` 是只读兼容来源——两者都不动。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { emHome, emAgentDir } from "../utils/paths";

export interface McpConfigMigrationResult {
  /** 已在新位置创建的文件名；源文件保留为备份 */
  moved: string[];
  /** 新位置已存在而跳过（不覆盖用户当前配置） */
  skipped: string[];
  /** 处理失败（保持原样，下次启动重试） */
  failed: string[];
}

/** 旧位置 → 新文件名。键是旧文件名，值是新文件名。 */
const MOVE_MAP: ReadonlyArray<readonly [oldName: string, newName: string]> = [
  // 凭据文件同时改名对齐 Pi（Pi 1.0.0+ 用 mcp-auth.json）
  ["mcp-oauth.json", "mcp-auth.json"],
  ["mcp.json", "mcp.json"],
  ["mcp-instructions.json", "mcp-instructions.json"],
];

export function migrateMcpConfigFiles(): McpConfigMigrationResult {
  const result: McpConfigMigrationResult = { moved: [], skipped: [], failed: [] };
  const fromDir = emHome();
  const toDir = emAgentDir();
  // EASYMINT_HOME 指向同一目录等边界下 from === to，直接跳过（否则会把自己搬给自己）
  if (path.resolve(fromDir) === path.resolve(toDir)) return result;

  if (!fs.existsSync(toDir)) {
    try {
      fs.mkdirSync(toDir, { recursive: true });
    } catch (e) {
      console.error(`[mcp-migration] 无法创建 ${toDir}:`, (e as Error).message);
      return { ...result, failed: MOVE_MAP.map(([old]) => old) };
    }
  }

  for (const [oldName, newName] of MOVE_MAP) {
    const from = path.join(fromDir, oldName);
    const to = path.join(toDir, newName);
    if (!fs.existsSync(from)) continue;
    if (fs.existsSync(to)) {
      // 新位置已有数据：不动。旧文件保留，用户手工确认后再删——迁移不做破坏性删除。
      result.skipped.push(oldName);
      continue;
    }
    try {
      // The existence check above is only an optimization. EXCL is the atomic no-overwrite gate.
      // Keep the source: removing it could race an older app instance writing the legacy path.
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      result.moved.push(oldName);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") result.skipped.push(oldName);
      else {
        result.failed.push(oldName);
        console.error(`[mcp-migration] 迁移 ${from} → ${to} 失败:`, (error as Error).message);
      }
    }
  }
  return result;
}
