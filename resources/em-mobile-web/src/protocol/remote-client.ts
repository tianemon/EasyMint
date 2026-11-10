import type {
  CommandName,
  PairingOffer,
  PcCredential,
  RemoteEnvelope,
  RemoteEvent,
} from './types';
import { resultError } from './remote-result';
import {
  base64,
  computeSharedSecret,
  createPairingKeyPair,
  decrypt,
  deriveKeys,
  encrypt,
  pairingCode,
  proof,
  randomId,
  type SessionKeys,
} from './crypto';
import { webDeviceId } from './client-id';

type Status = 'disconnected' | 'connecting' | 'connected';
type JsonObject = Record<string, unknown>;
class PairRejectedError extends Error {}

function openSocket(address: string, port: number, signal: AbortSignal, timeoutMs = 4_000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('连接已取消')); return; }
    const socket = new WebSocket(`ws://${address}:${port}`);
    const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', cancel); socket.onopen = null; socket.onerror = null; };
    const fail = (): void => { cleanup(); socket.close(); reject(new Error(`无法连接 ${address}`)); };
    const cancel = (): void => { fail(); };
    const timer = setTimeout(fail, timeoutMs);
    signal.addEventListener('abort', cancel, { once: true });
    socket.onopen = () => {
      cleanup();
      resolve(socket);
    };
    socket.onerror = fail;
  });
}

async function connectAny<T>(
  addresses: string[], port: number,
  verify: (socket: WebSocket) => Promise<T>,
  signal?: AbortSignal,
): Promise<{ socket: WebSocket; value: T; address: string }> {
  if (!addresses.length) throw new Error('无法连接电脑，请确认手机网络和电脑地址');
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const sockets = new Set<WebSocket>();
  const candidates = [...new Set(addresses)].map((address, index) => {
    const attempt = new Promise<WebSocket>((resolve, reject) => {
      const start = (): void => { void openSocket(address, port, controller.signal).then(socket => {
        sockets.add(socket); resolve(socket);
      }, reject); };
      if (!index) { start(); return; }
      const timer = setTimeout(start, index * 200);
      controller.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('连接已取消')); }, { once: true });
    });
    return { address, result: attempt.then(socket => ({ socket }), () => ({ socket: null })) };
  });
  try {
    while (candidates.length) {
      const { candidate, outcome } = await Promise.race(candidates.map(candidate =>
        candidate.result.then(outcome => ({ candidate, outcome }))));
      candidates.splice(candidates.indexOf(candidate), 1);
      if (!outcome.socket) continue;
      try {
        // Authenticate one socket at a time: the desktop replaces older connections for the same device.
        const value = await verify(outcome.socket);
        sockets.delete(outcome.socket);
        return { socket: outcome.socket, value, address: candidate.address };
      } catch (error) {
        sockets.delete(outcome.socket);
        outcome.socket.close();
        if (error instanceof PairRejectedError) throw error;
      }
    }
    throw new Error('无法连接或验证电脑，请检查网络或重新配对');
  } finally {
    signal?.removeEventListener('abort', abort);
    controller.abort();
    for (const socket of sockets) socket.close();
  }
}

function parseMessage(event: MessageEvent): JsonObject | null {
  if (typeof event.data !== 'string') return null;
  try {
    const value = JSON.parse(event.data);
    return value && typeof value === 'object' ? value as JsonObject : null;
  } catch {
    return null;
  }
}

/**
 * 一次配对所需的全部材料。验证码在**建连之前**就算好；连接失败重试时复用同一份材料，
 * 验证码才恒定——PC 端用 offer 私钥 + 手机公钥算同一个码（桌面端 handlePairInit），
 * 换密钥对或换 deviceId 都会让电脑上那串数字与手机对不上。
 */
export interface PairingAttempt {
  deviceId: string;
  publicKey: string;
  sharedSecret: Uint8Array;
  keys: SessionKeys;
  code: string;
}

export function createPairingAttempt(offer: PairingOffer, deviceId?: string): PairingAttempt {
  const id = deviceId ?? webDeviceId();
  const pair = createPairingKeyPair();
  const sharedSecret = computeSharedSecret(pair.secretKey, offer.publicKey);
  const keys = deriveKeys(sharedSecret);
  return {
    deviceId: id,
    publicKey: pair.publicKey,
    sharedSecret,
    keys,
    code: pairingCode(keys.auth, offer.token),
  };
}

