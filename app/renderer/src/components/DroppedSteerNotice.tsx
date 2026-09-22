/**
 * 打断丢弃插话的提示——输入卡片上沿（复用 TodoStrip 的位置与规格，不新增样式）。
 *
 * 为什么必须有这条提示：打断（`abort({clearQueue:true})`）会把**尚未投递**的插话丢掉，而那条插话的气泡
 * 还乐观留在界面上——不提示的话用户会以为它还排在队里、模型迟早会读到（实际永远不会）。
 * 注意这跟「排队中还有几条」是两件事：气泡在不在界面上只说明用户发过，不说明有没有投递进去。
 *
 * 数据源：主进程 abort() 拿到 SDK clearQueue 的返回后广播 `queue_dropped`（经 agent:stream），
 * 由 ChatPanel 按会话过滤后传入；10s 自动消失（见 ChatPanel 的 DROPPED_NOTICE_MS）。
 */
import { memo } from "react";
import { steerQueueSummary } from "./chat-utils";

const BADGE = "text-[length:var(--text-2xs)] px-1.5 py-px rounded-full leading-tight shrink-0";

export const DroppedSteerNotice = memo(function DroppedSteerNotice({ dropped }: {
  /** 被丢弃的插话原文（null = 无提示） */
  dropped: string[] | null;
}): JSX.Element | null {
  if (!dropped) return null;
  const summary = steerQueueSummary(dropped);
  if (summary.count === 0) return null;
  return (
    <div className="shrink-0 px-[var(--s16)] pt-2">
      <div className="flex items-center gap-2 rounded-[var(--radius-lg)] bg-surface-alt/60 border border-border/60 px-2.5 py-1.5">
        <span className={`${BADGE} bg-warning-soft text-warning`}>已丢弃 {summary.count} 条</span>
        <span className="flex-1 min-w-0 truncate text-xs text-text-secondary">{summary.text}</span>
      </div>
    </div>
  );
});
