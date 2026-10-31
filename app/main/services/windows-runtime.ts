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

/** 仅改变子进程环境；Windows PATH 名称大小写统一，避免两个键竞争。 */
export function windowsRuntimeEnvironment(env: NodeJS.ProcessEnv, paths: WindowsRuntimePaths): NodeJS.ProcessEnv {
  const result = { ...env };
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
  private preparing?: { controller: AbortController; promise: Promise<WindowsRuntimePaths>; waiters: number; progress: Set<(message: string) => void> };
  constructor(private readonly options: RuntimeOptions) {}
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
    if (this.checked?.status !== "ready" || !fs.existsSync(paths.git) || !fs.existsSync(paths.bash)) return undefined;
    return paths;
  }
  private async validate(paths: WindowsRuntimePaths, signal?: AbortSignal): Promise<void> {
    for (const relative of ["cmd/git.exe", "bin/bash.exe", "usr/bin/sed.exe", "usr/bin/awk.exe", "usr/bin/find.exe"]) {
      if (!(await fsp.stat(path.join(paths.root, relative))).isFile()) throw new Error(`Missing runtime executable: ${relative}`);
    }
    const env = probeEnvironment(paths);
    const git = await this.options.run(paths.git, ["--version"], { cwd: paths.root, env, signal });
    if (git.match(/^git version (\S+)/m)?.[1] !== this.options.manifest.releaseTag.replace(/^v/, "")) throw new Error("Git runtime verification failed");
    const bash = await this.options.run(paths.bash, ["--noprofile", "--norc", "-c", "git --version && sed --version >/dev/null && awk 'BEGIN {exit 0}' && find . -maxdepth 0 -print >/dev/null && printf '__EM_RUNTIME_OK__'"], { cwd: paths.root, env, signal });
    if (!bash.includes("__EM_RUNTIME_OK__")) throw new Error("Bash runtime verification failed");
  }
  async probe(): Promise<WindowsRuntimeProbe> {
    try {
      const paths = this.paths();
      if (!fs.existsSync(paths.root)) return { status: "missing" };
      if (this.prepared()) return this.checked!;
      const marker = JSON.parse(await fsp.readFile(path.join(paths.root, ".em-ready.json"), "utf8")) as { version?: string; sha256?: string };
      if (marker.version !== this.options.manifest.version || marker.sha256 !== this.options.manifest.archives[this.arch()].sha256) throw new Error("Runtime version marker mismatch");
      await this.validate(paths);
      return this.checked = { status: "ready", version: this.options.manifest.version, paths };
    } catch (error) {
      return this.checked = { status: "broken", detail: error instanceof Error ? error.message : String(error) };
    }
  }
  private async prepare(signal: AbortSignal, progress: (message: string) => void): Promise<WindowsRuntimePaths> {
    signal.throwIfAborted();
    const unlock = await acquirePreparationLock(path.join(this.options.dataRoot, "git"), signal);
    try {
      this.reset();
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
        await this.options.run(extractor, ["x", "-y", "-bd", `-o${stage}`, archive], { cwd: this.options.resources, env: probeEnvironment(pathsFor(stage)), signal, timeoutMs: 180_000 });
        const staged = pathsFor(stage);
        if (fs.existsSync(path.join(stage, "post-install.bat"))) {
          await this.options.run(path.join(stage, "git-bash.exe"), ["--no-needs-console", "--hide", "--no-cd", "--command=post-install.bat"], { cwd: stage, env: probeEnvironment(staged), signal, timeoutMs: 120_000 });
        }
        if (fs.existsSync(path.join(stage, "post-install.bat")) || fs.existsSync(path.join(stage, "etc", "post-install"))) throw new Error("PortableGit initialization did not finish");
        progress("正在验证命令执行…");
        await this.validate(staged, signal);
        signal.throwIfAborted();
        await fsp.writeFile(path.join(stage, ".em-ready.json"), JSON.stringify({ version: this.options.manifest.version, sha256: expected }));
        signal.throwIfAborted();
        if (fs.existsSync(paths.root)) { await fsp.rename(paths.root, backup); moved = true; }
        try { await fsp.rename(stage, paths.root); installed = true; }
        catch (error) { if (moved) await fsp.rename(backup, paths.root); throw error; }
        this.checked = { status: "ready", version: this.options.manifest.version, paths };
        if (moved) {
          // 已验证的新版本继续可用；旧副本被占用时保留它，不把清理失败冒充安装失败。
          await fsp.rm(backup, { recursive: true, force: true }).catch(error => console.warn("[windows-runtime] Previous copy retained:", error));
        }
        return paths;
      } finally {
        if (!installed) await fsp.rm(stage, { recursive: true, force: true });
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
        .finally(() => { if (this.preparing === task) this.preparing = undefined; });
      this.preparing = task;
    }
    const task = this.preparing;
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
export function resetWindowsRuntimeProbe(): void { service?.reset(); }
export function preparedWindowsRuntime(): WindowsRuntimePaths | undefined { return service?.prepared(); }
