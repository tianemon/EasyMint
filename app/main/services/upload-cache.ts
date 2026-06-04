/**
 * Upload cache service — track, scan, cleanup uploaded files.
 *
 * Files stored in ~/.easymint/uploads/, metadata in .meta.json.
 * Auto-cleanup runs at startup: 60-day age or 10GB cap.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Types ──────────────────────────────────────────

export interface FileMeta {
  size: number;
  created: number;
  refs: string[]; // session IDs
}

export interface UploadStatsItem {
  name: string;
  size: number;
  created: number;
  isImage: boolean;
}

export interface UploadStats {
  totalSize: number;
  fileCount: number;
  files: UploadStatsItem[];
}

// ── Paths ──────────────────────────────────────────

const UPLOAD_DIR = path.join(os.homedir(), ".easymint", "uploads");
const META_FILE = path.join(UPLOAD_DIR, ".meta.json");

function ensureDir(): void {
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── Metadata ───────────────────────────────────────

function readMeta(): Record<string, FileMeta> {
  try {
    if (!existsSync(META_FILE)) return {};
    return JSON.parse(readFileSync(META_FILE, "utf-8"));
  } catch { return {}; }
}

function writeMeta(meta: Record<string, FileMeta>): void {
  ensureDir();
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

/** Register an uploaded file in metadata (called by saveUpload) */
export function trackUpload(filename: string, size: number, sessionId?: string): void {
  const meta = readMeta();
  const existing = meta[filename];
  meta[filename] = {
    size,
    created: existing?.created || Date.now(),
    refs: existing?.refs || [],
  };
  if (sessionId && !meta[filename]!.refs.includes(sessionId)) {
    meta[filename]!.refs.push(sessionId);
  }
  writeMeta(meta);
}

/** Remove session reference; delete file if no refs remain */
export function untrackSession(sessionId: string): void {
  const meta = readMeta();
  const toDelete: string[] = [];
  for (const [name, m] of Object.entries(meta)) {
    m.refs = m.refs.filter((r) => r !== sessionId);
    if (m.refs.length === 0) toDelete.push(name);
  }
  for (const name of toDelete) {
    delete meta[name];
    try { unlinkSync(path.join(UPLOAD_DIR, name)); } catch { /* already gone */ }
  }
  writeMeta(meta);
}

// ── Scan ───────────────────────────────────────────

/** Scan uploads with sorting */
export function getUploadStats(sortBy: "time" | "size" = "time"): UploadStats {
  ensureDir();
  const meta = readMeta();
  const files: UploadStatsItem[] = [];
  let totalSize = 0;

  try {
    for (const entry of readdirSync(UPLOAD_DIR)) {
      if (entry === ".meta.json") continue;
      const filePath = path.join(UPLOAD_DIR, entry);
      if (!statSync(filePath).isFile()) continue;
      const m = meta[entry];
      const stats = statSync(filePath);
      const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(entry);
      files.push({
        name: entry,
        size: m?.size || stats.size,
        created: m?.created || stats.mtimeMs,
        isImage,
      });
      totalSize += m?.size || stats.size;
    }
  } catch { /* empty */ }

  files.sort((a, b) => sortBy === "size" ? b.size - a.size : b.created - a.created);
  return { totalSize, fileCount: files.length, files };
}

// ── Cleanup ────────────────────────────────────────

/** Delete specified files */
export function cleanFiles(filenames: string[]): number {
  let deleted = 0;
  const meta = readMeta();
  for (const name of filenames) {
    try { unlinkSync(path.join(UPLOAD_DIR, name)); deleted++; } catch { /* */ }
    delete meta[name];
  }
  writeMeta(meta);
  return deleted;
}

/** Delete all uploads */
export function cleanAll(): number {
  const meta = readMeta();
  let deleted = 0;
  for (const name of Object.keys(meta)) {
    try { unlinkSync(path.join(UPLOAD_DIR, name)); deleted++; } catch { /* */ }
  }
  writeMeta({});
  return deleted;
}

/** Delete files older than `maxAgeDays` days, or reduce total to `maxSizeBytes` */
export function autoClean(maxAgeDays = 60, maxSizeBytes = 10 * 1024 * 1024 * 1024): number {
  const stats = getUploadStats("time");
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const toDelete = new Set<string>();
  let totalAfter = stats.totalSize;

  for (const f of stats.files) {
    if (f.created < cutoff) { toDelete.add(f.name); totalAfter -= f.size; }
  }

  // If still over max, delete oldest first until under 80% of max
  if (totalAfter > maxSizeBytes) {
    for (const f of stats.files) {
      if (toDelete.has(f.name)) continue;
      toDelete.add(f.name);
      totalAfter -= f.size;
      if (totalAfter < maxSizeBytes * 0.8) break;
    }
  }

  if (toDelete.size > 0) cleanFiles([...toDelete]);
  return toDelete.size;
}
