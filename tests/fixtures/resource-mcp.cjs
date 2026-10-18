// Resource enumeration intentionally does not settle: discovery must still publish tools.
const fs = require("node:fs");
require("node:readline").createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  if (message.method === "initialize") result = { protocolVersion: message.params.protocolVersion,
    capabilities: { tools: {}, resources: {} }, serverInfo: { name: "resource-fixture", version: "1" } };
  else if (message.method === "tools/list") result = { tools: [{ name: "shape", description: "Return structured JSON", inputSchema: {
    type: "object", properties: { shape: { type: "string", enum: ["array", "null"] } }, required: ["shape"],
  } }] };
  else if (message.method === "resources/list" || message.method === "resources/templates/list") {
    fs.appendFileSync(process.env.EM_MCP_RESOURCE_LOG, message.method + "\n"); return;
  } else if (message.method === "tools/call") result = { content: [{ type: "text", text: "shape" }],
    structuredContent: message.params.arguments.shape === "array" ? [1, 2] : null };
  else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
});
