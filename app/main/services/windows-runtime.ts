import { app } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { trackChild, untrackChild } from "./process-registry";
import runtimeManifest from "../../shared/windows-runtime.json";
import { emHome, getResourcesDir } from "../utils/paths";
import { logProvisioning } from "./provisioning/log";

export interface WindowsRuntimePaths { root: string; git: string; bash: string }
export interface WindowsRuntimeProbe {
  status: "ready" | "missing" | "broken";
  detail?: string;
  version?: string;
  paths?: WindowsRuntimePaths;
}
interface PrepareOptions { signal?: AbortSignal; onProgress?: (message: string) => void }
type Arch = keyof typeof runtimeManifest.archives;
type Manifest = typeof runtimeManifest;
type Runner = (file: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs?: number }) => Promise<string>;
interface RuntimeOptions {
  arch: string;
  dataRoot: string;
  resources: string;
  manifest: Manifest;
  run: Runner;
  /** 审计日志落点（单测注入用；生产默认写 provisioning.log，见 provisioning/log.ts） */
  log?: (line: string) => void;
}
const run: Runner = (file, args, opts) => new Promise((resolve, reject) => {
  opts.signal?.throwIfAborted();
  const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  trackChild(child, { detached: false });
  let output = "", stderr = "", failure: Error | undefined;
  const kill = () => {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
        .once("error", () => { child.kill(); });
    } else child.kill();
  };
  const abort = () => { failure = new DOMException("Cancelled", "AbortError"); kill(); };
  const timer = setTimeout(() => { failure = new Error(`${path.basename(file)} timed out`); kill(); }, opts.timeoutMs ?? 20_000);
  child.stdout.on("data", (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-65_536); });
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-4096); });
  child.once("error", error => { failure = error; });
  // 取消后先确认进程退出、stdio排空，再允许stage清理，避免后台写入与回收相撞。
  child.once("close", code => {
    clearTimeout(timer); opts.signal?.removeEventListener("abort", abort); untrackChild(child);
    if (failure) reject(failure);
    else if (code !== 0) reject(new Error(`${path.basename(file)} exited ${code}: ${stderr.slice(-600)}`));
    else resolve(output);
  });
  opts.signal?.addEventListener("abort", abort, { once: true });
  if (opts.signal?.aborted) abort();
});
const lockfile = createRequire(path.join(__dirname, "windows-runtime.cjs"))("proper-lockfile") as {
  lock(file: string, options: { realpath: boolean; stale: number; update: number }): Promise<() => Promise<void>>;
};
async function acquirePreparationLock(root: string, signal: AbortSignal): Promise<() => Promise<void>> {
  await fsp.mkdir(root, { recursive: true });
  for (;;) {
    signal.throwIfAborted();
    try {
      const release = await lockfile.lock(root, { realpath: true, stale: 120_000, update: 10_000 });
      if (signal.aborted) { await release(); signal.throwIfAborted(); }
      return release;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED") throw error;
      await delay(150, undefined, { signal });
    }
  }
}
async function digestFile(file: string, signal: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) { signal.throwIfAborted(); hash.update(chunk); }
  return hash.digest("hex");
}
function pathsFor(root: string): WindowsRuntimePaths {
  return { root, git: path.join(root, "cmd", "git.exe"), bash: path.join(root, "bin", "bash.exe") };
}

/**
 * 一个可用运行时**必须同时在场的可执行文件**（少一个就不算就绪）。
 *
 * 只看 `cmd/git.exe` + `bin/bash.exe` 是不够的：运行时被搬走一半、或被杀软隔离了部分文件时，
 * 这两个仍可能在场，于是每条命令都去 spawn 一个残缺的 Bash —— 表现是工具调用直接卡住/永远不返回，
 * 而不是给出"环境没装好"。这里用同一份清单同时服务 `prepared()`（每次命令的热路径）与
 * `validate()`（准备后的验收），口径不会漂。
 *
 * ⚠️ 就绪标记（`.em-ready.json`）**不在**这份清单里：它由 prepare 在验收**之后**写入，
 * 混进来会让"刚验完的候选目录"永远无法通过验收。
 */
const REQUIRED_RUNTIME_FILES = [
  "cmd/git.exe", "bin/bash.exe", "usr/bin/sed.exe", "usr/bin/awk.exe", "usr/bin/find.exe",
] as const;
const READY_MARKER = ".em-ready.json";

