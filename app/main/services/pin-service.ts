/**
 * Pin Service — 内容便签持久化
 *
 * 存储：~/.easymint/session-pins.json → Record<sessionId, Pin[]>
 * 便签数量少（个位数），每次变更全量覆盖写；空数组时删除该会话 key。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA_DIR = path.join(os.homedir(), ".easymint");
const PINS_PATH = path.join(DATA_DIR, "session-pins.json");

export interface Pin {
  id: string;
  content: string;
  title: string;
  x: number; // -1 = 未定位（渲染层分配默认位置）
  y: number;
  width?: number;  // 缺省 320
  height?: number; // 缺省 auto（内容撑开）
  createdAt: number;
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (existsSync(filePath)) return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch { /* 用户手改 JSON 导致解析失败 → 回退默认值 */ }
  return fallback;
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir();
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function getPins(sessionId: string): Pin[] {
  const all = readJson<Record<string, Pin[]>>(PINS_PATH, {});
  return all[sessionId] || [];
}

export function setPins(sessionId: string, pins: Pin[]): void {
  const all = readJson<Record<string, Pin[]>>(PINS_PATH, {});
  if (pins.length === 0) delete all[sessionId];
  else all[sessionId] = pins;
  writeJson(PINS_PATH, all);
}
