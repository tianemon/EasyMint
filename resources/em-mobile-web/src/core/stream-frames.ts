/**
 * 流式帧合并器：把同一 runId 的连续 `message` 帧压成「窗口内最后一帧」，窗口取下一帧边界（rAF）。
 *
 * 为什么可以丢中间帧：Pi 的 `message_update` 携带的是**累计全文快照**（桌面端 event-bridge 明确
 * 「不做增量逻辑」），后一帧完全覆盖前一帧，中间态不含任何最后一帧里没有的信息。所以合并丢掉的
 * 只会是「会被后续帧覆盖的中间态」，不丢内容。
 *
 * 不能进队列、必须立即应用的：`message_start`、`partial === false` 的结束帧、`turn_start` /
 * `turn_end` / `error`、`tool_*`、`custom_event`——它们不是同一条消息的中间态，或本身就是终态信号，
 * 被窗口吞掉会让状态卡住或内容缺失。调用方在应用这些事件前先 `flush()`。
 *
 * 顺序保证：`flush()` 会先把待应用的帧落地，调用方再处理当前事件——等价于「合并后仍按帧到达顺序
 * 应用」，不会出现旧快照盖掉新状态。
 *
 * 调度契约：`schedule` 必须在下一帧**异步**调用 flush（rAF / 定时器），不支持同步回调。
 *
 * 调度可靠性：`scheduleOnNextFrame` 同时挂 rAF 与定时器，谁先到谁 flush。**不能只靠 rAF**——
 * RN 的 rAF 由显示刷新信号驱动（iOS RCTTiming 走 CADisplayLink、Android JavaTimerManager 走
 * Choreographer 帧回调），UI 线程被重活占满时帧回调会被挤掉，而定时器走原生定时器队列、与 vsync
 * 无关。只挂 rAF 时「挤掉一次 = 待应用帧一直不落地」，表现为流式输出中途定住。
 */

export type FrameScheduler = (flush: () => void) => () => void;

export type StreamFrameQueue<T> = {
  /** 排队一帧：同 key 的连续帧只保留最后一帧，并在下一帧边界触发 flush */
  defer: (key: string, frame: T) => void;
  /** 立刻应用待应用的帧（无待应用帧时空转），用于「不可合并事件」之前的顺序保序 */
  flush: () => void;
  /** 丢弃待应用帧并取消调度（订阅重建 / 卸载时用：后续帧仍是全量快照，内容会收敛） */
  clear: () => void;
};

export function createStreamFrameQueue<T>(apply: (frame: T) => void, schedule: FrameScheduler): StreamFrameQueue<T> {
  let key: string | null = null;
  let pending: T | null = null;
  let cancel: (() => void) | null = null;

  const flush = () => {
    if (cancel) { cancel(); cancel = null; }
    if (pending === null) return;
    const frame = pending;
    pending = null;
    key = null;
    apply(frame);
  };

  return {
    defer(nextKey, frame) {
      // 换 key（换消息）时先落地上一条的末帧，保持到达顺序
      if (key !== null && key !== nextKey) flush();
      key = nextKey;
      pending = frame;
      if (!cancel) cancel = schedule(flush);
    },
    flush,
    clear() {
      if (cancel) { cancel(); cancel = null; }
      pending = null;
      key = null;
    },
  };
}

/** 定时器兜底的等待时长：比一帧（16ms）长，正常情况几乎总由 rAF 先到，只在帧回调被挤掉时兜底 */
const FALLBACK_MS = 100;

/** 下一帧边界应用：rAF 与定时器并行挂上，谁先到谁 flush（另一个立刻取消，不会重复应用） */
export function scheduleOnNextFrame(flush: () => void): () => void {
  let rafHandle: number | null = null;
  let timerHandle: ReturnType<typeof setTimeout> | null = null;
  const fire = (): void => {
    if (rafHandle !== null) { cancelAnimationFrame(rafHandle); rafHandle = null; }
    if (timerHandle !== null) { clearTimeout(timerHandle); timerHandle = null; }
    flush();
  };
  if (typeof requestAnimationFrame === 'function') rafHandle = requestAnimationFrame(fire);
  timerHandle = setTimeout(fire, FALLBACK_MS);
  // 取消时两条路径都要清：漏掉定时器会让已作废的 flush 晚到一次（内容虽会收敛，但白跑一遍渲染）
  return () => {
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    if (timerHandle !== null) clearTimeout(timerHandle);
    rafHandle = null;
    timerHandle = null;
  };
}
