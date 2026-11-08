/**
 * `agent:remote-settings-changed` 的 revision 定序。
 *
 * revision **不是逻辑计数器**，而是 PC 侧 `app/main/services/session-cache.ts:67` 写缓存时的
 * `Date.now()`（广播点 `app/main/services/remote-command-router.ts:195/213/232`）。因此：
 *  - 略旧的值只可能是同一时间窗内的乱序重放，丢弃即可；
 *  - 大幅回退（系统时钟回拨、缓存重建后的新纪元）不是乱序，必须放行并重置游标，
 *    否则该会话之后的**所有**设置事件都会被永久丢弃（模型/权限显示一直停在旧值）。
 *
 * 桌面端渲染层不消费这个通道，也没有定序门（`app/renderer/src` 全仓 0 处命中），
 * 手机端这道门是 best-effort：只拦近距重放，不假设两端时钟绝对单调。
 */
export const SETTINGS_REPLAY_WINDOW_MS = 5 * 60_000;

/** 返回是否该丢弃这一帧，以及应用后该会话的新游标。 */
export function resolveSettingsRevision(
  cursor: number | undefined, revision: number,
): { stale: boolean; cursor: number } {
  // 无 revision（老版本桌面端、或 readCache() 返回 null 时广播的是 undefined）→ 不定序，按到达顺序应用
  if (!Number.isSafeInteger(revision)) return { stale: false, cursor: cursor ?? -1 };
  if (cursor === undefined) return { stale: false, cursor: revision };
  if (revision < cursor && cursor - revision <= SETTINGS_REPLAY_WINDOW_MS) return { stale: true, cursor };
  return { stale: false, cursor: revision };
}
