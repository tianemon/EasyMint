/**
 * MCP Service — EM 独立 MCP 配置(与 Claude Code 解耦)。
 *
 * 配置存 ~/.easymint/mcp.json,不再读写 ~/.claude/.claude.json。
 * 首次启动时一次性迁移旧共享配置;Enable/disable 由 em-settings.json 管理。
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { dropLegacyEncryptedApiKeys } from "./settings-legacy";
import { apiKeysFromDisk, readExternalField, writeExternalField } from "./em-settings-schema";
import { emHome, emAgentDir } from "../utils/paths";
// em-settings.json 是 store / native-config / 本模块**共用**的文件：写入必须走同一把目录锁
// 并原子写——否则双实例（EM 没有单实例锁）会互相覆盖，且 writeFileSync 写一半被杀会留下
// 半截 JSON，下次启动直接报「配置损坏」。见下方各写入点。
import { atomicWrite, lockConfigDirectory } from "./native-config-storage";

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
  /** 远程 server 需要 OAuth 登录（浏览器授权，凭据经系统钥匙串加密存储） */
  oauth?: boolean;
  /** OAuth 回调端口（固定值——DCR redirect_uris 精确匹配），缺省 31173 */
  callbackPort?: number;
  /** 可选：一句话说明这个 server 能做什么（如「浏览器控制」）。写进 search_mcp_tools 的工具说明，
   *  让模型在"该不该找外部能力"这一步就能判断；不填就只能露出服务器名。 */
  description?: string;
  /** Pi's per-request timeout, in seconds; legacy timeout above remains milliseconds. */
  requestTimeoutSeconds?: number;
  cwd?: string;
  exposure?: "codemode" | "deferred" | "direct" | "hidden";
  toolExposure?: Record<string, "codemode" | "deferred" | "direct" | "hidden">;
}

