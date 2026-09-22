/**
 * 一次性迁移：EM 旧编码的会话目录 → Pi 默认编码目录。
 *
 * ⚠️【待移除的一次性代码】迁移跑够之后应**整体删除**，不要长期留存（清理清单如下，缺一处就是残留）：
 *   1. 本文件与其测试 `session-dir-migration.test.ts`
 *   2. `app/main/index.ts` 里的 `armSessionDirReady(...)` 调用块 + `migrateLegacySessionDirs` 的 import
 *   3. `pi-session-dir.ts` 的 `armSessionDirReady` / `_readyGate`，以及 `ensureSessionManagerClass`
 *      里的等门那一句（就绪门只服务本次迁移）＋ `pi-session-dir.test.ts` 的守门用例
 *   移除时机：EM 无遥测，保守取「从含本迁移的版本起发布 2~3 个 minor 版本」——
 *   届时升级上来的活跃安装都已启动过一次（迁移幂等、启动即跑完）。
 *   移除后常规逻辑不受影响：`getPiSessionDir()` 照常向 SDK 取路径，只是不再有"等门"与旧目录迁移。
 *
 * 背景：EM 早期自定编码 `cwd.replace(/[:/\\]/g, "-")`（形如 `-Users-amon-x`），
 * 与原生 pi 的 `--<cwd 去首分隔符、把 / \ : 换成 ->--` 不同。对齐后旧目录里的会话
 * 在新编码目录下不可见，故启动时改名。
 *
 * 设计要点：
 * - **以会话文件首行的 cwd 为唯一真相源**：旧编码把 `/` 与 `-` 混同，是有损变换，
 *   无法从目录名安全反推真实路径（Windows 盘符形态的换算规则还与类 Unix 不同）。
 * - **幂等**：已是 `--…--` 形态的目录直接跳过，可重复执行。
 * - **best-effort**：单个目录失败只记日志、数据保持原样，不阻断启动（下次启动自动重试）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getPiSessionDir } from "./pi-session";

/** Pi 默认编码形态：前后各两个横线（EM 旧编码只会有一个前导横线，Windows 形态则无前导横线） */
const PI_ENCODED_DIR_RE = /^--.+--$/;

export interface SessionDirMigrationResult {
  /** 整目录改名成功数 */
  renamed: number;
  /** 目标已存在 → 逐文件并入成功数 */
  merged: number;
  /** 无需处理（已是新形态 / 无会话文件可判定 cwd） */
  skipped: number;
  /** 处理失败（保持原样，下次启动重试） */
  failed: number;
}

/** 深度优先找目录内任一会话文件；先文件后子目录，各自排序以保证多次执行取到同一个 */
function findFirstSessionFile(dir: string): string | undefined {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const files: string[] = [];
  const subDirs: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) subDirs.push(path.join(dir, entry.name));
    else if (entry.name.endsWith(".jsonl")) files.push(path.join(dir, entry.name));
  }

  files.sort();
  if (files.length > 0) return files[0];

  subDirs.sort();
  for (const sub of subDirs) {
    const found = findFirstSessionFile(sub);
    if (found) return found;
  }
  return undefined;
}

/** 读会话文件首行的 cwd（会话头，见 Pi 的 session-format 文档） */
function readSessionCwd(file: string): string | undefined {
  try {
    const firstLine = fs.readFileSync(file, "utf-8").split("\n", 1)[0];
    if (!firstLine?.trim()) return undefined;
    const header = JSON.parse(firstLine) as { cwd?: unknown };
    return typeof header.cwd === "string" && header.cwd ? header.cwd : undefined;
  } catch {
    return undefined;
  }
}

/** 把源目录内容并入目标目录：同名已存在则保留目标那份（不覆盖既有数据） */
function mergeIntoDirectory(from: string, to: string): number {
  fs.mkdirSync(to, { recursive: true });
  let moved = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      moved += mergeIntoDirectory(src, dst);
    } else if (!fs.existsSync(dst)) {
      fs.renameSync(src, dst);
      moved++;
    }
  }
  return moved;
}

/**
 * 遍历 `sessionsBase` 下的项目目录，把旧编码目录迁到 Pi 默认编码目录。
 *
 * `resolveSessionDir` 默认取 `getPiSessionDir`（SDK 规则，需启动期已预热）；测试可注入替身，
 * 避免单测依赖真实 SDK 与真实家目录（见 CLAUDE.md 测试纪律：平台/文件系统判定须参数注入）。
 */
export function migrateLegacySessionDirs(
  sessionsBase: string,
  resolveSessionDir: (cwd: string) => string = getPiSessionDir,
): SessionDirMigrationResult {
  const result: SessionDirMigrationResult = { renamed: 0, merged: 0, skipped: 0, failed: 0 };
  if (!fs.existsSync(sessionsBase)) return result;

  for (const entry of fs.readdirSync(sessionsBase, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const oldDir = path.join(sessionsBase, entry.name);
    if (PI_ENCODED_DIR_RE.test(entry.name)) {
      result.skipped++;
      continue;
    }

    const sample = findFirstSessionFile(oldDir);
    const cwd = sample ? readSessionCwd(sample) : undefined;
    if (!cwd) {
      // 空目录 / 首行无 cwd：无数据可迁，且旧编码有损不能猜路径 → 保持原样
      result.skipped++;
      continue;
    }

    const newDir = resolveSessionDir(cwd);
    if (path.resolve(newDir) === path.resolve(oldDir)) {
      result.skipped++;
      continue;
    }

    try {
      // 注意：resolveSessionDir（= getPiSessionDir）内部会 mkdir 目标目录（SDK 默认目录逻辑的副作用），
      // 因此「目标已存在」不能直接当判据——空目标视为刚被建出的空壳，清掉后整体改名（更快、更原子）。
      const targetExists = fs.existsSync(newDir);
      const targetIsEmpty = targetExists && fs.readdirSync(newDir).length === 0;
      if (!targetExists || targetIsEmpty) {
        if (targetIsEmpty) fs.rmdirSync(newDir);
        fs.renameSync(oldDir, newDir);
        result.renamed++;
      } else {
        // 目标在迁移前就有内容（罕见）：并入后删源。会话文件同名视为同一份，保留目标那份
        const moved = mergeIntoDirectory(oldDir, newDir);
        fs.rmSync(oldDir, { recursive: true, force: true });
        result.merged++;
        console.log(
          `[migrate] 会话目录并入 ${entry.name} → ${path.basename(newDir)}（移动 ${moved} 个文件）`,
        );
      }
    } catch (e) {
      result.failed++;
      console.warn(
        `[migrate] 会话目录迁移失败（保持原样，下次启动重试）: ${entry.name} —— ${(e as Error).message}`,
      );
    }
  }

  return result;
}
