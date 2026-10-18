import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProtectedMcpTransport } from "./mcp-transport";
import { InMemoryAuthStorageBackend } from "./mcp-test-store";
import { resetSandboxState } from "./sandbox/manager";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));
// Optional real-browser integration: use an installed MCP CLI and Chrome, without downloading.
const cli = process.env.PLAYWRIGHT_MCP_TEST_CLI;
const browser = process.env.PLAYWRIGHT_MCP_TEST_BROWSER;
const priorHome = process.env.EASYMINT_HOME;
let root: string | undefined;
afterEach(async () => {
  await resetSandboxState();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  if (priorHome === undefined) delete process.env.EASYMINT_HOME; else process.env.EASYMINT_HOME = priorHome;
});
describe.skipIf(!cli || !browser)("concurrent actual Playwright MCP sessions", () => {
  it("opens independent browsers from two standard-mode clients in the same workspace", async () => {
    root = fs.mkdtempSync(path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), "em-browser-mcp-"));
    const cwd = path.join(root, "project"); fs.mkdirSync(cwd);
    process.env.EASYMINT_HOME = path.join(root, "em");
    const sdk = await import("@earendil-works/pi-coding-agent");
    const connections = ["one", "two"].map(owner => new sdk.McpServerConnection({
      entry: { name: "browser", source: "test", config: { type: "stdio", command: process.execPath,
        args: [cli!, "--headless", "--executable-path", browser!] } },
      cwd, credentials: new sdk.McpOAuthCredentialStore(new InMemoryAuthStorageBackend()),
      connectTimeoutMs: 15000, onTools: () => {},
      createTransport: entry => new ProtectedMcpTransport({ entry, cwd, owner, mode: () => "standard", validate: () => {} }),
    }));
    try {
      const results = await Promise.all(connections.map(async connection => {
        const client = await connection.getClient();
        return client.callTool("browser_navigate", { url: "about:blank" });
      }));
      for (const result of results) {
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        expect(JSON.stringify(result)).toContain("about:blank");
      }
    } finally { await Promise.all(connections.map(connection => connection.close())); }
  }, 45000);
});
