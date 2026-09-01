/**
 * learn 工具族（期 3）——AI 自沉淀一步式入口。
 *
 * learn：{memory, context?, skill?} 一次调用完成「存经验 + 建/更新 managed skill」。
 *   挂起审阅式（复用 ask_user 模式）：execute 广播 learn-request → 前端审阅卡片 →
 *   用户确认（可携带编辑后的 memory/skillBody）才落盘；取消/abort 不落盘。
 * search_experiences：{query} 只读检索经验库（全局 + 项目级合并），低频按需。
 *
 * 两者同进退：learnEnabled 开关（D8 默认关闭）控制注册。
 */

import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { writeManagedSkill } from "../skill-service";
import { appendExperience, searchExperiences, updateExperience } from "../experience-service";

/** learn 挂起请求的用户响应（IPC learn:respond 传入） */
export interface LearnResponse {
  approved: boolean;
  /** 卡片上编辑后的正文（未编辑则回传原文） */
  memory?: string;
  skillBody?: string;
  /** 卡片上可编辑的 skill 元信息（撞名/修正场景，未编辑则回传原文） */
  skillName?: string;
  skillDescription?: string;
}

/** 挂起状态与广播由 agent-service 持有（同 pendingAsks 模式）；工具只管协议 */
export interface LearnToolDeps {
  projectPath?: string;
  /** 广播审阅请求并挂起等响应；返回用户响应（signal abort 时返回 { approved: false }） */
  requestReview: (
    payload: { memory: string; context?: string; skill?: { action: "create" | "update"; name: string; description: string; body: string } },
    signal: AbortSignal | undefined,
  ) => Promise<LearnResponse>;
}

function text(t: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: t }] };
}

