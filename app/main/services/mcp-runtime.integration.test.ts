import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "shell-quote";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "./pi-sdk";
import { Store } from "./store";
import { createPiSession, disposePiSession } from "./pi-session";
import { approveMcpServer, definitionFingerprint, saveMcpServer, scanMcpServers, type McpServerConfig } from "./mcp-service";
import { closeMcpContexts, getMcpStatus, reloadMcpTools, retryMcpServer, toPiMcpEntry } from "./mcp-runtime";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => os.tmpdir() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal: vi.fn() },
}));
const sandbox = vi.hoisted(() => ({ release: vi.fn(async () => {}), wrap: vi.fn(), initialize: vi.fn(async () => ({ ok: true })) }));
vi.mock("./sandbox/manager", () => ({
  ensureSandbox: sandbox.initialize, isSandboxBypassedForMode: (mode: string) => mode === "full",
  wrapForSandbox: sandbox.wrap,
}));

let root: string, cwd: string, agentDir: string;
const active: AgentSession[] = [];
const priorHome = process.env.EASYMINT_HOME;
const priorPi = process.env.PI_CODING_AGENT_DIR;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-mcp-"));
  cwd = path.join(root, "project"); agentDir = path.join(root, "agent");
  fs.mkdirSync(cwd, { recursive: true }); fs.mkdirSync(agentDir, { recursive: true });
  process.env.EASYMINT_HOME = root; process.env.PI_CODING_AGENT_DIR = agentDir;
  sandbox.release.mockClear(); sandbox.wrap.mockReset(); sandbox.initialize.mockClear();
  sandbox.wrap.mockImplementation(async (command: string, { context }: { context: { environment: Record<string, string> } }) => ({
    kind: "argv", argv: parse(command).map(String), env: context.environment, release: sandbox.release,
  }));
});
afterEach(async () => {
  await Promise.all(active.splice(0).map(disposePiSession));
  if (priorHome === undefined) delete process.env.EASYMINT_HOME; else process.env.EASYMINT_HOME = priorHome;
  if (priorPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = priorPi;
  fs.rmSync(root, { recursive: true, force: true });
});
function config(extra: Partial<McpServerConfig> = {}): McpServerConfig {
  return { type: "stdio", command: process.execPath, args: [path.resolve("tests/fixtures/echo-mcp.cjs")], timeout: 2500, ...extra };
}
function writeProject(cfg = config(), name = "echo") {
  fs.mkdirSync(path.join(cwd, ".easymint"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".easymint/mcp.json"), JSON.stringify({ mcpServers: { [name]: cfg } }));
}
async function waitFor(predicate: () => boolean) {
  const until = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > until) throw new Error("MCP did not settle: " + JSON.stringify(getMcpStatus(cwd)));
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}
async function create(mode: () => string = () => "standard", canUseTool = vi.fn(async () => ({ behavior: "allow" as const }))) {
  const session = await createPiSession({ cwd, agentDir, store: new Store(root), permissionMode: mode(), getPermissionMode: mode, canUseTool });
  active.push(session); return session;
}
async function script(session: AgentSession, code: string, id = "outer") {
  const args = { code };
  const toolCall = { id, name: "codemode", arguments: args };
  session.agent.state.messages.push({ role: "assistant", content: [{ type: "toolCall", ...toolCall }], timestamp: Date.now() } as never);
  const gate = await session.agent.beforeToolCall!({ toolCall, args } as never);
  if (gate?.block) throw new Error(gate.reason);
  const tool = session.agent.state.tools.find(tool => tool.name === "codemode")!;
  return tool.execute(id, args, new AbortController().signal);
}
const echoCode = 'const r = await tools.mcp__echo__echo({text:"hello"}); text(r.content[0].text);';

