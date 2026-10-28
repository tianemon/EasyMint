import { EventEmitter } from "node:events";

export interface AppEvent<T = unknown> {
  sequence: number;
  channel: string;
  data: T;
  emittedAt: number;
}

type AppEventListener = (event: AppEvent) => void;

/**
 * 环形缓冲按**字节**限流，不按条数。
 *
 * 缓冲的唯一用途是远端终端断线重连的补发（`eventsAfter`），而事件里含完整工具结果正文
 * （`event-bridge.ts` 转发 tool_result 时不做截断），一条可达数百 KB。只按条数限（历史实现
 * 是 2000 条）时，一块大文件读取密集的会话能把缓冲撑到几十 MB，且这份内存桌面端根本用不到。
 */
const MAX_RETAINED_TOTAL_BYTES = 12 * 1024 * 1024;
/** 单条事件超过此体积直接不入缓冲：留着会挤掉其它事件，且补发一条超大工具结果没有意义 */
const MAX_RETAINED_EVENT_BYTES = 4 * 1024 * 1024;
const MAX_RETAINED_EVENTS = 2_000;
/** 被跳过事件的记录条数上限（每条几十字节）。超出后改用游标下限做粗粒度判断 */
const MAX_TRACKED_DROPS = 256;

/**
 * 估算载荷体积，累计超过 limit 立刻返回（结果只需能判断「是否超限」）。
 * 不序列化：对大载荷 JSON.stringify 会额外分配一份等大的字符串，恰好是这里要避免的开销。
 *
 * 口径是**保守上界**：字符串按 UTF-16 code unit 计（V8 对含中文的字符串就是双字节存储），
 * 对象/数组按固定头开销计。宁高勿低——低报会让名义预算悄悄翻倍。
 */
function estimateBytes(value: unknown, limit: number): number {
  let total = 0;
  const seen = new WeakSet<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0 && total <= limit) {
    const item = stack.pop();
    switch (typeof item) {
      case "string":
        total += item.length * 2;
        break;
      case "number":
      case "boolean":
        total += 8;
        break;
      case "bigint":
        total += 16;
        break;
      case "object": {
        if (item === null) break;
        const obj = item as object;
        if (seen.has(obj)) break;
        seen.add(obj);
        total += 32;
        if (Array.isArray(obj)) {
          total += 8;
          for (const child of obj) stack.push(child);
        } else if (obj instanceof Uint8Array) {
          total += obj.byteLength;
        } else {
          for (const child of Object.values(obj)) stack.push(child);
        }
        break;
      }
      default:
        break;
    }
  }
  return total;
}

/** 被丢弃事件的补发范围提示：补发方只按渠道 + 会话筛选，这里只留这两项够用的信息 */
interface DroppedEvent {
  sequence: number;
  channel: string;
  sessionId?: string;
}

function sessionIdOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const value = (data as { sessionId?: unknown }).sessionId;
  return typeof value === "string" ? value : undefined;
}

class AppEventBus {
  private readonly emitter = new EventEmitter();
  private nextSequence = 0;
  private recent: Array<{ event: AppEvent; bytes: number }> = [];
  private retainedBytes = 0;
  /** 因体积超限而没进缓冲的事件；补发时按渠道/会话判断是否真有缺口 */
  private dropped: DroppedEvent[] = [];
  /** 记录已溢出，此序号之前的丢弃情况不再精确可知 */
  private dropTrackingFloor = 0;

  publish<T>(channel: string, data: T): AppEvent<T> {
    const event: AppEvent<T> = {
      sequence: ++this.nextSequence,
      channel,
      data,
      emittedAt: Date.now(),
    };
    this.retain(event);
    this.emitter.emit("event", event);
    return event;
  }

  private retain(event: AppEvent): void {
    const payloadBytes = estimateBytes(event.data, MAX_RETAINED_EVENT_BYTES);
    const bytes = payloadBytes + event.channel.length + 64;
    if (bytes > MAX_RETAINED_EVENT_BYTES) {
      this.trackDrop(event);
      return;
    }
    this.recent.push({ event, bytes });
    this.retainedBytes += bytes;
    while (this.recent.length > MAX_RETAINED_EVENTS || this.retainedBytes > MAX_RETAINED_TOTAL_BYTES) {
      const evicted = this.recent.shift();
      if (!evicted) break;
      this.retainedBytes -= evicted.bytes;
    }
  }

  private trackDrop(event: AppEvent): void {
    this.dropped.push({
      sequence: event.sequence,
      channel: event.channel,
      sessionId: sessionIdOf(event.data),
    });
    if (this.dropped.length > MAX_TRACKED_DROPS) {
      const removed = this.dropped.shift();
      if (removed) this.dropTrackingFloor = removed.sequence;
    }
  }

  subscribe(listener: AppEventListener): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  currentSequence(): number {
    return this.nextSequence;
  }

  /**
   * 返回游标后的事件；游标已早于环形缓冲时返回 null，调用方应重新拉快照。
   * 游标之后有被跳过的事件时同样返回 null——补不出完整序列，不能假装没有缺口。
   *
   * predicate 必须是**渠道/会话级**筛选（当前唯一调用方 remote-terminal-service 只比
   * `channel` 与 `data.sessionId`）：被跳过的事件只保留了这两项，更细的筛选条件在这里
   * 看到的是残缺载荷。
   */
  eventsAfter(sequence: number, predicate?: (event: AppEvent) => boolean): AppEvent[] | null {
    const oldest = this.recent[0]?.event.sequence;
    if (oldest !== undefined && sequence < oldest - 1) return null;
    if (sequence < this.dropTrackingFloor) return null;
    for (const dropped of this.dropped) {
      if (dropped.sequence <= sequence) continue;
      if (!predicate) return null;
      const probe: AppEvent = {
        sequence: dropped.sequence,
        channel: dropped.channel,
        data: dropped.sessionId === undefined ? undefined : { sessionId: dropped.sessionId },
        emittedAt: 0,
      };
      // 探针是残缺载荷，predicate 若取用了不存在字段可能抛错；抛错时按「有缺口」处理（fail-safe）
      let matched = true;
      try {
        matched = predicate(probe);
      } catch {
        matched = true;
      }
      if (matched) return null;
    }
    return this.recent
      .map((entry) => entry.event)
      .filter((event) => event.sequence > sequence && (!predicate || predicate(event)));
  }
}

export const appEventBus = new AppEventBus();
