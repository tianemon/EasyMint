/**
 * learn 工具族 — AI 自沉淀经验库入口（索引 + 原文分离）。
 *
 * learn：{title, body, tags?, updateId?, scope?, kind?, skill?} 一次调用完成
 *   「写原文文件 + 登记索引（+ 可选建/更新 managed skill）」。**直接落盘，不弹审阅卡片**——
 *   值不值得沉淀由模型按判定标准自行判断（用户决策：判断是模型的职责，标准不写死）；
 *   落盘后仍可随时用 updateId 改写或 retire_experiences 退役。
 * search_experiences：{query} 只读检索（标题/标签/正文命中），**返回索引与命中片段**——
 *   上下文有限，正文要按需用 read 读。
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
  storeDir,
  updateExperience,
  type ExperienceKind,
  type ExperienceScope,
} from "../experience-service";

export interface LearnToolDeps {
  projectPath?: string;
}

function text(t: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: t }] };
}

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
    // 串行执行的 WHY 不止是 UX：索引是「整文件读改写」，同批并行会互相覆盖丢条目
    executionMode: "sequential",
    description:
      "把本会话验证过的可复用经验沉淀入库（**直接落盘，不需要用户确认**）：落成「标题 + 原文」——原文写进 "
      + `${storeDir("project", deps.projectPath ?? "<项目>/.easymint/experiences")} 或 ${storeDir("global")} `
      + "目录下的 markdown 文件（文件名为 `<短id>-<标题>.md`），索引登记在**同目录的 index.json**。"
      + "注入进上下文的**只有索引**（标题 + 文件名）——模型上下文有限，正文由需要的一方用 read 按需读取。"
      + "落盘后可随时用 updateId 改写、用 retire_experiences 退役。",
    promptSnippet: "沉淀经验（写原文 + 登记索引；直接入库）",
    promptGuidelines: [
      "**按价值保存，不按工作量保存**：用户明确要求记住，或本任务验证了以后可能再用、已有规则/文档未覆盖的根因、解法或适用边界时保存；项目内有效也可以有价值。不因工具调用多、任务完成或完成 review 就例行沉淀。没有值得记的内容就静默结束，不追加专门评估回合、不问用户要不要沉淀。不要保存一次性操作、未验证猜测或敏感信息",
      "**内容各归原处**：任务进展归会话/开发记录，步骤与状态归待办/正式任务，长期必守规则归项目规则/现行文档，可重复执行的方法归 skill，审查发现归 review 报告。经验库只补充这些载体未覆盖、容易再踩的教训，不复制现有规则，也不把经验当作高于当前用户指令和项目事实的要求",
      "**直接入库与查重**：保存前用 search_experiences 查近似条目；有则优先带 updateId 改写，无则新增，不需用户确认。同一任务同一主题不重复新增",
      "**作用域与价值分开判断**：scope=global 用于换项目仍成立的环境、技术栈/版本行为与工作方法；scope=project（默认）用于仅本项目成立、否则容易再次踩坑的实现约束与决策理由。已在项目规则或文档中明确的事实不重复保存",
      "**判定 tags（决定注入时机）**：全局条目必须给 tags——技术栈/平台类写技术名（如 [\"flutter\"]、[\"electron\",\"tailwind\"]、[\"macos\"]），**只有带 tags 与当前项目技术栈匹配的全局条目才会被注入**；本机环境/工作方式这类「任何项目都该看见」的用空数组（常驻注入）。项目条目不需 tags",
      "**kind 标时效**：principle（与本项目无关的通用知识）/ convention（项目内约定，默认）/ temporary（只在当前阶段成立，过了就退役）",
      "**title 是一句话说明**（≤60 字，写清「什么场景 + 什么结论」，用于索引展示与检索）；**body 是原文**，按「问题 → 做法 → 验证」三段写 markdown：换一个会话不看上下文也能看懂，写清触发条件、具体做法与成功标志",
      "**纠错回流**：用户纠正/推翻某条经验的适用性时（「这条不对」「规矩改了」），或你发现经验与当前代码事实冲突 → 立刻用 updateId 改写；整条不再成立则用 retire_experiences 退役——不要只在回复里承认",
      "需要固化可重复执行的方法时可用 skill 参数；经验 body 只保留适用边界与验证教训，不复制 skill 中的操作步骤",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        title: { type: "string" as const, description: "必填。一句话说明（≤60 字）：什么场景 + 什么结论" },
        body: { type: "string" as const, description: "必填。原文（markdown，问题 → 做法 → 验证三段，自包含）" },
        tags: { type: "string" as const, description: "可选。技术栈/平台标签（逗号分隔，如 flutter / electron,tailwind / macos）；全局条目建议都给，空 = 通用常驻" },
        updateId: { type: "string" as const, description: "可选。要改写的已有经验 id（短 id 即可，索引或检索结果里有）——代替新增" },
        scope: { type: "string" as const, description: "可选。写入哪个库：project（默认，只对本项目有效）/ global（本机环境 / 框架与技术栈 / 通用工作方式）" },
        kind: { type: "string" as const, description: "可选。principle（与本项目无关的通用知识）/ convention（项目内约定，默认）/ temporary（临时，过时应退役）" },
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
      required: ["title" as const, "body" as const],
    },
    async execute(_tid: string, params: Record<string, unknown>) {
      const title = String(params.title || "").trim();
      const body = String(params.body || "").trim();
      if (!title) return text("learn 参数错误：title 不能为空（一句话说明，用于索引展示与检索）");
      if (!body) return text("learn 参数错误：body 不能为空（原文，问题 → 做法 → 验证）");

      const updateId = params.updateId !== undefined ? String(params.updateId).trim() : "";
      const scope = parseScope(params.scope);
      const kind = parseKind(params.kind);
      if (scope === "invalid") return text("learn 参数错误：scope 只能是 project 或 global");
      if (kind === "invalid") return text("learn 参数错误：kind 只能是 principle、convention 或 temporary");
      const tags = typeof params.tags === "string"
        ? params.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
        : Array.isArray(params.tags)
          ? (params.tags as unknown[]).map((t) => String(t).trim()).filter(Boolean)
          : undefined;

      let skill: { action: "create" | "update"; name: string; description: string; body: string } | undefined;
      const rawSkill = params.skill as Record<string, unknown> | undefined;
      if (rawSkill && typeof rawSkill === "object") {
        const action = rawSkill.action === "update" ? "update" : rawSkill.action === "create" ? "create" : null;
        const name = String(rawSkill.name || "");
        const description = String(rawSkill.description || "");
        const skillBody = String(rawSkill.body || "");
        if (!action) return text("learn 参数错误：skill.action 必须是 create/update");
        if (!name || !description || !skillBody) return text("learn 参数错误：skill 需同时提供 name/description/body");
        skill = { action, name, description, body: skillBody };
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
        const r = updateExperience(deps.projectPath, updateId, { title, body, tags, kind: kind ?? undefined });
        if (!r.ok) return text(`learn 失败：${r.error}`);
        const id = shortId(r.entry.id);
        if (scope && scope !== before.entry.scope) {
          const moved = moveExperience(deps.projectPath, updateId, scope);
          if (!moved.ok) return text(`经验 ${id} 已改写，但移动作用域失败（${moved.error}）`);
          return text(`learn 成功：经验 ${id} 已改写并移到${scope === "global" ? "全局库" : "项目库"}${skillNote}`);
        }
        return text(`learn 成功：经验 ${id} 已改写（${kindLabel(r.entry.kind)}，原文已更新）${skillNote}`);
      }

      const written = appendExperience(
        { title, body, tags, kind: kind ?? undefined },
        { scope: scope ?? undefined, projectPath: deps.projectPath },
      );
      const id = shortId(written.entry.id);
      const where = written.scope === "global" ? "全局库" : "项目库";
      const tagNote = written.entry.tags.length > 0 ? `，tags=${written.entry.tags.join(",")}` : "（通用条目，常驻注入）";
      const fallback = scope === "project" && !deps.projectPath ? "（当前会话无项目路径，已落全局库）" : "";
      return text(`learn 成功：经验 ${id} 已入库（${where}·${kindLabel(written.entry.kind)}${tagNote}）${fallback}${skillNote}；原文 ${written.entry.file}`);
    },
  } as any) as ToolDefinition;
}

export async function createSearchExperiencesTool(projectPath?: string): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "search_experiences",
    label: "搜索经验",
    description:
      "检索历史沉淀的经验库（全局 + 当前项目合并），返回匹配条目及其原文文件名——**这里只给索引与命中片段**，"
      + "判断确实相关时再用 read 读原文（路径 = 工具结果里的目录 + file 名）。"
      + "适用：遇到疑似踩过的坑时搜索历史解法；learn 前查重（命中近似经验时带 updateId 改写而不是新增）。",
    promptSnippet: "搜索历史沉淀的经验（关键词；返回索引与片段）",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "关键词，可多词（按空格分隔，命中词数越多越靠前；标题与标签命中权重更高）" },
      },
      required: ["query" as const],
    },
    async execute(_tid: string, params: Record<string, unknown>) {
      const query = String(params.query || "").trim();
      if (!query) return text("search_experiences 参数错误：query 不能为空");
      const { hits, total } = searchExperiences(query, projectPath, { touch: true });
      if (hits.length === 0) return text(`经验库中无「${query}」的匹配。可换关键词，或确认该场景未沉淀过`);
      const lines = hits.map((e) => {
        const where = e.scope === "project" ? "项目" : "全局";
        const tags = e.tags.length > 0 ? ` · tags ${e.tags.join(",")}` : "";
        const excerpt = e.excerpt ? `\n    片段：${e.excerpt.slice(0, 180)}` : "";
        return `- [id: ${shortId(e.id)}] ${e.title}（${where}·${kindLabel(e.kind)}${tags} · file ${e.file} · 检索命中 ${e.usageCount ?? 0}）${excerpt}`;
      });
      return text(
        `匹配 ${total} 条（显示前 ${hits.length} 条）。**只看索引与片段判断是否相关**，需要全文时用 read 读原文`
        + `（路径 = 目录 + file 名，目录见下）；改写用 learn 带 updateId=<id>，不再成立用 retire_experiences：\n`
        + `- 本项目目录：${storeDir("project", projectPath ?? "<项目>/.easymint/experiences")}\n`
        + `- 本机/通用目录：${storeDir("global")}\n`
        + lines.join("\n"),
      );
    },
  } as any) as ToolDefinition;
}
