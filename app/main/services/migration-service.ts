/**
 * 项目/会话迁移服务 — 发送端打包传输 + 接收端恢复
 *
 * 两端分离设计（方案见 docs/design/跨设备会话迁移与设备互联方案.md 第四章）：
 * - 发送端:按清单打包 → 分块传输 → 止于"传输完成"
 * - 接收端:弹窗确认 → 解压落位 → 会话恢复(cwd 改写) → 注入系统消息给本机 Mint
 *          + 经互联通道回执给发送端
 *
 * 传输协议（WS JSON 消息,基于 network-service 通道）:
 *   transfer-request  { fromName, projectName, size, fileCount, transferId }
 *   transfer-accept   { transferId, targetPath }
 *   transfer-reject   { transferId }
 *   transfer-chunk    { transferId, index, total, data(base64) }
 *   transfer-complete { transferId }        → 接收端恢复完成后:
 *   transfer-done     { transferId, projectPath }  → 回执给发送端
 */

import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { networkService } from "./network-service";
import { broadcast } from "./ipc-broadcast";

// ── 类型 ──
export interface MigrationFile {
  /** 相对路径(解压后按此落位) */
  relPath: string;
  size: number;
  /** 校验和(落位后核对) */
  sha256: string;
}

export interface MigrationManifest {
  fromName: string;          // 发送端设备名
  projectName: string;       // 项目名
  winProjectPath?: string;   // 发送端项目绝对路径(接收端改写会话 cwd 用)
  files: MigrationFile[];    // 全部待传文件
  sessionFile?: string;      // 主会话 jsonl 相对路径(若有)
  createdAt: number;
}

interface PendingTransfer {
  transferId: string;
  fromName: string;
  /** 发送端设备 ID(回执/拒绝用) */
  peerId: string;
  manifest: MigrationManifest;
  /** 分块缓存:扁平索引 = fileIndex * 该文件总块数 + 块内索引 */
  chunks: Buffer[];
  receivedBytes: number;
  /** 用户确认后的目标路径(acceptTransfer 时设置) */
  targetPath: string;
  /** transfer-complete 已到达但用户尚未确认(两阶段握手:等 accept 时落位) */
  completeArrived?: boolean;
}

const CHUNK_SIZE = 256 * 1024; // 256KB/块
const MAX_TRANSFER_SIZE = 500 * 1024 * 1024; // 单次传输上限 500MB

class MigrationService extends EventEmitter {
  private pending = new Map<string, PendingTransfer>();
  /** 发送端记录:transferId → 发起迁移的项目路径(回执到达时定位会话,注入系统消息) */
  private sentTransfers = new Map<string, string>();
  /** 发送端两阶段握手:transferId → 等待 accept/reject 的 resolver */
  private acceptWaiters = new Map<string, { resolve: (v: "accepted" | "rejected" | "timeout") => void; timer: NodeJS.Timeout }>();
  private nextId = 0;

