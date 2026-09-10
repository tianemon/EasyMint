/**
 * 外部 API 客户端 — Vision（DashScope）和 Web Fetch（Tavily）
 *
 * 从 builtin-mcp.ts 拆出，与工具定义解耦。
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { homedir } from "node:os";
import { resolveHome, IMAGE_MIME } from "../utils/paths";
import { dropLegacyEncryptedApiKeys } from "./settings-legacy";

// ── Config ──────────────────────────────────────────

// 视觉模型/API 地址可配置:em-settings apiKeys 的 VISION_MODEL / VISION_BASE_URL / VISION_MODE,
// 默认 qwen3.7-flash + 公共 DashScope(阿里云百炼免费额度可用)
const DEFAULT_VISION_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_VISION_MODEL = "qwen3.7-flash";

type VisionMode = "openai" | "anthropic";

function readVisionConfig(): { baseUrl: string; model: string; mode: VisionMode } {
  const keys = readApiKeys();
  return {
    baseUrl: keys.VISION_BASE_URL || DEFAULT_VISION_BASE_URL,
    model: keys.VISION_MODEL || DEFAULT_VISION_MODEL,
    mode: keys.VISION_MODE === "anthropic" ? "anthropic" : "openai",
  };
}

// ── Settings helpers ────────────────────────────────

function readEmSettings(): Record<string, unknown> {
  const p = `${homedir()}/.easymint/em-settings.json`;
  try {
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch { return {}; }
}

function readApiKeys(): Record<string, string> {
  // 1.4 回退后明文落盘；磁盘残留的旧 safeStorage 密文（em-v1: 前缀）不可解密 → 丢弃视为未配置
  return dropLegacyEncryptedApiKeys((readEmSettings().apiKeys as Record<string, string> | undefined)) || {};
}

export function isToolEnabled(name: "vision" | "webFetch" | "webSearch"): boolean {
  const settings = readEmSettings();
  const builtin = (settings.builtinTools as Record<string, boolean>) || {};
  const keys = readApiKeys();
  if (name === "vision") return builtin.vision === true && !!keys.VISION_API_KEY;
  if (name === "webSearch") return builtin.webSearch === true && !!keys.TAVILY_API_KEY;
  return builtin.webFetch === true && !!keys.TAVILY_API_KEY;
}

// ── Vision ──────────────────────────────────────────

export async function describeImage(args: { path: string; prompt?: string }): Promise<string> {
  const keys = readApiKeys();
  const key = keys.VISION_API_KEY;
  if (!key) return "VISION_API_KEY 未配置，请在设置中填写 API Key。";

  const src = resolveHome(args.path);
  const promptText = args.prompt || "Describe this image in detail.";

  // 图片 → base64（URL 直用 / 本地读取）
  let imageBase64: string;
  let isUrl = false;
  if (src.startsWith("http://") || src.startsWith("https://")) {
    imageBase64 = src;
    isUrl = true;
  } else {
    if (!existsSync(src)) return `文件不存在: ${src}`;
    imageBase64 = readFileSync(src).toString("base64");
  }

  const { baseUrl, model, mode } = readVisionConfig();

  // ── Anthropic 兼容模式(messages API:system 参数 + content 块)──
  if (mode === "anthropic") {
    const mime = isUrl ? undefined : (IMAGE_MIME[extname(basename(src)).toLowerCase()] || "image/png");
    const userContent: Array<Record<string, unknown>> = [
      { type: "text", text: promptText },
      isUrl
        ? { type: "image", source: { type: "url", url: imageBase64 } }
        : { type: "image", source: { type: "base64", media_type: mime, data: imageBase64 } },
    ];
    const body = {
      model,
      max_tokens: 1024,
      system: "You are a helpful assistant that describes images in detail.",
      messages: [{ role: "user", content: userContent }],
      thinking: { type: "disabled" },
    };
    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      return `视觉 API 请求失败 (${resp.status}): ${err.slice(0, 300)}`;
    }
    let data: Record<string, unknown>;
    try { data = await resp.json() as any; }
    catch { return "视觉 API 返回格式错误"; }
    const content = data.content as Array<{ type?: string; text?: string }> | undefined;
    const text = content?.find((b) => b.type === "text")?.text;
    return text || "(无描述)";
  }

  // ── OpenAI 兼容模式(chat/completions:平铺 messages)──
  const imageContent = isUrl
    ? { type: "image_url", image_url: { url: imageBase64 } }
    : { type: "image_url", image_url: { url: `data:${IMAGE_MIME[extname(basename(src)).toLowerCase()] || "image/png"};base64,${imageBase64}` } };
  const body = {
    model,
    messages: [{ role: "user", content: [{ type: "text", text: promptText }, imageContent] }],
    max_tokens: 1024,
  };
  const resp = await fetch(`${baseUrl}/chat/completions`, {
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

// ── Web Search ──────────────────────────────────────

export async function webSearch(args: { query: string; max_results?: number }): Promise<string> {
  const keys = readApiKeys();
  const tavilyKey = keys.TAVILY_API_KEY;
  if (!tavilyKey) return "TAVILY_API_KEY 未配置，请在设置→模型能力增强→联网搜索中填写 API Key。";
  if (!args.query) return "搜索查询不能为空。";
  const maxResults = Math.min(Math.max(Math.floor(Number(args.max_results) || 5), 1), 50);
  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: tavilyKey,
        query: args.query,
        max_results: maxResults,
        search_depth: "basic",
        include_raw_content: false,
        topic: "general",
      }),
    });
    if (!resp.ok) return `搜索失败 (${resp.status})`;
    const data = await resp.json() as { results?: Array<{ title?: string; url?: string; snippet?: string }> };
    const results = data.results || [];
    if (results.length === 0) return `[Web Search: ${args.query}]\n没有匹配结果。换个关键词试试。`;
    const lines = results.map((r, i) =>
      `${i + 1}. ${r.title || "(无标题)"} — ${r.url}\n   ${r.snippet || ""}`.trim()
    );
    return `[Web Search: ${args.query}]（${results.length} 条）\n${lines.join("\n\n")}`;
  } catch { return "搜索请求失败（网络或 API 错误）。请稍后重试。"; }
}
