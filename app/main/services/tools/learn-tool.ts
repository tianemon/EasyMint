/**
 * learn 工具族 — AI 自沉淀经验库入口。
 *
 * learn：{memory, context?, updateId?, scope?, kind?, skill?} 一次调用完成
 *   「存/改经验 + 可选建/更新 managed skill」。**直接落盘，不弹审阅卡片**——
 *   值不值得沉淀由模型按判定标准自行判断（用户决策 2026-09-12：判断是模型的职责，
 *   标准不写死；落盘后仍可随时用 updateId 改写或 retire_experiences 退役）。
 * search_experiences：{query} 只读检索经验库（全局 + 项目级合并），按命中词数排序。
 *
 * 两者同进退：learnEnabled 开关（D8 默认关闭）控制注册。
 */

import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { writeManagedSkill } from "../skill-service";
import {
  appendExperience,
  kindLabel,
  moveExperience,
  resolveExperience,
  searchExperiences,
  shortId,
  updateExperience,
  type ExperienceKind,
  type ExperienceScope,
} from "../experience-service";

/** learn 工具依赖：项目路径（决定默认作用域与落盘位置） */
export interface LearnToolDeps {
  projectPath?: string;
}

function text(t: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: t }] };
}

/** 参数校验：只接受枚举内的取值，给模型可纠正的错误文案 */
function parseScope(v: unknown): ExperienceScope | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  return v === "project" || v === "global" ? v : "invalid";
}

function parseKind(v: unknown): ExperienceKind | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  return v === "principle" || v === "convention" || v === "temporary" ? v : "invalid";
}

