/**
 * Session Cache — per-session UI state persisted to disk.
 *
 * Stores non-conversation UI state (permission mode, model, context usage, etc.)
 * keyed by SDK sessionId. Survives app restarts and tab switches.
 *
 * Path: ~/.easymint/session-cache/<sessionId>.json
 */

import { readFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { emHome } from "../utils/paths";
import { atomicWrite } from "./native-config-storage";
import { getSessionManagerClass } from "./pi-sdk";

const CACHE_DIR = path.join(emHome(), "session-cache");

export interface SessionCache {
  permissionMode: string;
  model?: string;
  /** 会话绑定的供应商 piId(需求 5:不同会话不同供应商) */
  provider?: string;
  /** 本会话用户选过的思考等级——持久化后重开会话不再被全局设置覆盖 */
  thinkingLevel?: string;
  contextUsage: number | null;
  updatedAt: number;
}

function cachePath(sessionId: string): string {
  if (!/^[A-Za-z0-9_.-]{1,256}$/.test(sessionId) || sessionId === "." || sessionId === "..") throw new Error("Invalid session cache identity");
  return path.join(CACHE_DIR, `${sessionId}.json`);
}

function ensureDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function readCache(sessionId: string): SessionCache | null {
  const p = cachePath(sessionId);
  if (!existsSync(p)) return null;
  const text = readFileSync(p, "utf-8");
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // UI cache is recoverable; malformed contents must not break conversation startup
    // or expose arbitrary cached text in an error message.
    console.warn(`[session-cache] Invalid JSON; ignoring UI cache: ${p}`);
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    console.warn(`[session-cache] Invalid cache object: ${p}`);
    return null;
  }
  return value as SessionCache;
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
  atomicWrite(cachePath(sessionId), JSON.stringify(merged, null, 2));
}

export function deleteCache(sessionId: string): void {
  const p = cachePath(sessionId);
  if (existsSync(p)) unlinkSync(p);
}

/** Purge cache files for sessions that no longer exist in the given list of valid IDs.
 *  skipTemp=true 时跳过 `__new_` 前缀——临时 key 的生命周期由 cleanupTempCaches 的
 *  24h 阈值接管,此处不抢(新会话首条消息回绑真实 sid 前重启,待生效的 UI 状态才不会被清)。 */
function cacheFingerprint(file: string): string | null {
  const stat = lstatSync(file, { bigint: true });
  if (!stat.isFile()) return null;
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
}

export function purgeOrphanedCaches(validSessionIds: Set<string>, skipTemp = false, snapshot?: ReadonlyMap<string, string>): number {
  ensureDir();
  let removed = 0;
  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.endsWith(".json")) continue;
    if (skipTemp && file.startsWith("__new_")) continue;
    const sid = file.slice(0, -5);
    if (!validSessionIds.has(sid)) {
      if (snapshot) {
        const original = snapshot.get(file);
        if (!original || cacheFingerprint(path.join(CACHE_DIR, file)) !== original) continue;
      }
      unlinkSync(path.join(CACHE_DIR, file));
      removed++;
    }
  }
  return removed;
}

/**
 * 清理孤儿会话缓存：经 SDK 收集 agent/sessions 下真实会话 header id，
 * 缓存 key 不在集合中的 = 会话已被删除/项目已移除
 * （会话列表不再列出、缓存永远不会被读取）→ 删除。启动时调用，防磁盘堆积。
 * `__new_` 前缀的临时 key 跳过——归 cleanupTempCaches 的 24h 阈值处理,避免误伤
 * 新建会话回绑真实 sid 前重启时待生效的权限/模型选择。
 * 返回删除的文件数。
 */
export async function cleanupOrphanCaches(): Promise<number> {
  if (!existsSync(CACHE_DIR)) return 0; // First startup has no maintenance work.
  // Only pre-existing, unchanged files can be removed after asynchronous discovery.
  // Date.now and filesystem mtime are not a reliable shared clock/precision boundary.
  const snapshot = new Map<string, string>();
  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.endsWith(".json") || file.startsWith("__new_")) continue;
    const fingerprint = cacheFingerprint(path.join(CACHE_DIR, file));
    if (fingerprint) snapshot.set(file, fingerprint);
  }
  const sessionsRoot = path.join(emHome(), "agent", "sessions");
  const valid = new Set<string>();
  let complete = true;
  const directories: Array<{ dir: string; files: number }> = [];
  const walk = (d: string): void => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); }
    catch (error) {
      complete = false;
      console.warn(`[session-cache] Session scan incomplete; retaining caches (${(error as NodeJS.ErrnoException).code ?? "unknown"}): ${d}`);
      return;
    }
    let files = 0;
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) files++;
    }
    if (files) directories.push({ dir: d, files });
  };
  walk(sessionsRoot);
  if (!complete) return 0;
  // The SDK identifies sessions from headers, including imported/custom IDs and
  // renamed transcript files. Filename guesses cannot prove a cache is orphaned.
  if (directories.length) {
    const SM = await getSessionManagerClass();
    for (const directory of directories) {
      const sessions = await SM.listAll(directory.dir);
      if (sessions.length !== directory.files) {
        console.warn(`[session-cache] Session metadata scan incomplete; retaining caches: ${directory.dir}`);
        return 0;
      }
      for (const session of sessions) valid.add(session.id);
    }
  }
  return purgeOrphanedCaches(valid, true, snapshot);
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
