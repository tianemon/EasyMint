/** Pi 1.0.4 host hooks. Fail closed on upstream drift; no copied connection state machine. */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const root = path.join(__dirname, "..", "node_modules/@earendil-works/pi-coding-agent");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (pkg.version !== "1.0.4") throw new Error("MCP host hooks require a review for Pi " + pkg.version);
const expected = {
  "dist/extensions/mcp/index.js": "90779ac1e18246c84888024645a21a1877bb85595dac1b8bf33b28163c3d0057",
  "dist/extensions/mcp/index.d.ts": "2326ac2f37daa7bbf258629846b4ff6d4d8d2c570331777b2da0852525de843e",
  "dist/extensions/mcp/runtime.js": "55f0d73d76a80b5343781ea5d99b7ab248e201276c4552dc55cce7bee972852c",
  "dist/extensions/mcp/runtime.d.ts": "15d7bc9ee02e59c1b9e04c254fd43fe45ce4abfc0fc034dfdb12442d0e5b1a9b",
  "dist/index.js": "5482298b995db935f7b96f5d6056fa1c36ac6fc80456be594ef65b83c62b0d30",
  "dist/index.d.ts": "b254e36846b1dcc64ce1a8ba72e23fb410df4aa4408ba8c23e69e5b3f934e3cc",
};
const hash = source => createHash("sha256").update(source).digest("hex");
// Generate from pristine source, not from the previously patched result. Layered patches otherwise
// cease being idempotent as soon as a later edit changes an earlier replacement's text.
const cacheFile = path.join(__dirname, "../node_modules/.cache/easymint-pi-mcp-1.0.4.json");
const cached = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
const originals = {}, sources = {}, current = {};
for (const [file, checksum] of Object.entries(expected)) {
  current[file] = fs.readFileSync(path.join(root, file), "utf8");
  originals[file] = cached[file]?.original ?? current[file];
  if (hash(originals[file]) !== checksum || (hash(current[file]) !== checksum && hash(current[file]) !== cached[file]?.appliedHash)) {
    throw new Error("Pi MCP source changed outside the verified patch: " + file);
  }
  sources[file] = originals[file];
}
function patch(file, before, after) {
  const source = sources[file];
  if (source.includes(after)) return;
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error("Pi MCP patch no longer matches: " + file);
  }
  sources[file] = source.replace(before, after);
}
patch("dist/extensions/mcp/index.js", "        const emitChange = () => {", `        const hostStatus = () => servers.map(server => ({
            name: server.entry.name,
            state: !isEnabled(server) ? "disabled" : server.connection?.state ?? "connecting",
            toolCount: server.connection?.tools.length ?? 0,
            error: server.connection?.error,
        }));
        let hostContext;
        const emitChange = () => {
            options.onStatus?.(hostStatus());`);
patch("dist/extensions/mcp/index.js", '        pi.on("session_start", (_event, ctx) => {', `        const startHostSession = (_event, ctx) => {
            hostContext = ctx;`);
patch("dist/extensions/mcp/index.js", `        });
        // The first prompt waits for servers`, `        };
        pi.on("session_start", startHostSession);
        // The first prompt waits for servers`);
patch("dist/extensions/mcp/index.js", '        pi.registerCommand("mcp", {', `        // EM host API: changes still use Pi's own connections, tools, OAuth and generation guards.
        let hostReload = Promise.resolve();
        const hostController = {
            status: hostStatus,
            reload: () => {
                const work = hostReload.then(async () => {
                    if (!sessionActive || !hostContext) return;
                    generation++;
                    const closing = connections();
                    for (const server of servers) hideTools(server.entry.name);
                    servers = [];
                    emitChange();
                    await Promise.all(closing.map(connection => connection.close()));
                    if (sessionActive) startHostSession({}, hostContext);
                });
                hostReload = work.catch(() => undefined);
                return work;
            },
            ready: async () => { await hostReload; await pending; },
            reconnect: async name => {
                await hostReload; await pending;
                const server = findServer(name);
                if (!server) throw new Error("MCP server is unavailable: " + name);
                const error = await reconnect(server);
                if (error) throw new Error(error);
                ensureDiscoveryActive(hostContext);
            },
            login: async name => {
                await hostReload; await pending;
                const server = findServer(name);
                if (!server || !hostContext) throw new Error("MCP server is unavailable: " + name);
                if (!usesOAuth(server)) throw new Error("MCP server does not use OAuth: " + name);
                const error = await signIn(server, {
                    showAuthorizationUrl: url => { openUrl(url.href); },
                    promptForRedirectUrl: signal => hostContext.ui.input(
                        "等待浏览器授权；无法自动回调时可粘贴回调 URL", "http://127.0.0.1:.../callback?code=...", { signal }),
                });
                if (error) throw new Error(error);
                ensureDiscoveryActive(hostContext);
            },
            logout: async name => {
                await hostReload; await pending;
                const server = findServer(name);
                if (!server) throw new Error("MCP server is unavailable: " + name);
                await signOut(server);
            },
        };
        options.onController?.(hostController);
        pi.registerCommand("mcp", {`);
// The transport factory can await sandbox setup. Do not abandon a just-created connection on shutdown.
patch("dist/extensions/mcp/index.js", `                const connection = await createConnection(server);
                if (!isCurrent())
                    return;`, `                const connection = await createConnection(server);
                if (!isCurrent()) {
                    await connection.close();
                    return;
                }`);
patch("dist/extensions/mcp/runtime.js", `        this.createTransport = options.createTransport;`, `        this.createTransport = options.createTransport;
        this.connectTimeoutMs = options.connectTimeoutMs;`);
