/** Pi 1.1.0 host hooks. Fail closed on upstream drift; no copied connection state machine. */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const root = path.join(__dirname, "..", "node_modules/@earendil-works/pi-coding-agent");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (pkg.version !== "1.1.0") throw new Error("MCP host hooks require a review for Pi " + pkg.version);
const expected = {
  "dist/extensions/mcp/index.js": "ee7e759f8b1e3946226a87f3af5e9af74a5a65106888037b890d4680faaea2d5",
  "dist/extensions/mcp/index.d.ts": "2326ac2f37daa7bbf258629846b4ff6d4d8d2c570331777b2da0852525de843e",
  "dist/extensions/mcp/runtime.js": "55f0d73d76a80b5343781ea5d99b7ab248e201276c4552dc55cce7bee972852c",
  "dist/extensions/mcp/runtime.d.ts": "15d7bc9ee02e59c1b9e04c254fd43fe45ce4abfc0fc034dfdb12442d0e5b1a9b",
  "dist/index.js": "5482298b995db935f7b96f5d6056fa1c36ac6fc80456be594ef65b83c62b0d30",
  "dist/index.d.ts": "b254e36846b1dcc64ce1a8ba72e23fb410df4aa4408ba8c23e69e5b3f934e3cc",
};
const hash = source => createHash("sha256").update(source).digest("hex");
// Generate from pristine source, not from the previously patched result. Layered patches otherwise
// cease being idempotent as soon as a later edit changes an earlier replacement's text.
const cacheFile = path.join(__dirname, "../node_modules/.cache/easymint-pi-mcp-1.1.0.json");
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
        let hostClosed = false;
        let hostReload = Promise.resolve();
        let hostClosing;
        const emitChange = () => {
            options.onStatus?.(hostStatus());`);
patch("dist/extensions/mcp/index.js", '        pi.on("session_start", (_event, ctx) => {', `        const startHostSession = (_event, ctx) => {
            hostContext = ctx;`);
patch("dist/extensions/mcp/index.js", `        });
        // The first prompt waits for servers`, `        };
        pi.on("session_start", startHostSession);
        // The first prompt waits for servers`);
// Preserve Pi 1.1.0's abortable lifetime and tracked actions, including pending startup.
patch("dist/extensions/mcp/index.js", `        pi.on("session_shutdown", async () => {
            session.abort();
            const closing = connections();
            servers = [];
            emitChange();
            await Promise.all([...backgroundActions, ...closing.map((connection) => connection.close())]);
        });`, `        const closeHostConnections = () => {
            session.abort();
            const closing = connections();
            const ready = servers.flatMap(server => [server.ready, server.closing].filter(Boolean));
            for (const server of servers) hideTools(server.entry.name);
            servers = [];
            emitChange();
            return Promise.all([pending, ...backgroundActions, ...ready, ...closing.map(connection => connection.close())]);
        };
        const closeHostSession = () => {
            hostClosed = true;
            return hostClosing ??= Promise.all([hostReload, closeHostConnections()]).then(() => undefined);
        };
        pi.on("session_shutdown", closeHostSession);`);
patch("dist/extensions/mcp/index.js", '        pi.registerCommand("mcp", {', `        // EM controls Pi's connections; reload cancels the old lifetime before starting a new one.
        const waitForHost = async (work, signal) => {
            if (!signal) return await work;
            if (signal.aborted) throw new Error("MCP action cancelled");
            let onAbort;
            try {
                return await Promise.race([work, new Promise((_, reject) => {
                    onAbort = () => reject(new Error("MCP action cancelled"));
                    signal.addEventListener("abort", onAbort, { once: true });
                })]);
            } finally { signal.removeEventListener("abort", onAbort); }
        };
        const requireHostServer = async (name, signal) => {
            await waitForHost(hostReload, signal);
            if (hostClosed || session.signal.aborted) throw new Error("MCP session is closed");
            const lifetime = session.signal;
            const server = findServer(name);
            if (!server) throw new Error("MCP server is unavailable: " + name);
            await waitForHost(server.ready, signal ? AbortSignal.any([lifetime, signal]) : lifetime);
            if (hostClosed || lifetime.aborted || server !== findServer(name)) throw new Error("MCP session changed");
            return server;
        };
        const hostController = {
            status: hostStatus,
            close: closeHostSession,
            reload: () => {
                const work = hostReload.then(async () => {
                    if (hostClosed || !hostContext) return;
                    await closeHostConnections();
                    if (!hostClosed) startHostSession({}, hostContext);
                });
                hostReload = work.catch(() => undefined);
                return work;
            },
            ready: async () => { await hostReload; await pending; },
            reconnect: async (name, signal) => {
                const server = await requireHostServer(name, signal);
                const error = await track(reconnect(server, signal));
                if (error) throw new Error(error);
                if (!session.signal.aborted) ensureDiscoveryActive(hostContext);
            },
            login: async (name, hostPrompt, signal) => {
                const server = await requireHostServer(name, signal);
                if (!usesOAuth(server)) throw new Error("MCP server does not use OAuth: " + name);
                const error = await track(signIn(server, hostPrompt ?? {
                    showAuthorizationUrl: url => { openUrl(url.href); },
                    promptForRedirectUrl: signal => hostContext.ui.input(
                        "等待浏览器授权；无法自动回调时可粘贴回调 URL", "http://127.0.0.1:.../callback?code=...", { signal }),
                }, signal));
                if (error) throw new Error(error);
                if (!session.signal.aborted) ensureDiscoveryActive(hostContext);
            },
            logout: async name => { await track(signOut(await requireHostServer(name))); },
        };
        options.onController?.(hostController);
        pi.registerCommand("mcp", {`);
