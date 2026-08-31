/**
 * skill 工具（期 1a）——use_skill 加载 + manage_skill 写入。
 *
 * use_skill：findSkillByName 四来源查找 → readSkill 返回正文 + 脚本根目录 + 调用参数；
 *   frontmatter `model` 字段触发会话级模型切换（当前供应商下解析，不存在降级忽略）；
 *   成功/失败均记 skill-registry（usageCount/failCount）。
 * manage_skill：写 managed 区（create/update/delete → writeManagedSkill），
 *   撞 authored/builtin 同名返回 shadowed 错误（磁盘零写入），约束在 service 层实现。
 */

import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { findSkillByName, readSkill, scanSkills, writeManagedSkill } from "../skill-service";
import { touchSkillStat } from "../skill-registry";

export interface SkillToolHooks {
  /** skill frontmatter model 字段触发的会话级模型切换；返回是否切换成功（失败降级忽略） */
  onModelSwitch?: (modelName: string) => Promise<boolean>;
}

function text(t: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: t }] };
}

export async function createSkillTool(projectPath: string | undefined, hooks: SkillToolHooks = {}): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "use_skill",
    label: "加载技能",
    description:
      "加载并执行指定 skill：读取其 SKILL.md 全文并按其中的工作流执行。"
      + "任务匹配某个 skill 描述时必须先调用本工具，再按内容执行。",
    promptSnippet: "加载并执行 skill（按名字，可带参数）",
    promptGuidelines: [
      "任务匹配某个 skill 的描述时，必须先调用 use_skill 加载它，再按其内容执行——这是硬性要求（BLOCKING REQUIREMENT）",
      "不要绕过本工具直接用 read 读 SKILL.md",
      "skill 内引用的相对路径，按返回的脚本根目录解析为绝对路径",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        name: { type: "string" as const, description: "skill 名称（见 system prompt 的 Skills 列表）" },
        args: { type: "string" as const, description: "可选：传给 skill 的参数（附加在返回内容的 [调用参数] 段）" },
      },
      required: ["name" as const],
    },
    async execute(_tid: string, params: Record<string, unknown>) {
      const name = String(params.name || "").trim();
      const args = params.args !== undefined ? String(params.args) : "";
      if (!name) return text("use_skill 参数错误：name 不能为空");

      const hit = findSkillByName(name, projectPath);
      if (!hit) {
        touchSkillStat(name, false);
        const names = scanSkills(projectPath).filter((s) => !s.shadowed).map((s) => s.name).join("、");
        return text(`未找到 skill「${name}」。可用 skill：${names || "（无）"}`);
      }
      if (!hit.enabled) {
        touchSkillStat(hit.name, false);
        return text(`skill「${hit.name}」已停用（可在 设置→插件→Skills 中开启）`);
      }
      const detail = readSkill(hit.path);
      if (!detail || !detail.body.trim()) {
        touchSkillStat(hit.name, false);
        return text(`skill「${hit.name}」内容为空或不可读（路径：${hit.path}）`);
      }

      // frontmatter model 字段 → 会话级切换；模型不存在降级忽略（不中断 skill 加载）
      let modelNote = "";
      if (detail.model && hooks.onModelSwitch) {
        const switched = await hooks.onModelSwitch(detail.model).catch(() => false);
        modelNote = switched
          ? `\n\n[模型] 已切换到 ${detail.model}`
          : `\n\n[模型] ${detail.model} 在当前供应商下不可用，沿用当前模型继续`;
      }

      touchSkillStat(hit.name, true);
      const argNote = args ? `\n\n[调用参数]\n${args}` : "";
      return text(
        `# skill: ${detail.name}\n\n脚本与资源根目录：${hit.path}\n（skill 内的相对路径均以此目录解析）\n\n${detail.body}${argNote}${modelNote}`,
      );
    },
  } as any) as ToolDefinition;
}

export async function createManageSkillTool(projectPath: string | undefined): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "manage_skill",
    label: "管理技能",
    description:
      "在 AI 管理区（~/.easymint/managed-skills/）创建/更新/删除 skill——只写 AI 管理区，"
      + "永不触碰用户手写 skill（authored/builtin 同名时返回 shadowed 错误且不写盘）。"
      + "适用场景：把验证过的工作方法沉淀为可复用 skill、修正自己创建的 skill。",
    promptSnippet: "创建/更新/删除 AI 管理区的 skill",
    promptGuidelines: [
      "沉淀 skill 时 name 用小写字母/数字/连字符，description 一句话说清「做什么、何时用」",
      "与现有手写 skill 同名会被拒绝（shadowed），换名或删除原 skill 后重试",
      "skill 正文（body）不要自带 frontmatter，系统会生成",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        action: { type: "string" as const, description: "create（新建，需 description + body）/ update（更新，description/body 至少一项）/ delete（删除）" },
        name: { type: "string" as const, description: "skill 名称，[a-z0-9][a-z0-9-]{0,63}" },
        description: { type: "string" as const, description: "skill 描述（单行）；create 必填" },
        body: { type: "string" as const, description: "skill 正文（Markdown，不含 frontmatter）；create 必填" },
      },
      required: ["action" as const, "name" as const],
    },
    async execute(_tid: string, params: Record<string, unknown>) {
      const action = String(params.action || "");
      const name = String(params.name || "");
      if (!["create", "update", "delete"].includes(action)) {
        return text(`manage_skill 参数错误：action 必须是 create/update/delete（收到「${action}」）`);
      }
      const r = writeManagedSkill(
        {
          action: action as "create" | "update" | "delete",
          name,
          description: params.description !== undefined ? String(params.description) : undefined,
          body: params.body !== undefined ? String(params.body) : undefined,
        },
        projectPath,
      );
      if (!r.ok) {
        return text(`manage_skill 失败（${action}「${name}」）：${r.error}${r.shadowed ? "——同名遮蔽，未写任何文件" : ""}`);
      }
      const verb = action === "create" ? "已创建" : action === "update" ? "已更新" : "已删除";
      return text(`manage_skill 成功：${verb} AI 管理区 skill「${name}」${action === "delete" ? "" : "，下次会话的 Skills 列表即生效"}`);
    },
  } as any) as ToolDefinition;
}
