/**
 * retire_experiences 工具 — 经验退役（从库里移除）。
 *
 * 与 learn 分开的理由：learn 的语义是「沉淀入库」，退役是即时动作；混在一个工具里会让
 * 「要不要等用户确认」随参数变化，模型和用户都难预期。退役按用户决策**不弹确认卡片**
 * （判断是模型的职责），但原文与理由进同目录 experiences-archive.json——误删可从档案拷回。
 */

import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { archivePath, retireExperiences, shortId, type ExperienceScope } from "../experience-service";

export interface RetireToolDeps {
  projectPath?: string;
}

function text(t: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: t }] };
}

export async function createRetireExperiencesTool(deps: RetireToolDeps): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "retire_experiences",
    label: "退役经验",
    // 串行执行：经验库是「整文件读改写」，同批并行会互相覆盖（与 learn 同理）
    executionMode: "sequential",
    description:
      "把不再成立的经验从库里移除（过时 / 临时阶段已过 / 与其它条目重复）。**直接生效，不需要用户确认**；"
      + "被移除条目的原文与理由会写入同目录 experiences-archive.json，误删可从档案拷回。"
      + "适用：会话中判断某条经验已过时或已重复（注入块末尾的体检清单会给出候选），或用户明确说某条经验不对/不用了。"
      + "改写（保留并修正）用 learn 带 updateId；这里只做「不再保留」。",
    promptSnippet: "退役经验（移除过时/重复条目，不弹确认）",
    promptGuidelines: [
      "**自行判断再退役**：判断标准不写死——问「删掉这条，未来的我会不会重新踩坑」：会则保留（该改写就改写），只是「当时发生过」的记录可退役",
      "优先选「改写」而不是「删除」：内容仍成立只是表述/范围不对 → learn 带 updateId 改写；整条不再成立（阶段已过、被新事实推翻、与另一条重复）才退役",
      "批量清理重复时：保留信息最全或命中次数最高的那条，其余退役；若两条各有独有信息，先 learn 带 updateId 合并成一条再退役另一条",
      "理由要具体（如「发版窗口已结束」「与 xxx 条重复」）——档案里靠它回溯",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        ids: {
          type: "array" as const,
          description: "要退役的经验 id 数组（短 id 即可，检索结果或注入块里有）",
          items: { type: "string" as const },
        },
        reason: { type: "string" as const, description: "退役理由（写进档案，便于日后回溯）" },
      },
      required: ["ids" as const, "reason" as const],
    },
    async execute(_tid: string, params: Record<string, unknown>) {
      const raw = params.ids;
      if (!Array.isArray(raw) || raw.length === 0) return text("retire_experiences 参数错误：ids 必须是非空数组");
      const ids = raw.map((v) => String(v ?? "").trim()).filter(Boolean);
      if (ids.length === 0) return text("retire_experiences 参数错误：ids 里没有有效 id");
      const reason = String(params.reason ?? "").trim();
      if (!reason) return text("retire_experiences 参数错误：reason 不能为空（档案靠它回溯）");

      const { retired, failures } = retireExperiences(deps.projectPath, ids, reason);
      const scopeLabel = (s: ExperienceScope): string => (s === "project" ? "项目库" : "全局库");
      const okLines = retired.map((r) => `- ${shortId(r.id)}（${scopeLabel(r.scope)}）${r.memory.replace(/\s+/g, " ").slice(0, 60)}`);
      const failLines = failures.map((f) => `- ${f.ref}：${f.error}`);
      if (retired.length === 0) return text(`retire_experiences 未退役任何条目：\n${failLines.join("\n")}`);
      const tail = failures.length > 0 ? `\n未处理 ${failures.length} 条：\n${failLines.join("\n")}` : "";
      // 给出档案绝对路径：只说「已进档案」模型无从回读（误删回溯是这套机制的关键）
      const archives = [...new Set(retired.map((r) => archivePath(r.scope, deps.projectPath)))];
      return text(
        `retire_experiences 完成：已退役 ${retired.length} 条\n${okLines.join("\n")}\n原文与理由已存档案（可回溯）：${archives.join("、")}${tail}`,
      );
    },
  } as any) as ToolDefinition;
}
