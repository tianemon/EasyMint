import { isMobileTarget } from "./project-targets";
/**
 * EasyMint 业务消息与项目场景；可编辑角色正文由主进程读取应用默认资源与用户覆盖。
 *
 * 保持纯字符串和模板函数，不在shared／renderer读取配置文件。
 * main 和 renderer 直接 import，不需要 IPC。
 */



// ── 项目场景模板 ──────────────────────────────────────

// ── 维度定义 ──────────────────────────────────────────

type ProductType = "web" | "desktop" | "mobile" | "cli" | "backend" | "library" | "miniprogram";
export type DeployMode = "local" | "cloud" | "hybrid" | "auto" | "client-only" | "cloud-dev" | "client-hybrid";
export type AIIntegration = "none" | "assistant" | "agent" | "multi-agent";
type StorageType = "sqlite" | "postgres" | "vector" | "none";

/**
 * 维度组合的输入——2026-09-16 起**没有「复杂度」这一维**。
 *
 * 原 ComplexityLevel / COMPLEXITY_OVERRIDES 已整个删除：流程深度的判定权在 Mint
 * （creation-guide skill），而它残留的「平台型产品」规范因两个产生点都硬编码 medium
 * 而永远触发不到。**不要再加回表单字段**——判定权只允许一处。
 */
export interface ProjectDimensions {
  product: ProductType;
  deploy: DeployMode;
  ai: AIIntegration;
  storage: StorageType;
  productUsesAI: boolean;
  needsAuth: boolean;
  needsPayment: boolean;
}

interface ProjectProfile {
  id: string;
  label: string;
  initSteps: string;
  platformSpec: string;
  evaluatorHint: string;
  suggestedStack: string[];
}

// ── 基础层：按产品形态定义 ─────────────────────────────

