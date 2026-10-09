import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "./store";
import { createPiSession, disposePiSession } from "./pi-session";
import { approveMcpServer } from "./mcp-service";
import { closeAllMcpClients, getMcpStatus, loginMcpServer, logoutMcpServer } from "./mcp-runtime";
import { EncryptedMcpAuthBackend } from "./mcp-auth-store";

const ui = vi.hoisted(() => ({ opened: vi.fn(), inputAborted: vi.fn(), pauseBrowser: false }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => os.tmpdir() },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(`fixture:${text}`), decryptString: (buffer: Buffer) => buffer.toString().slice(8) },
  shell: { openExternal: async (url: string) => { ui.opened(url); if (!ui.pauseBrowser) await fetch(url); } },
}));
vi.mock("./pi-extension-ui", () => ({ createPiExtensionUi: () => ({
  notify: () => {},
  input: (_title: string, _placeholder: string, { signal }: { signal: AbortSignal }) => new Promise(resolve => {
    if (signal.aborted) return resolve(undefined);
    signal.addEventListener("abort", () => { ui.inputAborted(); resolve(undefined); }, { once: true });
  }),
}) }));

const priorHome = process.env.EASYMINT_HOME;
const priorPi = process.env.PI_CODING_AGENT_DIR;
let root: string | undefined;
let server: http.Server | undefined;
const sessions: Awaited<ReturnType<typeof createPiSession>>[] = [];
afterEach(async () => {
  await closeAllMcpClients();
  await Promise.all(sessions.splice(0).map(disposePiSession));
  server?.closeAllConnections();
  await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); server = undefined;
  if (root) fs.rmSync(root, { recursive: true, force: true });
  if (priorHome === undefined) delete process.env.EASYMINT_HOME; else process.env.EASYMINT_HOME = priorHome;
  if (priorPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = priorPi;
  ui.opened.mockClear(); ui.inputAborted.mockClear(); ui.pauseBrowser = false;
});

async function freePort(): Promise<number> {
  const probe = net.createServer(); await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as net.AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve())); return port;
}
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("OAuth fixture timed out"); await new Promise(resolve => setTimeout(resolve, 15)); }
}

