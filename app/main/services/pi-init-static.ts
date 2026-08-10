/**
 * Pi 内置 Provider 静态数据读取
 *
 * 直接从 Pi SDK npm 包的 JSON 文件中读取 provider 和模型列表。
 * 不需要初始化 runtime，在设置页面也可用。
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface StaticModel {
  id: string;
  name: string;
  contextWindow: number;
}

export interface StaticProvider {
  name: string;
  baseUrl?: string;
  models: StaticModel[];
}

// Pi provider ID → 数据文件名
const PROVIDER_FILES: Record<string, { name: string; file: string }> = {
  "anthropic":             { name: "Anthropic",              file: "anthropic.json" },
  "deepseek":              { name: "DeepSeek",               file: "deepseek.json" },
  "kimi-coding":           { name: "Kimi Coding",            file: "kimi-coding.json" },
  "minimax":               { name: "MiniMax",                file: "minimax.json" },
  "minimax-cn":            { name: "MiniMax CN",             file: "minimax-cn.json" },
  "moonshotai":            { name: "Moonshot AI",            file: "moonshotai.json" },
  "moonshotai-cn":         { name: "Moonshot AI CN",         file: "moonshotai-cn.json" },
  "qwen-token-plan":       { name: "Qwen Token Plan",        file: "qwen-token-plan.json" },
  "qwen-token-plan-cn":    { name: "Qwen Token Plan CN",     file: "qwen-token-plan-cn.json" },
  "qwen-token-plan-individual": { name: "Qwen Token Plan Individual", file: "qwen-token-plan-individual.json" },
  "xiaomi":                { name: "Xiaomi MiMo",            file: "xiaomi.json" },
  "xiaomi-token-plan-ams": { name: "MiMo Token Plan AMS",    file: "xiaomi-token-plan-ams.json" },
  "xiaomi-token-plan-cn":  { name: "MiMo Token Plan CN",     file: "xiaomi-token-plan-cn.json" },
  "xiaomi-token-plan-sgp": { name: "MiMo Token Plan SGP",    file: "xiaomi-token-plan-sgp.json" },
  "zai":                   { name: "Z.AI",                   file: "zai.json" },
  "zai-coding-cn":         { name: "Z.AI Coding CN",          file: "zai-coding-cn.json" },
  "ant-ling":              { name: "Ant Ling",               file: "ant-ling.json" },
  "openai":                { name: "OpenAI",                 file: "openai.json" },
  "google":                { name: "Google Gemini",          file: "google.json" },
  "mistral":               { name: "Mistral",                file: "mistral.json" },
  "groq":                  { name: "Groq",                   file: "groq.json" },
  "xai":                   { name: "xAI",                    file: "xai.json" },
  "cerebras":              { name: "Cerebras",               file: "cerebras.json" },
  "github-copilot":        { name: "GitHub Copilot",         file: "github-copilot.json" },
  "fireworks":             { name: "Fireworks",              file: "fireworks.json" },
  "together":              { name: "Together",               file: "together.json" },
  "openrouter":            { name: "OpenRouter",             file: "openrouter.json" },
  "huggingface":           { name: "Hugging Face",           file: "huggingface.json" },
  "nvidia":                { name: "NVIDIA",                 file: "nvidia.json" },
  "amazon-bedrock":        { name: "Amazon Bedrock",         file: "amazon-bedrock.json" },
  "cloudflare-ai-gateway": { name: "Cloudflare AI Gateway",  file: "cloudflare-ai-gateway.json" },
  "cloudflare-workers-ai": { name: "Cloudflare Workers AI",  file: "cloudflare-workers-ai.json" },
  "vercel-ai-gateway":     { name: "Vercel AI Gateway",      file: "vercel-ai-gateway.json" },
  "opencode":              { name: "OpenCode",               file: "opencode.json" },
  "opencode-go":           { name: "OpenCode Go",            file: "opencode-go.json" },
  "openai-codex":          { name: "OpenAI Codex",           file: "openai-codex.json" },
  "azure-openai-responses":{ name: "Azure OpenAI Responses", file: "azure-openai-responses.json" },
  "google-vertex":         { name: "Google Vertex",          file: "google-vertex.json" },
  "baseten":               { name: "Baseten",                file: "baseten.json" },
};

// 展示过滤：数据层完整（表内可查），但不在设置页供应商列表展示的供应商。
// 当前仅 qwen-token-plan-individual 需要展示；baseten / azure-openai-responses 保留数据不展示。
const HIDDEN_PROVIDER_IDS = new Set(["baseten", "azure-openai-responses"]);

function findDataDir(): string {
  // pi-ai 在 pi-coding-agent 的 node_modules 或顶层 node_modules
  const candidates = [
    join(__dirname, "..", "..", "..", "node_modules", "@earendil-works", "pi-ai", "dist", "providers", "data"),
    join(__dirname, "..", "..", "..", "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "providers", "data"),
  ];
  for (const d of candidates) {
    if (existsSync(d)) return d;
  }
  return candidates[0]!;
}

function parseModels(data: unknown): { models: StaticModel[]; baseUrl?: string } {
  const models: StaticModel[] = [];
  let baseUrl: string | undefined;
  if (!data || typeof data !== "object") return { models, baseUrl };

  for (const [, apiGroup] of Object.entries(data as Record<string, unknown>)) {
    if (!apiGroup || typeof apiGroup !== "object") continue;
    for (const [id, m] of Object.entries(apiGroup as Record<string, any>)) {
      if (m && typeof m === "object" && m.id) {
        if (!baseUrl && m.baseUrl) baseUrl = m.baseUrl;
        models.push({
          id,
          name: m.name || id,
          contextWindow: m.contextWindow || 0,
        });
      }
    }
  }
  return { models, baseUrl };
}

export async function getPiProviders(): Promise<Record<string, StaticProvider>> {
  const dataDir = findDataDir();
  const result: Record<string, StaticProvider> = {};

  for (const [id, info] of Object.entries(PROVIDER_FILES)) {
    if (HIDDEN_PROVIDER_IDS.has(id)) continue;
    const filePath = join(dataDir, info.file);
    if (!existsSync(filePath)) continue;
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8"));
      const parsed = parseModels(raw);
      result[id] = {
        name: info.name,
        baseUrl: parsed.baseUrl,
        models: parsed.models,
      };
    } catch { /* skip broken files */ }
  }

  return result;
}