// Capture the lifetime before lazy loading; a reload must not give an old sign-in a new signal.
patch("dist/extensions/mcp/index.js", `            const runtime = await loadMcpRuntime();
            const signal = cancel ? AbortSignal.any([session.signal, cancel]) : session.signal;`, `            const signal = cancel ? AbortSignal.any([session.signal, cancel]) : session.signal;
            const runtime = await loadMcpRuntime();`);
patch("dist/extensions/mcp/index.js", `            // The challenge that asked for this sign-in (for example for more scope) is answered.`, `            if (signal.aborted) return "Sign-in cancelled.";
            // The challenge that asked for this sign-in (for example for more scope) is answered.`);
patch("dist/extensions/mcp/index.js", `                await connection.reconnect();
            }
            catch (error) {
                return \`Signed in, but \${errorMessage(error)}\`;`, `                await connection.reconnect(signal);
            }
            catch (error) {
                if (signal.aborted) return "Sign-in cancelled.";
                return \`Signed in, but \${errorMessage(error)}\`;`);
patch("dist/extensions/mcp/index.js", `        const reconnect = async (server) => {`, `        const reconnect = async (server, signal) => {`);
patch("dist/extensions/mcp/index.js", `                await previous;
                await connection.reconnect();`, `                await waitForHost(previous, signal);
                await connection.reconnect(signal);`);
// Closing the current client cancels initialize/discovery without permanently closing the server.
// Keep this on Pi's own client/connection; subsequent retries can still reconnect after logout.
patch("dist/extensions/mcp/runtime.js", `        this.shutdown.signal.addEventListener("abort", closeClient, { once: true });`, `        this.shutdown.signal.addEventListener("abort", closeClient, { once: true });
        this.hostCancelConnect = closeClient;`);
patch("dist/extensions/mcp/runtime.js", `            this.shutdown.signal.removeEventListener("abort", closeClient);`, `            this.shutdown.signal.removeEventListener("abort", closeClient);
            if (this.hostCancelConnect === closeClient) this.hostCancelConnect = undefined;`);
patch("dist/extensions/mcp/runtime.js", `    async reconnect() {
        await this.opening?.catch(() => undefined);
        if (this.client)
            await this.dropClient(this.client);
        await this.getClient();
    }`, `    async reconnect(signal) {
        const onAbort = () => { void this.hostCancelConnect?.(); };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
            signal?.throwIfAborted();
            await this.opening?.catch(() => undefined);
            signal?.throwIfAborted();
            if (this.client) await this.dropClient(this.client);
            signal?.throwIfAborted();
            await this.getClient();
            signal?.throwIfAborted();
        } finally { signal?.removeEventListener("abort", onAbort); }
    }`);
patch("dist/extensions/mcp/runtime.d.ts", `    reconnect(): Promise<void>;`, `    reconnect(signal?: AbortSignal): Promise<void>;`);
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
    close(): Promise<void>;
    reload(): Promise<void>;
    ready(): Promise<void>;
    reconnect(name: string, signal?: AbortSignal): Promise<void>;
    login(name: string, prompt?: import('./oauth.ts').McpSignInPrompt, signal?: AbortSignal): Promise<void>;
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
console.log("[patch-pi-mcp] Pi 1.1.0 host hooks verified");
