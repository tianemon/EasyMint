# Mint Designer — 完整设计方案

**日期**: 2026-07-15
**状态**: 设计阶段
**参考项目**: Open Design（daemon + skill 架构）、awesome-design-md（品牌 token 库）

---

## 1. 核心理念

纯 prompt 无法保证设计质量——规则会被 Agent 选择性忽略，且不可复用、不可强制。

Agent 启动前，`spawnAgentChat` 把 template + craft 规则 + 品牌 token 拼进 prompt。质量靠 prompt 内自检清单 + 用户在编辑器里最终审核。改动集中在 `agent-service.ts`。

---

## 2. 架构总览

```
┌─ 用户操作 ──────────────────────────────────────────────────────────┐
│                                                                     │
│  SessionHistory ──(点 "+ 新建设计")──► ProjectPage                   │
│                                          │                          │
│                                          ▼                          │
│                                    spawnAgentChat("mint-designer")   │
│                                          │                          │
│  ┌─ Design Engine (agent-service.ts) ────▼──────────────────────┐   │
│  │                                                                │   │
│  │  ① 读 resources/em-html-editor/template.html                  │   │
│  │  ② 读 craft 规则（从独立文件，非硬编码在 prompt 中）            │   │
│  │  ③ 读 .easymint/design.json（如果存在，注入品牌 token）        │   │
│  │  ④ 拼装 system prompt = template + craft + brand + workflow    │   │
│  │  ⑤ 启动 Agent                                                  │   │
│  │                                                                │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                          │                          │
│  Agent 生成 HTML                        │                          │
│       │                                 │                          │
│       ▼                                 │                          │
│  show_prototype MCP 工具                │                          │
│       │                                 │                          │
│       ├─ ① P0 lint 自动检查               │                          │
│       │    ├─ 无渐变标题？                 │                          │
│       │    ├─ 无 emoji 图标？              │                          │
│       │    └─ accent 色每屏 ≤ 2 次？       │                          │
│       │                                  │                          │
│       ├─ 通过 → ② 保存 HTML 到 .easymint/prototypes/             │   │
│       │        → ③ 通知前端打开编辑器窗口                          │   │
│       │                                 │                          │
│       └─ 不通过 → 返回 Agent 列出违规项，要求修正                  │   │
│                                                                     │
│  ┌─ EM HTML Editor ──────────────────────────────────────────────┐   │
│  │  加载 prototype.html → 用户预览、微调、导出                    │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 文件结构

```
resources/em-html-editor/
├── index.html              # 编辑器外壳
├── runtime.js              # 编辑运行时
├── template.html           # 种子模板（CSS token + 组件 + 响应式）
├── test-page.html          # 测试页面

app/main/services/
├── agent-service.ts        # 【修改】spawnAgentChat 增加 prompt 组装逻辑
├── builtin-mcp.ts          # 【修改】新增 show_prototype 工具（含 P0 lint）
├── agent-templates.ts      # 【已有】mint-designer 默认模板

app/shared/
├── prompts.ts              # 【简化】DESIGNER_AGENT_PROMPT → 只保留工作流部分
├── craft-rules.ts           # 【新建】craft 规则独立文件，可被 show_prototype lint 读取

app/renderer/src/
├── components/
│   ├── LeftPanel.tsx        # 【已有】会话分类药丸
│   ├── SessionHistory.tsx   # 【已有】新建设计按钮
│   └── DesignPanel.tsx      # 【新建】风格/品牌选择侧栏（可选，后续）
```

---

## 4. craft 规则独立管理

### 4.1 文件：`app/shared/craft-rules.ts`

```typescript
export interface CraftRule {
  id: string;
  name: string;          // 中文名
  level: "P0" | "P1" | "P2";
  check: string;         // 人类可读的检查描述
  lintPattern?: RegExp;  // 自动 lint 用的正则（P0 必须有）
}