/** 仅改变子进程环境；Windows PATH 名称大小写统一，避免两个键竞争。
 *
 *  `GIT_EXEC_PATH` 必须剔除：它指向的是**另一个** Git 安装的 exec-path，用户设过它时
 *  自带 git 会拿系统那份辅助程序来跑，报错与版本都对不上（探测侧早就剔了，执行侧漏了）。
 */
export function windowsRuntimeEnvironment(env: NodeJS.ProcessEnv, paths: WindowsRuntimePaths): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const name of Object.keys(result)) if (name.toUpperCase() === "GIT_EXEC_PATH") delete result[name];
  const key = Object.keys(result).find(name => name.toUpperCase() === "PATH");
  const previous = key ? result[key] : "";
  for (const name of Object.keys(result)) if (name.toUpperCase() === "PATH") delete result[name];
  result.PATH = [path.join(paths.root, "cmd"), path.join(paths.root, "bin"), path.join(paths.root, "usr", "bin"), previous].filter(Boolean).join(";");
  return result;
}
function probeEnvironment(paths: WindowsRuntimePaths): NodeJS.ProcessEnv {
  const env = windowsRuntimeEnvironment(process.env, paths);
  for (const name of Object.keys(env)) {
    if (["BASH_ENV", "ENV", "NODE_OPTIONS", "GIT_EXEC_PATH", "ELECTRON_RUN_AS_NODE"].includes(name.toUpperCase())) delete env[name];
  }
  return { ...env, LANG: "C", LC_ALL: "C" };
}