const BASE_PROFILES: Record<ProductType, ProjectProfile> = {
  web: {
    id: "web", label: "Web 应用",
    initSteps: `项目为 Web 应用。\n- docs/技术架构.md 需包含前端架构说明`,
    platformSpec: `## Web 开发规范\n- 优先使用语义化 HTML，SEO 友好\n- 响应式设计：移动端、平板、桌面端均需适配\n- 交互反馈：按钮 hover/active 态、加载状态、空状态、错误提示\n- 表单验证：必填校验、格式校验、提交前防重复\n- 错误边界：关键 UI 区块需有 ErrorBoundary 兜底\n- 可访问性：合理的 color contrast、focus 样式、aria 标签`,
    evaluatorHint: `Web 项目：静态 HTML 直接用 Playwright 打开 index.html 验证；有构建工具的先启动 dev server 再截图验证`,
    suggestedStack: ["React", "Vite", "Tailwind CSS"],
  },
  desktop: {
    id: "desktop", label: "桌面应用",
    initSteps: `项目为桌面应用。\n- docs/技术架构.md 关注进程架构、IPC 通信、窗口管理`,
    platformSpec: `## 桌面应用开发规范\n- 主进程与渲染进程分离\n- IPC 通信使用结构化 channel 名\n- 窗口状态持久化\n- 自动更新机制`,
    evaluatorHint: `桌面应用：启动应用 → Playwright 截图 → 验证窗口行为和 IPC 通信`,
    suggestedStack: ["Electron", "React", "Vite"],
  },
  mobile: {
    id: "mobile", label: "移动端应用",
    initSteps: `项目为移动端应用。\n- docs/技术架构.md 关注组件树、状态管理、路由设计`,
    platformSpec: `## 移动端开发规范\n- 组件化：页面 = 多个独立可复用 widget/component 组合\n- 状态管理：选用项目约定的方案\n- 响应式布局：适配不同屏幕尺寸\n- 交互反馈：按钮 pressed 态、加载指示器、空状态\n- 错误处理：网络请求失败、数据为空的兜底展示\n- 性能：列表懒加载、图片缓存`,
    evaluatorHint: `移动端项目：代码审查为主，读代码对照需求文档逐项检查，验证 build 通过`,
    suggestedStack: ["Flutter", "Dart"],
  },
  cli: {
    id: "cli", label: "CLI 命令行工具",
    initSteps: `项目为命令行工具，无 UI 界面。\n- docs/需求文档.md 重点描述命令行参数、输入/输出格式、退出码\n- docs/技术架构.md 无需前端章节，关注模块划分和命令结构`,
    platformSpec: `## CLI 工具开发规范\n- --help 输出必须包含：用途、参数列表、使用示例\n- 错误信息输出到 stderr，正常输出到 stdout\n- 退出码：0=成功，1=参数错误，2=运行时错误\n- 支持 --version 输出版本号\n- 管道兼容：非 TTY 时不输出进度条和彩色控制字符`,
    evaluatorHint: `CLI 项目：直接执行命令验证输出和退出码，检查 --help 和 --version，测试边界输入`,
    suggestedStack: ["Python", "Typer"],
  },
  backend: {
    id: "backend", label: "后端服务",
    initSteps: `项目为后端 API 服务。\n- docs/需求文档.md 重点描述 API 端点、请求/响应格式、数据模型\n- docs/技术架构.md 关注服务架构、中间件、数据库设计`,
    platformSpec: `## API 后端开发规范\n- RESTful 命名：名词复数、层级不超过 2 层\n- 统一响应格式：{ code, data, message }\n- 输入校验：必填/类型/长度/格式\n- 错误处理：所有异步路径有 try-catch\n- 敏感信息不在响应中暴露\n- 幂等性：PUT/DELETE 需幂等\n- 分页：列表接口默认支持分页（page/pageSize，返回 total）\n- 限流：关键接口需有基本频率限制`,
    evaluatorHint: `API 项目：用 curl 或测试框架验证所有端点，检查请求/响应格式、错误码、边界情况`,
    suggestedStack: ["FastAPI", "Python", "PostgreSQL"],
  },
  library: {
    id: "library", label: "库/SDK",
    initSteps: `项目为可复用的库或 SDK。\n- docs/需求文档.md 重点描述 API 接口、使用示例、参数说明\n- docs/技术架构.md 关注模块划分、导出接口、依赖关系\n- README 必须包含安装方式、快速开始示例、API 文档`,
    platformSpec: `## 库/SDK 开发规范\n- API 设计：简洁直观，命名一致\n- 向后兼容：不随意 breaking change\n- 类型安全：导出类型定义\n- 错误处理：抛出有意义的错误信息\n- 文档：每个公开 API 有 JSDoc/docstring\n- 测试：核心 API 需有单元测试覆盖`,
    evaluatorHint: `库/SDK 项目：运行测试，读代码对照需求文档，验证导出接口和 README 示例`,
    suggestedStack: ["TypeScript"],
  },
  miniprogram: {
    id: "miniprogram", label: "微信小程序",
    initSteps: `项目为微信小程序。\n- docs/技术架构.md 关注页面栈、组件通信，并根据实际需要说明后端配置\n- 注意分包加载限制（主包 ≤ 2MB，总包 ≤ 20MB）\n- 每个页面需在 app.json 中注册`,
    platformSpec: `## 微信小程序开发规范\n- 页面生命周期：onLoad → onShow → onReady → onHide → onUnload\n- 组件通信：父传子 properties，子传父 triggerEvent，跨组件用 globalData 或 eventBus\n- WXML 模板语法：wx:if 条件渲染、wx:for 列表渲染、{{}} 数据绑定\n- 样式：rpx 响应式单位（1rpx = 屏幕宽度/750），推荐 flex 布局\n- API 调用：wx.request 发网络请求，wx.setStorage/getStorage 本地存储\n- 用户授权：wx.getUserProfile / wx.authorize，首次调用需弹窗\n- 审核规范：不得包含隐藏功能、诱导分享、强制登录后才能浏览核心功能`,
    evaluatorHint: `小程序项目：用微信开发者工具打开编译检查，代码审查对照需求文档逐项验证，检查 app.json 注册和分包配置`,
    suggestedStack: ["微信开发者工具", "JavaScript/TypeScript"],
  },
};

// ── 维度叠加层 ─────────────────────────────────────────

interface ProfileOverride {
  initSteps?: string;
  platformSpec?: string;
  evaluatorHint?: string;
  suggestedStack?: string[];
}

