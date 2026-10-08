/**
 * 系统提示词动态 section 构建 — 借鉴 cc 的 section 组装思想。
 *
 * 稳定核心(MINT_SYSTEM_PROMPT)保持静态;此模块按项目运行时信息构建动态段,
 * 在 buildSystemPrompt 拼装时附加(会话创建时一次)。
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** 是否 git 仓库(检测 .git 目录) */
function isGitRepo(projectPath: string): boolean {
  try {
    return existsSync(path.join(projectPath, ".git"));
  } catch {
    return false;
  }
}

/** 平台显示名 */
function platformLabel(): string {
  if (process.platform === "darwin") return "macOS";
  if (process.platform === "win32") return "Windows";
  if (process.platform === "linux") return "Linux";
  return process.platform;
}

/**
 * # 项目环境 段 — 会话内稳定真相(工作目录/git/平台),快照式注入。
 * 借鉴 cc computeSimpleEnvInfo:只放稳定值,变化细节不在此。
 */
export function buildProjectEnvSection(projectPath: string): string {
  return [
    "\n## 项目环境",
    `- 工作目录: ${projectPath}`,
    `- 是否 Git 仓库: ${isGitRepo(projectPath) ? "是" : "否"}`,
    `- 平台: ${platformLabel()}`,
  ].join("\n");
}

/**
 * # 项目类型规范 段 — 按项目产品形态注入开发规范基线(web/桌面/CLI 等)。
 * @param platformSpec detectProfile/composeProfile 产物的 platformSpec 文本
 */
export function buildProjectProfileSection(platformSpec?: string): string {
  if (!platformSpec) return "";
  return `\n## 项目类型规范\n${platformSpec.trim()}`;
}

/** 读取项目持久化的 platformSpec(NewProjectDialog 创建时写入 .easymint/project-profile.json);失败返回 undefined */
export function readProjectProfile(projectPath: string): string | undefined {
  try {
    const f = path.join(projectPath, ".easymint", "project-profile.json");
    if (!existsSync(f)) return undefined;
    const data = JSON.parse(readFileSync(f, "utf-8")) as { platformSpec?: unknown };
    return typeof data.platformSpec === "string" && data.platformSpec.length > 0 ? data.platformSpec : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 权限边界提示词段（主会话与子 Agent 共用）。
 * 只写基本概念：绝对禁区（三档共同、不可变）+ 三档的定义（只读 / 标准 / 完全访问）。
 * 不写「当前处于哪个模式」——模式会随用户切换变化，写死会过时误导；
 * 当前模式以系统反馈为准：操作被拒时错误信息会说明原因（模式限制 / 禁区），据此应对。
 * 权限摘要与 access-policy.ts 的资源语义保持一致，不在提示词复制完整路径清单。
 * 沙盒相关的措辞（域名白名单、精确豁免、违规注解）必须与 sandbox/compat-policy 同步——
 * 否则模型会把"边界"当"故障"，反复换写法重试。
 */
export const PERMISSION_RULES_PROMPT = `<permission_rules>
系统权限由后台强制执行，日常操作不另询问权限；业务授权、删除确认及高风险操作仍遵循用户要求和项目规则。系统许可不等于用户授权。
- 绝对禁止（任何模式）：修改系统核心与系统安全控制面（系统目录、磁盘设备、内核扩展，以及关闭 Gatekeeper/防火墙/FileVault 这类安全机制的开关）；提权；改写会自动执行代码的持久化配置（MCP 配置、开机自启目录、EasyMint 的模型与供应商设置）。这些限制在完全访问中也不会关闭。
- 只读模式：**普通项目内容读自由（敏感凭据除外），其余一律拒绝**——不执行任何命令（含 bash / powershell / 安装依赖）、不写入文件或应用状态、不启用 MCP、不联网（web_fetch / web_search 也停用）；SSH 私钥、云凭据、浏览器登录数据等高度敏感内容不可读。所以构建、测试、装依赖、git 操作**全都做不了**，连 git log / git diff 也不行。这不是故障，是这一档的定义：不要反复重试、不要试图绕过；需要动手时请用户切到标准或完全访问。
- 标准模式：完整读写当前工作空间和该项目专属开发运行区；依赖缓存、用户级工具安装、运行配置和临时目录会自动放在运行区；可读取并执行宿主工具链与 SDK，也可读取项目外普通文件。命令在**系统级沙盒（运行时安全边界）**内执行（内核强制，脚本与变量绕不过去）：越界写入（工作区、项目运行区与系统临时目录之外）、读取高度敏感凭据、提权与系统核心改动都会被直接拒绝。**出网按域名白名单放行**——主流包管理器、代码托管与常见开发端点已在列；未知域名会被拦下，这是边界不是故障：不要换个写法反复重试，改用已放行的官方渠道，或请用户在设置里追加域名。浏览器与容器类的**单一命令**可走沙盒外兼容豁免，复合命令与重定向不会豁免。SSH agent 已有身份时 git push 可用；gh、gcloud 等依赖宿主登录目录的工具可能仍需完全访问。
- 命令被沙盒拦下时，stderr 里会出现 sandbox_violations 注解（被拒资源与操作的说明）——那是边界说明、不是故障：按注解调整做法，不要绕过、也不要反复重试。
- 完全访问：用宿主真实环境执行——系统命令、进程管理、打开浏览器与浏览器自动化（Playwright）、gh / git push 都能用；不受工作区和普通开发路径限制，不询问日常文件或命令权限，可读写系统核心与高度敏感资源之外的普通位置，包括桌面、文档、下载和外部项目。此档不套 OS 沙盒，系统核心保护是执行前的尽力检查，不是动态脚本绕不过的强安全边界。
- 上面第一条的禁区在标准与只读模式下有系统边界兜底；完全访问下由执行前判定尽力拦截。不要尝试绕过，也不要反复重试。
- 命令中的消息、正则、提交说明和普通文本不会被当成路径；越界 I/O 会在执行前被判定拦下。
</permission_rules>`;