/** 准备和实测在此集中，避免设置页、启动检查与执行入口使用不同的就绪标准。 */
export class WindowsRuntimeService {
  private checked?: WindowsRuntimeProbe;
  /** 本次运行里是否真的尝试过准备（命令链路据此决定要不要等启动那 1.5 秒的窗口） */
  private attempted = false;
  private preparing?: { controller: AbortController; promise: Promise<WindowsRuntimePaths>; waiters: number; progress: Set<(message: string) => void> };
  constructor(private readonly options: RuntimeOptions) {}
  /** 审计日志：注入优先（单测不碰真实文件），生产写 provisioning.log */
  private logLine(line: string): void { (this.options.log ?? logProvisioning)(line); }
  private arch(): Arch {
    if (this.options.arch !== "x64" && this.options.arch !== "arm64") throw new Error(`Unsupported Windows runtime architecture: ${this.options.arch}`);
    return this.options.arch;
  }
  paths(): WindowsRuntimePaths {
    return pathsFor(path.join(this.options.dataRoot, "git", `${this.options.manifest.version}-${this.arch()}`));
  }
  reset(): void { this.checked = undefined; }
  prepared(): WindowsRuntimePaths | undefined {
    const paths = this.paths();
    if (this.checked?.status !== "ready") return undefined;
    // 缓存说 ready 也要复核在不在场：运行时可能刚被搬走/清理掉一部分（见 REQUIRED_RUNTIME_FILES）
    if (!REQUIRED_RUNTIME_FILES.every(relative => fs.existsSync(path.join(paths.root, relative)))) return undefined;
    if (!fs.existsSync(path.join(paths.root, READY_MARKER))) return undefined;
    return paths;
  }
  private async validate(paths: WindowsRuntimePaths, signal?: AbortSignal): Promise<void> {
    for (const relative of REQUIRED_RUNTIME_FILES) {
      if (!(await fsp.stat(path.join(paths.root, relative))).isFile()) throw new Error(`Missing runtime executable: ${relative}`);
    }
    const env = probeEnvironment(paths);
    const git = await this.options.run(paths.git, ["--version"], { cwd: paths.root, env, signal });
    if (git.match(/^git version (\S+)/m)?.[1] !== this.options.manifest.releaseTag.replace(/^v/, "")) throw new Error("Git runtime verification failed");
    const bash = await this.options.run(paths.bash, ["--noprofile", "--norc", "-c", "git --version && sed --version >/dev/null && awk 'BEGIN {exit 0}' && find . -maxdepth 0 -print >/dev/null && printf '__EM_RUNTIME_OK__'"], { cwd: paths.root, env, signal });
    if (!bash.includes("__EM_RUNTIME_OK__")) throw new Error("Bash runtime verification failed");
  }
  /** 同目录下残留的 `.staging-*` / `.previous-*`：上次准备被打断（关窗、应用更新、取消）
   *  或旧副本清理失败留下的。它们从不被复用，只会占盘（一次最多 ~400MB），
   *  且在 `probe()` 里必须与"没装"区分开——否则用户只能盲点重试。 */
  private async staleCopies(paths: WindowsRuntimePaths): Promise<string[]> {
    const parent = path.dirname(paths.root), base = path.basename(paths.root);
    const entries = await fsp.readdir(parent).catch(() => [] as string[]);
    return entries.filter(name => name.startsWith(`${base}.staging-`) || name.startsWith(`${base}.previous-`))
      .map(name => path.join(parent, name));
  }
  /** 拿到准备锁之后才清扫：锁在手时不可能有别的实例正在准备，删得安全。 */
  private async sweepStaleCopies(paths: WindowsRuntimePaths): Promise<void> {
    for (const stale of await this.staleCopies(paths)) {
      await fsp.rm(stale, { recursive: true, force: true })
        .catch(error => console.warn("[windows-runtime] Stale copy retained:", error));
    }
  }
  async probe(): Promise<WindowsRuntimeProbe> {
    try {
      const paths = this.paths();
      if (!fs.existsSync(paths.root)) {
        // 有半截 staging = 上次准备被中断，不是"没装"。压成 missing 会让界面只说「未安装」，
        // 用户既看不出原因，也不知道点重试就能修（2026-11-15 现场就卡在这里）。
        const interrupted = (await this.staleCopies(paths)).some(p => p.includes(".staging-"));
        return this.checked = interrupted
          ? { status: "broken", detail: "上次准备被中断（关闭窗口或应用更新），运行环境未就绪——点「重试安装」可重新准备" }
          : { status: "missing" };
      }
      if (this.prepared()) return this.checked!;
      const marker = JSON.parse(await fsp.readFile(path.join(paths.root, READY_MARKER), "utf8")) as { version?: string; sha256?: string };
      if (marker.version !== this.options.manifest.version || marker.sha256 !== this.options.manifest.archives[this.arch()].sha256) throw new Error("Runtime version marker mismatch");
      await this.validate(paths);
      return this.checked = { status: "ready", version: this.options.manifest.version, paths };
    } catch (error) {
      return this.checked = { status: "broken", detail: error instanceof Error ? error.message : String(error) };
    }
  }
  private async prepare(signal: AbortSignal, progress: (message: string) => void): Promise<WindowsRuntimePaths> {
    signal.throwIfAborted();
    this.attempted = true;
    const unlock = await acquirePreparationLock(path.join(this.options.dataRoot, "git"), signal);
    try {
      this.reset();
      await this.sweepStaleCopies(this.paths());
      const current = await this.probe();
      if (current.status === "ready") return current.paths!;
      const paths = this.paths(), arch = this.arch();
      const archive = path.join(this.options.resources, "portable-git.7z.exe");
      const manifest = JSON.parse(await fsp.readFile(path.join(this.options.resources, "manifest.json"), "utf8")) as { version?: string; arch?: string; fileName?: string; sha256?: string; extractor?: { fileName?: string; sha256?: string } };
      const expected = this.options.manifest.archives[arch].sha256;
      const extractorHash = this.options.manifest.extractor.archives[arch].sha256;
      if (manifest.version !== this.options.manifest.version || manifest.arch !== arch || manifest.fileName !== "portable-git.7z.exe" || manifest.sha256 !== expected) throw new Error("Bundled Windows runtime manifest mismatch");
      if (manifest.extractor?.fileName !== "7za.exe" || manifest.extractor.sha256 !== extractorHash) throw new Error("Bundled extractor manifest mismatch");
      const extractor = path.join(this.options.resources, "7za.exe");
      progress("正在校验内置运行环境…");
      if (await digestFile(archive, signal) !== expected || await digestFile(extractor, signal) !== extractorHash) throw new Error("Bundled Windows runtime checksum mismatch");
      const stage = `${paths.root}.staging-${randomUUID()}`, backup = `${paths.root}.previous-${randomUUID()}`;
      await fsp.mkdir(path.dirname(stage), { recursive: true });
      let moved = false, installed = false;
      try {
        progress("正在准备命令运行环境…");
        // 官方SFX有GUI进度；使用随包CLI解压并隐藏控制台，随后按官方要求执行post-install。
        // 解压量是 ~400MB / 9600 个文件，带实时扫描的机器上 3 分钟不够——超时被当成失败会留下半截
        // stage，用户看到的是"未安装"（2026-11-15 的真实现场），故留 5 分钟余量。
        await this.options.run(extractor, ["x", "-y", "-bd", `-o${stage}`, archive], { cwd: this.options.resources, env: probeEnvironment(pathsFor(stage)), signal, timeoutMs: 300_000 });
        const staged = pathsFor(stage);
        const postInstall = path.join(stage, "post-install.bat");
        const postInstallMarker = path.join(stage, "etc", "post-install");
        if (fs.existsSync(postInstall)) {
          try {
            await this.options.run(path.join(stage, "git-bash.exe"), ["--no-needs-console", "--hide", "--no-cd", "--command=post-install.bat"], { cwd: stage, env: probeEnvironment(staged), signal, timeoutMs: 120_000 });
          } catch (error) {
            // `post-install.bat` 末行是 `@DEL post-install.bat`（自删）。脚本删掉自己之后 cmd 读不到
            // 下一行，会打印「找不到批处理文件。」并返回 **1**——这个 1 表示"跑完了"，不是初始化失败。
            // 成功判据只能是文件状态（脚本与标记都已清理），退出码仅留痕；真没跑完（文件还在）
            // 或用户取消了，仍按失败处理。
            const finished = !fs.existsSync(postInstall) && !fs.existsSync(postInstallMarker);
            if (signal.aborted || !finished) throw error;
            this.logLine(`[runtime] post-install 退出码非 0 但初始化已完成（自删所致）: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (fs.existsSync(postInstall) || fs.existsSync(postInstallMarker)) throw new Error("PortableGit initialization did not finish");
        progress("正在验证命令执行…");
        await this.validate(staged, signal);
        signal.throwIfAborted();
        await fsp.writeFile(path.join(stage, READY_MARKER), JSON.stringify({ version: this.options.manifest.version, sha256: expected }));
        signal.throwIfAborted();
        if (fs.existsSync(paths.root)) { await fsp.rename(paths.root, backup); moved = true; }
        try {
          // Antivirus or a just-exited PortableGit helper can briefly hold the tree.
          // Retry the same verified staging directory instead of unpacking it again.
          for (let attempt = 0; ; attempt++) {
            signal.throwIfAborted();
            try { await fsp.rename(stage, paths.root); break; }
            catch (error) {
              const code = (error as NodeJS.ErrnoException).code;
              if (attempt >= 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
              await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 250));
            }
          }
          installed = true;
        }
        catch (error) { if (moved) await fsp.rename(backup, paths.root); throw error; }
        this.checked = { status: "ready", version: this.options.manifest.version, paths };
        this.logLine(`[runtime] 命令运行环境就绪 version=${this.options.manifest.version} root=${paths.root}`);
        if (moved) {
          // 已验证的新版本继续可用；旧副本被占用时保留它，不把清理失败冒充安装失败。
          await fsp.rm(backup, { recursive: true, force: true }).catch(error => {
            console.warn("[windows-runtime] Previous copy retained:", error);
            this.logLine(`[runtime] 旧副本清理失败（保留）: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
        return paths;
      } finally {
        if (!installed) {
          // 清理失败不能盖掉真正的错误：杀软/7za 句柄可能还占着文件（EBUSY），
          // 那样用户看到的会是 rm 的异常，跟"为什么没装上"毫无关系。残留由下次准备清扫。
          await fsp.rm(stage, { recursive: true, force: true }).catch(error => {
            console.warn("[windows-runtime] Staged copy retained:", error);
            this.logLine(`[runtime] 临时候选目录清理失败（保留）: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
      }
    } finally { await unlock(); }
  }

  async ensure(options: PrepareOptions = {}): Promise<WindowsRuntimePaths> {
    options.signal?.throwIfAborted();
    if (this.preparing?.controller.signal.aborted) {
      const previous = this.preparing.promise;
      // 上一次取消必须先完成进程收尾与stage清理；新请求不继承它的取消结果。
      await new Promise<void>((resolve, reject) => {
        const abort = () => { options.signal?.removeEventListener("abort", abort); reject(options.signal?.reason ?? new DOMException("Cancelled", "AbortError")); };
        const settled = () => { options.signal?.removeEventListener("abort", abort); resolve(); };
        previous.then(settled, settled);
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
      });
      options.signal?.throwIfAborted();
      return this.ensure(options);
    }
    const ready = this.prepared();
    if (ready) return ready;
    if (!this.preparing) {
      const controller = new AbortController(), progress = new Set<(message: string) => void>();
      const task = { controller, progress, waiters: 0, promise: Promise.resolve({} as WindowsRuntimePaths) };
      task.promise = this.prepare(controller.signal, message => { for (const callback of progress) callback(message); })
        .catch(error => {
          // 留痕：启动时的静默准备没有界面、打包版也没有控制台，失败必须落到 provisioning.log，
          // 否则用户报告「一直检测不到」时连失败发生在解压还是 post-install 都无从判断。
          // 取消是用户/调用方的主动行为（暂停命令、关面板），不该在控制台报成故障。
          const aborted = (error as Error)?.name === "AbortError";
          this.logLine(aborted
            ? "[runtime] 命令运行环境准备中止: 调用方已取消（残留由下次准备清扫）"
            : `[runtime] 命令运行环境准备失败: ${error instanceof Error ? error.message : String(error)}`);
          if (!aborted) console.warn("[windows-runtime] preparation failed:", error);
          throw error;
        })
        .finally(() => { if (this.preparing === task) this.preparing = undefined; });
      // 等待者可能全部中途撤销（取消安装 / 命令被停）：共享任务按既有语义在 release 里收尾，
      // 但那时可能已经没有调用方在听这个拒绝——自己消化一次，避免 unhandledRejection 刷屏。
      void task.promise.catch(() => {});
      this.preparing = task;
    }
    const task = this.preparing;
    return this.waitOn(task, options);
  }

  /**
   * 只**加入**正在进行的准备，绝不在这里启动新的准备（消息链路专用）。
   *
   * 为什么要分开：`ensure()` 缺运行时会当场解压 400MB（1–3 分钟）。放在"每条消息的每个命令"上，
   * 用户看到的就是**发消息即未响应**——而且取消/重发还会 abort 掉解压、下一条再从头来
   * （2026-11-15 用户现场：把自带 Git 搬走之后完全没法用）。命令链路改为"就绪就用、正在装就等、
   * 都没就绪就立刻报错并指路（设置 → 环境检测）"，把重装限制在明确的入口上。
   *
   * `waitForAppearMs` 只补**启动那 1.5 秒的窗口**：启动时的静默准备是延迟触发的，命令赶在它前面
   * 就会白报一次"未就绪"。这段等待**只发生一次**（`attempted` 记过就跳过），不会让每条命令都白等。
   */
  async join(options: PrepareOptions = {}, waitForAppearMs = 3000): Promise<WindowsRuntimePaths | undefined> {
    if (options.signal?.aborted) return undefined;
    const ready = this.prepared();
    if (ready) return ready;
    if (this.preparing) return this.waitOn(this.preparing, options);
    if (this.attempted) return undefined;
    const deadline = Date.now() + waitForAppearMs;
    while (Date.now() < deadline) {
      await delay(150, undefined, { signal: options.signal });
      const now = this.prepared();
      if (now) return now;
      if (this.preparing) return this.waitOn(this.preparing, options);
    }
    return undefined;
  }

  /** 加入一份共享任务：返回一个随任务结束（或调用方撤销）而结算的 promise。 */
  private waitOn(task: NonNullable<WindowsRuntimeService["preparing"]>, options: PrepareOptions): Promise<WindowsRuntimePaths> {
    task.waiters++;
    if (options.onProgress) task.progress.add(options.onProgress);
    return new Promise((resolve, reject) => {
      let done = false;
      const release = () => {
        if (done) return; done = true;
        options.signal?.removeEventListener("abort", abort);
        if (options.onProgress) task.progress.delete(options.onProgress);
        if (--task.waiters === 0) task.controller.abort();
      };
      const abort = () => { release(); reject(options.signal?.reason ?? new DOMException("Cancelled", "AbortError")); };
      options.signal?.addEventListener("abort", abort, { once: true });
      task.promise.then(paths => { if (!done) { release(); resolve(paths); } }, error => { if (!done) { release(); reject(error); } });
    });
  }
}
let service: WindowsRuntimeService | undefined;
function runtime(): WindowsRuntimeService {
  if (!service) {
    const resources = app.isPackaged ? path.join(getResourcesDir(), "windows-runtime")
      : path.resolve(getResourcesDir(), "..", "temp", "runtime-resources", "windows", process.arch);
    service = new WindowsRuntimeService({ arch: process.arch, dataRoot: path.join(emHome(), "runtime-tools"), resources, manifest: runtimeManifest, run });
  }
  return service;
}
export function probeWindowsRuntime(): Promise<WindowsRuntimeProbe> { return runtime().probe(); }
export function ensureWindowsRuntime(options?: PrepareOptions): Promise<WindowsRuntimePaths> { return runtime().ensure(options); }
/** 命令链路用：只加入正在进行的准备，不新建（见 WindowsRuntimeService.join 的说明） */
export function joinWindowsRuntime(options?: PrepareOptions): Promise<WindowsRuntimePaths | undefined> {
  return runtime().join(options);
}
export function resetWindowsRuntimeProbe(): void { service?.reset(); }
export function preparedWindowsRuntime(): WindowsRuntimePaths | undefined { return service?.prepared(); }
