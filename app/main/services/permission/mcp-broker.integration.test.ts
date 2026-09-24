import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));

const home = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-broker-home-"));
const project = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-broker-project-"));
process.env.EASYMINT_HOME = home;

let broker: typeof import("./mcp-broker");
let mcp: typeof import("../mcp-service");
let adapter: typeof import("./mcp-adapter");

beforeAll(async () => {
  fs.writeFileSync(path.join(home, "em-settings.json"), JSON.stringify({ mcp: { approved: [] } }));
  const configPath = path.join(project, ".easymint", "mcp.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {
    echo: { type: "stdio", command: process.execPath,
      args: [path.join(process.cwd(), "tests/fixtures/echo-mcp.cjs")], timeout: 3000 },
  } }));
  broker = await import("./mcp-broker");
  mcp = await import("../mcp-service");
  adapter = await import("./mcp-adapter");
  mcp.approveMcpServer(project, "echo");
});

afterAll(async () => {
  await adapter?.closeAllMcpClients();
  fs.rmSync(project, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("本地 MCP 完整调用链", () => {
  it("搜索时连接、返回真实 schema，并经代理实际调用 server", async () => {
    const [search, call] = await broker.createMcpBrokerTools(project, "broker-e2e", () => "full", async () => ({ behavior: "allow" }));
    const signal = new AbortController().signal;
    const found = await search!.execute("search", { server: "echo", query: "echo" }, signal, () => {}, {} as never);
    const catalog = JSON.parse((found.content[0] as { text: string }).text);
    expect(catalog.tools[0].name).toBe("mcp__echo__echo");
    expect(catalog.tools[0].parameters.properties.text.type).toBe("string");

    const result = await call!.execute("call", { name: "mcp__echo__echo", arguments: { text: "hello" }, intent: "回显文本" }, signal, () => {}, {} as never);
    expect(result.content[0]).toMatchObject({ text: "echo:hello" });
  }, 10000);
});
