import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { createRequire } from "node:module";
import type { AuthStorageBackend } from "@earendil-works/pi-coding-agent";
import { atomicWrite, lockConfigDirectory } from "./native-config-storage";

const require = createRequire(path.join(__dirname, "mcp-auth-store.cjs"));
const lockfile = require("proper-lockfile") as {
  lock(file: string, options: { realpath: boolean; stale: number; retries: { retries: number; minTimeout: number; maxTimeout: number } }): Promise<() => Promise<void>>;
};

/** A separate versioned file preserves the old name-only credentials for rollback.
 * Those credentials cannot safely be attributed to a server URL: require a fresh sign-in.
 * Never overwrite them or transfer them to a same-named server in another project. */
export class EncryptedMcpAuthBackend implements AuthStorageBackend {
  private readonly lockDir: string;
  constructor(private readonly file: string) {
    this.lockDir = `${file}.lockdir`;
  }
  private encryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable() &&
      !(process.platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text");
  }

  private read(): string | undefined {
    if (!fs.existsSync(this.file)) return undefined;
    if (!this.encryptionAvailable()) throw new Error("系统钥匙串不可用，无法读取 MCP 凭据");
    const envelope = JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (envelope.version !== 2 || typeof envelope.encrypted !== "string") throw new Error("MCP 凭据格式不受支持");
    // Decryption errors must not turn into an empty store followed by an overwrite.
    return safeStorage.decryptString(Buffer.from(envelope.encrypted, "base64"));
  }

  private write(next: string): void {
    if (!this.encryptionAvailable()) throw new Error("系统钥匙串不可用，MCP 凭据不会以明文保存");
    atomicWrite(this.file, JSON.stringify({ version: 2, encrypted: safeStorage.encryptString(next).toString("base64") }));
  }

  withLock<T>(fn: (current: string | undefined) => { result: T; next?: string }): T {
    const release = lockConfigDirectory(this.lockDir);
    try {
      const update = fn(this.read());
      if (update.next !== undefined) this.write(update.next);
      return update.result;
    } finally { release(); }
  }

  async withLockAsync<T>(fn: (current: string | undefined) => Promise<{ result: T; next?: string }>): Promise<T> {
    fs.mkdirSync(this.lockDir, { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.lockDir, { realpath: true, stale: 30_000, retries: { retries: 50, minTimeout: 20, maxTimeout: 100 } });
    try {
      const update = await fn(this.read());
      if (update.next !== undefined) this.write(update.next);
      return update.result;
    } finally { await release(); }
  }
}