patch("dist/extensions/mcp/runtime.js", `            await client.connect(transport);`, `            let connectTimer;
            let connectTimedOut = false;
            try {
                if (this.connectTimeoutMs) connectTimer = setTimeout(() => {
                    connectTimedOut = true;
                    void closeClient();
                }, this.connectTimeoutMs);
                await client.connect(transport);
            } catch (error) {
                if (connectTimedOut) throw new Error("MCP initialize timed out after " + this.connectTimeoutMs + " ms");
                throw error;
            } finally { clearTimeout(connectTimer); }`);
patch("dist/extensions/mcp/index.js", `                credentials: getCredentials(runtime),`, `                credentials: getCredentials(runtime),
                connectTimeoutMs: options.connectTimeoutMs?.(server.entry),`);
patch("dist/extensions/mcp/runtime.d.ts", `        credentials: McpOAuthCredentialStore;`, `        credentials: McpOAuthCredentialStore;
        connectTimeoutMs?: number;`);
const hooks = `
/** Version-pinned EM host hooks; see scripts/patch-pi-mcp.cjs. */
export interface McpHostStatus {
    name: string;
    state: "connecting" | "connected" | "disconnected" | "needs-auth" | "failed" | "closed" | "disabled";
    toolCount: number;
    error?: string;
}
export interface McpHostController {
    status(): McpHostStatus[];
    reload(): Promise<void>;
    ready(): Promise<void>;
    reconnect(name: string): Promise<void>;
    login(name: string): Promise<void>;
    logout(name: string): Promise<void>;
}
`;
patch("dist/extensions/mcp/index.d.ts", `export interface McpExtensionOptions {`, `${hooks}
export interface McpExtensionOptions {
    onStatus?: (status: McpHostStatus[]) => void;
    onController?: (controller: McpHostController) => void;
    connectTimeoutMs?: (entry: McpServerEntry) => number;`);
patch("dist/index.js", `export { createMcpExtension } from "./extensions/mcp/index.js";`, `export { createMcpExtension } from "./extensions/mcp/index.js";
export { McpOAuthCredentialStore } from "./extensions/mcp/oauth.js";
export { McpServerConnection } from "./extensions/mcp/runtime.js";`);
patch("dist/index.d.ts", `export { createMcpExtension, type McpExtensionOptions, type McpTransportFactory } from "./extensions/mcp/index.ts";`, `export { createMcpExtension, type McpExtensionOptions, type McpTransportFactory, type McpHostController, type McpHostStatus } from "./extensions/mcp/index.ts";
export { McpOAuthCredentialStore } from "./extensions/mcp/oauth.ts";
export { McpServerConnection } from "./extensions/mcp/runtime.ts";
export type { AuthStorageBackend } from "./core/auth-storage.ts";`);
patch("dist/index.js", "//# sourceMappingURL=index.js.map", "export { signInMcpServer } from './extensions/mcp/oauth.js';\n//# sourceMappingURL=index.js.map");
patch("dist/index.d.ts", "//# sourceMappingURL=index.d.ts.map", "export { signInMcpServer } from './extensions/mcp/oauth.ts';\n//# sourceMappingURL=index.d.ts.map");
patch("dist/extensions/mcp/index.js", "            login: async name => {", "            login: async (name, hostPrompt) => {");
patch("dist/extensions/mcp/index.js", "                const error = await signIn(server, {\n                    showAuthorizationUrl: url => { openUrl(url.href); },", "                const error = await signIn(server, hostPrompt ?? {\n                    showAuthorizationUrl: url => { openUrl(url.href); },");
patch("dist/extensions/mcp/index.d.ts", "    login(name: string): Promise<void>;", "    login(name: string, prompt?: import('./oauth.ts').McpSignInPrompt): Promise<void>;");
patch("dist/extensions/mcp/index.js", `        pi.on("session_shutdown", async () => {
            sessionActive = false;
            generation++;
            const closing = connections();
            servers = [];
            emitChange();
            await Promise.all(closing.map((connection) => connection.close()));
        });`, `        let hostClosing = Promise.resolve();
        const closeHostSession = () => {
            sessionActive = false;
            generation++;
            const closing = connections();
            for (const server of servers) hideTools(server.entry.name);
            servers = [];
            emitChange();
            return hostClosing = Promise.all([hostClosing, hostReload, ...closing.map(connection => connection.close())]).then(() => undefined);
        };
        pi.on("session_shutdown", closeHostSession);`);
patch("dist/extensions/mcp/index.js", `            status: hostStatus,`, `            status: hostStatus,
            close: closeHostSession,`);
patch("dist/extensions/mcp/index.d.ts", `    status(): McpHostStatus[];`, `    status(): McpHostStatus[];
    close(): Promise<void>;`);
// Preserve diagnostics through the host's asynchronous transport wrapper.
patch("dist/extensions/mcp/runtime.js", `const stdio = transport instanceof StdioTransport ? transport : undefined;`, `const stdio = typeof transport.stderr === "string" ? transport : undefined;`);
patch("dist/extensions/mcp/runtime.js", `            if (transport instanceof StdioTransport) {`, `            if (typeof transport?.stderr === "string") {`);
const nextCache = {};
for (const [file, source] of Object.entries(sources)) {
  if (source !== current[file]) {
    const target = path.join(root, file);
    fs.writeFileSync(target + ".em-tmp", source);
    fs.renameSync(target + ".em-tmp", target);
  }
  nextCache[file] = { original: originals[file], appliedHash: hash(source) };
}
fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
fs.writeFileSync(cacheFile + ".tmp", JSON.stringify(nextCache));
fs.renameSync(cacheFile + ".tmp", cacheFile);
console.log("[patch-pi-mcp] Pi 1.0.4 host hooks verified");