const DEPLOY_OVERRIDES: Record<DeployMode, ProfileOverride> = {
  "client-hybrid": {
    initSteps: `项目客户端使用各平台支持的本地存储，按需连接在线服务或同步数据。服务端架构根据功能选择，不强制客户端使用 SQLite。`,
  },
  auto: {
    initSteps: `- 部署与存储尚未确定。根据全部客户端形式、功能、场景和预算推荐方案，说明理由；不要把默认值当成用户要求，不预设数据库或强制登录。`,
  },
  "client-only": {
    initSteps: `- 用户选择无需后端。客户端按各自平台运行与发布，使用平台支持的本地存储，不添加服务端、云数据库或必须联网的功能。若功能要求与此冲突，先向用户澄清。`,
  },
  "cloud-dev": {
    initSteps: `- 使用微信云开发承载服务端能力，存储按云开发能力选择，不预设 SQLite 或 PostgreSQL。区分小程序客户端发布和云端服务部署；其他客户端如需共享服务，先确认接入方案。`,
  },
  local: {
    initSteps: `项目为本地运行，无需云端部署。\n- 数据存储使用 SQLite 等本地方案\n- docs/技术架构.md 中无需云端部署、CI/CD 章节`,
  },
  cloud: {
    initSteps: `项目需云端部署。\n- docs/技术架构.md 需包含部署方案、环境变量管理、CI/CD 配置\n- 数据库使用云数据库（PostgreSQL 等）\n- 需配置环境变量（API keys、数据库连接串等）`,
  },
  hybrid: {
    initSteps: `项目为混合模式——本机运行，按需连接云端服务和同步数据。\n- 本地部分：SQLite + 本地文件\n- 云端部分：API 服务 + 数据库 + 认证`,
  },
};

const AI_OVERRIDES: Record<AIIntegration, ProfileOverride> = {
  none: {},
  assistant: {
    initSteps: `产品包含 AI 辅助功能。\n- 需集成 LLM API（优先推荐 DeepSeek、MiniMax、智谱 GLM 等国产模型，成本低、中文能力强）\n- docs/技术架构.md 需包含 AI 调用流程、prompt 管理、fallback 策略`,
    platformSpec: `\n## AI 集成规范\n- API Key 使用环境变量，不提交到 git\n- AI 调用需有超时和重试机制\n- AI 输出需有兜底展示（加载中、失败重试、空结果）\n- 考虑 API 调用成本，合理使用缓存`,
  },
  agent: {
    initSteps: `产品包含 Agent 能力（自主决策、工具调用）。\n- 需集成 LLM API（优先推荐 DeepSeek、MiniMax 等国产模型）\n- 可能需要向量数据库做 RAG\n- docs/技术架构.md 需包含 Agent 架构、工具定义、记忆管理`,
    platformSpec: `\n## Agent 开发规范\n- Agent 行为边界需明确定义\n- 工具调用需有超时和错误处理\n- 多步推理需有中间状态记录\n- API Key 使用环境变量`,
    suggestedStack: ["DeepSeek", "MiniMax"],
  },
  "multi-agent": {
    initSteps: `产品包含多 Agent 协作能力。\n- 需定义 Agent 角色分工和执行顺序\n- 可能需要消息队列协调 Agent 间通信\n- docs/技术架构.md 需包含多 Agent 架构、通信协议、冲突处理`,
    platformSpec: `\n## 多 Agent 开发规范\n- 每个 Agent 职责单一、边界清晰\n- Agent 间通过结构化消息通信\n- 需有全局异常处理和回滚机制\n- 考虑并发和死锁场景`,
    suggestedStack: ["CrewAI", "LangGraph"],
  },
};

const STORAGE_OVERRIDES: Record<StorageType, ProfileOverride> = {
  none: {},
  sqlite: {
    initSteps: `使用 SQLite 本地数据库。\n- 无需额外数据库服务\n- docs/技术架构.md 包含数据模型设计`,
  },
  postgres: {
    initSteps: `使用 PostgreSQL 数据库。\n- 需配置数据库连接\n- docs/技术架构.md 包含数据库 schema 和迁移方案`,
    suggestedStack: ["PostgreSQL"],
  },
  vector: {
    initSteps: `需要向量数据库支持 AI/搜索功能。\n- 选项：Qdrant / Milvus / Chroma\n- docs/技术架构.md 包含向量库选型和 embedding 方案`,
    suggestedStack: ["Chroma", "Qdrant"],
  },
};

