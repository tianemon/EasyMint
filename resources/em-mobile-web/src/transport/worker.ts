/**
 * 传输 Worker：持有 WebSocket + @noble 解密 + JSON 解析（均在 RemoteClient 内），
 * 按 runId 合并流式中间帧、按 eventSequence 保序转发事件、每 16ms 批量 postMessage，
 * 附件在 Worker 内 FileReader → base64 并校验限额。主线程只做渲染与交互。
 *
 * Worker 没有 requestAnimationFrame：合并节拍用 setTimeout(16) + 100ms 兜底。
 */
import { RemoteClient } from '../protocol/remote-client';
import type { PcCredential, RemoteEnvelope, RemoteEvent } from '../protocol/types';
import { encodeFiles } from './attachment-codec';

type BatchItem = { event: RemoteEvent; envelope: RemoteEnvelope };

const ctx = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

let client: RemoteClient | null = null;
let pending: BatchItem[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

function dataOf(item: BatchItem): Record<string, unknown> {
  const data = item.event.data;
  return data && typeof data === 'object' ? data as Record<string, unknown> : {};
}

/** 唯一可合并的帧：同一条消息的流式中间帧（累计全文快照，中间态必被覆盖）。 */
function isMergeableStream(item: BatchItem): boolean {
  const data = dataOf(item);
  return item.event.channel === 'agent:stream' && data.type === 'message' && data.partial !== false;
}

function runKey(item: BatchItem): string {
  return `${item.envelope.sessionId ?? ''}:${String(dataOf(item).runId ?? 'run')}`;
}

function flush(): void {
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
  if (fallbackTimer !== null) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  if (!pending.length) return;
  const batch = pending;
  pending = [];
  // 批量下发，保留每个事件的 eventSequence / envelope.sentAt / projectId / sessionId，
  // 主线程 openSession 的 duringRequest 与 snapshotMessagesWithBuffer 按 eventSequence 合并快照。
  ctx.postMessage({ type: 'events', events: batch });
}

function scheduleFlush(): void {
  if (flushTimer === null) flushTimer = setTimeout(flush, 16);
  // Worker 无 rAF：100ms 兜底，避免持续有帧时 16ms 定时器被饿死导致状态一直不落地。
  if (fallbackTimer === null) fallbackTimer = setTimeout(flush, 100);
}

function enqueue(event: RemoteEvent, envelope: RemoteEnvelope): void {
  const item: BatchItem = { event, envelope };
  const last = pending[pending.length - 1];
  // 只合并「相邻」的同 runId 中间帧，保持到达顺序：边界/终态帧绝不被窗口吞掉。
  if (last && isMergeableStream(item) && isMergeableStream(last) && runKey(item) === runKey(last)) {
    pending[pending.length - 1] = item;
  } else {
    pending.push(item);
  }
  scheduleFlush();
}

function errorBody(error: unknown): { message: string; code?: string } {
  const e = error as { message?: string; code?: string } | null;
  return { message: e?.message ?? '命令执行失败', ...(e?.code ? { code: e.code } : {}) };
}

ctx.onmessage = (event: MessageEvent): void => {
  const message = (event.data ?? {}) as Record<string, unknown>;
  switch (message.type) {
    case 'init': {
      if (client) client.close();
      client = new RemoteClient(message.credential as PcCredential);
      client.onStatus((status) => ctx.postMessage({ type: 'status', status }));
      client.onEvent((ev, envelope) => enqueue(ev, envelope));
      void client.connect().catch((error) => ctx.postMessage({ type: 'connectError', error: errorBody(error) }));
      break;
    }
    case 'command': {
      const requestId = String(message.requestId ?? '');
      if (!client) {
        ctx.postMessage({ type: 'result', requestId, ok: false, error: { message: '电脑尚未连接' } });
        break;
      }
      void client.command(message.command as never, (message.options ?? {}) as never).then(
        (data) => ctx.postMessage({ type: 'result', requestId, ok: true, data }),
        (error) => ctx.postMessage({ type: 'result', requestId, ok: false, error: errorBody(error) }),
      );
      break;
    }
    case 'pause':
      client?.close();
      break;
    case 'resume':
      void client?.connect().catch((error) => ctx.postMessage({ type: 'connectError', error: errorBody(error) }));
      break;
    case 'close':
      flush();
      client?.close();
      client = null;
      break;
    case 'encodeFiles': {
      const requestId = String(message.requestId ?? '');
      void encodeFiles(message.files as File[], message.kind as 'image' | 'doc').then(
        (attachments) => ctx.postMessage({ type: 'encoded', requestId, ok: true, attachments }),
        (error) => ctx.postMessage({ type: 'encoded', requestId, ok: false, error: errorBody(error) }),
      );
      break;
    }
    default:
      break;
  }
};
