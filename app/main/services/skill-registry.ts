/**
 * Skill Registry — skill 调用统计中心索引。
 *
 * ~/.easymint/skill-registry.json 只存派生数据（usageCount/lastUsedAt/failCount），
 * 非真相源：损坏即删、可随时重建（skill 列表以磁盘扫描为准，统计从零重计）。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface SkillStat {
  usageCount: number;
  lastUsedAt: number;
  failCount: number;
}

export type SkillRegistry = Record<string, SkillStat>;

const REGISTRY_FILE = path.join(os.homedir(), ".easymint", "skill-registry.json");

export function loadSkillRegistry(): SkillRegistry {
  if (!existsSync(REGISTRY_FILE)) return {};
  try {
    const data: unknown = JSON.parse(readFileSync(REGISTRY_FILE, "utf-8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bad shape");
    const reg: SkillRegistry = {};
    for (const [name, v] of Object.entries(data as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const s = v as Partial<SkillStat>;
      reg[name] = {
        usageCount: Number(s.usageCount) || 0,
        lastUsedAt: Number(s.lastUsedAt) || 0,
        failCount: Number(s.failCount) || 0,
      };
    }
    return reg;
  } catch {
    // 损坏即删，可重建
    try {
      unlinkSync(REGISTRY_FILE);
    } catch {
      // 删除失败不阻塞——下次写入会整体覆盖
    }
    return {};
  }
}

function saveSkillRegistry(reg: SkillRegistry): void {
  const dir = path.dirname(REGISTRY_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2));
}

/** use_skill 每次调用（成功/失败）打卡；读改写全同步，单线程下无竞态 */
export function touchSkillStat(name: string, ok: boolean): void {
  const reg = loadSkillRegistry();
  const cur = reg[name] ?? { usageCount: 0, lastUsedAt: 0, failCount: 0 };
  cur.usageCount += 1;
  cur.lastUsedAt = Date.now();
  if (!ok) cur.failCount += 1;
  reg[name] = cur;
  saveSkillRegistry(reg);
}

export function getSkillStats(): SkillRegistry {
  return loadSkillRegistry();
}
