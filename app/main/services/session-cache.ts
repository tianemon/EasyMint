/**
 * Session Cache — per-session UI state persisted to disk.
 *
 * Stores non-conversation UI state (permission mode, model, context usage, etc.)
 * keyed by SDK sessionId. Survives app restarts and tab switches.
 *
 * Path: ~/.easymint/session-cache/<sessionId>.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const CACHE_DIR = path.join(os.homedir(), ".easymint", "session-cache");

export interface SessionCache {
  permissionMode: string;
  model?: string;
  /** 会话绑定的供应商 piId(需求 5:不同会话不同供应商) */
  provider?: string;
  /** 本会话用户选过的思考等级——持久化后重开会话不再被全局设置覆盖 */
  thinkingLevel?: string;
  contextUsage: number;
  updatedAt: number;
}

function cachePath(sessionId: string): string {
  return path.join(CACHE_DIR, `${sessionId}.json`);
}

function ensureDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function readCache(sessionId: string): SessionCache | null {
  const p = cachePath(sessionId);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as SessionCache;
}

export function writeCache(sessionId: string, data: Partial<SessionCache>): void {
  ensureDir();
  const existing = readCache(sessionId);
  const merged: SessionCache = {
    permissionMode: "standard",
    contextUsage: 0,
    ...existing,
    ...data,
    updatedAt: Date.now(),
  };
  writeFileSync(cachePath(sessionId), JSON.stringify(merged, null, 2));
}

export function deleteCache(sessionId: string): void {
  const p = cachePath(sessionId);
  if (existsSync(p)) unlinkSync(p);
}

/** Purge cache files for sessions that no longer exist in the given list of valid IDs.
 *  skipTemp=true 时跳过 `__new_` 前缀——临时 key 的生命周期由 cleanupTempCaches 的
 *  24h 阈值接管,此处不抢(新会话首条消息回绑真实 sid 前重启,待生效的 UI 状态才不会被清)。 */
export function purgeOrphanedCaches(validSessionIds: Set<string>, skipTemp = false): void {
  ensureDir();
  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.endsWith(".json")) continue;
    if (skipTemp && file.startsWith("__new_")) continue;
    const sid = file.replace(".json", "");
    if (!validSessionIds.has(sid)) {
      unlinkSync(path.join(CACHE_DIR, file));
    }
  }
}

/**
 * 清理孤儿会话缓存：收集 agent/sessions 下所有真实会话 id（jsonl 文件名
 * `<时间戳>_<sid>.jsonl` 的 sid 段），缓存 key 不在集合中的 = 会话已被删除/项目已移除
 * （会话列表不再列出、缓存永远不会被读取）→ 删除。启动时调用，防磁盘堆积。
 * `__new_` 前缀的临时 key 跳过——归 cleanupTempCaches 的 24h 阈值处理,避免误伤
 * 新建会话回绑真实 sid 前重启时待生效的权限/模型选择。
 * 返回删除的文件数。
 */
export function cleanupOrphanCaches(): number {
  const sessionsRoot = path.join(os.homedir(), ".easymint", "agent", "sessions");
  const valid = new Set<string>();
  const walk = (d: string): void => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) {
        const m = e.name.match(/_([0-9a-f-]{36})\.jsonl$/);
        if (m) valid.add(m[1]!);
      }
    }
  };
  walk(sessionsRoot);
  if (!existsSync(CACHE_DIR)) return 0; // 无任何缓存可清理(首次启动),不建空目录
  // 计数与清理口径一致：只统计非临时 key
  const countPersistent = (): number =>
    readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("__new_")).length;
  const before = countPersistent();
  purgeOrphanedCaches(valid, true);
  return before - countPersistent();
}

/**
 * 清理临时会话缓存（__new_ 前缀）。历史版本代码会在新会话首条消息前把 UI 状态
 * （权限模式/模型/思考等级）写入临时 key，真实会话创建后这些文件永远不会再被读取
 * （读取方要么按真实 sid、要么经临时→真实映射解析）。兜底清理：仅删除 mtime 超过
 * maxAgeMs 的文件——临时 key 正常生命周期只有几秒（发送首条消息到回绑），24h 阈值
 * 绝不误伤正在发送中的瞬时文件，只清历史残留，防止磁盘堆积。
 * 返回删除的文件数。
 */
export function cleanupTempCaches(maxAgeMs = 24 * 60 * 60 * 1000): number {
  if (!existsSync(CACHE_DIR)) return 0;
  let removed = 0;
  const now = Date.now();
  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.startsWith("__new_") || !file.endsWith(".json")) continue;
    const p = path.join(CACHE_DIR, file);
    try {
      if (now - statSync(p).mtimeMs > maxAgeMs) {
        unlinkSync(p);
        removed++;
      }
    } catch { /* 文件已被删/权限异常 → 跳过 */ }
  }
  return removed;
}