export async function pairWithPc(
  offer: PairingOffer,
  deviceName: string,
  onVerificationCode: (code: string) => void,
  attempt: PairingAttempt = createPairingAttempt(offer),
): Promise<PcCredential> {
  const { deviceId, publicKey, sharedSecret, keys } = attempt;
  // 先把验证码交给 UI 显示，再去连 WS：WS 不可达时码仍留在页面上等用户比对/重试。
  onVerificationCode(attempt.code);
  const result = await connectAny(offer.addresses, offer.port, socket => new Promise<PcCredential>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('电脑端确认超时，请重新扫码'));
    }, Math.max(1_000, offer.expiresAt - Date.now() + 60_000));
    const finish = (error?: Error, credential?: PcCredential) => {
      clearTimeout(timeout);
      socket.onclose = null; socket.onerror = null; socket.onmessage = null;
      if (error) reject(error);
      else if (credential) resolve(credential);
    };
    socket.onmessage = (event) => {
      const message = parseMessage(event);
      if (message?.type === 'mobile-pair-rejected') {
        finish(new PairRejectedError('电脑端拒绝了配对'));
        return;
      }
      if (message?.type !== 'mobile-pair-accepted') return;
      const expected = proof(keys.auth, `pair-accepted:${offer.token}:${deviceId}`);
      if (message.pcId !== offer.pcId || message.proof !== expected) {
        finish(new Error('电脑身份校验失败'));
        return;
      }
      finish(undefined, {
        version: 1,
        pcId: offer.pcId,
        pcName: offer.pcName,
        addresses: offer.addresses,
        port: offer.port,
        deviceId,
        deviceName,
        sharedSecret: base64.encode(sharedSecret),
      });
    };
    socket.onerror = () => finish(new Error('配对连接中断'));
    socket.onclose = () => finish(new Error('配对连接中断'));
    try {
      socket.send(JSON.stringify({ type: 'mobile-pair-init', token: offer.token, deviceId, deviceName, publicKey }));
    } catch { finish(new Error('配对连接中断')); }
  }));
  result.socket.close();
  return result.value;
}

export class RemoteClient {
  private socket: WebSocket | null = null;
  private keys: SessionKeys;
  private connectionId = '';
  private sendSequence = 0;
  private receiveSequence = 0;
  private intentionalClose = false;
  private connectTask: Promise<void> | null = null;
  private connectAbort: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private statusListeners = new Set<(status: Status) => void>();
  private addressListeners = new Set<(address: string | null) => void>();

  onAddress(listener: (address: string | null) => void): () => void {
    this.addressListeners.add(listener);
    return () => this.addressListeners.delete(listener);
  }

  private emitAddress(address: string | null): void {
    for (const listener of this.addressListeners) listener(address);
  }
  private revokedListeners = new Set<() => void>();
  private eventListeners = new Set<(event: RemoteEvent, envelope: RemoteEnvelope) => void>();

  constructor(private readonly credential: PcCredential) {
    this.keys = deriveKeys(base64.decode(credential.sharedSecret));
  }

  /** 配对被电脑端撤销：上层要清掉本地凭证并回到配对页，而不是继续重连。 */
  onPairingRevoked(listener: () => void): () => void {
    this.revokedListeners.add(listener);
    return () => this.revokedListeners.delete(listener);
  }

  onStatus(listener: (status: Status) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onEvent(listener: (event: RemoteEvent, envelope: RemoteEnvelope) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connectTask) return this.connectTask;
    this.intentionalClose = false;
    const controller = new AbortController();
    this.connectAbort = controller;
    const task = this.establish(controller.signal).finally(() => {
      if (this.connectTask === task) { this.connectTask = null; this.connectAbort = null; }
    });
    this.connectTask = task;
    return task;
  }

