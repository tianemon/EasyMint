# EasyMint — 需求规格

## 项目概述

EasyMint 是为 AI Coding Automation Template 构建的 **Electron 桌面 GUI 外壳**。让不懂技术的用户通过图形界面完成项目创建、需求采集、AI 协作开发的全流程。

GUI 是 harness，不是替代品。AI 引擎仍是 Claude Code。

## 已锁定技术栈

| 层 | 选择 | 版本要求 |
|---|---|---|
| 壳 | Electron | >= 28 |
| 前端 | React + Vite + TypeScript | React 18, Vite 5 |
| 样式 | Tailwind CSS + Radix UI | Tailwind 3, Radix latest |
| 状态管理 | zustand | latest |
| AI 集成（自动化） | spawn Claude 子进程 + JSONL 流式解析 | Claude `--output-format stream-json` |
| AI 集成（Chat） | spawn Claude 子进程 + 双向 JSONL | Claude `--input-format stream-json --output-format stream-json` |
| 终端嵌入（P2） | xterm.js + node-pty | xterm 5, node-pty 1 |
| 数据存储 | `~/.easymint/` JSON 文件 | — |
| 打包分发 | electron-builder | latest |

## 设计风格

取"Mint"之意：**清爽淡绿，干净鲜活**。

- **纯亮色 Mint 主题**（无暗色切换）：底色 `#f5faf7`，surface `#ecf5f0`，强调色 `#16a34a`
- 等宽字体 Monospace 面板使用深绿黑底 + 亮绿文字（终端扫描输出）
- **交互**：全局 cubic-bezier(0.4, 0, 0.2, 1)，快动作 150ms，标准 250ms
- 滚动条 5px mint 色调
- App 外壳：1280px 宽居中，圆角 10px，macOS 红绿灯 + 窗口投影

## 页面/模块结构

### OnboardingPage — 首次启动设置（仅首次）

首次打开 App 时显示，3 步完成 Claude Code 检测和配置确认。完成后写 localStorage(`easymint_setup_complete`)，之后跳过。

- **Step 1: 检测 Claude Code** — 扫描按钮 + 终端风格逐行动画输出（`which claude` → 路径 → `claude --version` → 版本号）。未检测到显示安装引导 + 手动输入路径
- **Step 2: 确认配置** — 表格：Claude 路径、版本、工作目录、AI 模型
- **Step 3: 完成** — ✓ 图标 + "EasyMint 已准备就绪" → 进入工作台

### ProjectPage — 项目工作台（默认页）

四栏可拖拽网格布局：

```
┌──────┬──────────┬───┬────────────────────────┬───┬──────────┐
│ 侧边  │ 左面板     │ ↔ │ 中间编辑区(Tab栏+内容)    │ ↔ │ 右面板     │
│ (44) │ (220)    │   │ (flex-1)               │   │ (280)    │
│      │          │   │                        │   │ 任务列表   │
│ + 新建│ 文件树/   │   │ ┌─Tab1──Tab2──Tab3───┐ │   │ ✓ done   │
│ 📁   │ 会话列表   │   │ │ Chat / Editor     │ │   │ ◉ running│
│ 💬   │          │   │ │                    │ │   │ ○ pending│
│ 🖥P2 │          │   │ └────────────────────┘ │   │          │
│ ⚙   │          │   │                        │   │          │
└──────┴──────────┴───┴────────────────────────┴───┴──────────┘
```

**侧边图标栏 (44px)**：
- 新建(+) — 下拉菜单（新建项目 / 新建文件 / 新建文件夹）
- 项目文件 — active 时左面板显示文件树
- 会话 — active 时左面板显示对话列表
- 终端(P2) — 禁用态，tooltip "终端 · 即将推出"
- 设置 — 底部，打开设置弹窗
- 所有按钮 CSS tooltip

