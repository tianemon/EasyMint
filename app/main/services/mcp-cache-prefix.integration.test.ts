import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "shell-quote";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelRuntime, type AgentSession } from "@earendil-works/pi-coding-agent";
import { getCurrentSystemPrompt, getCurrentTools, type Message } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { getModelRuntime } from "./pi-init";
import { createPiSession, disposePiSession } from "./pi-session";
import { approveMcpServer } from "./mcp-service";
import { getMcpStatus } from "./mcp-runtime";
import { Store } from "./store";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal: vi.fn() } }));
vi.mock("./pi-init", async original => ({ ...await original<object>(), getModelRuntime: vi.fn() }));
vi.mock("./sandbox/manager", () => ({ ensureSandbox: vi.fn(async () => ({ ok: true })),
  isSandboxBypassedForMode: (mode: string) => mode === "full",
  wrapForSandbox: vi.fn(async (command: string, { context }: { context: { environment: Record<string, string> } }) => ({
    kind: "argv", argv: parse(command).map(String), env: context.environment, release: async () => {},
  })) }));

let root: string, cwd: string, agentDir: string, session: AgentSession | undefined;
const priorHome = process.env.EASYMINT_HOME, priorPi = process.env.PI_CODING_AGENT_DIR;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-prefix-"));
  cwd = path.join(root, "project"); agentDir = path.join(root, "agent");
  fs.mkdirSync(path.join(cwd, ".easymint"), { recursive: true }); fs.mkdirSync(agentDir);
  process.env.EASYMINT_HOME = root; process.env.PI_CODING_AGENT_DIR = agentDir;
});
afterEach(async () => {
  if (session) await disposePiSession(session); session = undefined;
  if (priorHome === undefined) delete process.env.EASYMINT_HOME; else process.env.EASYMINT_HOME = priorHome;
  if (priorPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = priorPi;
  vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true });
});

it("preserves the actual two-turn model prefix when MCP instructions arrive between requests", async () => {
  const gate = path.join(root, "release-server");
  fs.writeFileSync(path.join(cwd, ".easymint/mcp.json"), JSON.stringify({ mcpServers: { echo: {
    type: "stdio", command: process.execPath, args: [path.resolve("tests/fixtures/echo-mcp.cjs")],
    timeout: 10000, env: { EM_ECHO_LIST_GATE: gate, EM_ECHO_INSTRUCTIONS: "Untrusted server instruction" },
  } } }));
  approveMcpServer(cwd, "echo");
  const runtime = await ModelRuntime.create({ modelsPath: null, authPath: path.join(root, "auth.json"), allowModelNetwork: false });
  const faux = fauxProvider({ provider: "cache-fixture", models: [{ id: "fixture" }], tokensPerSecond: 0 });
  runtime.registerNativeProvider(faux.provider); await runtime.refresh({ allowNetwork: false });
  vi.mocked(getModelRuntime).mockResolvedValue(runtime);
  const requests: Message[][] = [];
  faux.setResponses([
    context => { requests.push(JSON.parse(JSON.stringify(context.messages))); return fauxAssistantMessage("first answer"); },
    context => { requests.push(JSON.parse(JSON.stringify(context.messages))); return fauxAssistantMessage("second answer"); },
  ]);
  session = await createPiSession({ cwd, agentDir, store: new Store(root), model: runtime.getModel("cache-fixture", "fixture")!,
    permissionMode: "standard", canUseTool: async () => ({ behavior: "allow" }) });
  await session.prompt("first message");
  expect(getMcpStatus(cwd)[0]?.state).not.toBe("connected");
  fs.writeFileSync(gate, "ready");
  await vi.waitFor(() => expect(getMcpStatus(cwd)[0]?.state).toBe("connected"), { timeout: 5000 });
  await session.prompt("second message");
  expect(requests).toHaveLength(2);
  expect(getCurrentSystemPrompt(requests[1]!)).toBe(getCurrentSystemPrompt(requests[0]!));
  expect(getCurrentSystemPrompt(requests[1]!)).toContain("mcp__echo");
  expect(getCurrentSystemPrompt(requests[1]!)).not.toContain("Untrusted server instruction");
  expect(getCurrentTools(requests[1]!)).toEqual(getCurrentTools(requests[0]!));
  expect(requests[1]!.filter(message => message.role === "user")).toHaveLength(2);
}, 15000);
