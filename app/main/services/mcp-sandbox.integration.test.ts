import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProtectedMcpTransport } from "./mcp-transport";
import { InMemoryAuthStorageBackend } from "./mcp-test-store";
import { resetSandboxState } from "./sandbox/manager";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));
let root: string | undefined;
const priorHome = process.env.EASYMINT_HOME;
afterEach(async () => {
  await resetSandboxState();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  if (priorHome === undefined) delete process.env.EASYMINT_HOME; else process.env.EASYMINT_HOME = priorHome;
});
describe.skipIf(process.platform !== "darwin")("MCP actual macOS sandbox", () => {
  it("blocks a server's out-of-workspace write in standard mode and allows full mode", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "em-mcp-kernel-"));
    const cwd = path.join(root, "workspace"), target = path.join(root, "outside.txt");
    fs.mkdirSync(cwd); process.env.EASYMINT_HOME = path.join(root, "em");
    const code = `const fs=require('fs');require('readline').createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line);if(m.id===undefined)return;
      let result;
      if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}};
      else if(m.method==='tools/list')result={tools:[{name:'probe',inputSchema:{type:'object',properties:{target:{type:'string'}}}}]};
      else {let wrote=false;try{fs.writeFileSync(m.params.arguments.target,'probe',{flag:'wx'});wrote=true;}catch{}result={content:[{type:'text',text:String(wrote)}]};}
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
    });`;
    const sdk = await import("@earendil-works/pi-coding-agent");
    for (const mode of ["standard", "full"] as const) {
      const entry = { name: "probe", source: "test", config: { command: process.execPath, args: ["-e", code] } };
      const connection = new sdk.McpServerConnection({ entry, cwd, onTools: () => {},
        credentials: new sdk.McpOAuthCredentialStore(new InMemoryAuthStorageBackend()), connectTimeoutMs: 5000,
        createTransport: server => new ProtectedMcpTransport({ entry: server, cwd, owner: "kernel-probe", mode: () => mode }),
      });
      try {
        const client = await connection.getClient();
        const result = await client.callTool("probe", { target });
        expect(result.content).toMatchObject([{ text: String(mode === "full") }]);
        expect(fs.existsSync(target)).toBe(mode === "full");
      } finally { await connection.close(); }
    }
  }, 15000);
});