export async function createLearnTool(deps: LearnToolDeps): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "learn",
    label: "沉淀经验",
    // 串行执行的 WHY 不止是 UX：经验库是「整文件读改写」，同批并行会互相覆盖丢条目
    // （两个 learn 各自 load→append→save，后写的把先写的挤掉）
    executionMode: "sequential",
    description:
      "把本会话验证过的可复用经验沉淀入库（**直接落盘，不需要用户确认**）：memory 是持久自包含的经验"
      + "（什么情况 / 做了什么 / 为什么有效）；scope 决定写项目库还是全局库（默认项目）、kind 标时效性质"
      + "（默认约定）；可选 skill 参数同时创建/更新 AI 管理区的 skill（把经验固化为可执行工作流时用）。"
      + "落盘后可随时用 updateId 改写、用 retire_experiences 退役。"
      + "适用：本机与工具链层面的通用知识、框架与技术栈的用法与踩坑、验证过的流程方法、项目内的具体修复与约定。",
    promptSnippet: "沉淀经验（直接入库；可选同时建 skill）",
    promptGuidelines: [
      "**不沉淀（重要）**：一次性操作（配环境、跑一次命令、本次专属排查）／纯信息问答／已沉淀过（先 search_experiences 确认）／项目特有细节换项目无用／含敏感信息（密钥、内网地址）——这些不要调 learn，也不要在回复里提沉淀",
      "**自行判断、直接入库**：判断值得就调 learn，落盘立即生效（没有确认环节）；判断不值得就静默跳过——不要在回复里问用户「要不要沉淀」",
      "learn 前先用 search_experiences 查重：命中近似经验时优先带 updateId 改写它（补全/纠错/合并），确属新经验才不带 updateId 新增",
      "**判定作用域与时效**（scope / kind，按内容判断而不是按习惯）——**全局库放「与本项目代码无关」的通用知识，不是用来跨项目共用项目经验的**："
      + "scope=global：① 本机与环境（操作系统与版本、路径与目录约定、shell/环境变量、git 配置与提交习惯、包管理器与工具安装位置、常用命令）② **框架与技术栈**（Flutter / Spring / Electron / React / 语言与库的用法、坑、最佳实践、版本行为）③ 跨项目成立的工作方式（协作习惯、排查方法）；"
      + "scope=project（默认）：**只对本项目有效**的知识——本项目某个组件/模块/接口的实现与约定、业务规则、架构决策、具体代码的修复/优化/踩坑/排查结论、本项目参考文档位置等；"
      + "一句话判据：这条换一个项目还成立吗？成立 → 全局（并在正文开头写明适用技术栈，如「Flutter 3.41：…」）；只在本项目代码里才成立 → 项目库；"
      + "kind=principle（跨项目成立的通用知识，如本机环境与技术栈）/ kind=convention（项目内约定，默认）/ kind=temporary（只在当前阶段成立，过了就退役）",
      "memory 要自包含：换一个会话不看上下文也能看懂——写清触发条件与做法，不写一次性细节",
      "memory 按「问题 → 做法 → 验证」三段组织：先一句话说清场景与问题，再写做法（可执行），最后写怎么确认有效（成功标志/验证方式）——结构化的经验检索命中率更高，注入时也会保留首尾两段",
      "**纠错回流**：用户纠正/推翻某条经验的适用性时（「这条不对」「规矩改了」），或你发现经验与当前代码事实冲突 → 立刻用 updateId 改写它；整条不再成立则用 retire_experiences 退役——不要只在回复里承认",
      "同一会话同一主题只沉淀一次；经验偏「知识/教训」用 memory，偏「可执行步骤」追加 skill 参数固化为工作流",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        memory: { type: "string" as const, description: "必填。持久自包含的经验：什么情况 / 做了什么 / 为什么有效" },
        context: { type: "string" as const, description: "可选。来源上下文（触发场景、报错摘要等，帮助检索）" },
        updateId: { type: "string" as const, description: "可选。要改写的已有经验 id（短 id 即可，检索结果或注入块里有）——代替新增" },
        scope: { type: "string" as const, description: "可选。写入哪个库：project（默认，只对本项目有效）/ global（本机环境 / 框架与技术栈 / 通用工作方式，与具体项目无关）" },
        kind: { type: "string" as const, description: "可选。时效性质：principle（跨项目成立的通用知识）/ convention（项目内约定，默认）/ temporary（临时，过时应退役）" },
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
    async execute(_tid: string, params: Record<string, unknown>) {
      const memory = String(params.memory || "").trim();
      if (!memory) return text("learn 参数错误：memory 不能为空");

      const context = params.context !== undefined ? String(params.context).trim() : "";
      const updateId = params.updateId !== undefined ? String(params.updateId).trim() : "";
      const scope = parseScope(params.scope);
      const kind = parseKind(params.kind);
      if (scope === "invalid") return text("learn 参数错误：scope 只能是 project 或 global");
      if (kind === "invalid") return text("learn 参数错误：kind 只能是 principle、convention 或 temporary");

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

      // 先写 skill 再写经验：skill 落盘失败（撞名/超限）时整体不成，模型可改名后重试
      let skillNote = "";
      if (skill) {
        const r = writeManagedSkill(skill, deps.projectPath);
        if (!r.ok) return text(`learn 失败：skill 未落盘（${r.error}），经验未入库。请修正后重新 learn（如换 skill 名称）`);
        skillNote = `；skill「${skill.name}」已${skill.action === "create" ? "创建" : "更新"}于 AI 管理区`;
      }

      if (updateId) {
        const before = resolveExperience(deps.projectPath, updateId);
        if (!before.ok) return text(`learn 失败：未找到经验「${updateId}」（可先 search_experiences 拿短 id）`);
        const r = updateExperience(deps.projectPath, updateId, {
          memory,
          context: context || undefined,
          kind: kind ?? undefined,
        });
        if (!r.ok) return text(`learn 失败：${r.error}`);
        const id = shortId(r.entry.id);
        // 显式指定了不同的 scope → 顺手移动（保留 id 与计数，不留双份）
        if (scope && scope !== before.entry.scope) {
          const moved = moveExperience(deps.projectPath, updateId, scope);
          if (!moved.ok) return text(`经验 ${id} 已改写，但移动作用域失败（${moved.error}）`);
          return text(`learn 成功：经验 ${id} 已改写并移到${scope === "global" ? "全局库" : "项目库"}${skillNote}`);
        }
        return text(`learn 成功：经验 ${id} 已改写（${kindLabel(r.entry.kind)}${skillNote}）`);
      }

      const written = appendExperience(
        { memory, context: context || undefined, kind: kind ?? undefined },
        { scope: scope ?? undefined, projectPath: deps.projectPath },
      );
      const id = shortId(written.entry.id);
      const where = written.scope === "global" ? "全局库" : "项目库";
      // 显式要项目库但没有项目路径（无项目工作区）→ 兑现全局并说明，避免用户以为丢了
      const fallback = scope === "project" && !deps.projectPath ? "（当前会话无项目路径，已落全局库）" : "";
      return text(`learn 成功：经验 ${id} 已入库（${where}·${kindLabel(written.entry.kind)}）${fallback}${skillNote}`);
    },
  } as any) as ToolDefinition;
}

export async function createSearchExperiencesTool(projectPath?: string): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "search_experiences",
    label: "搜索经验",
    description:
      "检索历史沉淀的经验库（全局 + 当前项目合并），返回匹配条目。"
      + "适用：接手任务/遇到报错时先搜一下是否踩过同样的坑；learn 前查重（命中近似经验时带 updateId 改写而不是新增）。",
    promptSnippet: "搜索历史沉淀的经验（关键词）",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "关键词，可多词（按空格分隔，命中词数越多越靠前）" },
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
        const scopeLabel = e.scope === "project" ? "项目" : "全局";
        // 短 id 必须回传：updateId / retire_experiences 都按它引用（不回传则模型无从改、无从删）
        return `- [${date}][${scopeLabel}·${kindLabel(e.kind)}][id: ${shortId(e.id)}] ${e.memory}${ctx}`;
      });
      return text(
        `匹配 ${total} 条（显示前 ${hits.length} 条；改写用 learn 带 updateId=<id>，不再成立用 retire_experiences）：\n${lines.join("\n")}`,
      );
    },
  } as any) as ToolDefinition;
}
