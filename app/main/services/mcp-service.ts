/**
 * MCP Service — scan MCP server configs shared with Claude Code.
 *
 * Claude Code stores MCP configs in ~/.claude/.claude.json under "mcpServers".
 * SDK also uses ~/.easymint/.claude.json (when CLAUDE_CONFIG_DIR is set).
 *
 * We scan both locations, merge, and inject into SDK's options.mcpServers.
 * Enable/disable is managed at the EasyMint level via em-settings.json.
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

function claudeCodeMcpPath(): string {
  return path.join(os.homedir(), ".claude", ".claude.json");
}

function easyMintMcpPath(): string {
  return path.join(os.homedir(), ".easymint", ".claude.json");
}

// ── Disabled list ──────────────────────────────────

const EM_SETTINGS = path.join(os.homedir(), ".easymint", "em-settings.json");

function getHiddenMcpServers(): string[] {
  try {
    if (!existsSync(EM_SETTINGS)) return [];
    const data = JSON.parse(readFileSync(EM_SETTINGS, "utf-8"));
    return (data.hiddenMcpServers as string[]) || [];
  } catch {
    return [];
  }
}

// ── Scan ───────────────────────────────────────────

function readMcpServersFrom(filePath: string): Record<string, McpServerConfig> {
  try {
    if (!existsSync(filePath)) return {};
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return (data.mcpServers as Record<string, McpServerConfig>) || {};
  } catch {
    return {};
  }
}

/** Scan all MCP config sources and return unified manifest */
export function scanMcpServers(): McpServerManifest[] {
  const disabled = getHiddenMcpServers();

  // Merge: Claude Code primary, EasyMint fallback (CC overrides EM for same name)
  const easyMintServers = readMcpServersFrom(easyMintMcpPath());
  const claudeServers = readMcpServersFrom(claudeCodeMcpPath());
  const merged = { ...easyMintServers, ...claudeServers };

  const result: McpServerManifest[] = [];
  for (const [name, cfg] of Object.entries(merged)) {
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
  try {
    if (!existsSync(EM_SETTINGS)) return {};
    const data = JSON.parse(readFileSync(EM_SETTINGS, "utf-8"));
    return (data.apiKeys as Record<string, string>) || {};
  } catch {
    return {};
  }
}

// ── Build SDK mcpServers ───────────────────────────

/** Build the mcpServers object for SDK's options (full config with env, apiKeys merged) */
export function buildMcpServersOption(): Record<string, McpServerConfig> | undefined {
  const disabled = getHiddenMcpServers();
  const easyMintServers = readMcpServersFrom(easyMintMcpPath());
  const claudeServers = readMcpServersFrom(claudeCodeMcpPath());
  const merged = { ...easyMintServers, ...claudeServers };
  const apiKeys = getApiKeys();

  const result: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(merged)) {
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

/** Discover which env vars each MCP server needs, with their current values.
 *  Checks MCP config env first, then apiKeys from em-settings.json. */
export function getMcpRequiredKeys(): Record<string, Record<string, string>> {
  const easyMintServers = readMcpServersFrom(easyMintMcpPath());
  const claudeServers = readMcpServersFrom(claudeCodeMcpPath());
  const merged = { ...easyMintServers, ...claudeServers };
  const apiKeys = getApiKeys();

  const result: Record<string, Record<string, string>> = {};
  for (const [name, cfg] of Object.entries(merged)) {
    const keys: Record<string, string> = {};

    // Keys from MCP config env vars (already configured via claude mcp add -e)
    if (cfg.env) {
      for (const [k, v] of Object.entries(cfg.env)) {
        keys[k] = v || apiKeys[k] || "";
      }
    }

    // Keys from apiKeys that match patterns for this server but aren't in MCP env
    const upper = name.toUpperCase().replace(/-/g, "_");
    for (const [k, v] of Object.entries(apiKeys)) {
      if (k.includes(upper) || upper.includes(k.replace(/_API_KEY$/, ""))) {
        if (!(k in keys)) keys[k] = v;
      }
    }

    if (Object.keys(keys).length > 0) result[name] = keys;
  }

  // Built-in MCP server (easymint-builtin) — not in config files, keys from apiKeys only
  const builtinKeys: Record<string, string> = {};
  for (const k of ["VISION_API_KEY"]) {
    builtinKeys[k] = apiKeys[k] || "";
  }
  if (Object.keys(builtinKeys).length > 0) {
    result["easymint-builtin"] = builtinKeys;
  }

  return result;
}

// ── Toggle ─────────────────────────────────────────

export function toggleMcpServer(name: string, enabled: boolean): void {
  const dir = path.dirname(EM_SETTINGS);
  if (!existsSync(dir)) return;
  const data: Record<string, unknown> = {};
  if (existsSync(EM_SETTINGS)) {
    try { Object.assign(data, JSON.parse(readFileSync(EM_SETTINGS, "utf-8"))); } catch { /* overwrite */ }
  }
  let list: string[] = (data.hiddenMcpServers as string[]) || [];
  if (enabled) {
    list = list.filter((n) => n !== name);
  } else {
    if (!list.includes(name)) list.push(name);
  }
  data.hiddenMcpServers = list;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
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
 *
 *  Writes to ~/.easymint/.claude.json so EM's config stays independent
 *  from Claude Code. buildMcpServersOption merges from both sources. */
export function seedDefaultMcp(): void {
  const configPath = easyMintMcpPath();
  const configDir = path.dirname(configPath);
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

  let data: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try { data = JSON.parse(readFileSync(configPath, "utf-8")); } catch { /* overwrite */ }
  }

  const existing: Record<string, McpServerConfig> =
    (data.mcpServers as Record<string, McpServerConfig>) || {};
  let changed = false;

  // Standard servers — just write config entries
  for (const [name, cfg] of Object.entries(DEFAULT_MCP_SERVERS)) {
    if (!existing[name]) {
      existing[name] = cfg;
      changed = true;
      console.log(`[seedDefaultMcp] added config: ${name}`);
    }
  }

  if (changed) {
    data.mcpServers = existing;
    writeFileSync(configPath, JSON.stringify(data, null, 2), "utf-8");
    console.log("[seedDefaultMcp] mcp config written to", configPath);
  }
}

// ── Plugin marketplace seed ────────────────────────
// Removed seedDefaultPlugins — plugin marketplace mechanism was redundant.
// Skills are seeded by seedDefaultSkills to ~/.claude/skills/.
