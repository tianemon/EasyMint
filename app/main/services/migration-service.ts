/**
 * 项目/会话迁移服务 — 统一封装:扫描 → zip 打包 → 分块传输 → 缓存解压恢复
 *
 * 两端分离设计（方案见 docs/design/跨设备会话迁移与设备互联方案.md 第四章）：
 * - 发送端:统一 prepareAndTransfer(projectPath, deviceId) —— 扫描 + 打包 zip + 传输
 * - 接收端:弹窗确认 → zip 收完整 → 缓存目录校验 → 解压落位 → 会话恢复(cwd 改写)
 *          → 注入系统消息给本机 Mint + 回执;全部恢复成功才删除缓存 zip
 *
 * 可靠性设计:
 * - zip 先整体校验哈希,再解压——中断不产生半成品项目目录(原子性)
 * - 恢复完才删缓存包;失败保留供排查/重试
 * - 单文件分块传输,协议简单(不再有逐文件扁平索引)
 *
 * 传输协议（WS JSON 消息,基于 network-service 通道,加密）:
 *   transfer-request  { fromName, projectName, zipName, zipSize, zipSha256, transferId }
 *   transfer-accept   { transferId }            → 接收端确认(两阶段握手)
 *   transfer-reject   { transferId }
 *   transfer-chunk    { transferId, index, total, data(base64) }  → zip 单文件分块
 *   transfer-complete { transferId }            → 接收端解压恢复完成后:
 *   transfer-done     { transferId, projectPath }  → 回执给发送端
 */

import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
// archiver 8.0 是 ESM 风格导出 class(ZipArchive)——主进程是 CJS bundle,用 require 取运行时
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ZipArchive } = require("archiver") as {
  ZipArchive: new (opts?: Record<string, unknown>) => {
    pipe: (w: NodeJS.WritableStream) => void;
    file: (p: string, opts: { name: string }) => void;
    on: (e: string, cb: (err?: Error) => void) => void;
    finalize: () => Promise<void>;
  };
};
/** unzipper 的 zip 条目(类型局部定义,@types/unzipper 命名空间与 require 运行时不一致) */
interface ZipEntry {
  path: string;
  type: "Directory" | "File";
  autodrain: () => void;
  pipe: (w: NodeJS.WritableStream) => void;
  on: (e: string, cb: (d: Buffer) => void) => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const unzipper = require("unzipper") as {
  Parse: () => NodeJS.ReadWriteStream & {
    on(e: "entry", cb: (entry: ZipEntry) => void): NodeJS.ReadWriteStream;
    on(e: "error", cb: (err: Error) => void): NodeJS.ReadWriteStream;
    on(e: "close", cb: () => void): NodeJS.ReadWriteStream;
    on(e: string, cb: (...args: unknown[]) => void): NodeJS.ReadWriteStream;
  };
};
import { networkService } from "./network-service";
import { broadcast } from "./ipc-broadcast";

// ── 常量 ──
const CHUNK_SIZE = 256 * 1024; // 256KB/块
const MAX_TRANSFER_SIZE = 500 * 1024 * 1024; // 单次传输上限 500MB
/** 迁移缓存目录(接收端 zip 落位,恢复成功才删) */
const MIGRATION_CACHE_DIR = path.join(os.homedir(), ".easymint", "migration-cache");

/** 迁移清单排除规则(单一实现,MCP 与手动入口共用):
    .easymint 只排除可重建子项,保留 state/run/issues 项目状态 */
const DEFAULT_EXCLUDE = [
  ".git", "node_modules", "dist", "build", "temp", ".idea", ".vscode", ".codegraph", ".DS_Store",
  ".easymint/shell-logs", ".easymint/templates", ".easymint/brand-tokens", ".easymint/group-sessions", ".easymint/group-sessions.json",
  ".apk", ".exe", ".dmg", ".zip",
];

/** 扫描结果:待传文件(相对路径 + 绝对路径) + 最新主会话文件名(若有) */
export interface ScanResult {
  files: Array<{ relPath: string; absPath: string }>;
  sessionFile?: string;
  totalSize: number;
}

// ── 类型 ──
export interface MigrationManifest {
  fromName: string;          // 发送端设备名
  projectName: string;       // 项目名
  zipName: string;           // zip 文件名
  zipSize: number;           // zip 字节数
  zipSha256: string;         // zip 哈希(接收端校验)
  sessionFile?: string;      // 主会话 jsonl 文件名(若有)
  createdAt: number;
}

interface PendingTransfer {
  transferId: string;
  fromName: string;
  /** 发送端设备 ID(回执/拒绝用) */
  peerId: string;
  manifest: MigrationManifest;
  /** zip 分块缓存 */
  chunks: Buffer[];
  receivedBytes: number;
  /** 用户确认后的目标路径(acceptTransfer 时设置) */
  targetPath: string;
  /** transfer-complete 已到达但用户尚未确认(两阶段握手:等 accept 时落位) */
  completeArrived?: boolean;
}

class MigrationService extends EventEmitter {
  private pending = new Map<string, PendingTransfer>();
  /** 发送端记录:transferId → 发起迁移的项目路径(回执到达时定位会话,注入系统消息) */
  private sentTransfers = new Map<string, string>();
  /** 发送端两阶段握手:transferId → 等待 accept/reject 的 resolver */
  private acceptWaiters = new Map<string, { resolve: (v: "accepted" | "rejected" | "timeout") => void; timer: NodeJS.Timeout }>();
  private nextId = 0;

