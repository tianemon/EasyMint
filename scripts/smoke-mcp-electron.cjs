/** Run with Electron, passing an app.asar path. No user files, accounts or network are used. */
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
app.disableHardwareAcceleration();
const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-electron-smoke-"));
process.env.EASYMINT_HOME = root;
process.env.PI_CODING_AGENT_DIR = root;
let session;
const timeout = setTimeout(() => { console.error("[mcp-smoke] timed out"); app.exit(1); }, 20000);

class EchoTransport {
  messages = new Set(); closes = new Set();
  async start() {}
  async close() { for (const listener of this.closes) listener(); }
  onMessage(listener) { this.messages.add(listener); return () => this.messages.delete(listener); }
  onError() { return () => {}; }
  onClose(listener) { this.closes.add(listener); return () => this.closes.delete(listener); }
  async send(message) {
    if (message.id === undefined) return;
    const result = message.method === "initialize"
      ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
      : message.method === "tools/list"
        ? { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] }
        : { content: [{ type: "text", text: `echo:${message.params.arguments.text}` }] };
    queueMicrotask(() => { for (const listener of this.messages) listener({ jsonrpc: "2.0", id: message.id, result }); });
  }
}

app.whenReady().then(async () => {
  const archive = process.argv[2];
  if (!archive) throw new Error("Pass the packaged app.asar path");
  const entry = path.join(path.resolve(archive), "node_modules/@earendil-works/pi-coding-agent/dist/index.js");
  const sdk = await import(pathToFileURL(entry).href);
  let controller;
  const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir: root, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [
      sdk.createMcpExtension({ loadConfig: () => ({ servers: [{ name: "fixture", source: "smoke", config: { command: "unused" } }], errors: [] }),
        createTransport: () => new EchoTransport(), onController: value => { controller = value; } }),
      sdk.createCodemodeExtension({ models: false }),
    ],
  });
  await loader.reload();
  if (loader.getExtensions().errors.length) throw new Error(JSON.stringify(loader.getExtensions().errors));
  ({ session } = await sdk.createAgentSession({ cwd: root, agentDir: root, resourceLoader: loader,
    sessionManager: sdk.SessionManager.create(root, path.join(root, "sessions")), noTools: "builtin" }));
  await session.bindExtensions({ mode: "rpc" });
  await controller.ready();
  const code = 'const r = await tools.mcp__fixture__echo({text:"packaged-worker-wasm"}); text(r.content[0].text);';
  session.agent.state.messages.push({ role: "assistant", content: [{ type: "toolCall", id: "smoke", name: "codemode", arguments: { code } }], timestamp: Date.now() });
  const tool = session.agent.state.tools.find(tool => tool.name === "codemode");
  if (!tool) throw new Error("codemode not activated");
  const result = await tool.execute("smoke", { code }, new AbortController().signal);
  if (result.isError || !JSON.stringify(result.content).includes("echo:packaged-worker-wasm")) throw new Error(JSON.stringify(result));
  console.log("[mcp-smoke] PASS Electron " + process.versions.electron + ": asar ESM + Worker + wasm + codemode -> MCP");
}).then(async () => {
  await session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session?.dispose();
  clearTimeout(timeout); fs.rmSync(root, { recursive: true, force: true }); app.exit(0);
}).catch(async error => {
  console.error("[mcp-smoke] FAIL", error);
  try { await session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session?.dispose(); } catch {}
  clearTimeout(timeout); fs.rmSync(root, { recursive: true, force: true }); app.exit(1);
});