// ── 组合引擎 ───────────────────────────────────────────

function mergeProfile(base: ProjectProfile, ...overrides: ProfileOverride[]): ProjectProfile {
  const merged = { ...base };
  for (const ov of overrides) {
    if (ov.initSteps) merged.initSteps = merged.initSteps + "\n" + ov.initSteps;
    if (ov.platformSpec) merged.platformSpec = merged.platformSpec + "\n" + ov.platformSpec;
    if (ov.evaluatorHint) merged.evaluatorHint = ov.evaluatorHint;
    if (ov.suggestedStack) merged.suggestedStack = [...new Set([...merged.suggestedStack, ...ov.suggestedStack])];
  }
  return merged;
}

function aiProfileOverride(dims: ProjectDimensions): ProfileOverride {
  if (!dims.productUsesAI) return {};
  if (dims.deploy === "client-only") return {
    initSteps: `- 用户同时选择 AI 功能（${dims.ai}）和无需后端。先确认平台是否支持设备端实现；如需要在线模型服务，先与用户澄清，不擅自添加后端或把 API 密钥嵌入客户端。`,
  };
  return AI_OVERRIDES[dims.ai];
}

export function composeProfile(dims: ProjectDimensions): ProjectProfile {
  const base = BASE_PROFILES[dims.product];
  if (!base) return BASE_PROFILES["web"];
  return mergeProfile(
    base,
    DEPLOY_OVERRIDES[dims.deploy],
    aiProfileOverride(dims),
    STORAGE_OVERRIDES[dims.storage],
  );
}

/** Keep every selected client contract; deployment overrides apply once to the shared project. */
export function composeProfilesForTargets(targets: string[], dims: ProjectDimensions): ProjectProfile {
  const products = [...new Set(targets.map(target => inferDimensions([target]).product))];
  if (products.length <= 1) return composeProfile({ ...dims, product: products[0] ?? dims.product });
  const bases = products.map(product => BASE_PROFILES[product]);
  const combined: ProjectProfile = {
    id: products.join("+"), label: bases.map(base => base.label).join(" / "),
    initSteps: "项目包含多个客户端。以下每段规范仅约束相应客户端，CLI 无界面不影响其他客户端；分别安排客户端和共享服务，保留全部已选平台。\n" + bases.map(base => base.initSteps).join("\n"),
    platformSpec: bases.map(base => base.platformSpec).join("\n"),
    evaluatorHint: bases.map(base => base.evaluatorHint).join("\n"),
    suggestedStack: [...new Set(bases.flatMap(base => base.suggestedStack))],
  };
  return mergeProfile(combined, DEPLOY_OVERRIDES[dims.deploy],
    aiProfileOverride(dims), STORAGE_OVERRIDES[dims.storage]);
}

function inferDimensions(targets: string[]): ProjectDimensions {
  const set = new Set(targets.map((t) => t.toLowerCase()));
  let product: ProductType = "web";
  // 按优先级匹配：CLI > 小程序 > 移动端 > 桌面 > 库 > 后端 > Web（默认）
  if (set.has("cli")) product = "cli";
  else if (set.has("wechat-miniprogram")) product = "miniprogram";
  else if ([...set].some(isMobileTarget) || set.has("mobile") || set.has("flutter") || set.has("react-native")) product = "mobile";
  else if (set.has("library") || set.has("sdk")) product = "library";
  else if (set.has("windows-desktop") || set.has("macos-desktop") || set.has("linux-desktop") || set.has("desktop") || set.has("electron") || set.has("tauri")) product = "desktop";
  else if (set.has("api") || set.has("backend") || set.has("server")) product = "backend";
  return {
    product,
    deploy: set.has("cloud") ? "cloud" : "local",
    ai: "none",
    storage: "sqlite",
    productUsesAI: false,
    needsAuth: false,
    needsPayment: false,
  };
}