  /** 等待接收端确认(两阶段握手)。30s 超时;收到 transfer-accept → accepted,transfer-reject → rejected */
  private waitAccept(transferId: string): Promise<"accepted" | "rejected" | "timeout"> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.acceptWaiters.delete(transferId);
        resolve("timeout");
      }, 30_000);
      this.acceptWaiters.set(transferId, { resolve, timer });
    });
  }

  constructor() {
    super();
    // 订阅 network-service 的应用层消息(migration-* 已按类型转发)
    networkService.on("migration-message", (req: { peerId: string; msg: Record<string, unknown> }) => {
      void this.handleProtocolMessage(req.peerId, req.msg);
    });
  }

  private resolveAccept(transferId: string, result: "accepted" | "rejected"): void {
    const w = this.acceptWaiters.get(transferId);
    if (!w) return;
    clearTimeout(w.timer);
    this.acceptWaiters.delete(transferId);
    w.resolve(result);
  }

  private async handleProtocolMessage(peerId: string, msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case "transfer-request":
        await this.handleTransferRequest({ fromId: peerId, ...msg });
        break;
      case "transfer-chunk":
        this.handleChunk(peerId, msg);
        break;
      case "transfer-complete":
        await this.completeTransfer(peerId, msg);
        break;
      case "transfer-accept":
        // 发送端:接收端确认接收 → 解除等待,开始传数据
        this.resolveAccept(msg.transferId as string, "accepted");
        break;
      case "transfer-reject":
        // 发送端:接收端拒绝 → 取消
        this.resolveAccept(msg.transferId as string, "rejected");
        break;
      case "transfer-done":
        // 发送端收到接收端回执:迁移完成(接收端已恢复)
        this.emit("done", { peerId, projectPath: this.sentTransfers.get(msg.transferId as string), ...msg });
        break;
      case "transfer-failed":
        // 发送端收到接收端失败报告
        this.emit("failed", { peerId, projectPath: this.sentTransfers.get(msg.transferId as string), ...msg });
        break;
      default:
        this.emit("message", { peerId, msg });
    }
  }

  // ── 发送端 ──

  /** 打包清单文件并传输(清单 + 全部文件分块;返回 transferId) */
  async startTransfer(projectPath: string, deviceId: string, files: Array<{ relPath: string; absPath: string }>, opts?: {
    sessionFile?: string;
  }): Promise<{ ok: boolean; transferId?: string; error?: string }> {
    const peer = networkService.listPaired().find((p) => p.id === deviceId);
    if (!peer?.online) return { ok: false, error: "目标设备不在线" };

    // 计算清单(哈希)
    const manifestFiles: MigrationFile[] = [];
    let total = 0;
    for (const f of files) {
      let size = 0;
      let hash = "";
      try {
        const stat = fs.statSync(f.absPath);
        size = stat.size;
        hash = this.sha256File(f.absPath);
      } catch {
        return { ok: false, error: `文件不可读: ${f.relPath}` };
      }
      total += size;
      manifestFiles.push({ relPath: f.relPath, size, sha256: hash });
    }
    if (total > MAX_TRANSFER_SIZE) return { ok: false, error: "传输内容过大" };

    const transferId = `t${Date.now()}-${this.nextId++}`;
    const manifest: MigrationManifest = {
      fromName: networkService.getSelf().name,
      projectName: path.basename(projectPath),
      winProjectPath: projectPath,
      files: manifestFiles,
      sessionFile: opts?.sessionFile,
      createdAt: Date.now(),
    };

    // 1. 发 manifest(两阶段握手:等接收端确认 + 目标路径后才开始传数据)
    const ok = networkService.sendToDevice(deviceId, { type: "transfer-request", transferId, manifest });
    if (!ok) return { ok: false, error: "发送失败(连接已断开)" };

    // 等待接收端 transfer-accept(30s 超时;拒绝则取消)
    const accepted = await this.waitAccept(transferId);
    if (accepted === "rejected") return { ok: false, error: "对方拒绝了迁移" };
    if (accepted !== "accepted") return { ok: false, error: "等待对方确认超时" };

    // 2. 分块传输(不一次性进内存,读一块发一块;每块广播发送进度供前端进度条)
    let sentBytes = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      const buf = fs.readFileSync(f.absPath);
      const totalChunks = Math.max(1, Math.ceil(buf.length / CHUNK_SIZE));
      for (let c = 0; c < totalChunks; c++) {
        const chunk = buf.subarray(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
        const ok2 = networkService.sendToDevice(deviceId, {
          type: "transfer-chunk",
          transferId,
          fileIndex: i,
          index: c,
          total: totalChunks,
          data: chunk.toString("base64"),
        });
        if (!ok2) return { ok: false, error: "传输中断(连接断开)" };
        sentBytes += chunk.length;
        // 节流:每 ~256KB 或最后一块广播一次
        if (c % 8 === 0 || (i === files.length - 1 && c === totalChunks - 1)) {
          this.emit("send-progress", { transferId, sent: sentBytes, total });
        }
      }
    }
    networkService.sendToDevice(deviceId, { type: "transfer-complete", transferId });
    this.sentTransfers.set(transferId, projectPath);
    this.emit("send-progress", { transferId, sent: total, total, done: true });
    return { ok: true, transferId };
  }

  // ── 接收端 ──

  private async handleTransferRequest(req: { fromId: string; fromName?: string; transferId?: string; manifest?: MigrationManifest }): Promise<void> {
    if (!req.transferId || !req.manifest) return;
    this.pending.set(req.transferId, {
      transferId: req.transferId,
      fromName: req.manifest.fromName ?? req.fromName ?? "未知设备",
      peerId: req.fromId,
      manifest: req.manifest,
      chunks: [],
      receivedBytes: 0,
      targetPath: "",
    });
    // 广播给前端弹窗(用户确认接收 + 选目标路径)
    broadcast("migration:incoming", {
      transferId: req.transferId,
      fromName: req.manifest.fromName ?? req.fromName,
      projectName: req.manifest.projectName,
      fileCount: req.manifest.files.length,
      totalSize: req.manifest.files.reduce((s, f) => s + f.size, 0),
    });
  }

  /** 前端弹窗:用户确认接收 + 目标路径 */
  async acceptTransfer(transferId: string, targetPath: string): Promise<{ ok: boolean; error?: string }> {
    const t = this.pending.get(transferId);
    if (!t) return { ok: false, error: "迁移请求不存在或已过期" };
    try {
      fs.mkdirSync(targetPath, { recursive: true });
    } catch (e) {
      return { ok: false, error: `无法创建目标目录: ${(e as Error).message}` };
    }
    t.targetPath = targetPath;
    // 通知发送端开始传数据(两阶段握手)
    networkService.sendToDevice(t.peerId, { type: "transfer-accept", transferId, targetPath });
    // 若数据已全部到达(complete 先于确认):立即落位
    if (t.completeArrived) {
      await this.restoreTransfer(t);
    }
    return { ok: true };
  }

  rejectTransfer(transferId: string): void {
    const t = this.pending.get(transferId);
    if (t) networkService.sendToDevice(t.peerId, { type: "transfer-reject", transferId });
    this.pending.delete(transferId);
  }

  /** 待确认的迁移请求列表(前端弹窗恢复用) */
  listIncoming(): Array<{ transferId: string; fromName: string; projectName: string; fileCount: number; totalSize: number }> {
    return [...this.pending.values()].map((t) => ({
      transferId: t.transferId,
      fromName: t.fromName,
      projectName: t.manifest.projectName,
      fileCount: t.manifest.files.length,
      totalSize: t.manifest.files.reduce((s, f) => s + f.size, 0),
    }));
  }

  /** 接收分块(从 network-service 的消息事件接入)。扁平索引 = fileIndex×total + index,防多文件互相覆盖 */
  handleChunk(peerId: string, msg: { transferId?: string; fileIndex?: number; index?: number; total?: number; data?: string }): void {
    const t = this.pending.get(msg.transferId ?? "");
    if (!t) return;
    const flat = (msg.fileIndex ?? 0) * (msg.total ?? 1) + (msg.index ?? 0);
    t.chunks[flat] = Buffer.from(msg.data ?? "", "base64");
    t.receivedBytes += t.chunks[flat]!.length;
    broadcast("migration:progress", { transferId: msg.transferId, received: t.receivedBytes });
  }

  /** 传输完成 → 解压落位 + 校验 + 会话恢复 + 注入系统消息 + 回执。
      若用户尚未确认接收(targetPath 空):标记 completeArrived,等 acceptTransfer 时落位(两阶段握手) */
  async completeTransfer(peerId: string, msg: { transferId?: string }): Promise<void> {
    const transferId = msg.transferId ?? "";
    const t = this.pending.get(transferId);
    if (!t) return;
    if (!t.targetPath) {
      t.completeArrived = true;
      return; // 用户还没确认,等 acceptTransfer 时落位
    }
    await this.restoreTransfer(t);
  }

  /** 落位执行:校验哈希 + 写文件 + 会话恢复 + 注入系统消息 + 回执(complete 或 accept 触发) */
  private async restoreTransfer(t: PendingTransfer): Promise<void> {
    const transferId = t.transferId;
    this.pending.delete(transferId);

    // 校验哈希 + 落位(按 manifest 的 relPath;每文件块数 = ceil(size/CHUNK_SIZE),扁平索引拼接)
    let ok = true;
    const failures: string[] = [];
    for (let i = 0; i < t.manifest.files.length; i++) {
      const f = t.manifest.files[i]!;
      const totalChunks = Math.max(1, Math.ceil(f.size / CHUNK_SIZE));
      // 缺块判定:最后一文件可能不足总块数,用 size 校验而非块数
      const parts: Buffer[] = [];
      let missing = false;
      for (let c = 0; c < totalChunks; c++) {
        const chunk = t.chunks[i * totalChunks + c];
        if (!chunk) { missing = true; break; }
        parts.push(chunk);
      }
      if (missing) {
        ok = false;
        failures.push(f.relPath);
        continue;
      }
      const buf = Buffer.concat(parts);
      if (this.sha256(buf) !== f.sha256) {
        ok = false;
        failures.push(f.relPath);
        continue;
      }
      const dest = path.join(t.targetPath, f.relPath);
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
      } catch {
        ok = false;
        failures.push(f.relPath);
      }
    }
    if (!ok) {
      broadcast("migration:failed", { transferId, failures });
      networkService.sendToDevice(t.peerId, { type: "transfer-failed", transferId, failures });
      return;
    }

    // 会话恢复:改写主会话 jsonl 首行 cwd → 放入 mac 编码目录
    const targetPath = t.targetPath;
    if (t.manifest.sessionFile) {
      try {
        this.restoreSession(path.join(targetPath, t.manifest.sessionFile), targetPath);
      } catch (e) {
        console.error("[migration] 会话恢复失败:", (e as Error).message);
      }
    }

    // 注入系统消息给本机 Mint(迁移完成 + 注意事项)
    this.emit("completed", {
      transferId,
      projectName: t.manifest.projectName,
      projectPath: targetPath,
      fromName: t.fromName,
    });

    // 回执给发送端
    networkService.sendToDevice(t.peerId, {
      type: "transfer-done",
      transferId,
      projectPath: targetPath,
      projectName: t.manifest.projectName,
    });
  }

  // ── 会话恢复(核心:只改首行 cwd,放入 mac 编码目录) ──

  private restoreSession(sessionFile: string, projectPath: string): void {
    const lines = fs.readFileSync(sessionFile, "utf-8").split("\n").filter((l) => l.trim());
    if (lines.length === 0) return;
    const first = JSON.parse(lines[0]!);
    first.cwd = projectPath; // 改写为 mac 路径
    lines[0] = JSON.stringify(first);

    // mac 编码目录:~/.easymint/sessions/<projectPath.replace(/[:/\\]/g,"-")>/
    const encoded = projectPath.replace(/[:/\\]/g, "-");
    const dir = path.join(os.homedir(), ".easymint", "sessions", encoded);
    fs.mkdirSync(dir, { recursive: true });
    const fileName = path.basename(sessionFile);
    fs.writeFileSync(path.join(dir, fileName), lines.join("\n") + "\n");
  }

  // ── 辅助 ──

  private sha256File(filePath: string): string {
    const buf = fs.readFileSync(filePath);
    return this.sha256(buf);
  }

  private sha256(buf: Buffer): string {
    const crypto = require("node:crypto");
    return crypto.createHash("sha256").update(buf).digest("hex");
  }

}

/** 单例 */
export const migrationService = new MigrationService();
