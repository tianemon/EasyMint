import path from "node:path";
import type { AuthProvider, JsonRpcMessage, McpTransport } from "@earendil-works/pi-mcp";
import type { McpServerEntry } from "@earendil-works/pi-coding-agent";
import { ensureSandbox, isSandboxBypassedForMode, wrapForSandbox } from "./sandbox/manager";
import { bindExecutionOwner, createExecutionContext, type PermissionMode } from "./permission/execution-context";
import { findBashOnWindows } from "./background-shell/registry";

const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

/** Synchronous factory, asynchronous preparation. All listeners are attached before spawn.
 * close() covers preparation races, failed starts and natural exit, with one lease release. */
export class ProtectedMcpTransport implements McpTransport {
  private inner?: McpTransport;
  private starting?: Promise<void>;
  private closing?: Promise<void>;
  private closed = false;
  private release?: () => Promise<void>;
  private released?: Promise<void>;
  private finished?: Promise<void>;
  private pid?: number;
  private executionMode?: PermissionMode;
  private messages = new Set<(message: JsonRpcMessage) => void>();
  private errors = new Set<(error: Error) => void>();
  private closes = new Set<() => void>();
  private closeEmitted = false;
  private protocol?: string;
  constructor(private readonly options: {
    entry: McpServerEntry;
    cwd: string;
    owner: string;
    mode: () => PermissionMode;
    authProvider?: AuthProvider;
    validate?: () => void;
  }) {}

  onMessage(listener: (message: JsonRpcMessage) => void) { this.messages.add(listener); return () => { this.messages.delete(listener); }; }
  onError(listener: (error: Error) => void) { this.errors.add(listener); return () => { this.errors.delete(listener); }; }
  onClose(listener: () => void) { this.closes.add(listener); return () => { this.closes.delete(listener); }; }
  get stderr(): string { return (this.inner as { stderr?: string })?.stderr ?? ""; }
  setProtocolVersion(version: string) { this.protocol = version; this.inner?.setProtocolVersion?.(version); }
  private emitClose() {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    for (const listener of this.closes) listener();
  }
  private releaseOnce(): Promise<void> {
    if (!this.release) return Promise.resolve();
    return this.released ??= Promise.resolve().then(() => this.release!());
  }
  private finish(): Promise<void> {
    return this.finished ??= (async () => {
      // A server can exit while its descendants keep running. Pi's stdio close has already lost
      // its child handle in that case; terminate the owned process group before releasing SRT.
      if (this.pid && process.platform !== "win32") {
        const alive = () => { try { process.kill(-this.pid!, 0); return true; } catch { return false; } };
        if (alive()) {
          try { process.kill(-this.pid, "SIGTERM"); } catch { /* group already exited */ }
          for (let i = 0; i < 10 && alive(); i++) await new Promise(resolve => setTimeout(resolve, 20));
          if (alive()) {
            try { process.kill(-this.pid, "SIGKILL"); } catch { /* group already exited */ }
            for (let i = 0; i < 20 && alive(); i++) await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
      }
      try { await this.releaseOnce(); } finally { this.emitClose(); }
    })();
  }
  private check(mode = this.executionMode) {
    const currentMode = this.options.mode();
    if (this.closed || currentMode === "readonly" || (mode && currentMode !== mode)) {
      throw new Error("MCP 执行权限已撤销");
    }
    this.options.validate?.();
  }
  start(): Promise<void> { return this.starting ??= this.prepare(); }
  private async prepare(): Promise<void> {
    const mode = this.executionMode = this.options.mode();
    try {
      this.check(mode);
      const { StdioTransport, StreamableHttpTransport } = await import("@earendil-works/pi-mcp");
      this.check(mode);
      const { config } = this.options.entry;
      if ("url" in config) {
        // Config values were expanded by EM. Never invoke Pi's !cmd/header resolver here.
        this.inner = new StreamableHttpTransport({ url: config.url, headers: config.headers, authProvider: this.options.authProvider });
      } else {
        const context = bindExecutionOwner(createExecutionContext(this.options.cwd, mode, config.env), this.options.owner);
        if (!isSandboxBypassedForMode(mode)) {
          const initialized = await ensureSandbox(this.options.cwd, mode);
          if (!initialized.ok) throw new Error(`MCP 安全执行后端不可用：${initialized.reason}`);
        }
        this.check(mode);
        const gitBashPath = process.platform === "win32" ? findBashOnWindows() : undefined;
        if (process.platform === "win32" && !gitBashPath) throw new Error("Windows MCP 需要 Git Bash");
        const spec = await wrapForSandbox([config.command, ...(config.args ?? [])].map(shellQuote).join(" "), { context, gitBashPath: gitBashPath ?? undefined });
        this.release = spec.release;
        this.check(mode);
        this.inner = new StdioTransport({
          command: spec.kind === "argv" ? spec.argv[0]! : "/bin/sh",
          args: spec.kind === "argv" ? spec.argv.slice(1) : ["-c", spec.command],
          env: spec.env as Record<string, string>, inheritEnv: false,
          cwd: path.resolve(this.options.cwd, config.cwd ?? "."), stderr: "pipe",
        });
      }
      this.inner.onMessage(message => { for (const listener of this.messages) listener(message); });
      this.inner.onError(error => { for (const listener of this.errors) listener(error); });
      this.inner.onClose(() => { void this.finish().catch(() => undefined); });
      if (this.protocol) this.inner.setProtocolVersion?.(this.protocol);
      await this.inner.start();
      this.pid = (this.inner as { pid?: number }).pid;
      this.check(mode);
    } catch (error) {
      try { await this.inner?.close(); } finally { await this.finish(); }
      throw error;
    }
  }
  async send(message: JsonRpcMessage): Promise<void> {
    this.check();
    if (!this.inner) throw new Error("MCP transport 尚未启动");
    await this.inner.send(message);
  }
  close(): Promise<void> {
    this.closed = true;
    return this.closing ??= (async () => {
      // Close an already-created transport immediately (including an initialize in progress).
      await this.inner?.close();
      await this.starting?.catch(() => undefined);
      try { await this.inner?.close(); } finally { await this.finish(); }
    })();
  }
}
