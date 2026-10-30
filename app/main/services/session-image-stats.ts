/**
 * 会话的图片占用统计 —— **只读磁盘，绝不激活会话**。
 *
 * 拆出来的原因是一次真实事故：这段逻辑原本写在 `agent-service.getContextImageStats` 里，
 * 未激活时会先调 `activateSession`。而打开会话的前端 effect 就会问这个统计，于是
 * 「看一眼会话」= resume 整份 jsonl（本仓库有 51MB 的）→ 状态点变绿 → 关掉 tab 后
 * 还要等 2 分钟才回收。纯读接口里出现写操作，就是这个形状。
 *
 * 把解析与缓存放在这里，让读路径物理上够不到 `activateSession`。活跃会话的内存分支
 * 仍留在 agent-service（它需要 session 对象）。
 */

import fs from "node:fs";
import path from "node:path";
import { contextImageEntries, type ContextImageEntry } from "../../shared/image-context";
import { resolveHome } from "../utils/paths";
import { getPiSessionDir } from "./pi-session-dir";
import { listPiSessions } from "./pi-session";
import { getSessionManagerClass } from "./pi-sdk";

export interface SessionImageStats {
  candidates: ContextImageEntry[];
  encodedBytes: number;
}

interface CacheEntry {
  mtimeMs: number;
  value: SessionImageStats;
}

/** 按会话文件路径缓存；键相同且 mtime 未变时直接复用上次解析结果。 */
export type SessionImageStatsCache = Map<string, CacheEntry>;

/**
 * 读会话文件算出仍在上下文里的图片占用。
 *
 * 缓存的意义：打开一个会话时该统计会被问多次（消息追加前反复触发），而同一份 jsonl
 * 的解析结果是稳定的 —— 以 mtime 失效，写盘后自动重算。
 *
 * 找不到会话或解析失败时返回 `undefined`，由调用方决定如何降级（不抛）。
 */
export async function readSessionImageStats(
  projectPath: string,
  sessionId: string,
  cache?: SessionImageStatsCache,
): Promise<SessionImageStats | undefined> {
  const resolved = path.resolve(resolveHome(projectPath));
  const sessions = await listPiSessions(resolved);
  const info = sessions.find((s) => s.id === sessionId);
  if (!info) return undefined;

  const mtimeMs = fs.statSync(info.path).mtimeMs;
  const cached = cache?.get(info.path);
  if (cached && cached.mtimeMs === mtimeMs) return cached.value;

  const SM = await getSessionManagerClass();
  const manager = SM.open(info.path, getPiSessionDir(resolved), resolved);
  const candidates = contextImageEntries(manager.buildSessionProjection().entries);
  const value: SessionImageStats = {
    candidates,
    encodedBytes: candidates.reduce((total, entry) => total + entry.encodedBytes, 0),
  };
  cache?.set(info.path, { mtimeMs, value });
  return value;
}
