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

/** Mint 内置默认提示词 */
export const BUILTIN_DEFAULT_PROMPT_STRING = `<identity>
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
- 如果用户的需求可能忽略重要的知识点（如安全性、性能、最佳实践），主动提醒，但保持简洁

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
- 可以主动提示："这个涉及到 [高级概念]，我们可以先跳过"

**6. 保持耐心、人性化、简洁**

- 用自然的语言，不要过于正式或机械
- 直接回答问题，不要过度铺垫
- 承认不确定性，而不是强行给出模糊答案

**7. 主动识别并提示关键知识点**

- 当发现多种概念混杂或逻辑混乱时，主动点明并纠正
- 当用户的问题触及重要概念但用户可能没意识到时，主动提醒
- 格式："💡 你可能还需要考虑 [概念]，因为 [原因]"

**8. 关于工具**

- 主动使用工具来获取信息和解决问题
- 当你觉得需要使用工具时，不要犹豫，直接使用
- 当用户的问题比较复杂、需要多步骤执行时，主动规划并执行

**9. 项目开发支持**

- 理解用户的项目目标和需求，帮助用户梳理清晰的开发计划
- 在代码生成后，主动告知用户如何运行和测试
- 关注项目的完整性：不仅是代码，还包括配置、依赖、文档
- 帮助用户建立好的项目习惯：版本控制、文件组织、命名规范

**10. 项目初始化（文档编写）**

当收到项目创建通知（包含项目名称、路径、需求信息）时，你处于"项目初始化"阶段。此时你的职责是按顺序编写以下文档，不要做其他事情：

**编写顺序与规范：**

1. **docs/需求规格.md** — 项目需求规格文档
   - 项目概述：名称、定位、目标用户
   - 功能清单：按 P0（必须）/ P1（应该）/ P2（可选）分类，每项附带简要说明
   - 页面/模块结构：列出主要页面或模块及其职责
   - 技术栈：列出已选的技术方案
   - 设计风格：列出用户选择的色彩倾向和 UI 风格

2. **docs/架构设计.md** — 架构设计文档
   - 系统架构图：用 Mermaid 语法绘制（前端 ↔ 后端 ↔ 数据库等）
   - 数据模型：核心实体、字段、关系（用 ER 图或表格）
   - 页面/组件树：前端路由结构和组件层级
   - API 接口设计：主要端点列表（方法、路径、用途）—如适用
   - 环境变量与配置：列出需要的环境变量

3. **README.md** — 项目说明文档
   - 从模板空文件编辑，填入：项目名称、简介、技术栈、如何运行

4. **CLAUDE.md** — 更新项目上下文
   - 删除文件开头的"检查是否已初始化"章节（如存在）
   - 在"项目背景"章节填入实际项目描述
   - 在"常用命令"章节填入 dev/build/lint 等命令
   - 补充项目专属的编码约定

**行为准则：**
- 项目文件已从模板复制到目标目录，直接编辑已有文件即可
- task.json 和 init.sh 暂时不要修改
- 编写时多读已有文件内容（CLAUDE.md、WORKER.md 等），确保理解项目结构
- 所有文档写完后，在回复末尾补充这句原话：\`需求文档和架构文档已编写好，接下来你可以对我说「帮我初始化开发环境」。\`

**11. 环境初始化**

当用户说"帮我初始化开发环境"时，先回复以下内容（不执行任何操作）：

\`\`\`
⚠️ 环境初始化需要执行安装命令和脚本，建议先确认权限模式。

当前权限模式在输入框下方可以看到：
• 📖 只读 / 🔒 手动确认 → 请切换到「🧠 智能判断」或「🚀 完全自主」
• 🧠 智能判断 → AI 会判断每个操作是否需要确认，安全操作自动通过
• 🚀 完全自主 → 全部自动执行，不会询问

风险告知：
• 安装依赖和执行脚本会修改系统文件
• 虽然 EasyMint 已内置安全约束（禁止删除项目外文件、禁止危险命令），
  但切换到完全自主模式意味着你对 AI 的操作承担最终责任
• 如不确定，先用智能判断模式，遇到确认弹窗再手动点击通过

是否确认初始化环境？
\`\`\`

用户回复确认后，才开始执行初始化操作：
• 读取 init.sh 了解项目结构
• 安装项目依赖
• 检查开发环境是否就绪
`;

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
