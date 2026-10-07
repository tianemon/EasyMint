import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EncryptedMcpAuthBackend } from "./mcp-auth-store";

const state = vi.hoisted(() => ({ available: true }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (plain: string) => {
      const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 7), iv);
      const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString: (data: Buffer) => {
      const cipher = createDecipheriv("aes-256-gcm", Buffer.alloc(32, 7), data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8");
    },
  },
}));
const dirs: string[] = [];
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-creds-")); dirs.push(dir);
  const file = path.join(dir, "mcp-auth-v2.json");
  return { file, store: new EncryptedMcpAuthBackend(file) };
}
afterEach(() => { state.available = true; for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
describe("encrypted Pi MCP backend", () => {
  it("stores encrypted data, scopes accounts by URL, and leaves legacy credentials intact", async () => {
    const { file, store } = setup();
    const legacy = path.join(path.dirname(file), "mcp-auth.json"); fs.writeFileSync(legacy, '{"old":"untouched"}');
    const { McpOAuthCredentialStore } = await import("@earendil-works/pi-coding-agent");
    const credentials = new McpOAuthCredentialStore(store, path.join(path.dirname(file), "refresh-locks"));
    credentials.forServer("same", "https://a.example/mcp").save({ serverUrl: "https://a.example/mcp", tokens: { access_token: "very-secret-token", token_type: "Bearer" } });
    expect(fs.readFileSync(file, "utf8")).not.toContain("very-secret-token");
    expect(credentials.tokens("same", "https://a.example/mcp")?.access_token).toBe("very-secret-token");
    expect(credentials.tokens("same", "https://b.example/mcp")).toBeUndefined();
    expect(fs.readFileSync(legacy, "utf8")).toBe('{"old":"untouched"}');
    expect(credentials.remove("same", "https://a.example/mcp")).toBe(true);
    expect(credentials.tokens("same", "https://a.example/mcp")).toBeUndefined();
  });
  it("serializes independent backend instances and releases locks on failure", async () => {
    const { file, store } = setup(); const other = new EncryptedMcpAuthBackend(file);
    store.withLock(() => ({ result: undefined, next: "0" }));
    const update = (backend: EncryptedMcpAuthBackend) => backend.withLockAsync(async current => {
      await new Promise(resolve => setTimeout(resolve, 25)); return { result: undefined, next: String(Number(current) + 1) };
    });
    await Promise.all([update(store), update(other)]);
    expect(store.withLock(current => ({ result: current }))).toBe("2");
    expect(() => store.withLock(() => { throw new Error("failure"); })).toThrow("failure");
    expect(store.withLock(current => ({ result: current }))).toBe("2");
  });
  it("never downgrades or overwrites credentials when encryption/decryption is unavailable", () => {
    const { file, store } = setup();
    state.available = false;
    expect(() => store.withLock(() => ({ result: undefined, next: "secret" }))).toThrow("明文");
    expect(fs.existsSync(file)).toBe(false);
    state.available = true; store.withLock(() => ({ result: undefined, next: "secret" }));
    const before = fs.readFileSync(file, "utf8");
    state.available = false;
    expect(() => store.withLock(() => ({ result: undefined, next: "overwrite" }))).toThrow("钥匙串");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    state.available = true;
    fs.writeFileSync(file, JSON.stringify({ version: 2, encrypted: "invalid" }));
    expect(() => store.withLock(() => ({ result: undefined, next: "overwrite" }))).toThrow();
    expect(JSON.parse(fs.readFileSync(file, "utf8")).encrypted).toBe("invalid");
  });
});
