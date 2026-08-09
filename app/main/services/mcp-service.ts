/**
 * MCP Service — EM 独立 MCP 配置(与 Claude Code 解耦)。
 *
 * 配置存 ~/.easymint/mcp.json,不再读写 ~/.claude/.claude.json。
 * 首次启动时一次性迁移旧共享配置;Enable/disable 由 em-settings.json 管理。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Types ──────────────────────────────────────────

export interface McpServerConfig {
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpServerManifest {
  name: string;
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

// ── Config sources ─────────────────────────────────

/** EM 独立 MCP 配置(与 Claude Code 解耦,不再读写 ~/.claude/.claude.json) */
function emMcpPath(): string {
  return path.join(os.homedir(), ".easymint", "mcp.json");
}

// ── Disabled list ──────────────────────────────────

const EM_SETTINGS = path.join(os.homedir(), ".easymint", "em-settings.json");

function getHiddenMcpServers(): string[] {
  if (!existsSync(EM_SETTINGS)) return [];
  const data = JSON.parse(readFileSync(EM_SETTINGS, "utf-8"));
  return (data.hiddenMcpServers as string[]) || [];
}

// ── Scan ───────────────────────────────────────────

function readMcpServersFrom(filePath: string): Record<string, McpServerConfig> {
  if (!existsSync(filePath)) return {};
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return (data.mcpServers as Record<string, McpServerConfig>) || {};
  } catch (e) {
    console.error(`[mcp] 解析 MCP 配置失败 (${filePath}):`, (e as Error).message);
    return {};
  }
}

/** Scan EM's MCP config for the settings panel display */
export function scanMcpServers(): McpServerManifest[] {
  const disabled = getHiddenMcpServers();

  const servers = readMcpServersFrom(emMcpPath());

  const result: McpServerManifest[] = [];
  for (const [name, cfg] of Object.entries(servers)) {
    result.push({
      name,
      type: cfg.type,
      command: cfg.command,
      args: cfg.args,
      url: cfg.url,
      enabled: !disabled.includes(name),
    });
  }

  return result;
}

// ── Build SDK mcpServers ───────────────────────────

// ── API keys ───────────────────────────────────────

function getApiKeys(): Record<string, string> {
  if (!existsSync(EM_SETTINGS)) return {};
  const data = JSON.parse(readFileSync(EM_SETTINGS, "utf-8"));
  return (data.apiKeys as Record<string, string>) || {};
}

// ── Build SDK mcpServers ───────────────────────────

/** Build the mcpServers object for SDK's options (full config with env, apiKeys merged) */
export function buildMcpServersOption(): Record<string, McpServerConfig> | undefined {
  const disabled = getHiddenMcpServers();
  const servers = readMcpServersFrom(emMcpPath());
  const apiKeys = getApiKeys();

  const result: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (disabled.includes(name)) continue;
    // Merge apiKeys into env: MCP config values take priority, but skip empty strings
    const cfgEnv = cfg.env || {};
    const filteredCfgEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfgEnv)) {
      if (v) filteredCfgEnv[k] = v; // Skip empty/placeholder values
    }
    const env = { ...apiKeys, ...filteredCfgEnv };
    result[name] = { ...cfg, env: Object.keys(env).length > 0 ? env : undefined };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/** Discover which env vars each MCP server needs. 只返回状态（已配置/未配置），不泄露实际值。 */
