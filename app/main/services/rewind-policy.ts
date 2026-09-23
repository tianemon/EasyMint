/**
 * 撤回策略的纯函数（不引 electron / SDK，便于单测）。
 *
 * 为什么单独一个文件：这里的判定依赖 SDK 的英文错误**原文**（substring 匹配——SDK 没有稳定错误码）。
 * 一旦 SDK 改文案，匹配会静默失效、回退分支永不触发，而症状正是「撤回偶尔就是不生效」这种最难查的形态；
 * 把裸字符串集中在此并配单测，升级 SDK 后能立刻发现。
 */

/** `agent-session.navigateTree` 开头两段运行态拒绝：
 *  isStreaming → "...Wait for the current response to finish before navigating the session tree."
 *  isCompacting → "...Wait for the current compaction or tree navigation to finish before navigating the session tree." */
const SDK_BUSY_REFUSALS = [
  "current response to finish",
  "compaction or tree navigation to finish",
] as const;

/** 该错误是否为「SDK 自认为忙」的拒绝（区别于目标不存在、无模型可用等其它错误）。 */
export function isSdkBusyRefusal(message: string): boolean {
  return SDK_BUSY_REFUSALS.some((s) => message.includes(s));
}

/** SDK 判定忙、本进程却判定空闲 = SDK 运行态标志残留（未复位）。
 *  只有这种**矛盾**才允许回退到手工落点：真在跑时不回退，避免与运行中的回合抢 leaf。 */
export function isStaleSdkBusyRefusal(
  message: string,
  emBusy: { running: boolean; compacting: boolean },
): boolean {
  return isSdkBusyRefusal(message) && !emBusy.running && !emBusy.compacting;
}

/** 已撤回的 user 气泡仅在当前落点紧贴它原父节点时可重发。
 *  允许 leaf=父节点，或 leaf 是挂在父节点后的撤回 pin；祖先仍在分支上不足以放行，
 *  否则另一个窗口已经续写的新内容会被旧气泡的操作静默截断。 */
export function canRewindDetachedUser(
  parentId: string | null,
  leafId: string | null,
  leafPin?: { parentId: string | null },
): boolean {
  return parentId === leafId || (leafPin !== undefined && leafPin.parentId === parentId);
}