export function detectProfile(targets: string[]): ProjectProfile {
  return composeProfile(inferDimensions(targets));
}


export function buildInitInstruction(profile: ProjectProfile): string {
  const sceneDiffs = profile.initSteps
    .split("\n")
    .filter((l) => l.trim().startsWith("-") || l.trim().startsWith("项目"))
    .join("\n");
  return sceneDiffs
    ? `\n初始化时注意以下场景差异：\n${sceneDiffs}`
    : "";
}
/** 只随真实创建入口发送；共享基础提示词和表单辅助不注入这段。 */
export const CREATION_COLLABORATION = `协作约定：沿用已填信息，只补关键缺口；能继续就继续。按本项目给简短建议和理由，必要时示范怎样描述修改或问题，不每轮教学、不讲完整生命周期。受阻先查已有证据，不把故障归咎于问法；不了解屏幕就不假装看见。交付给真实试用入口、关键操作和验证范围。后续按有效决定继续，不重启采集；恢复时核实项目资料，旧批准不复活。`;

/** 项目创建完毕后的初始化触发：引导 Mint 沿用已知信息判档推进（流程细节在 creation-guide skill） */
export function buildInitTriggerPrompt(projectPath: string, ctx: string, instruction: string, targets?: string[], selectedProfile?: ProjectProfile): string {
  const profile = selectedProfile ?? detectProfile(targets && targets.length > 0 ? targets : ["web"]);
  const instructionLines = new Set(instruction.split("\n").map(line => line.trim()));
  const dimHighlights = profile.initSteps
    .split("\n")
    .filter((l) => l.trim().startsWith("-") && !l.includes("无需") && !instructionLines.has(l.trim()))
    .join("\n");
  return `[系统消息] 项目已创建完毕。

项目场景：${profile.label}
项目路径：${projectPath}
${ctx}
${dimHighlights ? `关键约束：\n${dimHighlights}\n` : ""}
${instruction}

${CREATION_COLLABORATION}
流程提示：加载 creation-guide 按实际内容判档，只读当前阶段；已有授权与 Gate 按该技能处理。`;
}
// ── 确认开发 ──────────────────────────────────────────

export const CONFIRM_DEVELOPMENT_PROMPT = `开始执行 task.json 中的开发任务。按顺序逐条推进，每条按「任务执行」判断亲自实现还是委派，不由项目档位自动决定。实现后自验，仅按实际需要做独立复核，不为每条任务自动委派 Evaluator；你亲自实现的在适用验证通过后标记 done，委派任务的 done/failed 由系统自动回写，不手动重复标记。沿用 task.json 的正式任务状态，不复制同名会话进度清单。每完成一条按项目约定更新开发记录。全程在已授权范围内推进，直到全部完成、遇到真实阻塞或用户打断；阻塞时如实汇报，按项目约定记录。遵循项目 TDD 设定。`;

// ── 系统消息结构化(对齐 Pi sendCustomMessage)──────

/** 系统消息细分类型:JSONL/事件/前端按此识别渲染 */
export type SystemMessageKind =
  | "delegation"   // 子 Agent 委派完成/中止/失败
  | "shell"        // 后台 shell 退出通知
  | "human-action" // 命令输出里出现需要用户操作的内容(授权链接/输入提示)
  | "project-created" // 项目已创建完毕(初始化触发)
  | "direct-create" // 用户点直接创建,触发 Mint 对话引导补全信息
  | "flow"         // 流程指令(翻译/功能清单/技术方案等)
  | "summary";     // 上下文摘要指令

export interface SystemMessagePayload {
  customType: "system_message";
  content: string;
  display: true;
  details: { kind: SystemMessageKind } & Record<string, unknown>;
}

/** 系统消息 kind → 模型侧抬头标签（内容前缀 `[系统消息]-[标签]` 的第二段）。
 *  此前对所有 kind 硬编码「Agent执行结果」——一条摘要/续接消息顶着「执行结果」抬头，
 *  模型侧与展开后的用户都会误读。留此表做单一来源。
 *  注意：仅第二段可变，`[系统消息]` 前缀本身是协议（见宿主事件契约与测试）。 */
