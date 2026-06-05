/**
 * Session Cache — per-session UI state persisted to disk.
 *
 * Stores non-conversation UI state (permission mode, model, context usage, etc.)
 * keyed by SDK sessionId. Survives app restarts and tab switches.
 *
 * Path: ~/.easymint/session-cache/<sessionId>.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const CACHE_DIR = path.join(os.homedir(), ".easymint", "session-cache");

export interface SessionCache {
  permissionMode: string;
  model?: string;
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
  try {
    const p = cachePath(sessionId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as SessionCache;
  } catch {
    return null;
  }
}

export function writeCache(sessionId: string, data: Partial<SessionCache>): void {
  ensureDir();
  const existing = readCache(sessionId);
  const merged: SessionCache = {
    permissionMode: "auto",
    contextUsage: 0,
    updatedAt: Date.now(),
    ...existing,
    ...data,
    updatedAt: Date.now(),
  };
  writeFileSync(cachePath(sessionId), JSON.stringify(merged, null, 2));
}

export function deleteCache(sessionId: string): void {
  try {
    const p = cachePath(sessionId);
    if (existsSync(p)) unlinkSync(p);
  } catch { /* ignore */ }
}

/** Purge cache files for sessions that no longer exist in the given list of valid IDs. */
export function purgeOrphanedCaches(validSessionIds: Set<string>): void {
  ensureDir();
  try {
    for (const file of readdirSync(CACHE_DIR)) {
      if (!file.endsWith(".json")) continue;
      const sid = file.replace(".json", "");
      if (!validSessionIds.has(sid)) {
        unlinkSync(path.join(CACHE_DIR, file));
      }
    }
  } catch { /* ignore */ }
}
