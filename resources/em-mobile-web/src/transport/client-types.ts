import type { CommandName, RemoteEnvelope, RemoteEvent } from '../protocol/types';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

/**
 * 传输层对业务层的接口：协议层 RemoteClient（主线程直连）与 WorkerRemoteClient（Worker 代理）
 * 都结构上实现它，useRemoteEvents / useSessionActions 只依赖这个接口，不关心传输落在哪个线程。
 */
export interface RemoteClientLike {
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  onEvent(listener: (event: RemoteEvent, envelope: RemoteEnvelope) => void): () => void;
  connect(): Promise<void>;
  close(): void;
  command<T>(
    command: CommandName,
    options?: { projectId?: string; sessionId?: string; data?: unknown },
  ): Promise<T>;
}