export const SYSTEM_MESSAGE_LABELS: Record<SystemMessageKind, string> = {
  delegation: "Agent执行结果",
  shell: "后台命令",
  "human-action": "命令交互",
  "project-created": "项目初始化",
  "direct-create": "直接创建",
  flow: "流程指令",
  summary: "上下文摘要",
};

/**
 * 构造 sendCustomMessage 参数。customType 统一 system_message(对齐 cc promptSource: "system"),
 * 细分类型放 details.kind——details 不进 LLM,仅 JSONL/事件/前端使用。
 * 注意:content 必须保留 [系统消息] 前缀——Pi 的 convertToLlm 把 custom 映射为 user 角色,
 * 模型侧看不到 customType,宿主系统消息规则靠内容前缀识别。
 */
export function systemMessage(
  kind: SystemMessageKind,
  content: string,
  extra?: Record<string, unknown>,
): SystemMessagePayload {
  return { customType: "system_message", content, display: true, details: { kind, ...extra } };
}

/** 摘要卡的可广播字段（实时展示用）——三处构造点共用这一份，避免只改两处造成字段漂移：
 *  ①event-bridge 的 compacted 事件（自动压缩）②agent-service 手动压缩的自建订阅 ③session-service
 *  从落盘 compaction 条目重建（走 systemMessage 同形结构，不用本函数）。
 *  text 的文案来自 compactionSummaryNotice（单一来源）；摘要为空时 text 为 undefined（前端据此跳过建卡）。
 *  注意：这些字段**不发给模型**（模型从 compaction 记录读摘要），纯展示。 */
export function compactionCardFields(summary: string | undefined): {
  text?: string;
  customType: "system_message";
  details: { kind: "summary" };
} {
  return {
    text: summary ? compactionSummaryNotice(summary) : undefined,
    customType: "system_message",
    details: { kind: "summary" },
  };
}

/** 摘要卡正文（压缩后给用户看的那张卡）。
 *  实时（compacted 事件）与重开会话（从落盘 compaction 条目重建）两个展示入口共用这份文案，
 *  两边各写一份就会出现「同一件事两种抬头」的漂移。 */
export const COMPACTION_SUMMARY_HEADER = "【上下文摘要（本次压缩生成，原文）】";

export function compactionSummaryNotice(summary: string): string {
  return `${COMPACTION_SUMMARY_HEADER}\n\n${summary}`;
}

export function compactionSummaryBody(notice: string): string {
  const prefix = `${COMPACTION_SUMMARY_HEADER}\n\n`;
  return notice.startsWith(prefix) ? notice.slice(prefix.length) : notice;
}

// ── 业务 Prompt 构建函数 ────────────────────────────

/** 直接创建项目——跳过表单,触发 Mint 按 creation_flow 对话引导补全信息。
 *  系统消息只传动态信息(项目名+已采集快照),固定引导流程内置于 creation_flow,不重复塞进消息。 */
export function buildDirectCreatePrompt(projectName: string, ctx: string): string {
  const collected = ctx ? `已采集的结构化信息：${ctx}` : "已采集的结构化信息：无（用户未填写表单，全部信息需在对话中收集）";
  return `[系统消息] 用户点击了「直接创建」项目，跳过后续未填部分。请按内置流程补齐缺失信息，沿用已采集的选择，不重复询问。

项目名：${projectName}
${collected}

${CREATION_COLLABORATION}
流程提示：加载 creation-guide，从已有信息开始，不重问整套表单。`;
}

/** 功能清单推荐 */
export function buildFeatureRecommendPrompt(ctx: string): string {
  return `[系统消息] 请根据以下项目信息推荐功能清单：${ctx}

输出要求：每个功能一行，格式为 "- 功能名称"。不要输出其他内容。`;
}

// ── 项目创建工具函数 ──────────────────────────────────

/** 中文目录名 → 英文翻译 */
export function buildDirectoryTranslationPrompt(dirName: string): string {
  return `[系统消息] 请把"${dirName}"翻译成简短的英文目录名（小写、连字符分隔），直接回复翻译结果不要加任何解释`;
}

// ── 平台规范 ───────────────────────────────────────────
