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
import { getPiSessionDir } from "./pi-session";

// ── 常量 ──
const CHUNK_SIZE = 256 * 1024; // 256KB/块
const MAX_TRANSFER_SIZE = 500 * 1024 * 1024; // 单次传输上限 500MB
/** 迁移缓存目录(接收端 zip 落位,恢复成功才删) */
const MIGRATION_CACHE_DIR = path.join(os.homedir(), ".easymint", "migration-cache");

/** 扫描到的单个文件(带大小 + 排除标记——排除项可见但默认不勾选) */
export interface ScanFileItem {
  relPath: string;
  absPath: string;
  size: number;
  excluded: boolean;
}

/** 主会话条目(会话名从 jsonl 的 session_info 提取,提取失败回退文件名) */
export interface SessionItem {
  file: string;   // jsonl 文件名
  name: string;   // 会话显示名
  mtime: number;  // 修改时间(ms)
}

/** 迁移忽略规则文件(全局配置,类似 .gitignore:每行一项,# 开头为注释) */
const IGNORE_FILE = path.join(os.homedir(), ".easymint", "migration-ignore");

/** 默认忽略规则模板(首次生成写入;用户可编辑内置项;恢复默认也用它)。
    覆盖常见框架/语言排除项,按需保留或删除 */
export const DEFAULT_IGNORE_CONTENT = `# 迁移忽略项（类似 .gitignore）：每行一个文件/文件夹路径，# 开头为注释
# 支持 * 通配符（如 *.log 匹配任意 .log 文件）
# 迁移扫描时默认不勾选；迁移弹窗内仍可手动勾选；修改保存后下次扫描生效

# ── 通用：版本控制与工具目录 ──
.git
.idea
.vscode
.codegraph
.DS_Store
Thumbs.db

# ── 通用：构建产物与缓存 ──
node_modules
dist
build
temp
coverage
.eslintcache
*.tsbuildinfo

# ── 日志与临时文件 ──
*.log
*.tmp
*.swp
*~

# ── 压缩包与二进制 ──
*.apk
*.exe
*.dmg
*.zip
*.iml
*.rar
*.7z

# ── 敏感文件（默认不迁移，需要时手动勾选） ──
.env
.env.local
.env.*.local
*.pem
*.key

# ── 前端（React/Vue/Next/Vite 等） ──
.next
.nuxt
.vite
out
npm-debug.log*

# ── Python ──
__pycache__
*.pyc
.venv
venv
.pytest_cache
.mypy_cache
.ruff_cache

# ── Java / JVM ──
target
.gradle
out
*.class

# ── Go ──
bin
*.test

# ── Rust ──
target

# ── Flutter / Dart ──
.dart_tool
.packages
.flutter-plugins
.flutter-plugins-dependencies
windows/flutter/ephemeral
android/local.properties

# ── 移动端（iOS/Android） ──
Pods
DerivedData
*.ipa

# ── EasyMint 运行时数据（本机特有/可重建，不随项目迁移；run.json/issues.json/escalation.json 等项目资产保留） ──
.easymint/shell-logs
.easymint/templates
.easymint/brand-tokens
group-sessions
group-sessions.json

# ── EasyMint 项目本身（Electron 构建产物与临时文件，均可重建） ──
dist-electron
temp
`;

