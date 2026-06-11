/**
 * Built-in MCP tools — registered via SDK's createSdkMcpServer, no config files,
 * no external processes. Keys come from em-settings.json.apiKeys.
 *
 * Tools:
 *   describe_image — call Qwen vision model, return text description
 *   web_fetch     — fetch URL content via Tavily Extract or direct HTTP
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { homedir } from "node:os";

// ── Config ──────────────────────────────────────────

const VISION_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const VISION_MODEL = "qwen3.6-flash";

/** Resolve paths ~/ → /Users/xxx/ */
function resolve(input: string): string {
  return input.startsWith("~") ? input.replace(/^~/, homedir()) : input;
}

// ── Helpers ─────────────────────────────────────────

function readEmSettings(): Record<string, unknown> {
  const p = `${homedir()}/.easymint/em-settings.json`;
  try {
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function readApiKeys(): Record<string, string> {
  return (readEmSettings().apiKeys as Record<string, string>) || {};
}

/** Check if a built-in tool is explicitly enabled AND its API key is set */
function isToolEnabled(name: "vision" | "webFetch"): boolean {
  const settings = readEmSettings();
  const builtin = (settings.builtinTools as Record<string, boolean>) || {};
  const keys = readApiKeys();
  if (name === "vision") return builtin.vision === true && !!keys.VISION_API_KEY;
  return builtin.webFetch === true && !!keys.TAVILY_API_KEY;
}

// ── Vision ──────────────────────────────────────────

async function describeImage(args: { path: string; prompt?: string }): Promise<string> {
  const keys = readApiKeys();
  const key = keys.VISION_API_KEY;
  if (!key) return "VISION_API_KEY 未配置，请在设置中填写 DashScope API Key。";

  const src = resolve(args.path);
  let imageContent: Record<string, unknown>;

  if (src.startsWith("http://") || src.startsWith("https://")) {
    imageContent = { type: "image_url", image_url: { url: src } };
  } else {
    if (!existsSync(src)) return `文件不存在: ${src}`;
    const ext = extname(basename(src)).toLowerCase();
    const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp" };
    const mime = MIME[ext] || "image/png";
    const data = readFileSync(src).toString("base64");
    imageContent = { type: "image_url", image_url: { url: `data:${mime};base64,${data}` } };
  }

  const body = {
    model: VISION_MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: args.prompt || "Describe this image in detail." },
        imageContent,
      ],
    }],
    max_tokens: 1024,
  };

  const resp = await fetch(`${VISION_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    return `视觉 API 请求失败 (${resp.status}): ${err.slice(0, 300)}`;
  }

  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || "(无描述)";
}

// ── Web Fetch ───────────────────────────────────────

async function webFetch(args: { url: string; prompt?: string }): Promise<string> {
  const keys = readApiKeys();
  const tavilyKey = keys.TAVILY_API_KEY;

  // Try Tavily Extract first (handles JS-rendered pages, has SSRF protection)
  if (tavilyKey) {
    try {
      const resp = await fetch("https://api.tavily.com/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          urls: [args.url],
          extract_depth: "basic",
          format: "markdown",
        }),
      });
      if (resp.ok) {
        const data = await resp.json() as {
          results?: Array<{ raw_content?: string; url?: string }>;
        };
        const content = data.results?.[0]?.raw_content;
        if (content) {
          let result = `[Web Fetch: ${args.url}]\n${content}`;
          if (args.prompt) result += `\n\n---\n${args.prompt}`;
          return result.slice(0, 50000); // cap at ~50k chars
        }
      }
    } catch { /* fall through to direct fetch */ }
  }

  // Fallback: direct HTTP fetch
  try {
    const url = args.url;
    // SSRF guard: only http/https
    if (!/^https?:\/\//i.test(url)) return "只支持 http/https URL";

    const resp = await fetch(url, {
      headers: { "User-Agent": "EasyMint/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return `抓取失败 (${resp.status})`;

    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/") && !ct.includes("application/json")) {
      return `不支持的内容类型: ${ct}`;
    }

    const text = await resp.text();
    // Strip HTML tags for non-HTML responses
    const result = ct.includes("text/html")
      ? text.replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s{2,}/g, "\n")
            .trim()
      : text;
    return `[Web Fetch: ${args.url}]\n${result.slice(0, 50000)}`;
  } catch (e) {
    return `抓取失败: ${(e as Error).message}`;
  }
}

// ── MCP Server ──────────────────────────────────────

let _server: ReturnType<typeof createSdkMcpServer> | null = null;

/** Build built-in MCP servers (singleton — call once per process).
 *  Tools are always registered. If the API key is missing, the handler
 *  returns a helpful error telling the user to configure it in settings. */
export function buildBuiltinMcpServers(): Record<string, unknown> {
  const visionOn = isToolEnabled("vision");
  const fetchOn = isToolEnabled("webFetch");
  if (!visionOn && !fetchOn) return {};

  if (_server) return { "easymint-builtin": _server as unknown as Record<string, unknown> };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: any[] = [];

  if (visionOn) {
    tools.push(tool(
      "describe_image",
      "描述图片内容。支持本地路径或 URL。当用户发送图片、或消息中有 [Image] 标记、或需要理解图片内容时调用。",
      {
        path: z.string().describe("图片的本地绝对路径或 URL"),
        prompt: z.string().optional().describe("可选的提示词，如'描述UI界面的色彩搭配'"),
      },
      async (args) => {
        try {
          const text = await describeImage(args);
          return { content: [{ type: "text", text }] };
        } catch (e) {
          return { content: [{ type: "text", text: `describe_image 失败: ${(e as Error).message}` }] };
        }
      },
    ));
  }

  if (fetchOn) {
    tools.push(tool(
      "web_fetch",
      "抓取网页内容。当需要读取某个 URL 的实际内容时调用。支持各类网页，返回提取后的文本。",
      {
        url: z.string().describe("要抓取的网页 URL"),
        prompt: z.string().optional().describe("对抓取内容的分析要求"),
      },
      async (args) => {
        try {
          const text = await webFetch(args);
          return { content: [{ type: "text", text }] };
        } catch (e) {
          return { content: [{ type: "text", text: `web_fetch 失败: ${(e as Error).message}` }] };
        }
      },
    ));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _server = createSdkMcpServer({
    name: "easymint-builtin",
    version: "1.0.0",
    alwaysLoad: true, // tools always visible to the model, no tool-search needed
    tools: tools as any,
  });

  return { "easymint-builtin": _server as unknown as Record<string, unknown> };
}
