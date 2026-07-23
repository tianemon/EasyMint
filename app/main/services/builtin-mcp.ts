/**
 * Built-in MCP tools — registered via SDK's createSdkMcpServer, no config files,
 * no external processes. Keys come from em-settings.json.apiKeys.
 *
 * Tools:
 *   describe_image — call Qwen vision model, return text description
 *   web_fetch     — fetch URL content via Tavily Extract or direct HTTP
 */

// TODO: 步骤五 - 替换为 Pi defineTool()
// import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { homedir } from "node:os";
import { resolveHome, IMAGE_MIME } from "../utils/paths";
import { BrowserWindow, app } from "electron";

// ── Config ──────────────────────────────────────────

const VISION_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const VISION_MODEL = "qwen3.6-flash";

// ── Helpers ─────────────────────────────────────────

function readEmSettings(): Record<string, unknown> {
  const p = `${homedir()}/.easymint_pi_core/em-settings.json`;
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

  const src = resolveHome(args.path);
  let imageContent: Record<string, unknown>;

  if (src.startsWith("http://") || src.startsWith("https://")) {
    imageContent = { type: "image_url", image_url: { url: src } };
  } else {
    if (!existsSync(src)) return `文件不存在: ${src}`;
    const ext = extname(basename(src)).toLowerCase();
    const mime = IMAGE_MIME[ext] || "image/png";
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

/** Build built-in MCP servers. TODO: 步骤五 — 用 Pi defineTool() 重建所有工具 */
export function buildBuiltinMcpServers(_projectPath?: string): Record<string, unknown> {
  // TODO: 步骤五 - 替换为 Pi defineTool()
  return {};
}

// 旧代码已删除。步骤五用 Pi defineTool() 重新实现。
// 原工具：show_confirm_dev, show_new_project, set_task_status, rename_project,
//         list_issues, set_project_stage, refresh_tasks, show_prototype,
//         describe_image, web_fetch
