import { RemoteClient } from '../protocol/remote-client';
import type { CommandName, PcCredential, RemoteEnvelope, RemoteEvent } from '../protocol/types';
import type { AttachmentEncoder, AttachmentKind, DraftAttachment } from '../core/attachments';
import { defaultEncoder } from '../core/attachments';
import type { ConnectionStatus, RemoteClientLike } from './client-types';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type WorkerMessage = {
  type: string;
  status?: ConnectionStatus;
  events?: Array<{ event: RemoteEvent; envelope: RemoteEnvelope }>;
  requestId?: string;
  revoked?: boolean;
  ok?: boolean;
  data?: unknown;
  error?: { message: string; code?: string };
  attachments?: DraftAttachment[];
};

/**
 * 传输客户端：优先把 WebSocket / 解密 / 帧合并放进 Worker；Worker 不可用时
 * 主线程直接加载同一个 src/transport + src/protocol 模块降级（接口完全一致）。
 * 协议层与状态逻辑都不在 React 组件内。
 */
export class TransportClient implements RemoteClientLike {
  private worker: Worker | null = null;
  private direct: RemoteClient | null = null;
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private eventListeners = new Set<(event: RemoteEvent, envelope: RemoteEnvelope) => void>();
  private resumeListeners = new Set<() => void>();
  private revokedListeners = new Set<() => void>();
  private pending = new Map<string, Pending>();
  private encodePending = new Map<string, {
    resolve: (value: DraftAttachment[]) => void;
    reject: (error: Error) => void;
    files: File[];
  }>();
  private requestSeq = 0;
  private disposed = false;
  usingWorker = false;

  constructor(private readonly credential: PcCredential) {
    try {
      if (typeof Worker === 'undefined') throw new Error('Worker unavailable');
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent) => this.handleWorkerMessage((event.data ?? {}) as WorkerMessage);
      worker.onerror = () => this.fallbackToDirect();
      worker.postMessage({ type: 'init', credential });
      this.worker = worker;
      this.usingWorker = true;
    } catch {
      this.fallbackToDirect();
    }
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onEvent(listener: (event: RemoteEvent, envelope: RemoteEnvelope) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onPairingRevoked(listener: () => void): () => void {
    this.revokedListeners.add(listener);
    return () => this.revokedListeners.delete(listener);
  }

  /** 恢复可见 / 重连后重取快照（App 注册）。 */
  onResume(listener: () => void): () => void {
    this.resumeListeners.add(listener);
    return () => this.resumeListeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (this.worker) this.worker.postMessage({ type: 'resume' });
    else if (this.direct) await this.direct.connect();
  }

  close(): void {
    if (this.worker) this.worker.postMessage({ type: 'pause' });
    else this.direct?.close();
  }

  command<T>(command: CommandName, options: { projectId?: string; sessionId?: string; data?: unknown } = {}): Promise<T> {
    const requestId = `w${++this.requestSeq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('命令执行超时'));
      }, 65_000);
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer });
      if (this.worker) {
        this.worker.postMessage({ type: 'command', requestId, command, options });
      } else if (this.direct) {
        void this.direct.command<T>(command, options).then(
          (value) => { clearTimeout(timer); this.pending.delete(requestId); resolve(value); },
          (error) => { clearTimeout(timer); this.pending.delete(requestId); reject(error as Error); },
        );
      } else {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error('电脑尚未连接'));
      }
    });
  }

  /** 附件编码器：走 Worker 内 FileReader + 限额校验，主线程只补 createObjectURL 缩略图。 */
  encodeFiles: AttachmentEncoder = (files: File[], kind: AttachmentKind): Promise<DraftAttachment[]> => {
    if (!this.worker) return defaultEncoder(files, kind);
    const requestId = `a${++this.requestSeq}`;
    return new Promise<DraftAttachment[]>((resolve, reject) => {
      this.encodePending.set(requestId, { resolve, reject, files });
      this.worker?.postMessage({ type: 'encodeFiles', requestId, files, kind });
    }).then((items) => items.map((item, index) => ({
      ...item,
      previewUrl: files[index] ? URL.createObjectURL(files[index]) : undefined,
    })));
  };

  dispose(): void {
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.worker) { this.worker.postMessage({ type: 'close' }); this.worker.terminate(); this.worker = null; }
    this.direct?.close();
    this.direct = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('连接已关闭')); }
    this.pending.clear();
    this.encodePending.clear();
    this.statusListeners.clear();
    this.eventListeners.clear();
    this.resumeListeners.clear();
  }

  private onVisibility = (): void => {
    if (this.disposed) return;
    if (document.visibilityState === 'hidden') {
      this.close();
      return;
    }
    if (this.worker) this.worker.postMessage({ type: 'resume' });
    else if (this.direct) void this.direct.connect().catch(() => undefined);
    for (const listener of this.resumeListeners) listener();
  };

  private handleWorkerMessage(message: WorkerMessage): void {
    switch (message.type) {
      case 'status':
        if (message.status) for (const listener of this.statusListeners) listener(message.status);
        break;
      case 'revoked':
        for (const listener of this.revokedListeners) listener();
        break;
      case 'events':
        for (const item of message.events ?? []) {
          for (const listener of this.eventListeners) listener(item.event, item.envelope);
        }
        break;
      case 'result': {
        const pending = this.pending.get(String(message.requestId ?? ''));
        if (!pending) break;
        this.pending.delete(String(message.requestId ?? ''));
        clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.data);
        else {
          const error = new Error(message.error?.message ?? '命令执行失败') as Error & { code?: string };
          if (message.error?.code) error.code = message.error.code;
          pending.reject(error);
        }
        break;
      }
      case 'encoded': {
        const key = String(message.requestId ?? '');
        const task = this.encodePending.get(key);
        if (!task) break;
        this.encodePending.delete(key);
        if (message.ok) task.resolve(message.attachments ?? []);
        else task.reject(new Error(message.error?.message ?? '附件读取失败'));
        break;
      }
      default:
        break;
    }
  }

  private fallbackToDirect(): void {
    if (this.direct || this.disposed) return;
    this.worker?.terminate();
    this.worker = null;
    this.usingWorker = false;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('传输降级，请重试')); }
    this.pending.clear();
    const direct = new RemoteClient(this.credential);
    direct.onStatus((status) => { for (const listener of this.statusListeners) listener(status); });
    direct.onEvent((event, envelope) => { for (const listener of this.eventListeners) listener(event, envelope); });
    direct.onPairingRevoked(() => { for (const listener of this.revokedListeners) listener(); });
    this.direct = direct;
    void direct.connect().catch(() => undefined);
  }
}

export function createTransportClient(credential: PcCredential): TransportClient {
  return new TransportClient(credential);
}
