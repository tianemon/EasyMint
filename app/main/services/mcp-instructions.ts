/**
 * 缓存 MCP server 在 initialize 时给出的 `instructions`（协议自述：「本 server 能做什么」）。
 *
 * 自述只在明确搜索该 server 后作为第三方资料返回，不进入常驻工具说明。
 * 每次连接都用最新自述覆盖缓存；server 不再提供自述时清掉旧值。
 *
 * **失效**靠配置指纹：键含 `definitionFingerprint`（换命令 / 换 URL / 换令牌 / 改用途说明都会变），
 * 旧自述立即不可达——不会拿 A 的说明去描述 B。同一 server 在旧配置下的条目在写入时清掉。
 *
 * 实测（2026-09-24，本机 4 个 server）：github 1802 字符、codegraph 5787 字符提供自述；
 * playwright、tavily 不提供 → 这条链路是**纯增益**，缺失时一切照旧（退回只露 server 名）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { atomicWrite, lockConfigDirectory } from "./native-config-storage";
import { definitionFingerprint, getMcpConfigPath } from "./mcp-service";
import type { McpServerConfig } from "./mcp-service";

/** 单条自述的落盘上限——第三方文本，别让它无限长。 */
export const MAX_INSTRUCTIONS_CHARS = 8000;

interface Store {
  entries: Record<string, string>;
}

/** 与 mcp.json 同目录（~/.easymint/）；每次调用现取，测试可经 mock 的 getMcpConfigPath 改路径。 */
function storePath(): string {
  return path.join(path.dirname(getMcpConfigPath()), "mcp-instructions.json");
}

/** 不缓存到进程内：文件很小，且 EM 没有单实例锁——每次读盘才能让多实例互见最新值。 */
function readStore(): Store {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf-8")) as Store;
    return parsed && typeof parsed.entries === "object" && parsed.entries ? parsed : { entries: {} };
  } catch {
    // 不存在 / 损坏都当空：自述只是增益，绝不能因为它读不出来就让工具加载失败
    return { entries: {} };
  }
}

function storeKey(name: string, cfg: McpServerConfig, projectPath?: string): string {
  return `${projectPath ?? ""}\u0000${name}\u0000${definitionFingerprint(cfg)}`;
}

/** 取某 server 的自述；没存过或配置已变都返回 undefined。 */
export function readMcpInstructions(
  name: string,
  cfg: McpServerConfig | null | undefined,
  projectPath?: string,
): string | undefined {
  if (!cfg) return undefined;
  const text = readStore().entries[storeKey(name, cfg, projectPath)];
  return text && text.trim() ? text : undefined;
}

/** 存下自述；空文本清掉旧值。同一 server 的旧配置条目一并清掉。 */
export function writeMcpInstructions(
  name: string,
  cfg: McpServerConfig,
  projectPath: string | undefined,
  text: string,
): void {
  const value = text.trim().slice(0, MAX_INSTRUCTIONS_CHARS);
  // 锁要包住**整个读-改-写**（同 writeMcpApproval 的做法）：EM 没有单实例锁，
  // 只在写那一步加锁的话，读到的旧快照照样能把另一个实例刚写的条目覆盖掉。
  const release = lockConfigDirectory(path.dirname(storePath()));
  try {
    const store = readStore();
    const key = storeKey(name, cfg, projectPath);
    const prefix = `${projectPath ?? ""}\u0000${name}\u0000`;
    const oldKeys = Object.keys(store.entries).filter((existing) => existing.startsWith(prefix));
    if (store.entries[key] === value && oldKeys.length === 1) return;
    if (!value && oldKeys.length === 0) return;
    for (const existing of oldKeys) delete store.entries[existing];
    if (value) store.entries[key] = value;
    atomicWrite(storePath(), JSON.stringify(store));
  } finally {
    release();
  }
}