  private async establish(signal: AbortSignal): Promise<void> {
    this.emitStatus('connecting');
    let connected: { socket: WebSocket; value: string; address: string };
    try {
      connected = await connectAny(this.credential.addresses, this.credential.port, socket => {
        const connectionId = randomId();
        const nonce = randomId();
        return new Promise<string>((resolve, reject) => {
          const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', fail); };
          const fail = (): void => { cleanup(); reject(new Error('连接认证失败')); };
          const timer = setTimeout(fail, 5_000);
          signal.addEventListener('abort', fail, { once: true });
          socket.onmessage = (event) => {
            const message = parseMessage(event);
            if (message?.type !== 'mobile-hello-ack') return;
            const expected = proof(this.keys.auth, `hello-ack:${this.credential.deviceId}:${connectionId}:${nonce}`);
            if (message.connectionId !== connectionId || message.proof !== expected) { fail(); return; }
            cleanup();
            resolve(connectionId);
          };
          socket.onerror = fail;
          socket.onclose = fail;
          try {
            socket.send(JSON.stringify({ type: 'mobile-hello', deviceId: this.credential.deviceId,
              deviceName: this.credential.deviceName, connectionId, nonce,
              proof: proof(this.keys.auth, `hello:${this.credential.deviceId}:${connectionId}:${nonce}`) }));
          } catch { fail(); }
        });
      }, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      this.emitStatus('disconnected');
      this.scheduleReconnect();
      throw error;
    }
    const socket = connected.socket;
    if (signal.aborted) { socket.close(); throw new Error('连接已取消'); }
    this.socket = socket;
    this.connectionId = connected.value;
    this.sendSequence = 0;
    this.receiveSequence = 0;
    this.emitAddress(connected.address);

    socket.onmessage = (event) => this.handleMessage(event);
    socket.onerror = () => undefined;
    socket.onclose = (event) => this.handleClose(event);
    this.reconnectAttempt = 0;
    this.emitStatus('connected');
  }

  close(): void {
    this.emitAddress(null);
    this.intentionalClose = true;
    this.connectAbort?.abort();
    this.connectAbort = null;
    this.connectTask = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.rejectPending(new Error('连接已关闭'));
    this.emitStatus('disconnected');
  }

  command<T>(
    command: CommandName,
    options: { projectId?: string; sessionId?: string; data?: unknown } = {},
  ): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('电脑尚未连接'));
    }
    const requestId = randomId();
    const sequence = ++this.sendSequence;
    const envelope: RemoteEnvelope = {
      version: 1,
      connectionId: this.connectionId,
      sequence,
      sentAt: Date.now(),
      kind: 'command',
      requestId,
      projectId: options.projectId,
      sessionId: options.sessionId,
      payload: { command, data: options.data },
    };
    const encrypted = encrypt(this.keys.clientToServer, this.connectionId, sequence, JSON.stringify(envelope));
    this.socket.send(JSON.stringify({ type: 'mobile-encrypted', ...encrypted }));

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('命令执行超时'));
      }, 60_000);
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer });
    });
  }

  private handleMessage(event: MessageEvent): void {
    const message = parseMessage(event);
    if (message?.type !== 'mobile-encrypted') return;
    const sequence = Number(message.sequence);
    if (!Number.isSafeInteger(sequence) || sequence !== this.receiveSequence + 1) {
      this.socket?.close(1008, 'invalid sequence');
      return;
    }
    try {
      const plaintext = decrypt(this.keys.serverToClient, this.connectionId, sequence, {
        iv: String(message.iv ?? ''),
        tag: String(message.tag ?? ''),
        data: String(message.data ?? ''),
      });
      const envelope = JSON.parse(plaintext) as RemoteEnvelope;
      if (envelope.version !== 1 || envelope.connectionId !== this.connectionId || envelope.sequence !== sequence) {
        throw new Error('envelope mismatch');
      }
      this.receiveSequence = sequence;
      if (envelope.kind === 'result' && envelope.requestId) {
        const pending = this.pending.get(envelope.requestId);
        if (!pending) return;
        this.pending.delete(envelope.requestId);
        clearTimeout(pending.timer);
        const payload = envelope.payload as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } };
        const error = resultError(payload);
        if (error) pending.reject(error);
        else pending.resolve(payload.data);
      } else if (envelope.kind === 'event') {
        const payload = envelope.payload as RemoteEvent;
        if (payload && typeof payload.channel === 'string') {
          for (const listener of this.eventListeners) listener(payload, envelope);
        }
      }
    } catch {
      this.socket?.close(1008, 'decryption failed');
    }
  }

  private handleClose(event?: { code?: number; reason?: string }): void {
    this.emitAddress(null);
    this.socket = null;
    this.rejectPending(new Error('与电脑的连接已中断'));
    this.emitStatus('disconnected');
    // 正连着的时候电脑端点了「撤销」：立刻按凭证失效处理，别等重连再撞一次 unknown device
    if (event?.code === 1008 && event.reason === 'device revoked') {
      this.intentionalClose = true;
      for (const listener of this.revokedListeners) listener();
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose || this.reconnectTimer) return;
    const delay = Math.min(15_000, 1_000 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => undefined);
    }, delay);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private emitStatus(status: Status): void {
    for (const listener of this.statusListeners) listener(status);
  }
}