export const CRAFT_RULES: CraftRule[] = [
  {
    id: "no-gradient-title",
    name: "禁止 Hero 渐变标题",
    level: "P0",
    check: "标题文字不得使用 background-clip: text 配合渐变背景",
    lintPattern: /background-clip\s*:\s*text/i,
  },
  {
    id: "no-emoji-icon",
    name: "禁止 emoji 当图标",
    level: "P0",
    check: "不得使用 emoji 代替 UI 图标",
    lintPattern: /[\u{1F300}-\u{1F9FF}]/u,
  },
  {
    id: "accent-limit",
    name: "accent 色每屏 ≤ 2 次",
    level: "P0",
    check: "accent 色在每屏出现不超过 2 处（CTA 按钮 + 一个关键元素）",
  },
  {
    id: "button-states",
    name: "按钮至少 hover + active 两态",
    level: "P0",
    check: "每个交互按钮必须有 :hover 和 :active 样式",
    lintPattern: /\.btn[^{]*\{[^}]*\}/g,  // 粗略检测
  },
  {
    id: "no-hardcoded-color",
    name: "禁止硬编码颜色",
    level: "P1",
    check: "所有颜色值引用 :root CSS 变量（var(--xxx)），不直接写 #xxx",
  },
  {
    id: "type-scale",
    name: "字号层级 ≤ 4 级",
    level: "P1",
    check: "页面最多 4 种字号（标题/副标题/正文/辅助文字）",
  },
  {
    id: "spacing-4px",
    name: "间距为 4px 倍数",
    level: "P1",
    check: "所有 padding/margin/gap 值为 4 的整数倍",
  },
  {
    id: "uppercase-tracking",
    name: "全大写文字 letter-spacing ≥ 0.06em",
    level: "P1",
    check: "text-transform: uppercase 的地方必须设 letter-spacing",
  },
  {
    id: "contrast-ratio",
    name: "文字对比度 ≥ 4.5:1",
    level: "P1",
    check: "浅色文字在背景上有足够对比度",
  },
  {
    id: "max-3-shadows",
    name: "最多 3 级阴影",
    level: "P1",
    check: "不使用超过 3 种 box-shadow 样式",
  },
  {
    id: "mobile-grid",
    name: "移动端栅格折叠",
    level: "P2",
    check: "在 375px 宽度下栅格正常折叠为单列",
  },
];
```

### 4.2 使用方式

**Agent 启动时**：agent-service.ts 将全部 P0 + P1 规则拼入 prompt。P0 规则标注为"必须遵守"，P1 标注为"尽力遵守"。

**Agent 输出前**：自检清单要求 Agent 逐项对照 P0/P1 规则自查。未通过的不得调 `show_prototype`。

**用户审核**：在编辑器中预览原型，发现问题回到设计对话要求修改。

---

## 5. 品牌 Token 系统

### 5.1 品牌库位置

awesome-design-md 的 74 个品牌 DESIGN.md 位于本地路径：

```
/Users/amon/dev/project/GitHub/awesome-design-md/design-md/<brand>/DESIGN.md
```

每个 DESIGN.md 包含该品牌的完整 token：colors（20-30 色值）、typography（15-20 级）、rounded（5-8 档）、spacing（8-10 档）、components（20-30 个组件规范）。

### 5.2 Agent 使用方式

Agent prompt 中告知此路径。Agent 在生成 HTML 前：
① 读需求文档中的风格偏好描述
② 从品牌库中搜索匹配的品牌（按名称、行业、风格关键词）
③ 提取该品牌的 --accent、--bg、--fg、--muted、--border、--radius 等核心 token 值
④ 写入 template 的 :root 变量
⑤ 如果需求文档没有明确风格偏好，列出 3-5 个可能匹配的品牌让用户选

### 5.3 本地品牌缓存（可选后续迭代）

如果希望脱机使用或加快加载，可预提取常用品牌的核心 token 到 `.easymint/brands/` 目录。当前不阻塞，直接读 AD 源文件。

---

## 6. Agent Prompt 组装

### 6.1 prompt 分层

```
┌─ Layer 1: template 引用 ───────────────────────┐
│ "从 resources/em-html-editor/template.html 起步" │
│ template.html 内容直接注入（token + 组件文档）    │
└─────────────────────────────────────────────────┘
         ↓
┌─ Layer 2: craft 规则 ──────────────────────────┐
│ "生成 HTML 必须遵守以下 P0 规则：                │
│  ① 禁止渐变标题 ② 禁止 emoji 图标               │
│  ③ accent 色每屏 ≤ 2 次 ④ 按钮有 hover + active"│
│ (P1 规则也在此层注入)                          │
└─────────────────────────────────────────────────┘
         ↓
┌─ Layer 3: brand token（可选）───────────────────┐
│ "使用以下品牌色彩方案：                           │
│  --accent: #533afd                             │
│  --bg: #fafafa                                 │
│  风格方向：editorial"                           │
│ (从 .easymint/design.json 读取)                │
└─────────────────────────────────────────────────┘
         ↓
┌─ Layer 4: workflow ────────────────────────────┐
│ "1. 读需求文档 → 2. 确认风格 → 3. 生成 HTML      │
│  4. 对照自检清单 → 5. show_prototype() → 6. 反馈"│
└─────────────────────────────────────────────────┘
```

### 6.2 agent-service.ts 改动

```typescript
spawnAgentChat(projectPath, templateId, initialMessage) {
  const template = getTemplate(templateId);
  // … 现有代码 …
  
  if (template.agentType === "designer") {
    // ① 读 template.html 内容
    const templateHtml = readTemplateHtml();
    // ② 读 craft 规则
    const craftPrompt = buildCraftPrompt(CRAFT_RULES);
    // ③ 读品牌 token（如果存在）
    const brandPrompt = buildBrandPrompt(projectPath);
    // ④ 拼装完整 prompt
    const fullPrompt = templateHtml + "\n\n" + craftPrompt + "\n\n" + brandPrompt + "\n\n" + template.prompt;
    options.systemPrompt = { type: "preset", preset: "claude_code", append: fullPrompt };
  }
}
```

---

## 7. show_prototype MCP 工具

单一职责：保存 HTML + 打开编辑器预览。

```
show_prototype(name, html)
  → 写 .easymint/prototypes/<name>.html
  → broadcast 通知前端
  → 前端打开 EM HTML Editor 加载该文件
