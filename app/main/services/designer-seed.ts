/**
 * 设计资源播种 —— 把 `resources/em-html-editor/` 的种子模板拷进项目的 `.easymint/templates`，
 * 供设计路径 Read。
 *
 * 品牌库**不再播种**：它已改成内置 skill（`resources/skills/brand-tokens/`），只存在于应用包内，
 * 子 Agent 按 `available_skills` 里该条目的 `<location>` 直读绝对路径即可。此前每个项目都要多拷
 * 74 个品牌目录 / 2.5MB，且 `!existsSync` 守卫让它永不随应用升级刷新。
 *
 * 为什么要单独成模块：原先只在「主会话以 designer 类型启动」时播种（agent-service 的 isDesigner 分支），
 * 而真正要用模板的是**被委派的 Mint-D 子 Agent**——用户用普通 Mint 会话委派 `mint-designer` 时
 * 永不播种，子 Agent 于是开局拿 3~4 条调用去翻一个不存在的目录（2026-09-16 photo-waterfall-wall
 * 两轮实证，见 skill `easymint-subagent-diagnose` §5）。
 * 现在两个入口共用本函数：主会话 designer 启动 + 委派 designer 子 Agent 之前。
 *
 * **已存在的文件不覆盖**（否则每次委派都会把用户改过的种子模板冲掉）。
 * 旧项目播种失败只 warn；结构化项目缺少资源时抛错，避免静默换用旧主题。
 */

import fs from "node:fs";
import { ensureProjectDesign } from "./project-design";
import path from "node:path";
import { getResourcesDir, resolveHome } from "../utils/paths";
import { DESIGNER_TEMPLATE_FILES } from "../../shared/designer-templates";

/** 把种子模板同步进项目（幂等；已存在的不动） */
export function ensureDesignerTemplates(projectPath: string): void {
  if (!projectPath || projectPath.includes("\0")) return;
  if (ensureProjectDesign(path.resolve(resolveHome(projectPath)))) return;
  try {
    const home = resolveHome(projectPath);
    const resourcesDir = getResourcesDir();
    const srcTemplateDir = path.join(resourcesDir, "em-html-editor");
    const destTemplateDir = path.join(home, ".easymint", "templates");

    fs.mkdirSync(destTemplateDir, { recursive: true });
    for (const f of DESIGNER_TEMPLATE_FILES) {
      const src = path.join(srcTemplateDir, f);
      const dest = path.join(destTemplateDir, f);
      if (fs.existsSync(src) && !fs.existsSync(dest)) fs.copyFileSync(src, dest);
    }
  } catch (e) {
    console.warn("[designer-seed] 复制模板失败:", (e as Error).message);
  }
}
