/**
 * 外部 API 客户端 — Vision（DashScope）和 Web Fetch（Tavily）
 *
 * 从 builtin-mcp.ts 拆出，与工具定义解耦。
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { resolveHome, IMAGE_MIME, emHome } from "../utils/paths";
import { dropLegacyEncryptedApiKeys } from "./settings-legacy";
import { apiKeysFromDisk } from "./em-settings-schema";

// ── Config ──────────────────────────────────────────

// 视觉模型/API 地址可配置:em-settings 的 capabilities.vision.model / .baseUrl / .mode,
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
  const p = `${emHome()}/em-settings.json`;
  try {
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch { return {}; }
}

function readApiKeys(): Record<string, string> {
  const raw = readEmSettings();
  // 磁盘上是分组结构（capabilities.* + env 池），这里组装回「环境变量名 → 值」的 Record——键名即
  // 注入给 MCP server 的环境变量名，不能改成嵌套对象。apiKeysFromDisk 内含旧扁平结构兜底。
  // 1.4 回退后明文落盘；磁盘残留的旧 safeStorage 密文（em-v1: 前缀）不可解密 → 丢弃视为未配置
  return dropLegacyEncryptedApiKeys(apiKeysFromDisk(raw) ?? (raw.apiKeys as Record<string, string> | undefined)) || {};
}

/**
 * 能力是否可用 —— **只看 key 有没有填**（用户 2026-09-15 拍板：不再设开关，填写即启用）。
 *
 * 此前是「开关 on + key 非空」两个条件，于是存在"填了 key 却没打开开关"的静默失效：
 * 界面上看不出差别，模型那边工具就是不出现。收成单一判据后不可能再出现这种状态；
 * 想关掉某项能力就清空对应的 key。
 */
export function isToolEnabled(name: "vision" | "webFetch" | "webSearch"): boolean {
  const keys = readApiKeys();
  // 判据是 **key 本身**：填了即启用、清空即停用。trim 后判空——只写了空白的 key 不算已配置
  // （否则工具会注册出来，调用时才因为 key 无效失败）。
  if (name === "vision") return !!keys.VISION_API_KEY?.trim();
  // 搜索与抓取共用同一个 Tavily Key：填了即两项都可用
  return !!keys.TAVILY_API_KEY?.trim();
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
  if (!tavilyKey) return "TAVILY_API_KEY 未配置，请在设置→模型能力增强→联网能力中填写 API Key。";
  if (!args.query) return "搜索查询不能为空。";
  // 上限 20 取自 Tavily 官方 Search 文档的 max_results 取值范围（0–20，默认值文档标 10、
  // 最佳实践页标 5，我们一律显式传值故不受其影响）。此前写 50 会让超范围的请求被拒
  // （表现成「搜索失败 (400)」而不是自动截断）。下限 1 与默认 5 保持原语义。
  const maxResults = Math.min(Math.max(Math.floor(Number(args.max_results) || 5), 1), 20);
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
      // 超时对齐 webFetch 的直连分支：Tavily 无响应时不能让工具调用挂住整个回合
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return `搜索失败 (${resp.status})`;
    const data = await resp.json() as { results?: Array<{ title?: string; url?: string; snippet?: string }> };
    const results = data.results || [];
    if (results.length === 0) return `[Web Search: ${args.query}]\n没有匹配结果。换个关键词试试。`;
    const lines = results.map((r, i) =>
      `${i + 1}. ${r.title || "(无标题)"} — ${r.url}\n   ${r.snippet || ""}`.trim()
    );
    return `[Web Search: ${args.query}]（${results.length} 条）\n${lines.join("\n\n")}`;
  } catch (e) { return `搜索请求失败：${(e as Error).message}。请稍后重试。`; }
}