/** 规则匹配:精确 / * 通配符(转正则) / 多段路径前缀 / 单段目录或文件任意层级(gitignore 语义) */
function matchRule(rel: string, rule: string): boolean {
  if (rel === rule) return true;
  if (rule.includes("*")) {
    const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^${rule.split("*").map(esc).join(".*")}$`);
    return re.test(rel);
  }
  if (rule.includes("/")) {
    // 多段路径:目录前缀匹配(如 .easymint/shell-logs 匹配其内部全部)
    return rel.startsWith(rule + "/") || rel.endsWith(rule);
  }
  // 单段:任意层级的同名目录或文件(如 dist、node_modules 出现在子目录也排除)
  return rel.split("/").includes(rule) || rel.endsWith(rule);
}

/** 读取忽略规则文件原始内容(不存在 → 生成默认模板并写入) */
export function readIgnoreFileRaw(): string {
  try {
    return fs.readFileSync(IGNORE_FILE, "utf-8");
  } catch {
    try {
      fs.mkdirSync(path.dirname(IGNORE_FILE), { recursive: true });
      fs.writeFileSync(IGNORE_FILE, DEFAULT_IGNORE_CONTENT);
    } catch { /* 写入失败则返回模板 */ }
    return DEFAULT_IGNORE_CONTENT;
  }
}

/** 保存忽略规则文件(全量覆盖) */
export function saveIgnoreFileRaw(content: string): void {
  fs.mkdirSync(path.dirname(IGNORE_FILE), { recursive: true });
  fs.writeFileSync(IGNORE_FILE, content.endsWith("\n") ? content : content + "\n");
}

/** 从原始内容解析规则(忽略空行/注释) */
function parseIgnoreRules(content: string): string[] {
  return content.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

/** 扫描结果:待传文件(含排除标记) + 全部主会话(不含 subagents/) */
export interface ScanResult {
  files: ScanFileItem[];
  sessions: SessionItem[];
  /** 未排除文件总大小(byte) */
  totalSize: number;
  excludedCount: number;
}

/** 从 jsonl 提取会话名(session_info.name)——取最后一个(最近会话名)。
    session_info 在文件中部(每次会话段开头),读前 1MB 覆盖绝大多数;找不到回退空 */
function extractSessionName(filePath: string): string {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(1024 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    let last = "";
    for (const line of buf.subarray(0, n).toString("utf-8").split("\n")) {
      try {
        const obj = JSON.parse(line) as { type?: string; name?: string };
        if (obj?.type === "session_info" && typeof obj.name === "string" && obj.name) last = obj.name;
      } catch { /* 跳过非 JSON 行 */ }
    }
    return last;
  } catch { /* 提取失败,回退文件名 */ }
  return "";
}

// ── 类型 ──
export interface MigrationManifest {
  fromName: string;          // 发送端设备名
  projectName: string;       // 项目名
  /** 发送端项目绝对路径(迁移通知模板引用旧路径) */
  originPath: string;
  zipName: string;           // zip 文件名
  zipSize: number;           // zip 字节数
  zipSha256: string;         // zip 哈希(接收端校验)
  /** 项目文件预期数(接收端解压后对比,完整性校验) */
  fileCount: number;
  /** 会话 jsonl 文件名列表(接收端必须全部恢复成功) */
  sessionFiles: string[];
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
  /** 发送端记录:transferId → { manifest(完整性校验), projectPath(回执定位项目注入系统消息) } */
  private sentTransfers = new Map<string, { manifest: MigrationManifest; projectPath: string }>();
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

  /** 扫描项目:按全局忽略规则(内置默认 + 用户编辑)收集全部文件(带 excluded 标记) + 全部主会话 jsonl(含名称/时间,不含 subagents/) */
  scanProject(projectPath: string): ScanResult {
    const root = path.resolve(projectPath);
    const files: ScanFileItem[] = [];
    const ignoreRules = parseIgnoreRules(readIgnoreFileRaw());
    const isExcluded = (rel: string): boolean =>
      ignoreRules.some((x) => matchRule(rel, x));
    const walk = (dir: string, prefix: string): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        const excluded = isExcluded(rel);
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full, rel);
        } else if (e.isFile()) {
          let size = 0;
          try { size = fs.statSync(full).size; } catch { /* 跳过不可读文件 */ }
          files.push({ relPath: rel, absPath: full, size, excluded });
        }
      }
    };
    walk(root, "");
    // 全部主会话(编码目录根下 jsonl,不含 subagents/ 子会话)——按修改时间倒序(最新在前)
    const sessions: SessionItem[] = [];
    try {
      const dir = getPiSessionDir(root);
      const names = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
      for (const name of names) {
        const abs = path.join(dir, name);
        let mtime = 0;
        try { mtime = fs.statSync(abs).mtimeMs; } catch { continue; }
        sessions.push({ file: name, name: extractSessionName(abs) || name, mtime });
      }
      sessions.sort((a, b) => b.mtime - a.mtime);
    } catch { /* 无会话 */ }
    const noneExcluded = files.filter((f) => !f.excluded);
    return {
      files,
      sessions,
      totalSize: noneExcluded.reduce((s, f) => s + f.size, 0),
      excludedCount: files.length - noneExcluded.length,
    };
  }

  // ── 发送端 ──

  /** 统一入口:扫描 → 按选中清单打包 zip → 两阶段握手 → 分块传输。
      selection 缺省时全量(排除规则内仍打包,保持向后兼容)。
      MCP 工具与手动入口都调此方法(不分开写) */
  async prepareAndTransfer(
    projectPath: string,
    deviceId: string,
    selection?: { files: string[]; sessions: string[] },
  ): Promise<{ ok: boolean; transferId?: string; error?: string }> {
    const peer = networkService.listPaired().find((p) => p.id === deviceId);
    if (!peer?.online) return { ok: false, error: "目标设备不在线" };

    // 1. 统一扫描 + 按选中清单过滤
    this.emit("send-progress", { transferId: "", sent: 0, total: 0, phase: "scanning" });
    const scan = this.scanProject(projectPath);
    const selectedFiles = selection
      ? scan.files.filter((f) => selection.files.includes(f.relPath))
      : scan.files;
    const selectedSessions = selection
      ? scan.sessions.filter((s) => selection.sessions.includes(s.file))
      : scan.sessions;
    if (selectedFiles.length === 0) return { ok: false, error: "未选择可迁移文件——请确认勾选内容" };

    // 2. 打包 zip(仅选中文件 + 选中会话,前缀 .easymint-session/ 区分,接收端识别)
    const transferId = `t${Date.now()}-${this.nextId++}`;
    const projectName = path.basename(path.resolve(projectPath));
    // win 文件系统不允许 \/:*?"<>| —— zip 文件名需 sanitize(与接收端 safeName 同一规则)
    const safeName = projectName.replace(/[\\/:*?"<>|]/g, "_").trim() || "migrated-project";
    const zipName = `${safeName}-${transferId}.zip`;
    const zipPath = path.join(MIGRATION_CACHE_DIR, zipName);
    // 完整性校验:选中会话已声明但文件缺失 → 打包失败(不静默跳过)
    const missingSessions = selectedSessions.filter((s) => {
      const sessionAbs = path.join(getPiSessionDir(path.resolve(projectPath)), s.file);
      return !fs.existsSync(sessionAbs);
    });
    if (missingSessions.length > 0) {
      return { ok: false, error: `会话文件缺失: ${missingSessions.map((s) => s.file).join(", ")}——打包失败` };
    }
    this.emit("send-progress", { transferId, sent: 0, total: 0, phase: "packing" });
    try {
      fs.mkdirSync(MIGRATION_CACHE_DIR, { recursive: true });
      await this.buildZip(selectedFiles, selectedSessions.map((s) => s.file), zipPath, projectPath);
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
      originPath: path.resolve(projectPath),
      zipName,
      zipSize,
      zipSha256,
      fileCount: selectedFiles.length,
      sessionFiles: selectedSessions.map((s) => s.file),
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
    this.sentTransfers.set(transferId, { manifest, projectPath });
    this.emit("send-progress", { transferId, sent: zipSize, total: zipSize, phase: "sent" });
    return { ok: true, transferId };
  }

  /** 打包 zip:选中的项目文件(相对项目根) + 选中的会话文件(前缀 .easymint-session/) */
  private buildZip(files: ScanFileItem[], sessionFiles: string[], zipPath: string, projectPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = new ZipArchive({ zlib: { level: 6 } });
      output.on("close", () => resolve());
      archive.on("error", (e?: Error) => reject(e ?? new Error("zip 打包失败")));
      archive.pipe(output);
      // 项目文件:相对项目根
      for (const f of files) {
        archive.file(f.absPath, { name: f.relPath });
      }
      // 会话文件:.easymint-session/ 前缀(接收端识别并恢复)
      // 注意:编码必须用真实项目路径(与 scanProject 一致)——用 projectName 会解析成
      // 当前工作目录下的路径,会话目录编码错误 → 文件找不到 → 没打进 zip(实测踩坑)
      const sessionDir = getPiSessionDir(path.resolve(projectPath));
      for (const name of sessionFiles) {
        const sessionAbs = path.join(sessionDir, name);
        if (fs.existsSync(sessionAbs)) {
          archive.file(sessionAbs, { name: `.easymint-session/${name}` });
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
      case "transfer-done": {
        // 发送端收到回执 → 完整性确认(双重确认,接收端异常会带 failed 而非 done):
        // ① 恢复文件数 === 发送文件数 ② 声明的会话必须全部恢复成功
        const rec = this.sentTransfers.get(msg.transferId as string);
        const m = rec?.manifest;
        const restoredCount = Number(msg.restoredCount ?? -1);
        const sessionRestoredCount = Number(msg.sessionRestoredCount ?? -1);
        const countOk = m ? restoredCount === m.fileCount : false;
        const sessionOk = m ? (m.sessionFiles.length > 0 ? sessionRestoredCount === m.sessionFiles.length : true) : false;
        if (m && !(countOk && sessionOk)) {
          // 完整性不一致 → 按失败处理
          const why = !countOk ? `文件数不匹配(回执 ${restoredCount}/${m.fileCount})` : `会话未全部恢复(${sessionRestoredCount}/${m.sessionFiles.length})`;
          this.emit("failed", { peerId, projectPath: rec?.projectPath, failures: [`接收端完整性校验未通过: ${why}`] });
          break;
        }
        this.emit("done", { peerId, projectPath: rec?.projectPath, ...msg });
        break;
      }
      case "transfer-failed":
        this.emit("failed", { peerId, projectPath: this.sentTransfers.get(msg.transferId as string)?.projectPath, ...msg });
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
      sessionCount: req.manifest.sessionFiles?.length ?? 0,
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
    let extractedCount = 0;
    try {
      extractedCount = await this.extractZip(cacheZip, t.targetPath, extractFailures);
    } catch (e) {
      extractFailures.push(`解压失败: ${(e as Error).message}`);
    }
    // 完整性:解压文件数必须等于 manifest 预期数(多/少都异常)
    if (extractedCount !== t.manifest.fileCount) {
      extractFailures.push(`项目文件数不匹配: 预期 ${t.manifest.fileCount} 个,实际解压 ${extractedCount} 个`);
    }

    // 4. 会话恢复:从 zip 的 .easymint-session/ 里恢复(若 zip 内有)
    broadcast("migration:stage", { transferId, stage: "session" });
    let sessionRestoredCount = 0;
    try {
      sessionRestoredCount = await this.restoreSessionsFromZip(cacheZip, t.targetPath);
    } catch (e) {
      console.error("[migration] 会话恢复失败:", (e as Error).message);
    }
    // 完整性:zip 里声明了会话但恢复数量不符 → 解包失败
    if (t.manifest.sessionFiles.length > 0 && sessionRestoredCount !== t.manifest.sessionFiles.length) {
      extractFailures.push(`会话恢复不完整: 预期 ${t.manifest.sessionFiles.length} 个,实际恢复 ${sessionRestoredCount} 个`);
    }

    if (extractFailures.length > 0) {
      // 解压失败:保留缓存包供排查
      broadcast("migration:failed", { transferId, failures: extractFailures });
      networkService.sendToDevice(t.peerId, { type: "transfer-failed", transferId, failures: extractFailures });
      return;
    }

    // 5. 全部成功 → 删除缓存 zip
    fs.rmSync(cacheZip, { force: true });
    broadcast("migration:stage", { transferId, stage: "done", sessionRestoredCount });

    // 6. 通知前端(展示迁移完成卡片 + 复制模板文案) + 回执
    this.emit("completed", {
      transferId,
      projectName: t.manifest.projectName,
      projectPath: t.targetPath,
      originPath: t.manifest.originPath,
      fromName: t.fromName,
      sessionRestoredCount,
    });
    // 回执带完整性数据:发送端据此确认恢复成功(文件数 + 会话恢复数量)
    networkService.sendToDevice(t.peerId, {
      type: "transfer-done",
      transferId,
      projectPath: t.targetPath,
      projectName: t.manifest.projectName,
      restoredCount: extractedCount,
      sessionRestoredCount,
    });
  }

  /** 解压 zip 到目标目录(路径安全:拒绝绝对路径/../ 穿越条目)。返回解压的项目文件数 */
  private async extractZip(zipPath: string, targetDir: string, failures: string[]): Promise<number> {
    let fileCount = 0;
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
          fileCount++;
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          entry.pipe(fs.createWriteStream(dest));
        })
        .on("error", (e) => reject(e))
        .on("close", () => resolve());
    });
    return fileCount;
  }

  /** 从 zip 恢复全部会话:读取 .easymint-session/*.jsonl → 改写 cwd → 放入全局 sessions 目录。返回恢复成功数量 */
  private async restoreSessionsFromZip(zipPath: string, projectPath: string): Promise<number> {
    let restoredCount = 0;
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
                // 恢复成功 = 落盘 + 验证(文件存在且首行 cwd 为项目路径)——不满足不算成功
                if (this.restoreSession(buf, rel.split("/").pop()!, projectPath)) restoredCount++;
              } catch { /* 恢复失败 */ }
            });
          } else {
            entry.autodrain();
          }
        })
        .on("close", () => resolve());
    });
    return restoredCount;
  }

  /** 会话恢复:改写首行 cwd 为项目路径 → 写入全局 sessions 编码目录。
      返回 true 仅当:文件成功写入 且 存在 且 首行 cwd 正确(硬性保证会话文件有) */
  private restoreSession(content: Buffer, fileName: string, projectPath: string): boolean {
    const lines = content.toString("utf-8").split("\n").filter((l) => l.trim());
    if (lines.length === 0) return false;
    const first = JSON.parse(lines[0]!);
    first.cwd = projectPath;
    lines[0] = JSON.stringify(first);
    const dir = getPiSessionDir(projectPath);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, fileName);
    fs.writeFileSync(dest, lines.join("\n") + "\n");
    // 验证落盘 + cwd 正确(JSON.parse 比较——字符串 includes 会被反斜杠转义误判,
    // Windows 路径 D:\x → 文件里是 D:\\x,includes 匹配不上 → 文件在了却报失败,实测踩坑)
    try {
      const written = JSON.parse(fs.readFileSync(dest, "utf-8").split("\n")[0]!);
      return fs.existsSync(dest) && written.cwd === projectPath;
    } catch {
      return false;
    }
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
