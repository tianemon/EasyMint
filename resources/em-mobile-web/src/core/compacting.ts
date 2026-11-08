/**
 * 压缩态（输入卡片蒙版）的生命周期 + 超时兜底。
 *
 * 为什么需要单独一份状态：桌面端这条链路踩过「蒙版卡死不消失」，最后靠 4 层防御兜住
 * （CHANGELOG v0.9.3、ChatPanel.tsx:2053-2067 的 120s 安全网）。手机端只有一条通道，
 * 但风险一样——`agent:context-summarizing` 的 `done` 在 SDK 挂起/PC 重启时不会到达，
 * 那之后输入卡片会一直蒙着，用户以为应用卡死。
 *
 * 因此这里除了记「谁在压缩」，还挂一个 120s 定时器（与桌面端同值）。定时器的回调
 * **只在会话仍是活跃压缩时**才执行：期间被正常结束或快照重置掉，就什么都不做，
 * 避免超时后补一张「压缩状态异常」的假卡片。
 */

const TIMEOUT_MS = 120_000;

const active = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(sessionId: string): void {
  const timer = timers.get(sessionId);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(sessionId);
  }
}

/** 该会话是否正在压缩（供快照等外部路径判断，不必读 runtime） */
export function isCompacting(sessionId: string): boolean {
  return active.has(sessionId);
}

/**
 * 标记压缩开始并挂超时兜底。`onTimeout` 在超时且**仍处于压缩态**时调用，
 * 由调用方负责把 UI 恢复（清蒙版、落一条提示）。
 */
export function beginCompacting(sessionId: string, onTimeout: () => void, timeoutMs: number = TIMEOUT_MS): void {
  clearTimer(sessionId);
  active.add(sessionId);
  timers.set(sessionId, setTimeout(() => {
    timers.delete(sessionId);
    // 期间已被 endCompacting 收起（正常结束 / 快照重置）→ 这条兜底不该再吭声
    if (!active.has(sessionId)) return;
    active.delete(sessionId);
    onTimeout();
  }, timeoutMs));
}

/** 压缩结束（正常 done / 快照重置 / 卸载）：撤掉标记与定时器 */
export function endCompacting(sessionId: string): void {
  active.delete(sessionId);
  clearTimer(sessionId);
}

/** 卸载时统一清理，别让定时器在组件消失后还回调 */
export function clearAllCompacting(): void {
  active.clear();
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}
