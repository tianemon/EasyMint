import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "shell-quote";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelRuntime, type AgentSession } from "@earendil-works/pi-coding-agent";
import { getCurrentSystemPrompt, getCurrentTools, type Message } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
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

it("delivers deferred server instructions as untrusted paged search results without enabling codemode", async () => {
  const instructions = "A".repeat(4095) + "😀" + "end-of-server-instructions";
  fs.writeFileSync(path.join(cwd, ".easymint/mcp.json"), JSON.stringify({ mcpServers: { echo: {
    type: "stdio", command: process.execPath, args: [path.resolve("tests/fixtures/echo-mcp.cjs")],
    exposure: "deferred", timeout: 10000, env: { EM_ECHO_INSTRUCTIONS: instructions },
  }, zzz: { type: "stdio", command: process.execPath, args: [path.resolve("tests/fixtures/echo-mcp.cjs")],
    exposure: "deferred", timeout: 10000, env: { EM_ECHO_INSTRUCTIONS: "Unrelated server guidance" } } } }));
  approveMcpServer(cwd, "echo");
  approveMcpServer(cwd, "zzz");
  const runtime = await ModelRuntime.create({ modelsPath: null, authPath: path.join(root, "auth.json"), allowModelNetwork: false });
  const faux = fauxProvider({ provider: "deferred-fixture", models: [{ id: "fixture" }], tokensPerSecond: 0 });
  runtime.registerNativeProvider(faux.provider); await runtime.refresh({ allowNetwork: false });
  vi.mocked(getModelRuntime).mockResolvedValue(runtime);
  const outputs: string[] = [];
  let nextQuery = "";
  const lastResult = (messages: Message[]): string => JSON.stringify(messages.filter(message => message.role === "toolResult").at(-1)?.content);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("tool_search", { query: "mcp__echo__echo", limit: 1 }), { stopReason: "toolUse" }),
    context => {
      const text = lastResult(context.messages); outputs.push(text);
      const result = context.messages.filter(message => message.role === "toolResult").at(-1);
      const guidance = result?.content.find(block => block.type === "text" && block.text.includes("Untrusted third-party"));
      if (!guidance || guidance.type !== "text") throw new Error("missing MCP guidance");
      nextQuery = JSON.parse(guidance.text.slice(guidance.text.indexOf("\n") + 1)).servers[0].nextQuery;
      return fauxAssistantMessage("first page read");
    },
    () => fauxAssistantMessage(fauxToolCall("tool_search", { query: nextQuery }), { stopReason: "toolUse" }),
    context => { outputs.push(lastResult(context.messages)); return fauxAssistantMessage("second page read"); },
    fauxAssistantMessage(fauxToolCall("tool_search", { query: "echo" }), { stopReason: "toolUse" }),
    context => { outputs.push(lastResult(context.messages)); return fauxAssistantMessage("server guidance reread"); },
  ]);
  session = await createPiSession({ cwd, agentDir, store: new Store(root), model: runtime.getModel("deferred-fixture", "fixture")!,
    permissionMode: "standard", canUseTool: async () => ({ behavior: "allow" }) });
  await vi.waitFor(() => expect(getMcpStatus(cwd).map(status => status.state)).toEqual(["connected", "connected"]), { timeout: 5000 });
  expect(session.getActiveToolNames()).toContain("tool_search");
  expect(session.getActiveToolNames()).not.toContain("codemode");
  await session.prompt("Find the echo tool and read its server guidance.");
  expect(outputs[0]).toContain("Untrusted third-party MCP server data");
  expect(outputs[0]).not.toContain("end-of-server-instructions");
  expect(nextQuery).toBe("mcp__echo@4097");
  expect(session.getActiveToolNames()).not.toContain("mcp__zzz__echo");
  await session.prompt("Read the next page.");
  expect(outputs[1]).toContain("end-of-server-instructions");
  expect(outputs[1]).not.toContain("Unrelated server guidance");
  expect(session.getActiveToolNames()).not.toContain("mcp__zzz__echo");
  await session.prompt("Read the server guidance again.");
  expect(outputs[2]).toContain("Untrusted third-party MCP server data");
  expect(outputs[2]).not.toContain("Unrelated server guidance");
  expect(session.getActiveToolNames()).not.toContain("mcp__zzz__echo");
  expect(session.getActiveToolNames()).not.toContain("codemode");
}, 15000);

it("delivers resource-only server guidance to the model without listing resources", async () => {
  const instructions = "Resource-only untrusted guidance";
  const resourceLog = path.join(root, "resource-list.log");
  fs.writeFileSync(path.join(cwd, ".easymint/mcp.json"), JSON.stringify({ mcpServers: { resource_only: {
    type: "stdio", command: process.execPath, args: [path.resolve("tests/fixtures/resource-mcp.cjs")],
    exposure: "deferred", timeout: 10000,
    env: { EM_RESOURCE_ONLY: "1", EM_RESOURCE_INSTRUCTIONS: instructions, EM_MCP_RESOURCE_LOG: resourceLog },
  } } }));
  approveMcpServer(cwd, "resource_only");
  const runtime = await ModelRuntime.create({ modelsPath: null, authPath: path.join(root, "auth.json"), allowModelNetwork: false });
  const faux = fauxProvider({ provider: "resource-fixture", models: [{ id: "fixture" }], tokensPerSecond: 0 });
  runtime.registerNativeProvider(faux.provider); await runtime.refresh({ allowNetwork: false });
  vi.mocked(getModelRuntime).mockResolvedValue(runtime);
  let modelResult = "";
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("tool_search", { query: "resource_only" }), { stopReason: "toolUse" }),
    context => { modelResult = JSON.stringify(context.messages.filter(message => message.role === "toolResult").at(-1)?.content); return fauxAssistantMessage("guidance read"); },
  ]);
  session = await createPiSession({ cwd, agentDir, store: new Store(root), model: runtime.getModel("resource-fixture", "fixture")!,
    permissionMode: "standard", canUseTool: async () => ({ behavior: "allow" }) });
  await vi.waitFor(() => expect(getMcpStatus(cwd)[0]?.state).toBe("connected"), { timeout: 5000 });
  await session.prompt("Read the resource server guidance.");
  expect(modelResult).toContain(instructions);
  expect(modelResult).toContain("Untrusted third-party MCP server data");
  expect(fs.existsSync(resourceLog)).toBe(false);
  expect(session.getActiveToolNames()).not.toContain("codemode");
}, 15000);