describe("Pi MCP host integration", () => {
  it("never starts unapproved or readonly servers, including direct retry", async () => {
    writeProject();
    await create();
    expect(sandbox.wrap).not.toHaveBeenCalled();
    expect(await retryMcpServer("echo", cwd)).toMatchObject({ ok: false });
    approveMcpServer(cwd, "echo");
    const readonly = await create(() => "readonly");
    expect(readonly.getActiveToolNames()).not.toContain("codemode");
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(sandbox.wrap).not.toHaveBeenCalled();
  });

  it("runs MCP through codemode and EM permission checks, with nested execution events", async () => {
    writeProject(); approveMcpServer(cwd, "echo");
    let deny = true;
    const canUseTool = vi.fn(async (name: string) => deny && name.startsWith("mcp__")
      ? { behavior: "deny" as const, message: "MCP blocked by EM" } : { behavior: "allow" as const });
    const session = await create(() => "standard", canUseTool as never);
    await waitFor(() => getMcpStatus(cwd)[0]?.state === "connected");
    expect(session.getActiveToolNames()).toContain("codemode");
    expect(session.agent.state.tools.map(tool => tool.name)).not.toContain("mcp__echo__echo");
    const denied = await script(session, echoCode);
    expect(JSON.stringify(denied.content)).toContain("MCP blocked by EM");
    expect(canUseTool).toHaveBeenCalledWith("mcp__echo__echo", expect.anything(), expect.anything());
    deny = false;
    const events: unknown[] = [];
    const unsub = session.subscribe(event => { if ("parentToolCallId" in event) events.push(event); });
    const result = await script(session, echoCode, "allowed"); unsub();
    expect(JSON.stringify(result.content)).toContain("echo:hello");
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "tool_execution_start", parentToolCallId: "allowed", toolName: "mcp__echo__echo" })]));
    const models = await script(session, 'text(typeof models);', "models");
    expect(JSON.stringify(models.content)).toContain("undefined");
    expect(sandbox.initialize).toHaveBeenCalled();
  }, 15000);

  it("revokes live connections without interrupting the session and reconnects under the new mode", async () => {
    writeProject(); approveMcpServer(cwd, "echo");
    let mode = "full";
    const session = await create(() => mode);
    await waitFor(() => getMcpStatus(cwd)[0]?.state === "connected");
    expect(sandbox.initialize).not.toHaveBeenCalled();
    mode = "standard";
    await closeMcpContexts([session.sessionId]);
    await waitFor(() => getMcpStatus(cwd)[0]?.state === "connected");
    expect(sandbox.release).toHaveBeenCalledTimes(1);
    expect(sandbox.initialize).toHaveBeenCalled();
    expect(JSON.stringify((await script(session, echoCode)).content)).toContain("echo:hello");
    mode = "readonly";
    await closeMcpContexts([session.sessionId]);
    expect(sandbox.release).toHaveBeenCalledTimes(2);
    await expect(script(session, echoCode, "readonly")).rejects.toThrow("只读");
  }, 15000);

  it("rejects reuse of a full-access transport as soon as the live mode tightens", async () => {
    writeProject(); approveMcpServer(cwd, "echo");
    let mode = "full";
    const session = await create(() => mode);
    await waitFor(() => getMcpStatus(cwd)[0]?.state === "connected");
    // A nested call can reach send() after the cache commit but before the revocation await.
    mode = "standard";
    const result = await script(session, echoCode, "mode-drift");
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("权限已撤销");
  }, 15000);

  it("disposing a parent session leaves a still-running child's MCP usable", async () => {
    writeProject(); approveMcpServer(cwd, "echo");
    let mode = "standard";
    const parent = await create(() => mode);
    const child = await createPiSession({ cwd, agentDir, store: new Store(root), executionOwner: parent.sessionId,
      permissionMode: mode, getPermissionMode: () => mode, canUseTool: async () => ({ behavior: "allow" }) });
    active.push(child);
    expect(JSON.stringify((await script(child, echoCode, "child-before")).content)).toContain("echo:hello");
    await disposePiSession(parent);
    await expect(script(child, echoCode, "child-after")).resolves.toMatchObject({
      content: expect.arrayContaining([{ type: "text", text: "echo:hello" }]),
    });
    // The same parent alias still recursively revokes descendants when permissions tighten.
    mode = "readonly";
    await closeMcpContexts([parent.sessionId]);
    await expect(script(child, echoCode, "child-revoked")).rejects.toThrow("只读");
  }, 15000);

  it("reloads changed definitions only after reapproval and preserves tool identity", async () => {
    writeProject(); approveMcpServer(cwd, "echo");
    const session = await create();
    await waitFor(() => getMcpStatus(cwd)[0]?.state === "connected");
    writeProject(config({ description: "changed" }));
    reloadMcpTools();
    await waitFor(() => sandbox.release.mock.calls.length === 1);
    expect(scanMcpServers(cwd)[0]?.pendingApproval).toBe(true);
    expect(session.getAllTools().find(tool => tool.name === "mcp__echo__echo")?.exposure).toBe("hidden");
    approveMcpServer(cwd, "echo"); reloadMcpTools();
    await waitFor(() => getMcpStatus(cwd)[0]?.state === "connected");
    expect(JSON.stringify((await script(session, echoCode)).content)).toContain("echo:hello");
  }, 15000);

  it("keeps EM scope priority and native config units, blocks legacy SSE and missing variables", () => {
    writeProject(config(), "same");
    saveMcpServer("same", config({ description: "user wins" }));
    expect(scanMcpServers(cwd).find(server => server.name === "same")?.scope).toBe("user");
    const entry = toPiMcpEntry("sample", config({ timeout: 1234, requestTimeoutSeconds: 9, description: "native" }), "fixture");
    expect(entry.config).toMatchObject({ timeout: 9, description: "native", type: "stdio" });
    expect(() => toPiMcpEntry("old", { type: "sse", url: "https://example.invalid/sse" }, "fixture")).toThrow("HTTP+SSE");
    expect(() => toPiMcpEntry("missing", config({ env: { X: "${EM_NEVER_DEFINED_TEST}" } }), "fixture")).toThrow("未设置");
    expect(definitionFingerprint(config({ exposure: "direct" }))).not.toBe(definitionFingerprint(config()));
  });

  it("reconnects after a stdio server exits instead of reusing a dead client", async () => {
    const pidFile = path.join(root, "server.pid");
    writeProject(config({ args: ["-e", `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));require(${JSON.stringify(path.resolve("tests/fixtures/echo-mcp.cjs"))})`] }));
    approveMcpServer(cwd, "echo"); const session = await create();
    await waitFor(() => getMcpStatus(cwd)[0]?.state === "connected");
    const oldPid = Number(fs.readFileSync(pidFile, "utf8")); process.kill(oldPid, "SIGTERM");
    await waitFor(() => getMcpStatus(cwd)[0]?.state === "disconnected");
    const result = await script(session, echoCode);
    expect(JSON.stringify(result.content)).toContain("echo:hello");
    expect(Number(fs.readFileSync(pidFile, "utf8"))).not.toBe(oldPid);
  }, 15000);

  it("passes !cmd environment values literally without executing a host command", async () => {
    const marker = path.join(root, "must-not-exist");
    const literal = `!touch ${marker}`;
    writeProject(config({ env: { EM_LITERAL: literal }, args: ["-e", `if(process.env.EM_LITERAL!==${JSON.stringify(literal)})throw new Error('literal lost');require(${JSON.stringify(path.resolve("tests/fixtures/echo-mcp.cjs"))})`] }));
    approveMcpServer(cwd, "echo"); const session = await create();
    await waitFor(() => getMcpStatus(cwd)[0]?.state === "connected");
    expect(JSON.stringify((await script(session, echoCode)).content)).toContain("echo:hello");
    expect(fs.existsSync(marker)).toBe(false);
  }, 15000);

  it("terminates orphaned descendants before releasing the stdio sandbox lease", async () => {
    if (process.platform === "win32") return;
    const pidFile = path.join(root, "parent.pid"), heartbeat = path.join(cwd, "heartbeat");
    const childCode = `setInterval(()=>require('fs').writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),10);`;
    const parentCode = `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});require(${JSON.stringify(path.resolve("tests/fixtures/echo-mcp.cjs"))});`;
    writeProject(config({ args: ["-e", parentCode] })); approveMcpServer(cwd, "echo");
    await create(() => "full");
    await waitFor(() => getMcpStatus(cwd)[0]?.state === "connected" && fs.existsSync(heartbeat));
    process.kill(Number(fs.readFileSync(pidFile, "utf8")), "SIGTERM");
    await waitFor(() => sandbox.release.mock.calls.length === 1);
    const stopped = fs.readFileSync(heartbeat, "utf8");
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(fs.readFileSync(heartbeat, "utf8")).toBe(stopped);
  }, 15000);
});
