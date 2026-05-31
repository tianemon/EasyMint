/**
 * 系统提示词管理服务
 *
 * 管理 Chat 模式的系统提示词 CRUD。
 * 存储在 ~/.easymint/system-prompts.json
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Types ──────────────────────────────────────────

export interface SystemPrompt {
  id: string;
  name: string;
  content: string;
  isBuiltin: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SystemPromptConfig {
  prompts: SystemPrompt[];
  /** 默认提示词 ID（新建对话时自动选中） */
  defaultPromptId?: string;
  /** 是否追加日期时间和用户名到提示词末尾 */
  appendDateTimeAndUserName: boolean;
}

export interface SystemPromptCreateInput {
  name: string;
  content: string;
}

export interface SystemPromptUpdateInput {
  name?: string;
  content?: string;
}

// ── Constants ──────────────────────────────────────

export const BUILTIN_DEFAULT_ID = "builtin-default";

// ── 提示词块 ──

/** 身份 + 行为规范（始终作为 system prompt 发送） */
export const MINT_SYSTEM_PROMPT = `<identity>
你叫 Mint，是 EasyMint 桌面应用的内置 AI 助手。谨记你的名字。

你的角色是用户的**项目经理 + 架构师**。你：
- 像一个经验丰富的 PM，帮用户梳理需求、拆解任务、把控节奏
- 像一个资深架构师，在技术选型和系统设计上给出专业建议
- 帮用户避开只有做过很多项目才知道的坑
- 直接、务实、不啰嗦，把复杂问题讲简单
- 用户不确定时帮用户选，但让用户知道为什么这么选

你只有一个核心目标：**帮用户把项目做好**。写代码只是手段，不是目的。
</identity>

<language>
与用户交互时必须使用中文。代码和技术内容（变量名、命令行、配置等）按技术习惯处理即可，不需要翻译。
</language>

你需要在以下方面保持关注：

**1. 直接解决问题，但先确保信息完整**
- 优先给出简洁的解决方案
- 如果方案依赖前置信息或关键决策，先向用户提问
- 如果用户的需求可能忽略重要的知识点，主动提醒，但保持简洁

**2. 渐进式引导，降低认知压力**
- 多步骤复杂任务：先给出结构和选项，让用户选择后再展开
- 多种方案：先对比各方案的适用场景和权衡，让用户决定后再详细说明
- 复杂概念：先给核心要点，用户需要时再深入

**3. 根据上下文推测用户水平**
- 从用户的提问方式、使用的术语判断用户的能力水平
- 调整解释的深度：新手多解释概念，熟手直接给方案
- 不确定时可以直接问用户

**4. 遇到不确定时主动询问，避免主观决断**
- 技术选型、架构决策、配置参数等关键选择，先问用户的场景和需求
- 如果有多个合理方案，列出对比让用户选择，而不是替用户决定

**5. 识别学习场景，提供适当支持**
- 当用户在学习新概念时，避免引入超出当前范围的复杂内容
- 多鼓励，少批评

**6. 保持耐心、人性化、简洁**
- 用自然的语言，不要过于正式或机械
- 直接回答问题，不要过度铺垫
- 承认不确定性，而不是强行给出模糊答案

**7. 主动识别并提示关键知识点**
- 当发现多种概念混杂或逻辑混乱时，主动点明并纠正
- 当用户的问题触及重要概念但用户可能没意识到时，主动提醒

**8. 关于工具**
- 主动使用工具来获取信息和解决问题
- 当你觉得需要使用工具时，不要犹豫，直接使用
- 当用户的问题比较复杂、需要多步骤执行时，主动规划并执行

**9. 项目开发支持**
- 理解用户的项目目标和需求，帮助用户梳理清晰的开发计划
- 在代码生成后，主动告知用户如何运行和测试
- 关注项目的完整性：不仅是代码，还包括配置、依赖、文档
- 帮助用户建立好的项目习惯：版本控制、文件组织、命名规范

**10. 后续开发**
- 当用户提出开发需求时，直接动手，不废话
- 读 task.json 了解当前状态，创建新任务、实现、测试、标记完成
- 遇到阻塞再说话，不要预先输出风险告知
`;

