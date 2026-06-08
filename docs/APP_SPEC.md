# EasyMint — 需求规格

## 项目概述

EasyMint 是一个 Electron 桌面应用，让用户通过图形界面完成项目创建、需求采集、AI 协作开发的全流程。AI 引擎基于 `claude-agent-sdk`，采用长生命周期进程 + 消息通道。

GUI 是 harness，AI 引擎是 claude-agent-sdk。

## 技术栈

| 层 | 技术 |
|---|------|
| 壳 | Electron 28+ |
| 前端 | React 18 + Vite 5 + TypeScript 5 |
| 样式 | Tailwind CSS 3 + Radix UI |
| 状态管理 | zustand |
| AI 引擎 | `@anthropic-ai/claude-agent-sdk`，长生命周期 query + 消息通道 |
| SubAgent | Builder（编码）+ Evaluator（验收），模板化 |
| 存储 | `~/.easymint/` 全局 + `<project>/.easymint/state.json` 项目级 |
| 打包 | electron-builder |

## 设计风格

- **双主题**：亮色 Mint 主题（`#f5faf7` 底 / `#16a34a` 强调色）+ 暗色模式（`#0d0d0d` → `#2a2a2a` 四级灰度嵌套）
- 强调色浅色 `#16a34a`，暗色 `#cccccc`
- 交互：全局 cubic-bezier(0.4, 0, 0.2, 1)，快动作 150ms，标准 250ms
- Mint 签名字体：内嵌 Dancing Script woff2

## 页面/模块结构

### ProjectPage — 项目工作台（默认页）

三栏可拖拽网格布局（比例持久化到 localStorage）：

```
┌──────┬────────────┬──────────────────────┬────────────┐
│ 侧边  │ 左面板       │ 中间编辑区              │ 右面板       │
│ (44) │ (比例可调)   │ (flex-1)             │ (比例可调)   │
│      │ 文件树/     │ Tab 栏 + Chat/Editor  │ 任务面板     │
│      │ 会话列表    │ 快捷提示词 + 输入框     │ 鱼骨进度    │
└──────┴────────────┴──────────────────────┴────────────┘
```

**侧边图标栏 (44px)**：
- 新建(+) — 新建项目 / 打开项目 / 新建文件 / 新建文件夹 / 新窗口
- 项目文件 — 左面板显示文件树
- 会话 — 左面板显示对话列表
- 设置 — 底部，主题切换在上方

**左面板** — 文件/会话双模式，可折叠：
- 文件模式：文件树浏览
- 会话模式：置顶 + 普通 + 归档（时钟图标弹出），右键 rename/delete/pin

**聊天面板** — 核心交互区：
- Mint 消息气泡 + 用户气泡
- Markdown 渲染 + 代码块独立容器
- 思考过程 / 工具调用 可选显示
- 快捷提示词下拉菜单（6 个）
- 上下文使用率显示 + 阈值自动轮转
- 「确认开发」按钮

**任务面板** — 右侧：
- 鱼骨图项目进度线（6 阶段）
- Mint 按钮（签名字体，提示随阶段动态变化）
- 任务列表（hover 展开描述）

**面板拖拽**：比例存储，窗口缩放自动等比适配。

### NewProjectModal — 新建项目弹窗

5 步表单：
1. 项目概述（名称、路径）
2. 功能描述
3. 项目类型（Web/CLI/API/移动端/库）
4. 技术偏好（初步选型）
5. 确认创建

表单提交后自动触发 Mint 初始化流程。

### SettingsModal — 设置弹窗

- 聊天：思考过程 / 工具调用 显示开关
- API 配置：Base URL、Key、模型列表、默认模型、1M 上下文开关
- 上下文轮转阈值（40%-85%）
- Agent 模板、Skill、MCP 管理

## 核心功能

### Mint 初始化流程

表单提交 → Mint 收到 `buildInitInstruction`：
1. 拆解需求 → docs/需求规格.md
2. 二次技术评估 → 基于完整需求推荐方案 → 用户确认 → docs/架构设计.md
3. 分配任务 → task.json
4. 写 README.md + 更新 CLAUDE.md
5. 检测环境 → git init + init.sh
6. 确认开发 → Builder/Evaluator 驱动

### 任务执行

Mint（PM+架构师）→ 分配 task.json → Builder 编码 → Evaluator 验收 → 循环。Mint 只负责"想"，Builder 负责"写"，Evaluator 负责"验"。

TDD：分配任务时自动判断，逻辑/API/数据层标 `tdd: true`，Builder 先写测试再编码。

### 项目状态

`<project>/.easymint/state.json` 事实模型记录 `initCompleted`、`docsLevel`、`taskCount`/`doneCount`、`lastSummary`。Mint 在关键节点写入，`refreshAll` 据此推导阶段。

### 多场景支持

6 个场景模板（web-frontend/web-fullstack/cli/api-backend/mobile/library），每个包含初始化流程、平台规范、验收策略。Mint 从表单自动推断项目类型。

### 上下文管理

会话上下文达到阈值自动总结 → 归档 → 新会话接续。阈值可调（默认 60%）。

## 数据存储

```
~/.easymint/
├── projects.json           # 项目列表
├── em-settings.json        # EM 设置（模型、主题等）
├── settings.json           # SDK 设置（API key 等）
├── agent-templates.json    # Agent 模板
├── system-prompts.json     # 自定义系统提示词
├── mcp/
│   └── .claude.json        # MCP 服务器配置
├── plugins/
│   └── image-vision/       # 内置插件市场
├── sessions/
│   └── <project-id>/
│       └── sessions.json   # 会话列表
└── uploads/                # 上传文件缓存
```
