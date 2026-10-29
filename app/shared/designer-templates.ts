/**
 * 原型种子模板清单 —— 单一真理源
 *
 * 用途一致但视角不同，别把这三种混起来：
 *   - **播种**（`services/designer-seed.ts`）：把这 4 个文件从 `resources/em-html-editor/`
 *     拷进项目的 `.easymint/templates/`
 *   - **主会话选型**（`MINT_DESIGN_BOOST` + task 工具指引）：由主会话在委派时指定用哪个
 *   - **子 Agent 使用**（`DESIGNER_AGENT_PROMPT`）：只按指定路径 Read，**不自行选型、不翻目录**
 *
 * 2026-09-16 之前的写法把这三点搅在一起（DESIGN_SPEC 里既有清单又写着「需求匹配模板」），
 * 结果是设计子 Agent 开局先花 3~4 条调用翻目录找模板、自己去分析该用哪个——
 * 用户拍板：**选型是主会话的职责**，子 Agent 只接受明确起点。
 */

/** 种子模板文件名（顺序即清单展示顺序） */
export const DESIGNER_TEMPLATE_FILES = [
  "template-landing.html",
  "template-dashboard.html",
  "template-form.html",
  "template-detail.html",
] as const;

export interface DesignerTemplateInfo {
  file: string;
  name: string;
  structure: string;
}

/** 模板类型与结构（主会话据此选型） */
export const DESIGNER_TEMPLATES: DesignerTemplateInfo[] = [
  { file: "template-landing.html", name: "落地页", structure: "nav → hero → features(3-card) → stats → CTA → footer" },
  { file: "template-dashboard.html", name: "后台面板", structure: "sidebar + header → stats-row → table + activity" },
  { file: "template-form.html", name: "表单页", structure: "标题 → 表单字段(含 error/disabled 态) → 提交" },
  { file: "template-detail.html", name: "详情页", structure: "返回导航 → 媒体区 → 详情 → 侧栏操作卡片" },
];

/** 项目内种子模板目录（相对项目根） */
export const DESIGNER_TEMPLATE_DIR = ".easymint/templates";

/** Scene contracts are the normal start; explicit templates also support legacy projects. */
export const START_POINT_SHOWCASE = "showcase";
export const START_POINT_TEMPLATE_PREFIX = "模板：";
export const START_POINT_FREE = "自由设计";

/** markdown 表格（主会话提示词与 task 工具指引共用，避免两处漂移） */
export function designerTemplateTable(): string {
  const head = "| 模板 | 类型 | 结构 |\n|------|------|------|";
  return [head, ...DESIGNER_TEMPLATES.map((t) => `| ${t.file} | ${t.name} | ${t.structure} |`)].join("\n");
}