```

P0 质量检查不在此工具中——由 Agent 的 prompt 自检清单负责，由用户在编辑器里最终审核。

---

## 8. 前端改动

### 8.1 已完成

| 组件 | 功能 |
|------|------|
| LeftPanel | `项目会话 | UI 设计` 药丸切换 |
| SessionHistory | `+ 新建设计` 按钮 → spawnAgentChat("mint-designer") |

### 8.2 待做

| 组件 | 功能 |
|------|------|
| ProjectPage | 监听 `editor:open-prototype` 事件 → 打开编辑器窗口 |
| DesignPanel.tsx（新建）| UI 设计右侧面板：品牌选择、风格滑块（可选，后续迭代） |

---

## 9. 与 Open Design 的对照

| 维度 | Open Design | EM |
|------|------|------|
| **skill 管理** | 100+ SKILL.md 文件，YAML frontmatter 声明 | agent-templates.ts 中的模板对象 |
| **craft 规则注入** | daemon 按 `od.craft.requires` 从 `craft/` 动态注入 | agent-service.ts 启动前读 `craft-rules.ts` 拼入 prompt |
| **品牌 token 注入** | daemon 按 `od.design_system.sections` 注入 | 读 `.easymint/design.json` 拼入 prompt |
| **输出 lint** | `lint-artifact.ts` 自动检查 P0 | `show_prototype` MCP 工具内置 lint |
| **种子模板** | skill 自己的 `assets/template.html` | 共享 `resources/em-html-editor/template.html` |
| **风格方向** | frontend-design skill 的 10+ 种方向 | craft-rules 中维护 |
| **后处理** | impeccable-design-polish 6 种模式 | 尚未实现（后续迭代） |
| **参数滑块** | `od.parameters` 实时重生成 | 尚未实现（后续迭代） |
| **表单输入** | `od.inputs` 侧栏表单 | 尚未实现（后续迭代） |

---

## 10. 实现优先级

### P0（核心闭环 — 本次实现）

| 序号 | 改动 | 文件 | 行数 |
|------|------|------|------|
| 1 | craft 规则独立文件 | `app/shared/craft-rules.ts` | ~60 |
| 2 | agent-service 增加 prompt 组装 | `app/main/services/agent-service.ts` | ~30 |
| 3 | prompts.ts 简化 DESIGNER_AGENT_PROMPT | `app/shared/prompts.ts` | -20 |
| 4 | show_prototype MCP 工具（含 P0 lint） | `app/main/services/builtin-mcp.ts` | ~40 |
| 5 | main/index.ts 注册 IPC | `app/main/index.ts` | ~5 |
| 6 | preload/index.ts 暴露 API | `app/preload/index.ts` | ~3 |
| 7 | ProjectPage 监听 prototype 事件 | `app/renderer/src/pages/ProjectPage.tsx` | ~10 |

**P0 总计：~170 行**

### P1（质量提升 — 后续迭代）

| 功能 | 说明 |
|------|------|
| 品牌库 + 选择 UI | DesignPanel 侧栏，8 个预置品牌 |
| impeccable polish 模式 | 提示词加 6 种后处理模式 |
| P1 规则自动 lint | show_prototype 增加 P1 检查 |

### P2（体验增强 — 远期）

| 功能 | 说明 |
|------|------|
| 参数滑块 | accent hue / font scale / spacing density |
| 移动端自动检测 | show_prototype 在 375px 下截图检查 |
| 设计迭代历史 | 保存每次 prototype 版本，支持回退 |

---

## 11. 借鉴来源总结

| 借鉴内容 | 来自 | 用途 |
|------|------|------|
| craft 三层注入架构 | OD daemon | agent-service prompt 组装逻辑 |
| 10+ 种风格方向 | OD frontend-design skill | craft-rules 风格列表 |
| 6 种后处理模式 | OD impeccable-design-polish | 后续迭代 |
| P0/P1/P2 分级自检 | OD swiss-creative-mode / craft | craft-rules 分级 + show_prototype lint |
| 品牌 token 值 | AD 74 品牌 | design.json 预置 + 品牌库 |
| 种子模板结构 | OD template.html | EM template.html |
| HTML 编辑器集成 | EM 现有 | 预览 + 微调 |
