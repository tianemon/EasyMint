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
  /** 可选：连接超时（毫秒）；缺省走 adapter 默认（8000） */
  timeout?: number;
}

/** 服务器名规范（对齐 CC/OMP：小写字母数字 + 连字符/下划线） */
export const MCP_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** MCP 连接状态（界面状态列与诊断用） */
export interface McpServerStatus {
  name: string;
  state: "connected" | "connecting" | "failed" | "disabled";
  toolCount?: number;
  /** 脱敏后的失败原因（仅 failed 时有） */
  error?: string;
}

// ── 环境变量展开（对齐 CC/OMP：${VAR} 与 ${VAR:-default}） ────

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/** 展开字符串中的 ${VAR} / ${VAR:-default}；env 缺省取 process.env */
export function expandEnvVars(input: string, env?: Record<string, string>): { value: string; missing: string[] } {
  const missing: string[] = [];
  const value = input.replace(VAR_RE, (whole, name: string, def?: string) => {
    const raw = env?.[name] ?? process.env[name];
    if (raw !== undefined && raw !== "") return raw;
    if (def !== undefined) return def;
    missing.push(name);
    return whole; // 未定义且无默认 → 保留原样，由调用方提示
  });
  return { value, missing };
}

/** 展开配置中的 command/args/env/url/headers（OMP/CC 的作用域一致） */
export function expandServerConfig(
  cfg: McpServerConfig,
  env?: Record<string, string>,
): { cfg: McpServerConfig; missing: string[] } {
  const missing = new Set<string>();
  const one = (s: string | undefined): string | undefined => {
    if (s === undefined) return undefined;
    const { value, missing: m } = expandEnvVars(s, env);
    m.forEach((x) => missing.add(x));
    return value;
  };
  const map = (rec: Record<string, string> | undefined): Record<string, string> | undefined => {
    if (!rec) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = one(v) ?? v;
    return out;
  };
  return {
    cfg: {
      ...cfg,
      command: one(cfg.command),
      args: cfg.args?.map((a) => one(a) ?? a),
      url: one(cfg.url),
      env: map(cfg.env),
      headers: map(cfg.headers),
    },
    missing: [...missing],
  };
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

// ── 校验与 CRUD（配置管理界面） ────────────────────

export interface McpValidationResult {
  ok: boolean;
  error?: string;
}

/** 校验 server 配置（对齐 OMP config.ts:317-343：stdio 需 command，command 与 url 互斥） */
export function validateMcpServer(name: string, cfg: McpServerConfig): McpValidationResult {
  if (!MCP_NAME_RE.test(name)) {
    return { ok: false, error: "名称需用小写字母/数字/连字符（如 my-server），长度 1-64" };
  }
  if (!cfg || !["stdio", "http", "sse"].includes(cfg.type)) {
    return { ok: false, error: "传输类型必须是 stdio / http / sse" };
  }
  if (cfg.type === "stdio") {
    if (!cfg.command?.trim()) return { ok: false, error: "stdio 类型必须填写启动命令（如 npx）" };
    if (cfg.url) return { ok: false, error: "stdio 类型不能同时填写 URL" };
  } else {
    if (!cfg.url?.trim()) return { ok: false, error: `${cfg.type} 类型必须填写 URL` };
    try {
      const u = new URL(cfg.url);
      if (!/^https?:$/.test(u.protocol)) return { ok: false, error: "URL 必须是 http/https" };
    } catch {
      return { ok: false, error: "URL 格式不正确" };
    }
  }
  return { ok: true };
}

/** 新增/更新一个 MCP 服务器（写入 ~/.easymint/mcp.json）。同名覆盖需调用方先确认。 */
export function saveMcpServer(name: string, cfg: McpServerConfig): { ok: boolean; error?: string; overwritten?: boolean } {
  const v = validateMcpServer(name, cfg);
  if (!v.ok) return { ok: false, error: v.error };

  const configPath = emMcpPath();
  const dir = path.dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let data: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      data = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch (e) {
      return { ok: false, error: `配置文件解析失败：${(e as Error).message}` };
    }
  }
  const servers = ((data.mcpServers as Record<string, McpServerConfig>) || {});
  const overwritten = Object.prototype.hasOwnProperty.call(servers, name);
  servers[name] = cfg;
  data.mcpServers = servers;
  try {
    writeFileSync(configPath, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    return { ok: false, error: `写入失败：${(e as Error).message}` };
  }
  return { ok: true, overwritten };
}

/** 删除一个 MCP 服务器（同时清掉禁用名单里的残留） */
export function deleteMcpServer(name: string): { ok: boolean; error?: string } {
  const configPath = emMcpPath();
  if (!existsSync(configPath)) return { ok: false, error: "配置文件不存在" };
  try {
    const data = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const servers = (data.mcpServers as Record<string, McpServerConfig>) || {};
    if (!servers[name]) return { ok: false, error: `未找到服务器「${name}」` };
    delete servers[name];
    data.mcpServers = servers;
    writeFileSync(configPath, JSON.stringify(data, null, 2), "utf-8");
    // 清禁用名单残留，避免同名重建时被误判为停用
    const settings: Record<string, unknown> = existsSync(EM_SETTINGS)
      ? JSON.parse(readFileSync(EM_SETTINGS, "utf-8"))
      : {};
    const hidden = (settings.hiddenMcpServers as string[]) || [];
    if (hidden.includes(name)) {
      settings.hiddenMcpServers = hidden.filter((n) => n !== name);
      writeFileSync(EM_SETTINGS, JSON.stringify(settings, null, 2));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 读取原始配置（供编辑表单回填；不含 apiKeys 等运行时信息） */
export function getMcpServerConfig(name: string): McpServerConfig | null {
  const servers = readMcpServersFrom(emMcpPath());
  return servers[name] ?? null;
}

/** 配置文件路径（界面提示用） */
export function getMcpConfigPath(): string {
  return emMcpPath();
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
  // 迁移导入也算"需要写"——否则迁移的服务器覆盖全部默认服务器时 changed 恒 false,文件不落盘
  let changed = false;
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
          changed = true;
          console.log(`[mcp] 已迁移 ${Object.keys(servers).length} 个 MCP 服务器配置到 ~/.easymint/mcp.json`);
        }
      } catch (e) {
        console.warn("[mcp] 迁移旧 MCP 配置失败:", (e as Error).message);
      }
    }
  }

  const existing: Record<string, McpServerConfig> =
    (data.mcpServers as Record<string, McpServerConfig>) || {};

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
