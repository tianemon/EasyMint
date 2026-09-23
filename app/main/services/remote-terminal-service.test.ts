import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WebSocket } from "ws";
import {
  computeRemoteSecret,
  decryptRemoteMessage,
  deriveRemoteKeys,
  encryptRemoteMessage,
  generateRemoteKeyPair,
  pairingCode,
  remoteProof,
} from "./remote-crypto";
import { RemoteTerminalService, type MobilePairRequest } from "./remote-terminal-service";
import { appEventBus } from "./app-event-bus";

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

function waitForMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message timeout")), 2_000);
    socket.once("message", (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
    });
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

interface PhoneConnection {
  socket: WebSocket;
  keys: ReturnType<typeof deriveRemoteKeys>;
  connectionId: string;
}

/** 扫码配对 + 加密连接（两个用例共用；配对过程的协议断言留在此处，调用方只关心拿到可用连接） */
async function connectPhone(
  service: RemoteTerminalService,
  offer: Awaited<ReturnType<RemoteTerminalService["createPairingOffer"]>>,
): Promise<PhoneConnection> {
  const deviceId = "phone-1";
  const phone = generateRemoteKeyPair();
  const keys = deriveRemoteKeys(computeRemoteSecret(phone.privateKey, offer.publicKey));
  const pairSocket = new WebSocket(`ws://127.0.0.1:${offer.port}`);
  await waitForOpen(pairSocket);
  const pairRequestPromise = new Promise<MobilePairRequest>((resolve) => service.once("pair-request", resolve));
  pairSocket.send(JSON.stringify({
    type: "mobile-pair-init",
    token: offer.token,
    deviceId,
    deviceName: "Test Phone",
    publicKey: phone.publicKey,
  }));
  const pairRequest = await pairRequestPromise;
  expect(pairRequest.verificationCode).toBe(pairingCode(keys.auth, offer.token));
  const acceptedMessagePromise = waitForMessage(pairSocket);
  expect(service.acceptPair(pairRequest.requestId)).toBe(true);
  const accepted = await acceptedMessagePromise;
  expect(accepted.type).toBe("mobile-pair-accepted");

  const connectionId = "connection-1";
  const nonce = "nonce-1";
  const socket = new WebSocket(`ws://127.0.0.1:${offer.port}`);
  await waitForOpen(socket);
  const ackPromise = waitForMessage(socket);
  socket.send(JSON.stringify({
    type: "mobile-hello",
    deviceId,
    connectionId,
    nonce,
    proof: remoteProof(keys.auth, `hello:${deviceId}:${connectionId}:${nonce}`),
  }));
  const ack = await ackPromise;
  expect(ack.type).toBe("mobile-hello-ack");
  pairSocket.close();
  return { socket, keys, connectionId };
}

/** 发一条加密命令并解出结果信封（服务端按 connectionId/sequence 校验，两者由此处统一回填） */
async function sendCommand(
  connection: PhoneConnection,
  sequence: number,
  envelope: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const encrypted = encryptRemoteMessage(
    connection.keys.clientToServer,
    "c2s",
    connection.connectionId,
    sequence,
    JSON.stringify({ ...envelope, connectionId: connection.connectionId, sequence }),
  );
  const responsePromise = waitForMessage(connection.socket);
  connection.socket.send(JSON.stringify({ type: "mobile-encrypted", ...encrypted }));
  const response = await responsePromise;
  const plaintext = decryptRemoteMessage(connection.keys.serverToClient, "s2c", connection.connectionId, {
    sequence: Number(response.sequence),
    iv: String(response.iv),
    tag: String(response.tag),
    data: String(response.data),
  });
  expect(plaintext).not.toBeNull();
  return JSON.parse(plaintext!) as Record<string, unknown>;
}