export function getMcpRequiredKeys(): Record<string, Record<string, string>> {
  const servers = readMcpServersFrom(emMcpPath());
  const apiKeys = getApiKeys();

  const result: Record<string, Record<string, string>> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    const keys: Record<string, string> = {};

    // Keys from MCP config env vars
    if (cfg.env) {
      for (const [k, v] of Object.entries(cfg.env)) {
        keys[k] = (v || apiKeys[k]) ? "已配置" : "未配置";
      }
    }

    // Keys from apiKeys matching this server
    const upper = name.toUpperCase().replace(/-/g, "_");
    for (const [k, v] of Object.entries(apiKeys)) {
      if (k.includes(upper) || upper.includes(k.replace(/_API_KEY$/, ""))) {
        if (!(k in keys)) keys[k] = v ? "已配置" : "未配置";
      }
    }

    if (Object.keys(keys).length > 0) result[name] = keys;
  }

  // Built-in MCP servers
  if (apiKeys.VISION_API_KEY) {
    result["easymint-vision"] = { VISION_API_KEY: "已配置" };
  }
  if (apiKeys.TAVILY_API_KEY) {
    result["easymint-web-fetch"] = { TAVILY_API_KEY: "已配置" };
  }

  return result;
}

// ── Toggle ─────────────────────────────────────────

export function toggleMcpServer(name: string, enabled: boolean): void {
  const dir = path.dirname(EM_SETTINGS);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const data: Record<string, unknown> = existsSync(EM_SETTINGS)
    ? JSON.parse(readFileSync(EM_SETTINGS, "utf-8"))
    : {};

  let list: string[] = (data.hiddenMcpServers as string[]) || [];
  if (enabled) {
    list = list.filter((n) => n !== name);
  } else {
    if (!list.includes(name)) list.push(name);
  }
  data.hiddenMcpServers = list;
  writeFileSync(EM_SETTINGS, JSON.stringify(data, null, 2));
}

// ── Seed built-in MCP configs ─────────────────────

const DEFAULT_MCP_SERVERS: Record<string, McpServerConfig> = {
  playwright: {
    type: "stdio",
    command: "npx",
    args: ["@playwright/mcp@latest", "--headless"],
  },
  codegraph: {
    type: "stdio",
    command: "codegraph",
    args: ["serve", "--mcp"],
  },
};

/** Write default MCP server configs on first launch. Merges into existing
 *  config — never overwrites servers already configured.
 *  与 Claude Code 解耦:EM 配置独立存 ~/.easymint/mcp.json。
 *  首次启动时若旧共享配置(~/.claude/.claude.json)存在 → 一次性迁移导入,此后不再读写 CC 配置。 */
export function seedDefaultMcp(): void {
  const configPath = emMcpPath();
  const configDir = path.dirname(configPath);
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

  let data: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    data = JSON.parse(readFileSync(configPath, "utf-8"));
  } else {
    // 一次性迁移:旧 CC 共享配置 → EM 独立配置(仅首次;CC 侧文件原样保留)
    const legacyPath = path.join(os.homedir(), ".claude", ".claude.json");
    if (existsSync(legacyPath)) {
      try {
        const legacy = JSON.parse(readFileSync(legacyPath, "utf-8"));
        const servers = (legacy.mcpServers as Record<string, McpServerConfig>) || {};
        if (Object.keys(servers).length > 0) {
          data.mcpServers = servers;
          console.log(`[mcp] 已迁移 ${Object.keys(servers).length} 个 MCP 服务器配置到 ~/.easymint/mcp.json`);
        }
      } catch (e) {
        console.warn("[mcp] 迁移旧 MCP 配置失败:", (e as Error).message);
      }
    }
  }

  const existing: Record<string, McpServerConfig> =
    (data.mcpServers as Record<string, McpServerConfig>) || {};
  let changed = false;

  // Standard servers — just write config entries
  for (const [name, cfg] of Object.entries(DEFAULT_MCP_SERVERS)) {
    if (!existing[name]) {
      existing[name] = cfg;
      changed = true;
    }
  }

  if (changed) {
    data.mcpServers = existing;
    writeFileSync(configPath, JSON.stringify(data, null, 2), "utf-8");
  }
}

// ── Plugin marketplace seed ────────────────────────
// Removed seedDefaultPlugins — plugin marketplace mechanism was redundant.
// Skills are seeded by seedBundledSkills to ~/.easymint/skills/.