/** 服务器名规范（对齐 CC/OMP：小写字母数字 + 连字符/下划线） */
export const MCP_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** MCP 连接状态（界面状态列与诊断用） */
export interface McpServerStatus {
  name: string;
  state: "connected" | "connecting" | "failed" | "disabled" | "pending" | "idle" | "disconnected" | "needs-auth" | "closed";
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

export type McpScope = "user" | "project" | "project-compat";

export interface McpServerManifest {
  name: string;
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  /** 可选：一句话用途（来自配置的 description），按需入口拿它给模型做提示 */
  description?: string;
  enabled: boolean;
  /** 来源作用域：用户级 / EM 项目级 / 项目根 .mcp.json（只读兼容 CC/OMP） */
  scope: McpScope;
  /** project-compat 为只读——不提供编辑/删除入口 */
  writable: boolean;
  /** 项目级（含 compat）首次使用需用户确认（CC 的 Pending approval 设计）；
   *  定义（command/args/url）变更后重新转回待确认，见 definitionFingerprint */
  pendingApproval?: boolean;
}

// ── Config sources ─────────────────────────────────

/**
 * EM 独立 MCP 配置(与Claude Code 解耦,不再读写 ~/.claude/.claude.json)。
 *
 * 落在 `emAgentDir()`（`~/.easymint/agent/`）下，与 Pi 自身摆放mcp.json / mcp-auth.json /
 * mcp.log 的那一层一致：1.0.4 起 Pi 内置 MCP 会从 `getAgentDir()` 读配置，EM 的配置若留在
 * `emHome()` 根下就会与 SDK 读到的文件分裂成两份。层级严格对应 Pi 默认的 `~/.pi/agent`。
 */
function emMcpPath(): string {
  return path.join(emAgentDir(), "mcp.json");
}

/** 归位前的旧位置（`~/.easymint/mcp.json`）——只读兜底，见mcp-config-migration。 */
function legacyMcpPath(): string {
  return path.join(emHome(), "mcp.json");
}

// ── Disabled list ──────────────────────────────────

const emSettingsPath = () => path.join(emHome(), "em-settings.json");

function getHiddenMcpServers(): string[] {
  if (!existsSync(emSettingsPath())) return [];
  const data = JSON.parse(readFileSync(emSettingsPath(), "utf-8"));
  return (readExternalField(data, "hiddenMcpServers") as string[]) || [];
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

/**
 * 用户级配置的**生效路径**：新位置优先，新位置没有可读配置时回落旧位置。
 *
 * 为什么读和写都要走这一个函数（而不是只给读加回落）：
 * - 只让读回落、写仍写新位置 ⇒ 用户在设置页改一个 server 时，配置被劈成两份
 *   （旧文件里原有的 + 新文件里刚改的），下一次读新位置非空就不再回落，其余 server 看起来"消失"。
 * - 路径切换的职责归迁移本身（`mcp-config-migration`）：搬成功后 `emMcpPath()` 自然接管；
 *   搬失败就一直沿用旧位置，行为与迁移前逐字一致。
 *
 * 归位迁移（`~/.easymint/mcp.json` → `~/.easymint/agent/mcp.json`）是 best-effort 的
 * （失败不阻断启动，下次启动重试），所以这个回落窗口真实存在。
 */
let legacyPathWarned = false;
function userMcpPath(): string {
  const current = emMcpPath();
  if (Object.keys(readMcpServersFrom(current)).length > 0) return current;
  const legacy = legacyMcpPath();
  if (Object.keys(readMcpServersFrom(legacy)).length > 0) {
    // 只警告一次：本函数在扫描/取定义/写入等处都会被调用，迁移长期未完成时会刷屏
    if (!legacyPathWarned) {
      legacyPathWarned = true;
      console.warn("[mcp] 未在 agent/ 下找到配置，仍沿用旧位置 ~/.easymint/mcp.json（迁移未完成？）");
    }
    return legacy;
  }
  // 两边都没有：新位置优先（迁移后首写、seedDefaultMcp 的落点）
  return current;
}

/** 读用户级配置（生效路径，见 userMcpPath） */
function readUserMcpServers(): Record<string, McpServerConfig> {
  return readMcpServersFrom(userMcpPath());
}

/** 项目级目录：EM 项目配置（可写） */
function projectMcpPath(projectPath: string): string {
  return path.join(projectPath, ".easymint", "mcp.json");
}

/** 项目根 .mcp.json（CC/OMP 生态标准）——只读，不写回、不迁移 */
function compatMcpPath(projectPath: string): string {
  return path.join(projectPath, ".mcp.json");
}

// ── 项目级首次审批（CC 的 Pending approval 设计） ──────

/** 已确认的项目级 server 键列表（`<项目路径>::<服务器名>::<定义指纹>`）。 */
function getApprovedMcp(): string[] {
  if (!existsSync(emSettingsPath())) return [];
  try {
    const data = JSON.parse(readFileSync(emSettingsPath(), "utf-8")) as Record<string, unknown>;
    const list = readExternalField(data, "mcpApproved");
    return Array.isArray(list) ? list.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

/**
 * 审批身份绑定**完整的执行定义**：同名 server 的命令、环境或连接配置变化后重新确认。
 *
 * 为什么：审批键原本只有 `<项目路径>::<名>`——共享仓库里别人改过 .mcp.json 的同名条目，
 * 用户先前那次「确认」会被静默挪用给一段没审过的新命令。
 *
 * 指纹取配置文件中的原始定义（`${VAR}` 占位符不展开）；修改定义里的 env/headers
 * 仍会改变子进程或网络请求行为，必须重新确认。
 */
/** 配置指纹：定义里任何"影响行为或影响模型"的字段变了都要变。
 *  审批与运行中的 transport 都用它检测定义变化。 */
export function definitionFingerprint(cfg: McpServerConfig): string {
  const sorted = (values?: Record<string, string>) => values
    ? Object.entries(values).sort(([a], [b]) => a.localeCompare(b))
    : null;
  return createHash("sha256")
    .update(JSON.stringify([
      cfg.type, cfg.command ?? null, cfg.args ?? null, sorted(cfg.env), cfg.url ?? null,
      sorted(cfg.headers), cfg.timeout ?? null, cfg.oauth ?? null, cfg.callbackPort ?? null,
      // description 会进入 Pi 的 mcp_servers 分节，属于"影响模型行为"的定义：
      // 不纳入指纹的话，外部仓库更新 .mcp.json 里这段文字就能绕过审批直接进上下文。
      cfg.description ?? null,
      // Keep old approvals valid when no new fields are present.
      ...(cfg.cwd !== undefined || cfg.requestTimeoutSeconds !== undefined || cfg.exposure !== undefined || cfg.toolExposure !== undefined
        ? [{ cwd: cfg.cwd, requestTimeoutSeconds: cfg.requestTimeoutSeconds, exposure: cfg.exposure, toolExposure: sorted(cfg.toolExposure) }] : []),
    ]))
    .digest("hex")
    .slice(0, 32);
}

function approvalEntry(projectPath: string, name: string, fingerprint?: string): string {
  const base = `${projectPath}::${name}`;
  return fingerprint ? `${base}::${fingerprint}` : base;
}

/** 写入审批记录：先清掉该 server 的旧条目（含无指纹的旧记录），只留当前定义这一条 */
function writeMcpApproval(projectPath: string, name: string, entry: string): void {
  // 锁要包住**整个读-改-写**：只在写那一步加锁的话，读到的旧快照照样能把别人刚写的覆盖掉
  const release = lockConfigDirectory(emHome());
  try {
    const data: Record<string, unknown> = existsSync(emSettingsPath())
      ? JSON.parse(readFileSync(emSettingsPath(), "utf-8"))
      : {};
    const base = `${projectPath}::${name}`;
    const list = getApprovedMcp().filter((k) => k !== base && !k.startsWith(`${base}::`));
    list.push(entry);
    writeExternalField(data, "mcpApproved", list);
    atomicWrite(emSettingsPath(), JSON.stringify(data, null, 2));
  } finally { release(); }
}

/** 确认一个项目级 server（写入 em-settings.json 的 `mcp.approved`） */
export function approveMcpServer(projectPath: string, name: string): void {
  const manifest = scanMcpServers(projectPath).find((server) => server.name === name);
  if (!manifest || manifest.scope === "user") throw new Error(`服务器「${name}」的项目级定义已不存在，请刷新列表`);
  const cfg = getMcpServerConfig(name, { scope: manifest.scope, projectPath });
  if (!cfg) throw new Error(`服务器「${name}」的项目级定义已不存在，请刷新列表`);
  writeMcpApproval(projectPath, name, approvalEntry(projectPath, name, definitionFingerprint(cfg)));
}

/**
 * 该 server 是否已确认启用。
 *
 * 旧记录没有原定义可核对，不能把当前文件（可能已被改动）静默采纳为新基线。
 * 首次扫描将其视为待确认，用户确认后 writeMcpApproval 会清掉旧键。
 */
function isMcpApproved(approved: readonly string[], projectPath: string, name: string, cfg: McpServerConfig): boolean {
  const entry = approvalEntry(projectPath, name, definitionFingerprint(cfg));
  return approved.includes(entry);
}

/** 多来源扫描：用户级（可写）> EM 项目级（可写）> 项目根 .mcp.json（只读兼容） */
export function scanMcpServers(projectPath?: string): McpServerManifest[] {
  const disabled = getHiddenMcpServers();
  const approved = getApprovedMcp();
  const result: McpServerManifest[] = [];
  const taken = new Set<string>();

  // 1) 用户级
  for (const [name, cfg] of Object.entries(readUserMcpServers())) {
    result.push({
      name, type: cfg.type, command: cfg.command, args: cfg.args, url: cfg.url,
      description: cfg.description,
      enabled: !disabled.includes(name), scope: "user", writable: true,
    });
    taken.add(name);
  }

  if (projectPath) {
    // 2) EM 项目级（可写）
    for (const [name, cfg] of Object.entries(readMcpServersFrom(projectMcpPath(projectPath)))) {
      if (taken.has(name)) continue;
      result.push({
        name, type: cfg.type, command: cfg.command, args: cfg.args, url: cfg.url,
        description: cfg.description,
        enabled: !disabled.includes(name), scope: "project", writable: true,
        pendingApproval: !isMcpApproved(approved, projectPath, name, cfg),
      });
      taken.add(name);
    }
    // 3) 项目根 .mcp.json（只读兼容 CC/OMP——不写回、不迁移）
    for (const [name, cfg] of Object.entries(readMcpServersFrom(compatMcpPath(projectPath)))) {
      if (taken.has(name)) continue;
      result.push({
        name, type: cfg.type, command: cfg.command, args: cfg.args, url: cfg.url,
        description: cfg.description,
        enabled: !disabled.includes(name), scope: "project-compat", writable: false,
        pendingApproval: !isMcpApproved(approved, projectPath, name, cfg),
      });
      taken.add(name);
    }
  }

  return result;
}

// ── API keys ───────────────────────────────────────

function getApiKeys(): Record<string, string> {
  if (!existsSync(emSettingsPath())) return {};
  const data = JSON.parse(readFileSync(emSettingsPath(), "utf-8"));
  // 磁盘是分组结构（capabilities.* + env 池），组装回「环境变量名 → 值」——键名即注入 MCP 的变量名。
  // 1.4 回退后明文落盘；磁盘残留的旧 safeStorage 密文（em-v1: 前缀）不可解密 → 丢弃视为未配置
  return dropLegacyEncryptedApiKeys(apiKeysFromDisk(data) ?? (data.apiKeys as Record<string, string> | undefined)) || {};
}

/** Discover which env vars each MCP server needs. 只返回状态（已配置/未配置），不泄露实际值。 */
export function getMcpRequiredKeys(): Record<string, Record<string, string>> {
  const servers = readUserMcpServers();
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
  if (!cfg || !["stdio", "http"].includes(cfg.type)) {
    return { ok: false, error: "传输类型必须是 stdio / http；旧 HTTP+SSE 请迁移到 Streamable HTTP 端点" };
  }
  for (const field of ["command", "url", "description", "cwd"] as const) {
    if (cfg[field] !== undefined && typeof cfg[field] !== "string") return { ok: false, error: `${field} 必须是字符串` };
  }
  if (cfg.args !== undefined && (!Array.isArray(cfg.args) || cfg.args.some(value => typeof value !== "string"))) return { ok: false, error: "args 必须是字符串数组" };
  for (const field of ["env", "headers", "toolExposure"] as const) {
    const value = cfg[field];
    if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(item => typeof item !== "string"))) {
      return { ok: false, error: `${field} 必须是字符串字典` };
    }
  }
  if (cfg.callbackPort !== undefined && (!Number.isInteger(cfg.callbackPort) || cfg.callbackPort < 1 || cfg.callbackPort > 65535)) return { ok: false, error: "callbackPort 必须是有效端口" };
  if (cfg.timeout !== undefined && (!Number.isFinite(cfg.timeout) || cfg.timeout <= 0)) return { ok: false, error: "连接超时必须为正数（毫秒）" };
  if (cfg.requestTimeoutSeconds !== undefined && (!Number.isFinite(cfg.requestTimeoutSeconds) || cfg.requestTimeoutSeconds <= 0)) return { ok: false, error: "请求超时必须为正数（秒）" };
  const exposures = ["codemode", "deferred", "direct", "hidden"];
  if (cfg.exposure !== undefined && !exposures.includes(cfg.exposure)) return { ok: false, error: "不支持的 exposure" };
  if (cfg.toolExposure && Object.values(cfg.toolExposure).some(value => !exposures.includes(value))) return { ok: false, error: "不支持的 toolExposure" };
  if (cfg.oauth !== undefined && typeof cfg.oauth !== "boolean") return { ok: false, error: "EasyMint 的 oauth 字段必须是布尔值" };
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

/** 新增/更新一个 MCP 服务器。scope=project 写入项目 .easymint/mcp.json；
 *  project-compat（项目根 .mcp.json）为只读来源，拒绝写入。同名覆盖需调用方先确认。 */
export function saveMcpServer(
  name: string,
  cfg: McpServerConfig,
  opts?: { scope?: McpScope; projectPath?: string },
): { ok: boolean; error?: string; overwritten?: boolean } {
  const v = validateMcpServer(name, cfg);
  if (!v.ok) return { ok: false, error: v.error };

  if (opts?.scope === "project-compat") {
    return { ok: false, error: "项目根 .mcp.json 为只读兼容来源，请直接编辑该文件（EM 不会写回）" };
  }
  if (opts?.scope === "project" && !opts.projectPath) {
    return { ok: false, error: "缺少项目路径" };
  }

  const configPath = opts?.scope === "project" && opts.projectPath
    ? projectMcpPath(opts.projectPath)
    : userMcpPath();
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
    atomicWrite(configPath, JSON.stringify(data, null, 2));
  } catch (e) {
    return { ok: false, error: `写入失败：${(e as Error).message}` };
  }
  return { ok: true, overwritten };
}

/** 删除一个 MCP 服务器（同时清掉禁用名单里的残留）。只读来源拒绝删除。 */
export function deleteMcpServer(
  name: string,
  opts?: { scope?: McpScope; projectPath?: string },
): { ok: boolean; error?: string } {
  if (opts?.scope === "project-compat") {
    return { ok: false, error: "项目根 .mcp.json 为只读兼容来源，请直接编辑该文件删除" };
  }
  const configPath = opts?.scope === "project" && opts.projectPath
    ? projectMcpPath(opts.projectPath)
    : userMcpPath();
  if (!existsSync(configPath)) return { ok: false, error: "配置文件不存在" };
  try {
    const data = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const servers = (data.mcpServers as Record<string, McpServerConfig>) || {};
    if (!servers[name]) return { ok: false, error: `未找到服务器「${name}」` };
    delete servers[name];
    data.mcpServers = servers;
    atomicWrite(configPath, JSON.stringify(data, null, 2));
    // 清禁用名单残留，避免同名重建时被误判为停用
    // 同 approveMcpServer：锁包住整个读-改-写，写用原子替换
    const release = lockConfigDirectory(emHome());
    try {
      const settings: Record<string, unknown> = existsSync(emSettingsPath())
        ? JSON.parse(readFileSync(emSettingsPath(), "utf-8"))
        : {};
      const hidden = (readExternalField(settings, "hiddenMcpServers") as string[]) || [];
      if (hidden.includes(name)) {
        writeExternalField(settings, "hiddenMcpServers", hidden.filter((n) => n !== name));
        atomicWrite(emSettingsPath(), JSON.stringify(settings, null, 2));
      }
    } finally { release(); }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 读取原始配置（供编辑表单回填；不含 apiKeys 等运行时信息） */
export function getMcpServerConfig(name: string, opts?: { scope?: McpScope; projectPath?: string }): McpServerConfig | null {
  const file = opts?.scope === "project" && opts.projectPath
    ? projectMcpPath(opts.projectPath)
    : opts?.scope === "project-compat" && opts.projectPath
      ? compatMcpPath(opts.projectPath)
      : userMcpPath();
  const servers = readMcpServersFrom(file);
  return servers[name] ?? null;
}

/**
 * 配置文件路径（界面提示用）。
 *
 * 返回**生效路径**而不是恒定新位置：设置页会把这条路径显示给用户（"配置在 xxx"），
 * 迁移未完成时若显示新位置，用户照着去编辑的是空文件，而程序读的是旧文件。
 * 调用方通过这个路径保持配置读写同源，
 * 跟着生效路径走才不会与配置分家。
 */
export function getMcpConfigPath(): string {
  return userMcpPath();
}

// ── Toggle ─────────────────────────────────────────

export function toggleMcpServer(name: string, enabled: boolean): void {
  // 同 approveMcpServer：锁包住整个读-改-写，写用原子替换
  const release = lockConfigDirectory(emHome());
  try {
    const data: Record<string, unknown> = existsSync(emSettingsPath())
      ? JSON.parse(readFileSync(emSettingsPath(), "utf-8"))
      : {};

    let list: string[] = (readExternalField(data, "hiddenMcpServers") as string[]) || [];
    if (enabled) {
      list = list.filter((n) => n !== name);
    } else {
      if (!list.includes(name)) list.push(name);
    }
    writeExternalField(data, "hiddenMcpServers", list);
    atomicWrite(emSettingsPath(), JSON.stringify(data, null, 2));
  } finally { release(); }
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
 *  与 Claude Code 解耦:EM 配置独立存 ~/.easymint/agent/mcp.json（与 Pi 的 agentDir 同层）。
 *  首次启动时若旧共享配置(~/.claude/.claude.json)存在 → 一次性迁移导入,此后不再读写 CC 配置。 */
export function seedDefaultMcp(): void {
  // 走生效路径：迁移未完成时旧位置才是正在被读的那份，往新位置播种会把配置劈成两份
  const configPath = userMcpPath();
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
    atomicWrite(configPath, JSON.stringify(data, null, 2));
  }
}

// ── Plugin marketplace seed ────────────────────────
// Removed seedDefaultPlugins — plugin marketplace mechanism was redundant.
// Skills are seeded by seedBundledSkills to ~/.easymint/skills/.

// ── 粘贴导入解析（对齐 claude mcp add-json / 用户粘贴 README 片段的习惯） ────

const COMMAND_HINT_RE = /^(npx|uvx|node|python3?|bunx|deno|docker)\b/i;

export interface ParsedMcpImport {
  servers: Record<string, McpServerConfig>;
  /** 需要用户注意的提示（如同名覆盖、变量缺失） */
  notes: string[];
}

/** 从粘贴文本解析 MCP 配置：完整 mcpServers JSON / 单 server 对象 /
 *  claude mcp add 命令行 / 裸 npx·uvx 命令。失败返回明确错误。 */
export function parseMcpConfig(text: string): { ok: true; parsed: ParsedMcpImport } | { ok: false; error: string } {
  const trimmed = (text || "").trim();
  if (!trimmed) return { ok: false, error: "内容为空" };
  const notes: string[] = [];

  // 1) claude mcp add-json name '{...}'
  const addJson = trimmed.match(/mcp\s+add-json\s+(\S+)\s+('(.*)'|"(.*)"|(\{.*\}))/s);
  if (addJson) {
    const name = addJson[1]!.replace(/^['"]|['"]$/g, "");
    const jsonRaw = addJson[3] ?? addJson[4] ?? addJson[5] ?? "";
    try {
      const cfg = JSON.parse(jsonRaw) as McpServerConfig;
      const v = validateMcpServer(name, cfg);
      if (!v.ok) return { ok: false, error: `「${name}」配置不合法：${v.error}` };
      return { ok: true, parsed: { servers: { [name]: cfg }, notes } };
    } catch (e) {
      return { ok: false, error: `add-json 的 JSON 解析失败：${(e as Error).message}` };
    }
  }

  // 2) claude mcp add [flags] name [-- cmd args...]
  const addCmd = trimmed.match(/mcp\s+add\s+(.*)$/s);
  if (addCmd) {
    let rest = addCmd[1]!.trim();
    const env: Record<string, string> = {};
    const headers: Record<string, string> = {};
    let type: McpServerConfig["type"] = "stdio";
    let url: string | undefined;
    // 提取 flags（--transport/--header/--env）
    rest = rest.replace(/--transport\s+(\S+)/gi, (_, t) => { type = /https?:/i.test(t) || ["http", "sse"].includes(String(t).toLowerCase()) ? (String(t).toLowerCase() as McpServerConfig["type"]) : "stdio"; return ""; });
    rest = rest.replace(/--header\s+"?([^:\s]+):\s*([^"]*)"?\s*/gi, (_, k, v) => { headers[k] = v; return ""; });
    rest = rest.replace(/--env\s+(\S+)=("([^"]*)"|\S+)/gi, (_, k, v, q) => { env[k] = q ?? v; return ""; });
    rest = rest.replace(/--scope\s+\S+/gi, "").replace(/--client-(id|secret)\s+\S+/gi, "").replace(/--callback-port\s+\d+/gi, "").trim();
    // name 与命令分离：第一个非 flag token 是 name；-- 之后是命令
    const dashIdx = rest.indexOf("--");
    const tokens = (dashIdx >= 0 ? rest.slice(0, dashIdx) : rest).split(/\s+/).filter(Boolean);
    let name = "mcp-server";
    let cmdPart = dashIdx >= 0 ? rest.slice(dashIdx + 2).trim() : "";
    if (tokens.length > 0) {
      if (!COMMAND_HINT_RE.test(tokens[0]!)) {
        name = tokens[0]!;
        cmdPart = dashIdx >= 0 ? rest.slice(dashIdx + 2).trim() : tokens.slice(1).join(" ");
      } else {
        cmdPart = tokens.join(" ");
      }
    }
    if (dashIdx < 0 && !cmdPart) cmdPart = rest;
    if (type !== "stdio" && !url) url = cmdPart && /^https?:\/\//.test(cmdPart) ? cmdPart : undefined;
    if (type === "stdio" && !cmdPart) return { ok: false, error: "命令行里没有找到要执行的命令" };
    const cfg: McpServerConfig = type === "stdio"
      ? { type, command: cmdPart.split(/\s+/)[0], args: cmdPart.split(/\s+/).slice(1).filter(Boolean), env: Object.keys(env).length ? env : undefined }
      : { type, url: url ?? undefined, headers: Object.keys(headers).length ? headers : undefined, env: Object.keys(env).length ? env : undefined };
    const v = validateMcpServer(name, cfg);
    if (!v.ok) return { ok: false, error: `「${name}」配置不合法：${v.error}` };
    if (dashIdx >= 0 && cmdPart) notes.push("已按空格拆分命令与参数（含引号的参数请导入后在界面微调）");
    return { ok: true, parsed: { servers: { [name]: cfg }, notes } };
  }

  // 3) JSON 形态：完整 mcpServers 或单 server 对象
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      if (data.mcpServers && typeof data.mcpServers === "object") {
        const servers: Record<string, McpServerConfig> = {};
        for (const [name, cfg] of Object.entries(data.mcpServers as Record<string, McpServerConfig>)) {
          const v = validateMcpServer(name, cfg);
          if (!v.ok) return { ok: false, error: `「${name}」配置不合法：${v.error}` };
          servers[name] = cfg;
        }
        if (Object.keys(servers).length === 0) return { ok: false, error: "mcpServers 为空" };
        return { ok: true, parsed: { servers, notes } };
      }
      // 单 server 对象（有 type 或 command/url 之一）
      if (data.type || data.command || data.url) {
        const cfg = data as unknown as McpServerConfig;
        const v = validateMcpServer("mcp-server", cfg);
        if (!v.ok) return { ok: false, error: `配置不合法：${v.error}` };
        notes.push("粘贴内容里没有服务器名称，默认用 mcp-server，可在导入后重命名");
        return { ok: true, parsed: { servers: { "mcp-server": cfg }, notes } };
      }
    } catch { /* 非 JSON，继续尝试命令行 */ }
  }

  // 4) 裸命令（npx/uvx/node/…）
  if (COMMAND_HINT_RE.test(trimmed)) {
    const parts = trimmed.split(/\s+/);
    const pkgToken = parts.find((p) => /@|mcp|server/i.test(p) && p !== parts[0]) ?? parts[1] ?? "server";
    const name = (pkgToken.split("/").pop() ?? "mcp-server")
      .replace(/^@/, "").replace(/[^a-z0-9_-]/gi, "-").toLowerCase().slice(0, 64)
      .replace(/^[-_]+|[-_]+$/g, "") || "mcp-server";
    const cfg: McpServerConfig = { type: "stdio", command: parts[0], args: parts.slice(1).filter(Boolean) };
    const v = validateMcpServer(name, cfg);
    if (!v.ok) return { ok: false, error: `「${name}」配置不合法：${v.error}` };
    notes.push(`名称从包名推导为「${name}」，导入后可改`);
    return { ok: true, parsed: { servers: { [name]: cfg }, notes } };
  }

  return { ok: false, error: "无法识别的配置格式——支持 mcpServers JSON、单 server JSON、claude mcp add 命令行、或 npx/uvx 等启动命令" };
}