/** 项目初始化指令（用户消息中发送） */
export const PROJECT_INIT_INSTRUCTION = `请按顺序完成以下全部工作（一气呵成，中间不要停下来问用户）：

1. 写 docs/需求规格.md — 项目需求规格文档，包含项目概述、功能清单（按P0/P1/P2）、页面/模块结构、技术栈、设计风格
2. 写 docs/架构设计.md — 架构设计文档，包含系统架构图（Mermaid）、数据模型、页面/组件树、API设计、环境变量
3. 写 README.md — 项目说明文档，从模板空文件编辑，填入项目名称、简介、技术栈、如何运行
4. 更新 CLAUDE.md — 删除"检查是否已初始化"章节，填入项目背景、常用命令、技术栈信息

5. 编辑 init.sh，根据项目实际技术栈填入 PROJECT_DIR、运行时检测、依赖安装和启动命令

6. 执行 bash init.sh：
   - 成功 → 告知"环境初始化完成，可以开始开发了"。在回复末尾追加原话：\`环境已就绪。点击任务面板的「分配任务」按钮开始分配开发任务。\`
   - 被权限拦截 → 提示用户切换到"完全自主"模式，等切换后继续
   - 失败 → 修改后重试，最多3次

   **不要在 task.json 中创建任务。任务分配由后续按钮触发。**`;

/** 任务分配指令（用户点击按钮后发送） */
export const TASK_ALLOCATION_INSTRUCTION = `请根据项目文档分配开发任务：

1. 读 docs/需求规格.md — 了解所有功能及其优先级（P0/P1/P2）
2. 读 docs/架构设计.md — 了解技术栈和系统结构
3. 按以下原则编辑 task.json：

**拆分原则：**
- 一个功能 = 一个任务。以用户能理解的功能为基本单位（如"用户注册"而非"创建表单组件"）
- 一个功能描述超过一句话说不清楚的，拆成多个任务
- 禁止过度拆分。如果一个任务少于 50 行代码或仅涉及 1 个文件，就合并到相邻任务
- P0 功能优先拆分，P1/P2 可以每组 2-3 个功能合并为 1 个任务
- 有依赖的任务标注 dependsOn 字段，无依赖的可以并行

**格式：**
{ "tasks": [
  { "id": 1, "title": "用户注册功能", "description": "...", "steps": ["..."], "priority": "P0", "passes": false, "evaluated": false },
  { "id": 2, "title": "用户登录功能", "description": "...", "steps": ["..."], "priority": "P0", "dependsOn": [1], "passes": false, "evaluated": false }
]}

**注意：**
- 直接覆盖 task.json，不要创建新文件
- 写原始 JSON，不要加 Markdown 代码块或语法高亮标签
- P0 任务优先排在前面，然后 P1，最后 P2
- 覆盖所有 P0 和大部分 P1，P2 可先不写入
- 完成后告知用户任务分配情况（共 N 个任务，P0 X 个，P1 Y 个）`;

/** 内置默认提示词（即系统提示词） */
export const BUILTIN_DEFAULT_PROMPT_STRING = MINT_SYSTEM_PROMPT;

export const BUILTIN_DEFAULT_PROMPT: SystemPrompt = {
  id: BUILTIN_DEFAULT_ID,
  name: "Mint 内置提示词",
  content: BUILTIN_DEFAULT_PROMPT_STRING,
  isBuiltin: true,
  createdAt: 0,
  updatedAt: 0,
};

// ── Paths ──────────────────────────────────────────

const DATA_DIR = path.join(os.homedir(), ".easymint");
const CONFIG_PATH = path.join(DATA_DIR, "system-prompts.json");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ── Config IO ──────────────────────────────────────

function getDefaultConfig(): SystemPromptConfig {
  return {
    prompts: [{ ...BUILTIN_DEFAULT_PROMPT }],
    defaultPromptId: BUILTIN_DEFAULT_ID,
    appendDateTimeAndUserName: true,
  };
}

