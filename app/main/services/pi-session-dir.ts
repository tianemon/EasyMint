/**
 * 会话目录（Pi 默认布局）—— 路径一律向 SDK 索取，EM 不复制编码规则。
 *
 * 为什么要独立成模块：
 * - 目录路径与「会话构建」是两件事（前者被项目删除/迁移/清理等 6 个文件引用）；
 * - pi-session.ts 的依赖面很大（store / skill-service / 增强工具 / 权限），
 *   单测无法轻量引用；这里只依赖 pi-sdk 的懒加载 wrapper，可直接单测。
 *
 * 背景（为什么不再自己算路径）：EM 早期自实现 `cwd.replace(/[:/\\]/g, "-")`，与 Pi 的
 * `--<cwd 去首分隔符、把 / \ : 换成 ->--` 并不一致，且 Pi 把编码输入从 cwd 改成
 * `resolvePath(cwd)` 后 EM 不会跟随（静默漂移）。故一律向 SDK 取路径，不自己算。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionManager } from "./pi-sdk";
import { getSessionManagerClass } from "./pi-sdk";

/**
 * SessionManager 类缓存。
 *
 * SDK 没有从包入口导出 `getDefaultSessionDir`，取会话目录只能经 `SessionManager` 实例的
 * `getSessionDir()`；而类本身要 dynamic import（ESM-only）。若让 getPiSessionDir 自己 await，
 * 会把 6 个调用文件（含 3 处同步上下文：ProjectService.update / cleanupProjectSessions /
 * MigrationService.restoreSession）全部拖成异步，故改为「启动期预热 + 同步读取」。
 */
let _sessionManagerClass: typeof SessionManager | null = null;
let _priming: Promise<void> | null = null;
let _readyGate: Promise<void> | null = null;

/**
 * 注册「会话目录就绪门」：启动期把「预热 + 旧目录迁移」的 promise 交给本模块。
 *
 * ⚠️ 就绪门只服务「旧会话目录一次性迁移」这个需求（见 session-dir-migration.ts 顶部移除清单）——
 * 迁移代码移除时，本函数、`_readyGate` 与 `ensureSessionManagerClass` 里的等门那一句一并删除。
 *
 * 为什么要门：首次 dynamic import SDK 冷启实测 7~10 秒（包体大，几乎全是文件 IO），**不能在 createWindow 前 await**，
 * 否则窗口出现会被推迟同样久；但迁移又必须早于会话读写。于是启动期把它当后台任务跑、
 * 同时注册成门，所有异步会话入口（create/resume/list）先 await 门。
 * 注意：同步调用点（ProjectService.update / cleanupProjectSessions / restoreSession）不经此门，
 * 在启动后数秒的窗口内可能读到迁移前的状态（后果轻：会话目录残留/空壳，非数据丢失）。
 *
 * 传 `null` = **复位为「无门」**（门是模块级单例状态，测试用完必须复位，否则污染同文件后续用例；
 * 生产侧只有 index.ts 的启动接入会调用本函数、不会传 null）。
 */
export function armSessionDirReady(gate: Promise<void> | null): void {
  _readyGate = gate;
}

/**
 * 启动期预热 SessionManager 类（幂等，重复调用复用同一 promise）。
 *
 * 失败时**不缓存**那个 rejected promise：否则后续每次调用都拿到同一个失败结果，类永远停在未就绪，
 * 「会话列表 / 删除项目 / 会话迁移」等所有走 getPiSessionDir 的路径会一起失效且不会自愈。
 * （调用方请 await 它——直接 void 会漏掉 rejection。）
 */
export function primeSessionManagerClass(): Promise<void> {
  if (!_priming) {
    _priming = getSessionManagerClass()
      .then((SM) => {
        _sessionManagerClass = SM;
      })
      .catch((e: unknown) => {
        _priming = null; // 允许下次重试
        throw e;
      });
  }
  return _priming;
}

/**
 * 会话类操作入口先 await 它：先过就绪门（保证旧目录迁移已完成），再确保类可用。
 * 门内的失败已在注册侧消化（见 index.ts 的 catch），故此处不会因迁移失败而中断会话。
 */
export async function ensureSessionManagerClass(): Promise<typeof SessionManager> {
  if (_readyGate) await _readyGate;
  if (!_sessionManagerClass) await primeSessionManagerClass();
  return _sessionManagerClass!;
}

/**
 * 会话落盘目录 —— 与 Pi 默认完全一致（`<agentDir>/sessions/--<cwd>--`）。
 *
 * 路径由 SDK 计算：`SM.create(cwd)` 内部走 `getDefaultSessionDir`，再由 `getSessionDir()` 读回。
 * EM 只负责调用，不参与编码。
 *
 * 副作用：该调用会 mkdir 目标目录（SDK 默认目录逻辑自带）——「删除/清理」类调用方需对空目录
 * 做回退（见 project-service 删项目、session-service cleanupProjectSessions）。
 */
