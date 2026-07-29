/**
 * 外部 API 客户端 — Vision（DashScope）和 Web Fetch（Tavily）
 *
 * 从 builtin-mcp.ts 拆出，与工具定义解耦。
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { homedir } from "node:os";
import { resolveHome, IMAGE_MIME } from "../utils/paths";

// ── Config ──────────────────────────────────────────

const VISION_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const VISION_MODEL = "qwen3.6-flash";

// ── Settings helpers ────────────────────────────────

function readEmSettings(): Record<string, unknown> {
  const p = `${homedir()}/.easymint/em-settings.json`;
  try {
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch { return {}; }
}

function readApiKeys(): Record<string, string> {
  return (readEmSettings().apiKeys as Record<string, string>) || {};
}

export function isToolEnabled(name: "vision" | "webFetch"): boolean {
  const settings = readEmSettings();
  const builtin = (settings.builtinTools as Record<string, boolean>) || {};
  const keys = readApiKeys();
  if (name === "vision") return builtin.vision === true && !!keys.VISION_API_KEY;
  return builtin.webFetch === true && !!keys.TAVILY_API_KEY;
}

// ── Vision ──────────────────────────────────────────

export async function describeImage(args: { path: string; prompt?: string }): Promise<string> {
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
    messages: [{ role: "user", content: [{ type: "text", text: args.prompt || "Describe this image in detail." }, imageContent] }],
    max_tokens: 1024,
  };

  const resp = await fetch(`${VISION_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    return `视觉 API 请求失败 (${resp.status}): ${err.slice(0, 300)}`;
  }
  let data: Record<string, unknown>;
  try { data = await resp.json() as any; }
  catch { return "视觉 API 返回格式错误"; }
  const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
  return choices?.[0]?.message?.content || "(无描述)";
}

// ── Web Fetch ───────────────────────────────────────

export async function webFetch(args: { url: string; prompt?: string }): Promise<string> {
  const keys = readApiKeys();
  const tavilyKey = keys.TAVILY_API_KEY;

  if (tavilyKey) {
    try {
      const resp = await fetch("https://api.tavily.com/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: tavilyKey, urls: [args.url], extract_depth: "basic", format: "markdown" }),
      });
      if (resp.ok) {
        const data = await resp.json() as { results?: Array<{ raw_content?: string; url?: string }> };
        const content = data.results?.[0]?.raw_content;
        if (content) return `[Web Fetch: ${args.url}]\n${content.slice(0, 50000)}`;
      }
    } catch { /* fall through */ }
  }

  try {
    if (!/^https?:\/\//i.test(args.url)) return "只支持 http/https URL";
    const resp = await fetch(args.url, {
      headers: { "User-Agent": "EasyMint/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return `抓取失败 (${resp.status})`;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/") && !ct.includes("application/json")) return `不支持的内容类型: ${ct}`;
    const text = await resp.text();
    const result = ct.includes("text/html")
      ? text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, "\n").trim()
      : text;
    return `[Web Fetch: ${args.url}]\n${result.slice(0, 50000)}`;
  } catch (e) {
    return `抓取失败: ${(e as Error).message}`;
  }
}
