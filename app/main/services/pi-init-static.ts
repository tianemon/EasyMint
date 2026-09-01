/**
 * Pi 内置 Provider 静态数据读取
 *
 * 直接从 Pi SDK npm 包的 JSON 文件中读取 provider 和模型列表。
 * 不需要初始化 runtime，在设置页面也可用。
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
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

/** 模型窗口规格（自定义供应商注册用：命中真实值，避免硬编码 200k 导致过早压缩） */
export interface ModelSpec {
  contextWindow: number;
  maxTokens: number;
}

/** 思考等级大小关系（与 SDK EXTENDED_THINKING_LEVELS 一致） */
const THINKING_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * 按静态 spec 算出模型支持的思考等级（与 SDK `getSupportedThinkingLevels` 同一判定式）。
 * 用途：打开会话时前端就要按模型收敛下拉，而此时 Pi 会话可能还没创建（要等首条消息）——
 * 不能依赖 AgentSession，只能从模型规格直接算。
 * 返回 null 表示该模型规格未知（调用方按"全部档位"处理）。
 */
export function supportedThinkingLevelsOfSpec(spec: Record<string, any> | undefined): string[] | null {
  if (!spec) return null;
  if (spec.reasoning === false) return ["off"];
  const map = spec.thinkingLevelMap as Record<string, string | null> | undefined;
  return THINKING_ORDER.filter((level) => {
    const mapped = map ? map[level] : undefined;
    if (mapped === null) return false;
    // xhigh / max 必须有显式映射才可用
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

let _modelLookup: Map<string, ModelSpec> | null = null;

/** 跨全部 provider 数据构建 模型 ID → 窗口/输出上限 查表。
 *  同一模型在多个 provider 出现时取最大 contextWindow（保守：窗口设小会过早压缩）。
 *  数据目录不可读时返回空表，调用方回退默认值。 */
export function getModelSpecLookup(): Map<string, ModelSpec> {
  if (_modelLookup) return _modelLookup;
  const lookup = new Map<string, ModelSpec>();
  const dataDir = findDataDir();
  try {
    for (const f of readdirSync(dataDir)) {
      if (!f.endsWith(".json")) continue;
      let data: unknown;
      try {
        data = JSON.parse(readFileSync(join(dataDir, f), "utf-8"));
      } catch { continue; }
      if (!data || typeof data !== "object") continue;
      for (const apiGroup of Object.values(data as Record<string, unknown>)) {
        if (!apiGroup || typeof apiGroup !== "object") continue;
        for (const [id, m] of Object.entries(apiGroup as Record<string, any>)) {
          if (!m || typeof m !== "object") continue;
          const ctx = typeof m.contextWindow === "number" ? m.contextWindow : 0;
          const max = typeof m.maxTokens === "number" ? m.maxTokens : 0;
          if (ctx <= 0 && max <= 0) continue;
          const prev = lookup.get(id);
          const contextWindow = ctx > 0 && (!prev || ctx > prev.contextWindow) ? ctx : prev?.contextWindow ?? 0;
          const maxTokens = max > 0 && (!prev || max > prev.maxTokens) ? max : prev?.maxTokens ?? 0;
          lookup.set(id, { contextWindow, maxTokens });
        }
      }
    }
  } catch { /* 数据目录不可读:查表为空 */ }
  _modelLookup = lookup;
  return lookup;
}

const _staticModelsByProvider = new Map<string, Map<string, Record<string, any>>>();
let _staticModelById: Map<string, Record<string, any>> | null = null;

/** 跨全部 provider 的 模型 ID → 完整 spec 查表。
 *  用途：自定义供应商(第三方网关/镜像站)转售的模型继承其内在能力——
 *  同一模型 id 在官方数据里可查时，直接用官方的 reasoning / input / thinkingLevelMap。 */
export function getStaticModelSpec(modelId: string): Record<string, any> | undefined {
  if (!_staticModelById) {
    const byId = new Map<string, Record<string, any>>();
    const dataDir = findDataDir();
    try {
      for (const f of readdirSync(dataDir)) {
        if (!f.endsWith(".json")) continue;
        let data: unknown;
        try { data = JSON.parse(readFileSync(join(dataDir, f), "utf-8")); } catch { continue; }
        if (!data || typeof data !== "object") continue;
        for (const apiGroup of Object.values(data as Record<string, unknown>)) {
          if (!apiGroup || typeof apiGroup !== "object") continue;
          for (const [id, m] of Object.entries(apiGroup as Record<string, any>)) {
            if (m && typeof m === "object" && !byId.has(id)) byId.set(id, m);
          }
        }
      }
    } catch { /* 数据目录不可读:查表为空 */ }
    _staticModelById = byId;
  }
  return _staticModelById.get(modelId);
}

/**
 * 取某内置供应商的完整模型 spec（按模型 id）。
 * 用途：供应商页手动添加的模型(extraModels)注册时继承同族内置模型的能力声明
 * (api / reasoning / thinkingLevelMap / compat / cost …)——只写 id+窗口会导致
 * SDK 按"供应商首个模型"兜底为 reasoning=false,思考等级被 clamp 成 off。
 */
export function getProviderStaticModels(providerId: string): Map<string, Record<string, any>> {
  const cached = _staticModelsByProvider.get(providerId);
  if (cached) return cached;
  const models = new Map<string, Record<string, any>>();
  const file = PROVIDER_FILES[providerId]?.file;
  if (file) {
    const filePath = join(findDataDir(), file);
    if (existsSync(filePath)) {
      try {
        const data = JSON.parse(readFileSync(filePath, "utf-8"));
        for (const apiGroup of Object.values(data as Record<string, unknown>)) {
          if (!apiGroup || typeof apiGroup !== "object") continue;
          for (const [id, m] of Object.entries(apiGroup as Record<string, any>)) {
            if (m && typeof m === "object") models.set(id, m);
          }
        }
      } catch { /* 坏档 → 返回空表，调用方走保守兜底 */ }
    }
  }
  _staticModelsByProvider.set(providerId, models);
  return models;
}
