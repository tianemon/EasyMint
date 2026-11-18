import { z } from "zod";
import { DOMAIN_GUIDANCE_MODE_ID, UI_DESIGN_MODE_ID } from "../../shared/collaboration";

export const mainSchema = z.object({
  nickname: z.string().trim().min(1).max(40),
  userAddress: z.string().trim().max(40),
  avatar: z.string().max(1024 * 1024).refine(value => !value || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)),
  personality: z.string(), rules: z.string(),
});
export const modeFields = z.object({ name: z.string().trim().min(1).max(40), scenario: z.string().max(200),
  prompt: z.string().refine(value => !!value.trim()), defaultEnabled: z.boolean() });
export const templateFields = z.object({ name: z.string().min(1), description: z.string(),
  prompt: z.string().refine(value => !!value.trim()), agentType: z.string().optional() });
const id = z.string().min(1);
export const legacyTemplateSchema = templateFields.extend({ id, customized: z.boolean().optional() });
const templateOverride = templateFields.partial().extend({ id });
export const modeOverride = modeFields.partial().extend({ id });
export const storeSchema = z.object({ version: z.literal(2), rolesInJson:z.literal(true).optional(), defaultUpgrade:z.literal(1).optional(), main: mainSchema.partial(),
  templates: z.array(templateOverride), modes: z.array(modeOverride),
  legacyPrompts: z.array(z.unknown()).optional(), legacyTemplates: z.array(z.unknown()).optional(),
  migration: z.object({ backup: z.string().regex(/^prompts-v2-[a-f0-9]{16}$/), templateHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), skippedTemplates: z.number().int().positive().optional() }).optional(),
}).strict();
export type PromptStore = z.infer<typeof storeSchema>;

export const builtinTemplateTypes = new Map([["default-builder", "builder"], ["default-evaluator", "evaluator"]]);
export const retiredIds = new Set(["mint", "mint-designer", "default-orchestrator"]);
const builtinModes = new Set([UI_DESIGN_MODE_ID, DOMAIN_GUIDANCE_MODE_ID]);

/** Shared by configuration loading and the memory worker's role-preservation check. */
export function assertPromptStoreEntries(config: PromptStore): void {
  if (new Set(config.templates.map(item => item.id)).size !== config.templates.length) throw new Error("执行模板包含重复 ID");
  if (new Set(config.modes.map(item => item.id)).size !== config.modes.length) throw new Error("协作模式包含重复 ID");
  for (const template of config.templates) {
    if (retiredIds.has(template.id)) throw new Error("主对话和旧角色不能注册为执行模板");
    const type = builtinTemplateTypes.get(template.id);
    if (!type) templateFields.parse(template);
    else if (template.agentType !== undefined && template.agentType !== type) throw new Error("内置模板不可修改执行类型");
  }
  for (const mode of config.modes) if (!builtinModes.has(mode.id)) modeFields.parse(mode);
}