export async function createLearnTool(deps: LearnToolDeps): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "learn",
    label: "沉淀经验",
    description:
      "把本会话验证过的可复用经验沉淀入库（一次调用完成）：memory 是持久自包含的经验"
      + "（什么情况 / 做了什么 / 为什么有效），可选 skill 参数同时创建/更新 AI 管理区的 skill"
      + "（把经验固化为可执行工作流时用）。调用后弹出审阅卡片，用户确认才落盘。"
      + "适用：踩坑修复（报错→根因→解法）、验证过的流程方法、跨项目通用的协作约定。",
    promptSnippet: "沉淀经验（可选同时建 skill，审阅卡片确认）",
    promptGuidelines: [
      "任务完成且出现可复用经验（踩坑修复/验证过的方法/项目约定）时主动 learn 入库，不要只在回复里说一遍",
      "learn 前先用 search_experiences 查重：命中近似经验时优先带 updateId 更新它（补全/纠错/合并），确属新经验才不带 updateId",
      "memory 要自包含：换一个会话不看上下文也能看懂——写清触发条件与做法，不写一次性细节",
      "memory 按「问题 → 方案 → 验证」三段组织：先一句话说清场景与问题，再写做法（可执行），最后写怎么确认有效（成功标志/验证方式）——结构化的经验检索命中率更高",
      "经验偏「知识/教训」用 memory；偏「可执行步骤」追加 skill 参数固化为工作流",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        memory: { type: "string" as const, description: "必填。持久自包含的经验：什么情况 / 做了什么 / 为什么有效" },
        context: { type: "string" as const, description: "可选。来源上下文（触发场景、报错摘要等，帮助检索）" },
        updateId: { type: "string" as const, description: "可选。要更新的已有经验 id（search_experiences 查重命中时用，代替新增）" },
        skill: {
          type: "object" as const,
          description: "可选。同时沉淀为 managed skill（AI 管理区），把经验固化为可执行工作流时用",
          properties: {
            action: { type: "string" as const, description: "create（新建）/ update（更新已有 managed skill）" },
            name: { type: "string" as const, description: "skill 名称，[a-z0-9][a-z0-9-]{0,63}" },
            description: { type: "string" as const, description: "skill 描述（单行，何时用）" },
            body: { type: "string" as const, description: "skill 正文（Markdown，不含 frontmatter）" },
          },
          required: ["action" as const, "name" as const, "description" as const, "body" as const],
        },
      },
      required: ["memory" as const],
    },
    async execute(_tid: string, params: Record<string, unknown>, signal: AbortSignal | undefined) {
      const memory = String(params.memory || "").trim();
      const context = params.context !== undefined ? String(params.context).trim() : "";
      const updateId = params.updateId !== undefined ? String(params.updateId).trim() : "";
      if (!memory) return text("learn 参数错误：memory 不能为空");

      let skill: { action: "create" | "update"; name: string; description: string; body: string } | undefined;
      const rawSkill = params.skill as Record<string, unknown> | undefined;
      if (rawSkill && typeof rawSkill === "object") {
        const action = rawSkill.action === "update" ? "update" : rawSkill.action === "create" ? "create" : null;
        const name = String(rawSkill.name || "");
        const description = String(rawSkill.description || "");
        const body = String(rawSkill.body || "");
        if (!action) return text("learn 参数错误：skill.action 必须是 create/update");
        if (!name || !description || !body) return text("learn 参数错误：skill 需同时提供 name/description/body");
        skill = { action, name, description, body };
      }

      const response = await deps.requestReview({ memory, context: context || undefined, skill }, signal);
      if (!response.approved) {
        return text("用户未确认，本次未入库（可按用户反馈调整后重新 learn，或不再沉淀）");
      }

      // 落盘原子性：先 skill 后 memory——skill 写盘失败（撞名/超限/目录异常）时整体失败返回
      //（经验不半途入库），模型可按错误修正（如换名）后重新 learn
      const finalMemory = (response.memory || memory).trim();
      // 空编辑防线：前端已禁用空确认按钮，此处兜底 IPC 直调等非前端路径
      if (!finalMemory) return text("learn 失败：编辑后的 memory 为空，未入库");

      // 更新路径：updateId 指向已有经验——用户确认后的 memory 覆盖原条目（合并/纠错/补全）
      if (updateId) {
        const updated = updateExperience(deps.projectPath, updateId, { memory: finalMemory, context: context || undefined });
        if (!updated) {
          return text(`learn 失败：未找到经验 ${updateId}（可能已被清理）。请去掉 updateId 重新 learn 作为新经验入库`);
        }
        if (skill) {
          const finalName = (response.skillName || skill.name).trim();
          const finalDesc = (response.skillDescription || skill.description).trim();
          const finalBody = response.skillBody !== undefined ? response.skillBody : skill.body;
          const r = writeManagedSkill({ action: skill.action, name: finalName, description: finalDesc, body: finalBody }, deps.projectPath);
          if (!r.ok) return text(`经验已更新，但 skill 未落盘（${r.error}）。请修正后重新 learn（不带 updateId 仅重试 skill，或直接用 manage_skill）`);
          return text(`learn 成功：经验 ${updateId} 已更新；skill「${finalName}」已${skill.action === "create" ? "创建" : "更新"}于 AI 管理区`);
        }
        return text(`learn 成功：经验 ${updateId} 已更新（未新增条目）`);
      }

      if (skill) {
        const finalName = (response.skillName || skill.name).trim();
        const finalDesc = (response.skillDescription || skill.description).trim();
        const finalBody = response.skillBody !== undefined ? response.skillBody : skill.body;
        const r = writeManagedSkill(
          { action: skill.action, name: finalName, description: finalDesc, body: finalBody },
          deps.projectPath,
        );
        if (!r.ok) {
          return text(`learn 失败：skill 未落盘（${r.error}），经验未入库。请修正后重新 learn（如换 skill 名称）`);
        }
        try {
          appendExperience({ memory: finalMemory, context: context || undefined }, deps.projectPath);
        } catch (e) {
          return text(`learn 部分成功：skill「${finalName}」已落盘，但经验写盘失败（${(e as Error).message}）。可重新 learn（不带 skill 参数）仅补存经验`);
        }
        return text(`learn 成功：经验已入库；skill「${finalName}」已${skill.action === "create" ? "创建" : "更新"}于 AI 管理区`);
      }
      try {
        appendExperience({ memory: finalMemory, context: context || undefined }, deps.projectPath);
      } catch (e) {
        return text(`learn 失败：经验写盘失败（${(e as Error).message}）`);
      }
      return text("learn 成功：经验已入库");
    },
  } as any) as ToolDefinition;
}

export async function createSearchExperiencesTool(projectPath?: string): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "search_experiences",
    label: "搜索经验",
    description:
      "检索历史沉淀的经验库（全局 + 当前项目），返回匹配条目。"
      + "适用：接手任务/遇到报错时先搜一下是否踩过同样的坑；引用 learn 沉淀过的做法。",
    promptSnippet: "搜索历史沉淀的经验（关键词）",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "关键词（报错信息片段/技术名词/操作名）" },
      },
      required: ["query" as const],
    },
    async execute(_tid: string, params: Record<string, unknown>) {
      const query = String(params.query || "").trim();
      if (!query) return text("search_experiences 参数错误：query 不能为空");
      const { hits, total } = searchExperiences(query, projectPath, { touch: true });
      if (hits.length === 0) return text(`经验库中无「${query}」的匹配。可换关键词，或确认该场景未沉淀过`);
      const lines = hits.map((e) => {
        const date = new Date(e.createdAt).toISOString().slice(0, 10);
        const ctx = e.context ? `\n  上下文: ${e.context.slice(0, 200)}` : "";
        const proj = e.project ? `（项目沉淀）` : "";
        return `- [${date}]${proj} ${e.memory}${ctx}`;
      });
      return text(`匹配 ${total} 条（显示前 ${hits.length} 条）：\n${lines.join("\n")}`);
    },
  } as any) as ToolDefinition;
}