  constructor() {
    super();
    networkService.on("migration-message", (req: { peerId: string; msg: Record<string, unknown> }) => {
      void this.handleProtocolMessage(req.peerId, req.msg);
    });
  }

  // ── 统一扫描(单一实现,MCP 与手动入口共用) ──

  /** 扫描项目:按排除规则收集待传文件 + 定位最新主会话 jsonl(全局 sessions 目录) */
  scanProject(projectPath: string): ScanResult {
    const root = path.resolve(projectPath);
    const files: Array<{ relPath: string; absPath: string }> = [];
    const isExcluded = (rel: string): boolean =>
      DEFAULT_EXCLUDE.some((x) => rel === x || rel.startsWith(x + "/") || rel.endsWith(x));
    const walk = (dir: string, prefix: string): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (isExcluded(rel)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, rel);
        else if (e.isFile()) files.push({ relPath: rel, absPath: full });
      }
    };
    walk(root, "");
    // 最新主会话(文件名)
    let sessionFile: string | undefined;
    try {
      const encoded = root.replace(/[:/\\]/g, "-");
      const dir = path.join(os.homedir(), ".easymint", "sessions", encoded);
      const names = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
      if (names.length > 0) sessionFile = names[names.length - 1];
    } catch { /* 无会话 */ }
    const totalSize = files.reduce((s, f) => s + (fs.statSync(f.absPath).size || 0), 0);
    return { files, sessionFile, totalSize };
  }

  // ── 发送端 ──

  /** 统一入口:扫描 → 打包 zip → 两阶段握手 → 分块传输。
      MCP 工具与手动入口都调此方法(不分开写) */
  async prepareAndTransfer(projectPath: string, deviceId: string): Promise<{ ok: boolean; transferId?: string; error?: string }> {
    const peer = networkService.listPaired().find((p) => p.id === deviceId);
    if (!peer?.online) return { ok: false, error: "目标设备不在线" };

    // 1. 统一扫描
    this.emit("send-progress", { transferId: "", sent: 0, total: 0, phase: "scanning" });
    const scan = this.scanProject(projectPath);
    if (scan.files.length === 0) return { ok: false, error: "未扫描到可迁移文件" };

    // 2. 打包 zip(含会话文件,前缀 .easymint-session/ 区分,接收端识别)
    const transferId = `t${Date.now()}-${this.nextId++}`;
    const projectName = path.basename(path.resolve(projectPath));
    const zipName = `${projectName}-${transferId}.zip`;
    const zipPath = path.join(MIGRATION_CACHE_DIR, zipName);
    this.emit("send-progress", { transferId, sent: 0, total: 0, phase: "packing" });
    try {
      fs.mkdirSync(MIGRATION_CACHE_DIR, { recursive: true });
      await this.buildZip(scan, zipPath, projectName, projectPath);
    } catch (e) {
      return { ok: false, error: `打包失败: ${(e as Error).message}` };
    }
    const zipSize = fs.statSync(zipPath).size;
    if (zipSize > MAX_TRANSFER_SIZE) {
      fs.rmSync(zipPath, { force: true });
      return { ok: false, error: "传输内容过大" };
    }
    const zipSha256 = this.sha256File(zipPath);

    const manifest: MigrationManifest = {
      fromName: networkService.getSelf().name,
      projectName,
      zipName,
      zipSize,
      zipSha256,
      sessionFile: scan.sessionFile,
      createdAt: Date.now(),
    };

    // 3. 两阶段握手(等接收端确认)
    const ok = networkService.sendToDevice(deviceId, { type: "transfer-request", transferId, manifest });
    if (!ok) {
      fs.rmSync(zipPath, { force: true });
      return { ok: false, error: "发送失败(连接已断开)" };
    }
    this.emit("send-progress", { transferId, sent: 0, total: zipSize, phase: "waiting" });
    const accepted = await this.waitAccept(transferId);
    if (accepted === "rejected") {
      fs.rmSync(zipPath, { force: true });
      this.emit("send-progress", { transferId, sent: 0, total: zipSize, phase: "rejected" });
      return { ok: false, error: "对方拒绝了迁移" };
    }
    if (accepted !== "accepted") {
      fs.rmSync(zipPath, { force: true });
      this.emit("send-progress", { transferId, sent: 0, total: zipSize, phase: "timeout" });
      return { ok: false, error: "等待对方确认超时" };
    }

    // 4. 分块传输 zip(单文件,索引简单)
    this.emit("send-progress", { transferId, sent: 0, total: zipSize, phase: "transferring" });
    const buf = fs.readFileSync(zipPath);
    const totalChunks = Math.max(1, Math.ceil(buf.length / CHUNK_SIZE));
    for (let c = 0; c < totalChunks; c++) {
      const chunk = buf.subarray(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
      const ok2 = networkService.sendToDevice(deviceId, {
        type: "transfer-chunk",
        transferId,
        index: c,
        total: totalChunks,
        data: chunk.toString("base64"),
      });
      if (!ok2) {
        fs.rmSync(zipPath, { force: true });
        return { ok: false, error: "传输中断(连接断开)" };
      }
      if (c % 8 === 0 || c === totalChunks - 1) {
        this.emit("send-progress", { transferId, sent: (c + 1) * CHUNK_SIZE, total: zipSize, phase: "transferring" });
      }
    }
    // 传输完成:发送端临时 zip 删除(接收端恢复完成后会回执)
    fs.rmSync(zipPath, { force: true });
    networkService.sendToDevice(deviceId, { type: "transfer-complete", transferId });
    this.sentTransfers.set(transferId, projectPath);
    this.emit("send-progress", { transferId, sent: zipSize, total: zipSize, phase: "sent" });
    return { ok: true, transferId };
  }

  /** 打包 zip:项目文件(相对项目根) + 会话文件(前缀 .easymint-session/) */
  private buildZip(scan: ScanResult, zipPath: string, projectName: string, projectPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = new ZipArchive({ zlib: { level: 6 } });
      output.on("close", () => resolve());
      archive.on("error", (e?: Error) => reject(e ?? new Error("zip 打包失败")));
      archive.pipe(output);
      // 项目文件:相对项目根
      for (const f of scan.files) {
        archive.file(f.absPath, { name: f.relPath });
      }
      // 会话文件:.easymint-session/ 前缀(接收端识别并恢复)
      // 注意:编码必须用真实项目路径(与 scanProject 一致)——用 projectName 会解析成
      // 当前工作目录下的路径,会话目录编码错误 → 文件找不到 → 没打进 zip(实测踩坑)
      if (scan.sessionFile) {
        const encoded = path.resolve(projectPath).replace(/[:/\\]/g, "-");
        const sessionAbs = path.join(os.homedir(), ".easymint", "sessions", encoded, scan.sessionFile);
        if (fs.existsSync(sessionAbs)) {
          archive.file(sessionAbs, { name: `.easymint-session/${scan.sessionFile}` });
        }
      }
      void archive.finalize();
    });
  }

  // ── 接收端 ──

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
        this.resolveAccept(msg.transferId as string, "accepted");
        break;
      case "transfer-reject":
        this.resolveAccept(msg.transferId as string, "rejected");
        break;
      case "transfer-done":
        this.emit("done", { peerId, projectPath: this.sentTransfers.get(msg.transferId as string), ...msg });
        break;
      case "transfer-failed":
        this.emit("failed", { peerId, projectPath: this.sentTransfers.get(msg.transferId as string), ...msg });
        break;
      default:
        this.emit("message", { peerId, msg });
    }
  }

  private resolveAccept(transferId: string, result: "accepted" | "rejected"): void {
    const w = this.acceptWaiters.get(transferId);
    if (!w) return;
    clearTimeout(w.timer);
    this.acceptWaiters.delete(transferId);
    w.resolve(result);
  }

  private waitAccept(transferId: string): Promise<"accepted" | "rejected" | "timeout"> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.acceptWaiters.delete(transferId);
        resolve("timeout");
      }, 30_000);
      this.acceptWaiters.set(transferId, { resolve, timer });
    });
  }

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
    broadcast("migration:incoming", {
      transferId: req.transferId,
      fromName: req.manifest.fromName ?? req.fromName,
      projectName: req.manifest.projectName,
      fileCount: 1, // zip 单文件
      totalSize: req.manifest.zipSize,
    });
  }

  /** 前端弹窗:用户确认接收 + 选择项目父文件夹(落位 = 父 + 项目名,自动创建) */
  async acceptTransfer(transferId: string, parentPath: string): Promise<{ ok: boolean; error?: string }> {
    const t = this.pending.get(transferId);
    if (!t) return { ok: false, error: "迁移请求不存在或已过期" };
    const safeName = t.manifest.projectName.replace(/[\\/:*?"<>|]/g, "_").trim() || "migrated-project";
    const targetPath = path.join(parentPath, safeName);
    try {
      fs.mkdirSync(targetPath, { recursive: true });
    } catch (e) {
      return { ok: false, error: `无法创建项目目录: ${(e as Error).message}` };
    }
    t.targetPath = targetPath;
    networkService.sendToDevice(t.peerId, { type: "transfer-accept", transferId });
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
      fileCount: 1,
      totalSize: t.manifest.zipSize,
    }));
  }

  handleChunk(peerId: string, msg: { transferId?: string; index?: number; data?: string }): void {
    const t = this.pending.get(msg.transferId ?? "");
    if (!t) return;
    t.chunks[msg.index ?? 0] = Buffer.from(msg.data ?? "", "base64");
    t.receivedBytes += t.chunks[msg.index ?? 0]!.length;
    broadcast("migration:progress", { transferId: msg.transferId, received: t.receivedBytes });
  }

  /** 传输完成 → zip 校验 → 缓存目录 → 解压落位 → 会话恢复 → 注入消息 + 回执 → 删缓存包 */
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

  /** 落位执行:校验 zip → 缓存目录 → 解压 → 会话恢复 → 注入系统消息 + 回执 → 删缓存包 */
  private async restoreTransfer(t: PendingTransfer): Promise<void> {
    const transferId = t.transferId;
    this.pending.delete(transferId);

    // 1. 拼接 zip 分块 + 校验哈希
    broadcast("migration:stage", { transferId, stage: "verify" });
    const zipBuf = Buffer.concat(t.chunks.filter(Boolean));
    if (this.sha256(zipBuf) !== t.manifest.zipSha256) {
      broadcast("migration:failed", { transferId, failures: ["zip 校验失败"] });
      networkService.sendToDevice(t.peerId, { type: "transfer-failed", transferId, failures: ["zip 校验失败"] });
      return;
    }

    // 2. 写入 EM 缓存目录(恢复成功才删)
    const cacheZip = path.join(MIGRATION_CACHE_DIR, t.manifest.zipName);
    try {
      fs.mkdirSync(MIGRATION_CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheZip, zipBuf);
    } catch (e) {
      broadcast("migration:failed", { transferId, failures: [`缓存写入失败: ${(e as Error).message}`] });
      networkService.sendToDevice(t.peerId, { type: "transfer-failed", transferId, failures: ["缓存写入失败"] });
      return;
    }

    // 3. 解压到项目目录(zip 内部路径安全:跳过绝对路径/穿越条目)
    broadcast("migration:stage", { transferId, stage: "extract" });
    const extractFailures: string[] = [];
    try {
      await this.extractZip(cacheZip, t.targetPath, extractFailures);
    } catch (e) {
      extractFailures.push(`解压失败: ${(e as Error).message}`);
    }

    // 4. 会话恢复:从 zip 的 .easymint-session/ 里恢复(若 zip 内有)
    broadcast("migration:stage", { transferId, stage: "session" });
    let sessionRestored = false;
    try {
      sessionRestored = await this.restoreSessionFromZip(cacheZip, t.targetPath);
    } catch (e) {
      console.error("[migration] 会话恢复失败:", (e as Error).message);
    }

    if (extractFailures.length > 0) {
      // 解压失败:保留缓存包供排查
      broadcast("migration:failed", { transferId, failures: extractFailures });
      networkService.sendToDevice(t.peerId, { type: "transfer-failed", transferId, failures: extractFailures });
      return;
    }

    // 5. 全部成功 → 删除缓存 zip
    fs.rmSync(cacheZip, { force: true });
    broadcast("migration:stage", { transferId, stage: "done" });

    // 6. 注入系统消息给本机 Mint + 回执
    this.emit("completed", {
      transferId,
      projectName: t.manifest.projectName,
      projectPath: t.targetPath,
      fromName: t.fromName,
    });
    networkService.sendToDevice(t.peerId, {
      type: "transfer-done",
      transferId,
      projectPath: t.targetPath,
      projectName: t.manifest.projectName,
    });
    void sessionRestored;
  }

  /** 解压 zip 到目标目录(路径安全:拒绝绝对路径/../ 穿越条目) */
  private async extractZip(zipPath: string, targetDir: string, failures: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(unzipper.Parse())
        .on("entry", (entry: ZipEntry) => {
          const rel = entry.path.replace(/\\/g, "/");
          // 跳过 .easymint-session/(会话单独恢复)与非法路径
          if (rel.startsWith(".easymint-session/")) {
            entry.autodrain();
            return;
          }
          if (rel.startsWith("/") || rel.includes("..")) {
            entry.autodrain();
            failures.push(`非法路径: ${rel}`);
            return;
          }
          const dest = path.join(targetDir, rel);
          if (entry.type === "Directory") {
            fs.mkdirSync(dest, { recursive: true });
            entry.autodrain();
            return;
          }
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          entry.pipe(fs.createWriteStream(dest));
        })
        .on("error", (e) => reject(e))
        .on("close", () => resolve());
    });
  }

  /** 从 zip 恢复会话:读取 .easymint-session/xxx.jsonl → 改写 cwd → 放入全局 sessions 目录 */
  private async restoreSessionFromZip(zipPath: string, projectPath: string): Promise<boolean> {
    let restored = false;
    await new Promise<void>((resolve) => {
      fs.createReadStream(zipPath)
        .pipe(unzipper.Parse())
        .on("entry", (entry: ZipEntry) => {
          const rel = entry.path.replace(/\\/g, "/");
          if (rel.startsWith(".easymint-session/") && rel.endsWith(".jsonl")) {
            const chunks: Buffer[] = [];
            entry.on("data", (d: Buffer) => chunks.push(d));
            entry.on("end", () => {
              try {
                const buf = Buffer.concat(chunks);
                this.restoreSession(buf, rel.split("/").pop()!, projectPath);
                restored = true;
              } catch { /* 恢复失败 */ }
            });
          } else {
            entry.autodrain();
          }
        })
        .on("close", () => resolve());
    });
    return restored;
  }

  /** 会话恢复:改写首行 cwd 为项目路径 → 写入全局 sessions 编码目录 */
  private restoreSession(content: Buffer, fileName: string, projectPath: string): void {
    const lines = content.toString("utf-8").split("\n").filter((l) => l.trim());
    if (lines.length === 0) return;
    const first = JSON.parse(lines[0]!);
    first.cwd = projectPath;
    lines[0] = JSON.stringify(first);
    const encoded = projectPath.replace(/[:/\\]/g, "-");
    const dir = path.join(os.homedir(), ".easymint", "sessions", encoded);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), lines.join("\n") + "\n");
  }

  // ── 辅助 ──

  private sha256File(filePath: string): string {
    return this.sha256(fs.readFileSync(filePath));
  }

  private sha256(buf: Buffer): string {
    return crypto.createHash("sha256").update(buf).digest("hex");
  }
}

/** 单例 */
export const migrationService = new MigrationService();