async function startFixture(phase?: "metadata" | "registration" | "token" | "reconnect") {
  const grants: string[] = [];
  const blocking = { enabled: false, reached: false };
  let base = "", accessToken = "issued-token";
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, base);
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString();
    const shouldBlock = phase === "metadata" ? url.pathname.startsWith("/.well-known/")
      : phase === "registration" ? url.pathname === "/register" : phase === "token" && url.pathname === "/token";
    if (blocking.enabled && shouldBlock) { blocking.reached = true; return; }
    const json = (status: number, data: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    if (url.pathname === "/.well-known/oauth-protected-resource") return json(200, { resource: base + "/mcp", authorization_servers: [base], scopes_supported: ["tools"] });
    if (url.pathname.startsWith("/.well-known/")) return json(200, { issuer: base, authorization_endpoint: base + "/authorize", token_endpoint: base + "/token", registration_endpoint: base + "/register", response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"] });
    if (url.pathname === "/register") return json(201, { ...JSON.parse(text), client_id: "fixture-client" });
    if (url.pathname === "/authorize") {
      const callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.searchParams.set("code", "fixture-code"); callback.searchParams.set("state", url.searchParams.get("state")!);
      res.writeHead(302, { location: callback.href }); return res.end();
    }
    if (url.pathname === "/token") {
      const grant = new URLSearchParams(text).get("grant_type")!; grants.push(grant);
      accessToken = `token-${grants.length}`;
      return json(200, { access_token: accessToken, token_type: "Bearer", refresh_token: `refresh-${grants.length}`, expires_in: grant === "authorization_code" ? 1 : 3600 });
    }
    if (req.headers.authorization !== `Bearer ${accessToken}`) {
      res.setHeader("www-authenticate", `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`);
      return json(401, { error: "unauthorized" });
    }
    if (req.method !== "POST") return json(405, {});
    const message = JSON.parse(text);
    if (blocking.enabled && phase === "reconnect" && message.method === "initialize") { blocking.reached = true; return; }
    if (message.id === undefined) { res.writeHead(202); return res.end(); }
    const result = message.method === "initialize" ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "oauth-fixture", version: "1" } }
      : message.method === "tools/list" ? { tools: [{ name: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] }
        : { content: [{ type: "text", text: "oauth:" + message.params.arguments.text }] };
    json(200, { jsonrpc: "2.0", id: message.id, result });
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-oauth-"));
  const cwd = path.join(root, "project"), agentDir = path.join(root, "agent");
  process.env.EASYMINT_HOME = root; process.env.PI_CODING_AGENT_DIR = agentDir;
  fs.mkdirSync(path.join(cwd, ".easymint"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".easymint/mcp.json"), JSON.stringify({ mcpServers: { oauth: { type: "http", url: base + "/mcp", oauth: true, callbackPort: await freePort(), timeout: 1500 } } }));
  approveMcpServer(cwd, "oauth");
  return { cwd, agentDir, base, grants, blocking };
}

describe("native MCP OAuth GUI bridge", () => {
  it("signs in once across two sessions, refreshes rotated tokens, closes the input and logs out", async () => {
    const { cwd, agentDir, base, grants } = await startFixture();
    for (let i = 0; i < 2; i++) sessions.push(await createPiSession({ cwd, agentDir, store: new Store(root), permissionMode: "standard", canUseTool: async () => ({ behavior: "allow" }) }));
    await waitFor(() => getMcpStatus(cwd)[0]?.state === "needs-auth");
    const result = await loginMcpServer("oauth", cwd);
    expect(result).toEqual({ ok: true });
    expect(ui.opened).toHaveBeenCalledTimes(1);
    expect(ui.inputAborted).toHaveBeenCalled();
    expect(grants).toEqual(["authorization_code", "refresh_token"]);
    expect(getMcpStatus(cwd)[0]?.state).toBe("connected");
    const { McpOAuthCredentialStore } = await import("@earendil-works/pi-coding-agent");
    const credentials = new McpOAuthCredentialStore(new EncryptedMcpAuthBackend(path.join(agentDir, "mcp-auth-v2.json")));
    expect(credentials.tokens("oauth", base + "/mcp")?.refresh_token).toBe("refresh-2");
    expect(await logoutMcpServer("oauth", cwd)).toEqual({ ok: true });
    expect(credentials.tokens("oauth", base + "/mcp")).toBeUndefined();
    expect(getMcpStatus(cwd)[0]?.state).toBe("needs-auth");
    // Cancel a pending browser flow through logout, then verify it cannot resurrect credentials.
    ui.pauseBrowser = true;
    const pending = loginMcpServer("oauth", cwd);
    await waitFor(() => ui.opened.mock.calls.length === 2);
    const loggedOut = await logoutMcpServer("oauth", cwd);
    expect((await pending).ok).toBe(false);
    expect(loggedOut.ok).toBe(true);
    expect(credentials.tokens("oauth", base + "/mcp")).toBeUndefined();
  }, 15000);

  it.each([
    { phase: "metadata", session: false }, { phase: "registration", session: false }, { phase: "token", session: false },
    { phase: "metadata", session: true }, { phase: "registration", session: true }, { phase: "token", session: true },
  ] as const)("logout cancels blocked $phase requests (session=$session) without resurrecting credentials", async ({ phase, session }) => {
    const { cwd, agentDir, base, grants, blocking } = await startFixture(phase);
    if (session) {
      sessions.push(await createPiSession({ cwd, agentDir, store: new Store(root!), permissionMode: "standard", canUseTool: async () => ({ behavior: "allow" }) }));
      await waitFor(() => getMcpStatus(cwd)[0]?.state === "needs-auth");
    }
    blocking.enabled = true;
    const pending = loginMcpServer("oauth", cwd);
    await waitFor(() => blocking.reached);
    const result = await withinCancellationBudget(Promise.all([pending, logoutMcpServer("oauth", cwd)]));
    expect(result[0].ok).toBe(false);
    expect(result[1].ok).toBe(true);
    expect(grants).toEqual([]);
    const { McpOAuthCredentialStore } = await import("@earendil-works/pi-coding-agent");
    const credentials = new McpOAuthCredentialStore(new EncryptedMcpAuthBackend(path.join(agentDir, "mcp-auth-v2.json")));
    expect(credentials.tokens("oauth", base + "/mcp")).toBeUndefined();
  }, 10000);

  it("session disposal cancels a token exchange and finishes the pending login", async () => {
    const { cwd, agentDir, base, blocking } = await startFixture("token");
    const session = await createPiSession({ cwd, agentDir, store: new Store(root!), permissionMode: "standard", canUseTool: async () => ({ behavior: "allow" }) });
    sessions.push(session);
    await waitFor(() => getMcpStatus(cwd)[0]?.state === "needs-auth");
    blocking.enabled = true;
    const pending = loginMcpServer("oauth", cwd);
    await waitFor(() => blocking.reached);
    const [result] = await withinCancellationBudget(Promise.all([pending, disposePiSession(session)]));
    expect(result.ok).toBe(false);
    const { McpOAuthCredentialStore } = await import("@earendil-works/pi-coding-agent");
    const credentials = new McpOAuthCredentialStore(new EncryptedMcpAuthBackend(path.join(agentDir, "mcp-auth-v2.json")));
    expect(credentials.tokens("oauth", base + "/mcp")).toBeUndefined();
  }, 10000);

  it("logout does not wait for an unrelated server startup", async () => {
    const { cwd, agentDir } = await startFixture();
    const file = path.join(cwd, ".easymint/mcp.json");
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    const marker = path.join(root!, "slow.pid");
    config.mcpServers.slow = { type: "stdio", command: process.execPath,
      args: ["-e", `require('fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`], timeout: 30000 };
    fs.writeFileSync(file, JSON.stringify(config));
    approveMcpServer(cwd, "slow");
    sessions.push(await createPiSession({ cwd, agentDir, store: new Store(root!), permissionMode: "full", canUseTool: async () => ({ behavior: "allow" }) }));
    await waitFor(() => getMcpStatus(cwd).some(status => status.name === "oauth" && status.state === "needs-auth") && fs.existsSync(marker));
    const login = loginMcpServer("oauth", cwd);
    const [result, loggedOut] = await withinCancellationBudget(Promise.all([login, logoutMcpServer("oauth", cwd)]));
    expect(result.ok).toBe(false);
    expect(loggedOut.ok).toBe(true);
  }, 10000);

  it("logout cancels post-authorization MCP initialize and allows signing in again", async () => {
    const { cwd, agentDir, base, blocking } = await startFixture("reconnect");
    const file = path.join(cwd, ".easymint/mcp.json");
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    config.mcpServers.oauth.timeout = 30000; config.mcpServers.oauth.requestTimeoutSeconds = 30;
    fs.writeFileSync(file, JSON.stringify(config)); approveMcpServer(cwd, "oauth");
    sessions.push(await createPiSession({ cwd, agentDir, store: new Store(root!), permissionMode: "standard", canUseTool: async () => ({ behavior: "allow" }) }));
    await waitFor(() => getMcpStatus(cwd)[0]?.state === "needs-auth");
    blocking.enabled = true;
    const login = loginMcpServer("oauth", cwd);
    await waitFor(() => blocking.reached);
    const [result, loggedOut] = await withinCancellationBudget(Promise.all([login, logoutMcpServer("oauth", cwd)]));
    expect(result.ok).toBe(false);
    expect(loggedOut.ok).toBe(true);
    const { McpOAuthCredentialStore } = await import("@earendil-works/pi-coding-agent");
    const credentials = new McpOAuthCredentialStore(new EncryptedMcpAuthBackend(path.join(agentDir, "mcp-auth-v2.json")));
    expect(credentials.tokens("oauth", base + "/mcp")).toBeUndefined();
    blocking.enabled = false;
    expect(await loginMcpServer("oauth", cwd)).toEqual({ ok: true });
    expect(getMcpStatus(cwd)[0]?.state).toBe("connected");
  }, 10000);

});

/** Cancellation must finish before the upstream 15-second request timeout. */
async function withinCancellationBudget<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("OAuth cancellation did not settle")), 2000);
    })]);
  } finally { clearTimeout(timer); }
}
