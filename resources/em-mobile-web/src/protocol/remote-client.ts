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

function openSocket(address: string, port: number, timeoutMs = 4_000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${address}:${port}`);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`无法连接 ${address}`));
    }, timeoutMs);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve(socket);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`无法连接 ${address}`));
    };
  });
}

async function connectAny(addresses: string[], port: number): Promise<WebSocket> {
  let lastError: unknown;
  for (const address of addresses) {
    try {
      return await openSocket(address, port);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('无法连接电脑，请确认两台设备在同一局域网');
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
  const socket = await connectAny(offer.addresses, offer.port);

  return await new Promise<PcCredential>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('电脑端确认超时，请重新扫码'));
    }, Math.max(1_000, offer.expiresAt - Date.now() + 60_000));
    const finish = (error?: Error, credential?: PcCredential) => {
      clearTimeout(timeout);
      socket.close();
      if (error) reject(error);
      else if (credential) resolve(credential);
    };
    socket.onmessage = (event) => {
      const message = parseMessage(event);
      if (message?.type === 'mobile-pair-rejected') {
        finish(new Error('电脑端拒绝了配对'));
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
    socket.send(JSON.stringify({
      type: 'mobile-pair-init',
      token: offer.token,
      deviceId,
      deviceName,
      publicKey,
    }));
  });
}

export class RemoteClient {
  private socket: WebSocket | null = null;
  private keys: SessionKeys;
  private connectionId = '';
  private sendSequence = 0;
  private receiveSequence = 0;
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private statusListeners = new Set<(status: Status) => void>();
  private eventListeners = new Set<(event: RemoteEvent, envelope: RemoteEnvelope) => void>();

  constructor(private readonly credential: PcCredential) {
    this.keys = deriveKeys(base64.decode(credential.sharedSecret));
  }

  onStatus(listener: (status: Status) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onEvent(listener: (event: RemoteEvent, envelope: RemoteEnvelope) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    this.intentionalClose = false;
    this.emitStatus('connecting');
    let socket: WebSocket;
    try {
      socket = await connectAny(this.credential.addresses, this.credential.port);
    } catch (error) {
      // 先开手机、后开电脑：第一次必然连不上。这里不排重试的话，之后电脑起来了也没人再试
      this.emitStatus('disconnected');
      this.scheduleReconnect();
      throw error;
    }
    this.socket = socket;
    this.connectionId = randomId();
    this.sendSequence = 0;
    this.receiveSequence = 0;
    const nonce = randomId();

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('连接认证超时')), 5_000);
        socket.onmessage = (event) => {
          const message = parseMessage(event);
          if (message?.type !== 'mobile-hello-ack') return;
          const expected = proof(
            this.keys.auth,
            `hello-ack:${this.credential.deviceId}:${this.connectionId}:${nonce}`,
          );
          if (message.connectionId !== this.connectionId || message.proof !== expected) {
            clearTimeout(timer);
            reject(new Error('电脑身份校验失败'));
            return;
          }
          clearTimeout(timer);
          resolve();
        };
        socket.onerror = () => {
          clearTimeout(timer);
          reject(new Error('连接认证失败'));
        };
        socket.send(JSON.stringify({
          type: 'mobile-hello',
          deviceId: this.credential.deviceId,
          connectionId: this.connectionId,
          nonce,
          proof: proof(this.keys.auth, `hello:${this.credential.deviceId}:${this.connectionId}:${nonce}`),
        }));
      });
    } catch (error) {
      socket.close();
      this.socket = null;
      this.emitStatus('disconnected');
      this.scheduleReconnect();
      throw error;
    }

    socket.onmessage = (event) => this.handleMessage(event);
    socket.onerror = () => undefined;
    socket.onclose = () => this.handleClose();
    this.reconnectAttempt = 0;
    this.emitStatus('connected');
  }

  close(): void {
    this.intentionalClose = true;
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

  private handleClose(): void {
    this.socket = null;
    this.rejectPending(new Error('与电脑的连接已中断'));
    this.emitStatus('disconnected');
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
