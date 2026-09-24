const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");

const server = new Server({ name: "echo-test", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "echo",
    description: "Echo back text",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  }],
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => ({
  content: [{ type: "text", text: `echo:${params.arguments.text}` }],
}));
server.connect(new StdioServerTransport()).catch((error) => {
  process.stderr.write(String(error));
  process.exitCode = 1;
});