function readConfig(): SystemPromptConfig {
  ensureDir();

  if (!existsSync(CONFIG_PATH)) {
    return getDefaultConfig();
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const data = JSON.parse(raw) as SystemPromptConfig;

    // 确保内置提示词始终存在，且内容与源码保持同步
    const builtinIndex = data.prompts.findIndex((p) => p.id === BUILTIN_DEFAULT_ID);
    if (builtinIndex === -1) {
      data.prompts.unshift({ ...BUILTIN_DEFAULT_PROMPT });
    } else {
      data.prompts[builtinIndex] = { ...BUILTIN_DEFAULT_PROMPT };
    }

    return {
      prompts: data.prompts,
      defaultPromptId: data.defaultPromptId ?? BUILTIN_DEFAULT_ID,
      appendDateTimeAndUserName: data.appendDateTimeAndUserName ?? true,
    };
  } catch (error) {
    console.error("[系统提示词] 读取配置失败:", error);
    return getDefaultConfig();
  }
}

function writeConfig(config: SystemPromptConfig): void {
  ensureDir();
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch (error) {
    console.error("[系统提示词] 写入配置失败:", error);
    throw new Error("写入系统提示词配置失败");
  }
}

// ── Public API ─────────────────────────────────────

export function getSystemPromptConfig(): SystemPromptConfig {
  return readConfig();
}

export function createSystemPrompt(input: SystemPromptCreateInput): SystemPrompt {
  const config = readConfig();
  const now = Date.now();

  const prompt: SystemPrompt = {
    id: randomUUID(),
    name: input.name,
    content: input.content,
    isBuiltin: false,
    createdAt: now,
    updatedAt: now,
  };

  config.prompts.push(prompt);
  writeConfig(config);
  console.log(`[系统提示词] 已创建: ${prompt.name} (${prompt.id})`);
  return prompt;
}

export function updateSystemPrompt(id: string, input: SystemPromptUpdateInput): SystemPrompt {
  const config = readConfig();
  const index = config.prompts.findIndex((p) => p.id === id);

  if (index === -1) {
    throw new Error(`提示词不存在: ${id}`);
  }

  const prompt = config.prompts[index]!;
  if (prompt.isBuiltin) {
    throw new Error("内置提示词不可编辑");
  }

  if (input.name !== undefined) prompt.name = input.name;
  if (input.content !== undefined) prompt.content = input.content;
  prompt.updatedAt = Date.now();

  writeConfig(config);
  console.log(`[系统提示词] 已更新: ${prompt.name} (${prompt.id})`);
  return prompt;
}

export function deleteSystemPrompt(id: string): void {
  const config = readConfig();
  const prompt = config.prompts.find((p) => p.id === id);

  if (!prompt) {
    throw new Error(`提示词不存在: ${id}`);
  }

  if (prompt.isBuiltin) {
    throw new Error("内置提示词不可删除");
  }

  config.prompts = config.prompts.filter((p) => p.id !== id);

  // 如果被删除的是默认提示词，重置为内置默认
  if (config.defaultPromptId === id) {
    config.defaultPromptId = BUILTIN_DEFAULT_ID;
  }

  writeConfig(config);
  console.log(`[系统提示词] 已删除: ${prompt.name} (${id})`);
}

export function updateAppendSetting(enabled: boolean): void {
  const config = readConfig();
  config.appendDateTimeAndUserName = enabled;
  writeConfig(config);
  console.log(`[系统提示词] 追加设置已更新: ${enabled}`);
}

export function setDefaultPrompt(id: string | null): void {
  const config = readConfig();

  if (id !== null) {
    const exists = config.prompts.some((p) => p.id === id);
    if (!exists) {
      throw new Error(`提示词不存在: ${id}`);
    }
  }

  config.defaultPromptId = id ?? BUILTIN_DEFAULT_ID;
  writeConfig(config);
  console.log(`[系统提示词] 默认提示词已设置: ${config.defaultPromptId}`);
}

/**
 * 解析最终的 system prompt 文本
 * 根据 defaultPromptId 找到对应提示词，拼接日期时间和用户名。
 */
/** Return the static prompt content (no dynamic time/user). Safe to inject on every call. */
export function resolveEffectivePrompt(): string {
  const config = readConfig();
  const promptId = config.defaultPromptId ?? BUILTIN_DEFAULT_ID;
  const prompt = config.prompts.find((p) => p.id === promptId);
  return prompt?.content ?? "";
}

/** Dynamic context that changes per-message — prepend to user message, not system prompt. */
export function buildDynamicContext(): string {
  const config = readConfig();
  if (!config.appendDateTimeAndUserName) return "";

  const now = new Date();
  const dateTimeStr = now.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
  });
  return `[当前时间: ${dateTimeStr}]\n`;
}
