/**
 * 缓存 MCP server 在 initialize 时给出的 `instructions`（协议自述：「本 server 能做什么」）。
 *
 * **为什么必须落盘**：会话创建时**不连接**任何 server（按需加载的前提），而 `search_mcp_tools`
 * 的工具说明在那一刻就拼好了——「这个 server 能干什么」在第一次搜索之前无从得知。连接过一次后
 * 把自述存下来，下一次会话就能拿它当用途说明（用户没手工填 `description` 时），于是
 * **新接一个 server 什么都不用配**。
 *
 * **失效**靠配置指纹：键含 `definitionFingerprint`（换命令 / 换 URL / 换令牌 / 改用途说明都会变），
 * 旧自述立即不可达——不会拿 A 的说明去描述 B。同一 server 在旧配置下的条目在写入时清掉。
 *
 * 实测（2026-09-24，本机 4 个 server）：github 1802 字符、codegraph 5787 字符提供自述；
 * playwright、tavily 不提供 → 这条链路是**纯增益**，缺失时一切照旧（退回只露 server 名）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { atomicWrite } from "./native-config-storage";
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

/** 存下自述（重复内容不重写）。同一 server 在旧配置下的条目一并清掉，避免文件无限增长。 */
export function writeMcpInstructions(
  name: string,
  cfg: McpServerConfig,
  projectPath: string | undefined,
  text: string,
): void {
  const value = text.trim().slice(0, MAX_INSTRUCTIONS_CHARS);
  if (!value) return;
  const store = readStore();
  const key = storeKey(name, cfg, projectPath);
  if (store.entries[key] === value) return;
  const prefix = `${projectPath ?? ""}\u0000${name}\u0000`;
  for (const existing of Object.keys(store.entries)) {
    if (existing !== key && existing.startsWith(prefix)) delete store.entries[existing];
  }
  store.entries[key] = value;
  atomicWrite(storePath(), JSON.stringify(store));
}
