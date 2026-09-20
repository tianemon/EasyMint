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
 * `resolvePath(cwd)` 后 EM 不会跟随（静默漂移）。详见 docs/design/会话目录对齐 pi 方案.md。
 */

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
 * 为什么要门：首次 dynamic import SDK 实测约 7 秒（包体大），**不能在 createWindow 前 await**，
 * 否则窗口出现会被推迟同样久；但迁移又必须早于会话读写。于是启动期把它当后台任务跑、
 * 同时注册成门，所有异步会话入口（create/resume/list）先 await 门。
 * 注意：同步调用点（ProjectService.update / cleanupProjectSessions / restoreSession）不经此门，
 * 在启动后数秒的窗口内可能读到迁移前的状态（后果轻：会话目录残留/空壳，非数据丢失）。
 */
export function armSessionDirReady(gate: Promise<void>): void {
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
