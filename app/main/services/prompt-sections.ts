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