export function getPiSessionDir(cwd: string): string {
  if (!_sessionManagerClass) {
    throw new Error(
      "SessionManager 类未就绪：启动期需调用 primeSessionManagerClass()（见 app/main/index.ts）",
    );
  }
  return _sessionManagerClass.create(cwd).getSessionDir();
}

/**
 * **不抛错**的取目录：供「不能 await 就绪门」的同步调用点使用——删项目、改项目路径时的
 * 记录更新、会话清理、zip 打包回调等。
 *
 * 为什么需要它：预热是启动期的**后台任务**（首次 dynamic import SDK 冷启实测 7~10 秒），未完成时
 * `getPiSessionDir` 会抛「未就绪」。而这些调用点都在同步上下文里，一旦异常逃出去，整条
 * 「删除项目」「重命名项目」流程会连带失败——改动前 `getPiSessionDir` 是纯函数、不可能抛，
 * 这属于回归（2026-09-20 代码审查 P1）。是否要用抛错版本的判据：**能否 await**——
 * 能 await 的入口（create/resume/list、rename 等 async 流程）走 `ensureSessionManagerClass()`
 * 拿确定结果；不能 await 的用本函数，按「本次读不到会话目录」处置（跳过会话侧处理，主流程照走）。
 *
 * 未就绪时顺手补一次**后台预热**：预热若失败过一次，`_priming` 已被清空，这里让后续调用自愈
 * （否则同步调用点永远拿不到目录）。预热失败不影响本次返回。
 */
export function tryGetPiSessionDir(cwd: string): string | undefined {
  if (!_sessionManagerClass) {
    void primeSessionManagerClass().catch(() => {
      /* 预热失败：本次跳过会话侧处理，下次调用再试 */
    });
    return undefined;
  }
  try {
    return getPiSessionDir(cwd);
  } catch {
    // 类在但算路径失败（罕见）：当作读不到，不把会话目录问题升级成调用方的失败
    return undefined;
  }
}

/**
 * 目标目录是否只是「算路径时被 mkdir 出来的空壳」。
 *
 * ⚠️ 为什么必须有这个判据：`getPiSessionDir(cwd)` **会把该目录建出来**（SDK 的
 * `getDefaultSessionDir` 自带 mkdir）。于是「先算新路径、再判 `!existsSync(新路径)`」这类
 * 写法**恒为假** → 搬迁整段被跳过，且不报错。实测踩过（2026-09-20 审查）：改项目路径 /
 * 重命名项目时会话目录根本没搬，历史会话在新路径下不可见——正是 CHANGELOG 声称已修的那类现象。
 * 判据：目录不存在 → false（无需清理）；存在且为空 → true（空壳，可删后整体搬）。
 */
export function isEmptyDirShell(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}

/** 把目录内容并入目标（同名已存在则保留目标那份，不覆盖既有数据）；返回移动的文件数 */
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
 * 把 `fromCwd` 的会话目录**整体搬到** `toCwd`（项目改路径/改名时用）。
 *
 * 调用方不要自己写「算两个路径 + 判 existsSync」——那套写法会被 mkdir 副作用骗（见
 * isEmptyDirShell）。两端路径一律在本函数内部计算。
 * 语义：目标为空壳 → 删壳后整体 rename（快且原子）；目标已有内容（罕见）→ 逐文件并入后删源；
 * 源不存在或为空 → 无会话可搬，直接返回 noop。抛错由调用方决定如何处置。
 */
export function moveSessionDir(fromCwd: string, toCwd: string): "moved" | "merged" | "noop" {
  const from = getPiSessionDir(fromCwd);
  const to = getPiSessionDir(toCwd);
  if (path.resolve(from) === path.resolve(to)) return "noop";
  if (!fs.existsSync(from)) return "noop";
  // 源目录存在但为空：本次 getPiSessionDir(from) 可能刚把它建出来，删掉空壳避免留垃圾
  if (fs.readdirSync(from).length === 0) {
    try {
      fs.rmdirSync(from);
    } catch { /* 被占用则留着，无数据损失 */ }
    return "noop";
  }
  if (isEmptyDirShell(to)) {
    try {
      fs.rmdirSync(to);
    } catch {
      // 删不掉空壳（被占用）就退回并入：仍能保证会话到达新目录
      return mergeIntoDirectory(from, to) > 0 ? "merged" : "noop";
    }
  }
  if (!fs.existsSync(to)) {
    fs.renameSync(from, to);
    return "moved";
  }
  const moved = mergeIntoDirectory(from, to);
  fs.rmSync(from, { recursive: true, force: true });
  return moved > 0 ? "merged" : "noop";
}
