import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { getPiConfigSdk } from "./pi-config-sdk";
import { getModelRuntimeClass } from "./pi-sdk";

export type JsonObject = Record<string, any>;
const require = createRequire(path.join(__dirname, "native-config-storage.cjs"));
const lockfile = require("proper-lockfile") as {
  lockSync(file: string, options: { realpath: boolean; stale: number }): () => void;
};

/** Shared by native transactions and ordinary EM settings/project writes, including other app processes. */
// Atomics.wait 是真·同步休眠（主线程可用，不需要 worker）：同步 API 下没法 await，
// 忙等（while 自旋）会在锁竞争时烧 CPU 并占住事件循环，锁持有者还会被拖慢。
const lockSleeper = new Int32Array(new SharedArrayBuffer(4));
export function lockConfigDirectory(dataDir: string): () => void {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return lockfile.lockSync(dataDir, { realpath: true, stale: 30_000 });
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED" || attempt === 9) throw error;
      // Settings writes are synchronous throughout Store. Keep the retry bounded so callers do
      // not need a second async API merely to coordinate two desktop processes.
      Atomics.wait(lockSleeper, 0, 0, 20);
    }
  }
  throw lastError;
}
export const encode = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export function readText(file: string): string | null {
  try { return fs.readFileSync(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, "wx", 0o600);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}

/** 备份目录保留数量（含本次刚建的那个）。为什么要设上限见 `NativeConfigStorage.pruneBackups`。 */
const KEEP_BACKUPS = 20;

interface Change { file: string; before: string | null; after: string }
interface Journal { version: 1; changes: Change[]; backup: string }

/** Multi-file writes are recoverable. The journal is durable before the first change;
 * completion is durable before it is removed. Interrupted writes roll back on startup.
 * Never overwrite a file changed independently since the transaction began. */
export class NativeConfigStorage {
  readonly agentDir: string;
  private sdk: any;
  constructor(readonly dataDir: string) { this.agentDir = path.join(dataDir, "agent"); }
  async initialize(): Promise<void> {
    this.sdk = await getPiConfigSdk();
    const release = lockConfigDirectory(this.dataDir);
    try {
      const journal = readText(this.journalPath);
      if (journal) await this.rollback(JSON.parse(journal));
    } finally { release(); }
  }
  assertReady(): void {
    if (readText(this.journalPath) !== null) throw new Error("存在未完成的配置事务，请重启并先完成恢复");
  }
  private get journalPath() { return path.join(this.dataDir, "native-config-transaction.json"); }
  read(file: string): JsonObject {
    const text = readText(file);
    if (text === null) return {};
    let value: unknown;
    try {
      value = JSON.parse(this.sdk.stripJsonComments(text.replace(/^\uFEFF/, "")));
    } catch (error) {
      // 裸 SyntaxError 只有「Unexpected token … in JSON at position N」——EM 有 4 个配置文件，
      // 用户拿到这句无从知道坏的是哪个。补上路径；**不带文件原文**，否则凭据会进错误信息与日志。
      throw new Error(`配置文件不是合法 JSON：${file}（${(error as Error).message}）`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`配置必须是对象：${file}`);
    return value;
  }
  async validateModels(value: JsonObject): Promise<void> {
    // 校验走临时文件（不碰真文件），但**报错必须指向用户真正的 models.json**——否则用户拿着
    // `.validate-models-<uuid>.json` 这个路径去找，什么也找不到，只会以为升级搞坏了东西。
    const modelsPath = path.join(this.agentDir, "models.json");
    const file = path.join(this.dataDir, `.validate-models-${randomUUID()}.json`);
    try {
      atomicWrite(file, encode(value));
      // SDK 会把「它加载的那个文件路径」写进报错（形如 `File: <临时校验文件>`）。必须替换成用户
      // 真正的 models.json——否则用户拿着那个临时路径去找，什么也找不到（而且它已被删掉）。
      const describe = (message: string) => message.split(file).join(modelsPath);
      const config = await this.sdk.ModelConfig.load(file);
      if (config.error) throw new Error(`模型配置（${modelsPath}）无法通过校验：${describe(config.error)}`);
      const MR = await getModelRuntimeClass();
      const runtime = await MR.create({ modelsPath: file, credentials: this.sdk.AuthStorage.inMemory(), refreshOnCreate: false, allowModelNetwork: false });
      // 存变量再判：方法每次调用在类型上都是独立的 `string | undefined`，直接内联会过不了收窄
      const runtimeError = runtime.getError();
      if (runtimeError) throw new Error(`模型配置（${modelsPath}）无法通过校验：${describe(runtimeError)}`);
    } finally { fs.rmSync(file, { force: true }); }
  }
  private replace(change: Change, reverse = false): void {
    const expected = reverse ? change.after : change.before;
    const desired = reverse ? change.before : change.after;
    const update = (current: string | null) => {
      if (current === desired) return;
      if (current !== expected) throw new Error(`配置已被其他程序修改，请重新加载：${change.file}`);
      if (desired === null) fs.rmSync(change.file, { force: true });
      else atomicWrite(change.file, desired);
    };
    if (path.basename(change.file) === "auth.json") {
      // Use pi's file lock so OAuth refresh and credential edits cannot clobber each other.
      const backend = new this.sdk.FileAuthStorageBackend(change.file);
      backend.withLock((current: string | undefined) => {
        // FileAuthStorageBackend creates an empty file on first use.
        const normalized = current === "{}" && change.before === null ? (reverse ? expected : null) : current ?? null;
        if (normalized === desired) return { result: undefined };
        if (normalized !== expected) throw new Error("凭据已更新，请重新加载后再保存");
        if (desired === null) fs.rmSync(change.file, { force: true });
        else atomicWrite(change.file, desired);
        return { result: undefined };
      });
    } else update(readText(change.file));
  }
  private async rollback(journal: Journal): Promise<void> {
    if (journal.version !== 1 || !Array.isArray(journal.changes) || journal.changes.some(c =>
      typeof c.file !== "string" || path.relative(this.dataDir, c.file).startsWith("..") || path.isAbsolute(path.relative(this.dataDir, c.file)) ||
      (c.before !== null && typeof c.before !== "string") || typeof c.after !== "string")) throw new Error("无效的配置恢复日志，请保留日志和备份后检查");
    // Validate the whole recovery set first; a conflict leaves the journal + backup intact.
    for (const c of journal.changes) {
      const current = readText(c.file);
      if (current !== c.before && current !== c.after && !(c.before === null && current === "{}" && path.basename(c.file) === "auth.json")) throw new Error(`迁移恢复遇到外部修改：${c.file}；备份：${journal.backup}`);
    }
    for (const c of [...journal.changes].reverse()) if (readText(c.file) !== c.before) this.replace(c, true);
    fs.rmSync(this.journalPath, { force: true });
  }
  async commit(values: Map<string, JsonObject>, label: string, originals?: Map<string, string | null>, textFiles = new Map<string, string>()): Promise<string | undefined> {
    const release = lockConfigDirectory(this.dataDir);
    try {
      this.assertReady();
      // 两道判断缺一不可：
      // ① `before !== after` 快速排除「值没变」；
      // ② 再按**语义**比一次 `encode(read(file)) !== after`——带注释的 models.json（pi 支持行
      //    注释）原文与序列化结果永不相等，只靠 ① 会把注释文件无谓重写一遍（注释随之丢失）。
      const changes = [...values].map(([file, value]) => ({
        file, before: originals?.has(file) ? originals.get(file)! : readText(file), after: encode(value),
      })).filter(c => c.before !== c.after && (c.before === null || encode(this.read(c.file)) !== c.after));
      for (const [file, after] of textFiles) {
        const before = originals?.has(file) ? originals.get(file)! : readText(file);
        if (before !== after) changes.push({ file, before, after });
      }
      if (!changes.length) return;
      for (const c of changes) if (readText(c.file) !== c.before) throw new Error("配置已更新，请重新加载后再保存");
      const backup = path.join(this.dataDir, "config-backups", `${label}-${Date.now()}-${randomUUID().slice(0, 8)}`);
      fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
      for (const c of changes) if (c.before !== null) atomicWrite(path.join(backup, path.relative(this.dataDir, c.file)), c.before);
      atomicWrite(path.join(backup, "manifest.json"), encode({
        version: 1, createdAt: new Date().toISOString(),
        files: changes.map(c => ({ path: path.relative(this.dataDir, c.file), existed: c.before !== null,
          afterSha256: createHash("sha256").update(c.after).digest("hex") })),
      }));
      const journal: Journal = { version: 1, changes, backup };
      atomicWrite(this.journalPath, encode(journal));
      try {
        for (const c of changes) this.replace(c);
        fs.rmSync(this.journalPath);
        this.pruneBackups(backup);
        return backup;
      } catch (error) {
        await this.rollback(journal);
        throw error;
      }
    } finally { release(); }
  }

  /**
   * 备份目录的保留策略：只留最近 `KEEP_BACKUPS` 个（含本次刚建的那个）。
   *
   * 为什么需要：保存供应商 / 改思考等级 / 改默认模型 / 导入 pi 配置都会走 commit 建一个目录，
   * 活跃用户一年能积累几百个。而备份里含 `auth.json`（**明文 api_key**）与整套配置——等于把
   * 用户删过、轮换过的历史凭据长期留在磁盘上。只增不减是安全债，不只是占地方。
   *
   * 只在提交成功后调用、且跳过本次刚建的那个；任何失败都吞掉（清理不该影响提交结果）。
   */
  private pruneBackups(justCreated: string): void {
    try {
      const dir = path.join(this.dataDir, "config-backups");
      const keepName = path.basename(justCreated);
      const older = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name !== keepName)
        .map(e => ({ name: e.name, mtime: fs.statSync(path.join(dir, e.name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);   // 新的在前
      for (const old of older.slice(KEEP_BACKUPS - 1)) fs.rmSync(path.join(dir, old.name), { recursive: true, force: true });
    } catch { /* 清理失败不影响提交结果 */ }
  }
}