/** 解出下一条服务端事件信封 */
async function receiveEvent(connection: PhoneConnection): Promise<{ kind: string; payload: { channel: string; data: Record<string, unknown> } }> {
  const response = await waitForMessage(connection.socket);
  const plaintext = decryptRemoteMessage(connection.keys.serverToClient, "s2c", connection.connectionId, {
    sequence: Number(response.sequence),
    iv: String(response.iv),
    tag: String(response.tag),
    data: String(response.data),
  });
  expect(plaintext).not.toBeNull();
  return JSON.parse(plaintext!) as { kind: string; payload: { channel: string; data: Record<string, unknown> } };
}

/** 「不应收到」的反向断言：ms 内收不到则 resolve，收到了则 reject */
function receiveNothing(connection: PhoneConnection, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { connection.socket.off("message", onMessage); resolve(); }, ms);
    const onMessage = (): void => { clearTimeout(timer); reject(new Error("收到了不该收到的事件")); };
    connection.socket.on("message", onMessage);
  });
}

describe("RemoteTerminalService", () => {
  it("快照生成后、订阅生效前的流式帧从事件游标补齐", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-mobile-terminal-"));
    const service = new RemoteTerminalService(async () => {
      const eventSequence = appEventBus.currentSequence();
      appEventBus.publish("agent:stream", { sessionId: "session-1", type: "message", blocks: [{ type: "text", text: "补帧" }] });
      return { messages: [], bufferedEvents: [], eventSequence };
    }, { port: 0, pairedFile: path.join(dir, "paired.json") });
    service.on("error", () => {});
    cleanup.push(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    const offer = await service.createPairingOffer();
    const connection = await connectPhone(service, offer);
    const response = await sendCommand(connection, 1, {
      version: 1, sentAt: Date.now(), kind: "command", requestId: "snapshot-catchup",
      projectId: "project-1", sessionId: "session-1", payload: { command: "session.snapshot", data: {} },
    });
    const payload = response.payload as { ok: boolean; data: { bufferedEvents: Array<{ type: string; eventSequence: number }> } };
    expect(payload.ok).toBe(true);
    expect(payload.data.bufferedEvents).toMatchObject([{ type: "message" }]);
    expect(payload.data.bufferedEvents[0]?.eventSequence).toBeGreaterThan(0);
    connection.socket.close();
  });

  it("完成扫码配对、认证和加密命令往返", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-mobile-terminal-"));
    const handler = vi.fn(async () => [{ id: "project-1", name: "Demo", status: "development" }]);
    const service = new RemoteTerminalService(handler, { port: 0, pairedFile: path.join(dir, "paired.json") });
    service.on("error", () => {});
    cleanup.push(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });

    const offer = await service.createPairingOffer();
    const connection = await connectPhone(service, offer);

    const response = await sendCommand(connection, 1, {
      version: 1,
      sentAt: Date.now(),
      kind: "command",
      requestId: "request-1",
      payload: { command: "project.listOpen", data: {} },
    });
    const payload = response.payload as { ok: boolean; data: Array<{ id: string }> };
    expect(payload.ok).toBe(true);
    expect(payload.data[0].id).toBe("project-1");
    expect(handler).toHaveBeenCalledTimes(1);
    connection.socket.close();
  });

  it("压缩状态事件随会话下发（载荷缺 sessionId 会被订阅过滤丢弃）", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-mobile-terminal-"));
    const service = new RemoteTerminalService(vi.fn(), { port: 0, pairedFile: path.join(dir, "paired.json") });
    service.on("error", () => {});
    cleanup.push(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });

    const offer = await service.createPairingOffer();
    const connection = await connectPhone(service, offer);
    // 先发一条带 sessionId 的命令登记会话订阅（对应手机进会话后的首次命令），再推压缩事件
    await sendCommand(connection, 1, {
      version: 1,
      sentAt: Date.now(),
      kind: "command",
      requestId: "request-1",
      projectId: "project-1",
      sessionId: "session-1",
      payload: { command: "session.snapshot", data: {} },
    });

    service.forwardAppEvent({
      sequence: 7,
      channel: "agent:context-summarizing",
      data: { chatId: "chat-1", sessionId: "session-1", type: "compact" },
      emittedAt: Date.now(),
    });
    const envelope = await receiveEvent(connection);
    expect(envelope.kind).toBe("event");
    expect(envelope.payload.channel).toBe("agent:context-summarizing");
    expect(envelope.payload.data).toMatchObject({ chatId: "chat-1", sessionId: "session-1", type: "compact" });
    connection.socket.close();
  });

  it("流式正文只按会话订阅放行：只有项目订阅的手机收不到（避免灌死手机端 JS）", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-mobile-terminal-"));
    const service = new RemoteTerminalService(vi.fn(), { port: 0, pairedFile: path.join(dir, "paired.json") });
    service.on("error", () => {});
    cleanup.push(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });

    const offer = await service.createPairingOffer();
    const connection = await connectPhone(service, offer);
    // 手机在首页拉一次会话列表：命令带 projectId、不带 sessionId → 只登记「项目订阅」
    await sendCommand(connection, 1, {
      version: 1,
      sentAt: Date.now(),
      kind: "command",
      requestId: "request-1",
      projectId: "project-1",
      payload: { command: "session.list", data: { projectId: "project-1" } },
    });

    // 列表类事件仍按项目放行（手机要能跟着刷新列表）
    service.forwardAppEvent({
      sequence: 1,
      channel: "session:list-changed",
      data: { projectId: "project-1" },
      emittedAt: Date.now(),
    });
    expect((await receiveEvent(connection)).payload.channel).toBe("session:list-changed");

    // 流式正文是高频大载荷（每帧全量累计正文）：没打开该会话就不推——否则手机逐帧解密+解析，JS 线程被吃死
    const streamEvent = {
      sequence: 2,
      channel: "agent:stream" as const,
      data: { sessionId: "session-1", projectId: "project-1", type: "turn_start" },
      emittedAt: Date.now(),
    };
    service.forwardAppEvent(streamEvent);
    await expect(receiveNothing(connection, 150)).resolves.toBeUndefined();

    // 打开会话后（带 sessionId 的命令登记会话订阅）才放行
    await sendCommand(connection, 2, {
      version: 1,
      sentAt: Date.now(),
      kind: "command",
      requestId: "request-2",
      projectId: "project-1",
      sessionId: "session-1",
      payload: { command: "session.snapshot", data: {} },
    });
    service.forwardAppEvent({ ...streamEvent, sequence: 3 });
    expect((await receiveEvent(connection)).payload.channel).toBe("agent:stream");
    connection.socket.close();
  });

  it("切换会话后旧会话不再推送事件", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-mobile-terminal-"));
    const service = new RemoteTerminalService(vi.fn(async () => ({})), { port: 0, pairedFile: path.join(dir, "paired.json") });
    service.on("error", () => {});
    cleanup.push(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    const offer = await service.createPairingOffer();
    const connection = await connectPhone(service, offer);

    for (const [sequence, sessionId] of [[1, "session-1"], [2, "session-2"]] as const) {
      await sendCommand(connection, sequence, {
        version: 1, sentAt: Date.now(), kind: "command", requestId: `request-${sequence}`,
        projectId: "project-1", sessionId, payload: { command: "session.snapshot", data: {} },
      });
    }
    const stream = (sessionId: string, sequence: number) => ({
      sequence, channel: "agent:stream", data: { sessionId, type: "turn_start" }, emittedAt: Date.now(),
    });
    service.forwardAppEvent(stream("session-1", 10));
    await expect(receiveNothing(connection, 150)).resolves.toBeUndefined();
    service.forwardAppEvent(stream("session-2", 11));
    expect((await receiveEvent(connection)).payload.data.sessionId).toBe("session-2");
    await sendCommand(connection, 3, {
      version: 1, sentAt: Date.now(), kind: "command", requestId: "request-3",
      projectId: "project-2", payload: { command: "session.list", data: {} },
    });
    service.forwardAppEvent(stream("session-2", 12));
    await expect(receiveNothing(connection, 150)).resolves.toBeUndefined();
    connection.socket.close();
  });
});
