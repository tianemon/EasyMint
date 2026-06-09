import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { lookup } from "mime-types";
import { basename } from "path";
import { homedir } from "os";

const VISION_BASE_URL = process.env.VISION_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
const VISION_MODEL = process.env.VISION_MODEL || "qwen3.6-flash";
const VISION_API_KEY = process.env.VISION_API_KEY;

const server = new Server(
  { name: "image-vision", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "describe_image",
      description: "描述图片内容。支持本地路径或 URL。",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "图片的本地绝对路径或 URL" },
          prompt: { type: "string", description: "可选的提示词" },
        },
        required: ["path"],
      },
    },
    {
      name: "describe_images",
      description: "批量描述多张图片，并行处理。",
      inputSchema: {
        type: "object",
        properties: {
          paths: { type: "array", items: { type: "string" }, description: "图片的本地绝对路径或 URL 列表" },
          prompt: { type: "string", description: "可选的提示词" },
        },
        required: ["paths"],
      },
    },
  ],
}));

async function callVision(imageContent, prompt) {
  const body = {
    model: VISION_MODEL,
    messages: [{ role: "user", content: [{ type: "text", text: prompt || "Describe this image in detail." }, imageContent] }],
    max_tokens: 1024,
  };
  const resp = await fetch(`${VISION_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${VISION_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Vision API ${resp.status}: ${await resp.text().catch(() => "")}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

function buildImageContent(source) {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return { type: "image_url", image_url: { url: source } };
  }
  const path = source.startsWith("~") ? source.replace(/^~/, homedir()) : source;
  const mimeType = lookup(basename(path)) || "image/png";
  const data = readFileSync(path).toString("base64");
  return { type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!VISION_API_KEY) {
    return { content: [{ type: "text", text: "VISION_API_KEY 未配置" }] };
  }
  const { name, arguments: args } = request.params;

  if (name === "describe_image") {
    const img = buildImageContent(args.path);
    const caption = await callVision(img, args.prompt);
    return { content: [{ type: "text", text: caption }] };
  }

  if (name === "describe_images") {
    const prompt = args.prompt;
    const captions = await Promise.all(args.paths.map((p) => callVision(buildImageContent(p), prompt)));
    const result = captions.map((c, i) => `[Image ${i + 1}]\n${c}`).join("\n\n");
    return { content: [{ type: "text", text: result }] };
  }

  throw new Error(`unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
