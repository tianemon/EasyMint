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
 * 只写基本概念：绝对禁区（两模式共同、不可变）+ 两模式的定义。
 * 不写「当前处于哪个模式」——模式会随用户切换变化，写死会过时误导；
 * 当前模式以系统反馈为准：操作被拒时错误信息会说明原因（标准限制 / 禁区），据此应对。
 * 保持与 permission-rules.ts 的禁区清单与拒绝措辞一致（需同步维护）。
 */
export const PERMISSION_RULES_PROMPT = `<permission_rules>
权限由系统强制拦截，你无需自行判断能否执行；操作被拒时，错误信息会说明具体原因，据此应对。
- 绝对禁止（任何模式下都不要尝试）：系统核心目录写入/删除（macOS：/etc /usr /bin /sbin /System /Library /var /cores /dev /proc /sys /private /Volumes /tmp；Windows：C:\\Windows、C:\\ProgramData 等）；凭据/敏感目录读写（~/.ssh、~/.aws、~/.gnupg、~/.kube、~/.docker、~/.npmrc、~/Library/Keychains 等）；用户目录写入（~/Desktop ~/Documents ~/Downloads ~/Library 等——读取允许）；系统级变更命令（sudo、launchctl、systemctl、mount、diskutil、reg add 等——需用户手动执行）
- 权限模式（你当前处于哪种，以操作是否被系统拒绝为准）：标准模式——只能写入当前工作空间，写入工作空间外会被系统拒绝；完全访问——可写入所有非禁止区域。两种模式都允许：读写项目内文件、安装依赖/运行时、读取环境配置与系统信息、读取项目外普通位置与用户下载的文档
- 操作被拒时：错误是「仅可操作工作空间内文件」→ 说明当前为标准模式，改用工作空间内路径，或告知用户「该操作需切换「完全访问」才能执行」；错误是「系统敏感位置/凭据目录/用户目录/系统级变更」→ 如实告知用户该操作不可执行，不要尝试绕过、伪装路径或换命令变体
</permission_rules>`;