**左面板 (220px)** — 双模式切换：
- 文件模式：panel-header("项目文件") + 刷新/折叠/收起 + 文件树（带 ▶ 箭头、缩进、modified M 标记）
- 会话模式：panel-header("会话") + 新建会话按钮(dashed) + 对话列表（圆点+标题+时间）
- 可折叠，收起后边缘 peek 按钮恢复

**中间编辑区 (flex-1)**：
- Tab 栏：每个 tab 有圆点（file 灰 / chat 绿）+ 标题 + 关闭 ✕，active 白底
- Chat 面板：欢迎页（Logo + 快捷入口）+ 消息气泡 + textarea 输入 + Token 状态栏
- Editor 面板：行号 gutter(44px) + 代码区(contenteditable)，CSS 语法高亮 class

**右面板 (280px)** — 任务列表：
- panel-header("任务列表") + 完成统计("3/5 完成")
- 任务项：状态圆点（✓ done / ◉ running+pulse / ○ pending / ✕ failed）
- 点击展开/折叠子步骤
- 可折叠

**面板拖拽**：两个 4px resize handle，hover accent 色，拖拽更新 CSS 变量

### NewProjectModal — 新建项目弹窗

5 步自适应表单，步骤根据项目类型动态显隐：

| Step | 内容 | 类型自适应 |
|------|------|-----------|
| 1. 项目概述 | 名称 input + 类型 radio(Web/移动/CLI/桌面) | 全部 |
| 2. 技术偏好 | 框架/样式/后端 radio，每项有 "AI 推荐" | CLI 时隐藏后端 |
| 3. 功能清单 | textarea + ✨ AI 推荐按钮（打字机模拟） | 全部 |
| 4. UI 风格 | 色彩 select + 排版 select | CLI 时跳过 |
| 5. 部署方式 | 技术费用 radio + 部署平台 radio | 全部 |

顶部 Step 指标器（4px 圆点条），底部上一步/下一步/创建项目。

### SettingsModal — 设置弹窗

- 外观：主题显示 "亮色 Mint（仅亮色）"
- Claude CLI：路径、版本、检测状态
- 开发选项：评估模式 / TDD 模式 / 截图验证 三个 toggle
- Token 消耗对照表（⭐1-4 颗）

## 当前阶段约定

**先 UI 布局，暂不接入 Claude 真实调用。** 全部使用 mock 数据：

- 文件树、会话列表、任务列表使用 mock-ipc 假数据
- Chat 输入关键词返回预设回复
- Onboarding 扫描 Claude 用模拟动画
- evaluator 接 Claude 的功能标记为待实现

## 功能清单

### P0（本期做）
- 纯亮色 Mint 主题
- Onboarding 首次设置页
- 四栏工作台布局 + 面板拖拽/折叠
- 侧边图标栏 + 下拉菜单 + Tooltip
- 文件树浏览
- Chat 面板（mock 对话）
- 代码 Editor 面板
- 任务列表面板
- 新建项目 5 步自适应表单
- 设置弹窗

### P2（后续做）
- 嵌入式终端（xterm.js + node-pty）
- Claude 真实 spawn + JSONL 流
- 对话历史持久化

### 本期不做
- 多模型支持、远程协作、插件系统、多项目 Tab
- 暗色主题（固定亮色 Mint）

## 数据存储

```
~/.easymint/
├── projects.json          # 项目列表
├── settings.json          # 用户设置（评估模式等）
└── sessions/
    └── <project-id>/
        └── sessions.json  # 对话历史
```

## 参考项目

| 项目 | 路径 | 参考内容 |
|------|------|---------|
| ai-coding-automation-template | `ai-coding-automation-template/` | 模板项目（复制源），SETUP.md 流程 |
| Proma | `/Users/amon/dev/project/Proma` | Electron 架构、React UI 模式 |
| open-design | `/Users/amon/dev/project/open-design` | Claude CLI 检测、JSONL 流式解析、session 管理 |
| EasyMint.html | `~/Downloads/EasyMint.html` | 工作台 UI 设计稿 |
| onboarding.html | `~/Downloads/onboarding.html` | 首次设置页设计稿 |
