# EasyMint — 设计构想

> 名称含义：Easy（简单）+ Mint（铸造）—— 简单操作让想法变为现实。
>
> **这是初步构想，还不是完整需求。** 后续会通过 SETUP 流程进一步完善和细化。

---

## 参考

| 参考对象 | 路径/地址 | 用途 |
|---------|----------|------|
| 模板项目 | `ai-coding-automation-template/` | 本项目围绕其构建 GUI 外壳，模板中的 SETUP.md 流程是核心驱动逻辑 |
| SETUP.md | `ai-coding-automation-template/docs/SETUP.md` | GUI 的需求采集表单按 SETUP Phase 1-3 设计，Phase 4-5 由 Claude 子进程自动执行 |
| Proma | `/Users/amon/dev/project/Proma` | Electron 架构、React UI 模式、workspace 管理 |
| open-design | `/Users/amon/dev/project/open-design` | Claude CLI 扫描检测、JSONL 流式解析、session 管理 |

---

## 1. 项目目标

为模板项目构建 **Electron 桌面 GUI 外壳**。用户通过图形界面完成：

- 一键新建项目（自动复制模板到目标目录）
- 需求采集（分步表单，覆盖 SETUP.md Phase 1-3）
- 启动自动化开发（SETUP Phase 4-5 由 Claude 子进程执行，实时流式输出到 GUI）
- 浏览项目文件结构、查看开发进度

GUI 是 harness，不是替代品。AI 引擎仍是 Claude Code。

---

## 2. 用户场景

目标用户：有想法但不懂技术的普通人。

```
用户打开 App
  → 首页：项目列表（空则有引导文案）
  → 点击 [新建项目]：弹窗填名称、选目录
  → 系统复制模板到目标目录，跳转到需求采集
  → 分步表单：项目概述 → 技术偏好 → 功能清单 → UI 风格（对应 SETUP Phase 1-3）
  → 提交，生成 requirements.md 写入项目目录
  → 进入项目工作台：
     ├── 左侧：功能按钮列（新建、项目结构、对话历史、终端、设置）
     ├── 中上：编辑区（文档/代码查看）
     ├── 中下：流式输出面板（Claude worker/evaluator 实时输出）
     └── 右侧：暂不规划
  → 用户点击 [启动开发]，EasyMint 后台 spawn Claude 子进程（自动化模式）
  → 子进程输出 JSONL 流，GUI 实时渲染（文本、工具调用、文件变更）
  → 每轮 worker 完成后自动触发 evaluator（如开启评估模式）
  → 用户可在 Chat 面板与 Claude 自由对话（Chat 模式，长会话双向 JSONL 通信）
  → 也可打开嵌入式终端，使用 Claude 原生 TUI（P2）
```

---

## 3. 技术选型

| 层 | 选择 |
|---|---|
| 壳 | Electron |
| 前端 | React + Vite + TypeScript |
| 样式 | Tailwind CSS + Radix UI 无样式组件 |
| 状态管理 | zustand |
| AI 集成（自动化） | `claude -p "..." --output-format stream-json`，主进程 spawn 子进程，解析 JSONL 流 |
| AI 集成（Chat） | `claude --input-format stream-json --output-format stream-json`，长会话双向通信 |
| 终端嵌入（P2） | xterm.js + node-pty，Claude 原生 TUI，供进阶用户使用 |
| 数据存储 | `~/.easymint/` JSON 文件 |
| AI 绑定 | 本地 `claude` CLI，严格绑定 |

---

## 4. 系统架构

```
┌── Electron ───────────────────────────────────────────┐
│                                                        │
│  ┌── Main Process (Node.js) ─────────────────────────┐ │
│  │  services/                                         │ │
│  │  ├── project-service   # 模板复制、项目 CRUD        │ │
│  │  ├── file-service      # 目录树读取、文件内容        │ │
│  │  ├── agent-service     # Claude 子进程 spawn + JSONL 解析 │
│  │  ├── evaluator-service # 评估 Agent 调度             │ │
│  │  └── store             # JSON 文件读写              │ │
│  │                                                    │ │
│  │  utils/                                            │ │
│  │  ├── claude-detector   # PATH 扫描检测 claude CLI   │ │
│  │  └── jsonl-parser      # JSONL 流式解析器           │ │
│  └────────────────────────────────────────────────────┘ │
│                          │ IPC / SSE                    │
│  ┌── Preload (contextBridge) ─────────────────────────┐ │
│  │  window.electronAPI = { project:*, file:*,          │ │
│  │    agent:*, evaluator:*, settings:* }               │ │
│  └────────────────────────────────────────────────────┘ │
│                          │                              │
│  ┌── Renderer (React + Vite) ─────────────────────────┐ │
│  │                                                    │ │
│  │  Pages              Components                      │ │
│  │  HomePage           LeftToolbar（功能切换按钮列）      │ │
│  │  SetupPage          RequirementForm (4 steps)        │ │
│  │  ProjectPage        StreamPanel（JSONL 流式渲染）     │ │
│  │                     TerminalPanel (xterm.js, P1)    │ │
│  │                     EditorPanel                      │ │
│  │                     FileTreePanel                    │ │
│  │                     SessionHistory                   │ │
│  └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘

数据存储（独立于 Electron 进程）:
~/.easymint/
├── projects.json
├── settings.json
└── sessions/<project-id>/sessions.json
```

---

## 5. 核心机制

EasyMint 与 Claude Code 有三种交互模式，覆盖不同场景：

### 5.1 自动化模式（Worker / Evaluator）

对应模板的 `run-automation.sh` 和 `evaluate.sh`。主进程 spawn Claude 子进程，一次性执行：

```bash
claude -p "<prompt>" --output-format stream-json
```

每行是一个 JSON 对象，经 JSONL 解析器解析后通过 IPC 推送到渲染进程。前端 `StreamPanel` 用自定义组件渲染：文本 → Markdown、工具调用 → 可折叠卡片、文件变更 → 变更摘要。Claude 跑完自动退出。

用户全程看到实时进度，`-p` 黑箱问题消失。参考 open-design 的 `claude-stream.ts` JSONL 解析模式、Proma 的 `SDKMessageRenderer.tsx` 结构化渲染模式。

### 5.2 Chat 模式（自由对话）

对应模板 SETUP Phase 1-5 的交互式对话。主进程 spawn Claude 子进程，双向通信：

```bash
claude --input-format stream-json --output-format stream-json
```

- **stdin**：用户通过 ChatPanel 输入框发送消息，主进程序列化为 JSONL 写入子进程 stdin
- **stdout**：Claude 输出 JSONL，解析后渲染到 ChatPanel，效果同 StreamPanel 但多一个输入通道
- **生命周期**：进程保持，直到用户关闭会话或 Claude 自然结束

Chat 模式替代了原本由嵌入式终端承载的"与 Claude 自由对话"场景。与自动化模式共用同一套 JSONL 解析和渲染组件，唯一差异是多 stdin 写入。参考 open-design 的 daemon → agent run → SSE 长会话架构。

### 5.3 嵌入式终端（P2）

xterm.js + node-pty，Claude 原生 TUI 在 GUI 中直接渲染。供进阶用户在需要完整 Claude Code TUI 体验时使用（权限确认弹窗、文件 diff 等）。

### 5.4 Claude CLI 检测

启动时扫描 PATH 找 `claude` 二进制，逐个尝试 `--version` 直到找到有效路径。未检测到时在 GUI 中显示安装引导。

### 5.5 表单数据注入

需求采集表单提交后生成 `requirements.md` 写入项目根目录。Claude Code 启动时自动加载同目录下的 CLAUDE.md，requirements.md 作为补充上下文对 Claude 可见。

### 5.6 评估模式（--evaluate）

评估模式对应模板的 `EVALUATOR.md` + `evaluate.sh`。界面提供手动开关，开启后每轮 worker 完成自动触发独立评估 Agent 对产出做验证（Playwright 测 Vite dev server 的 DOM，不是 Electron 窗口），输出评估报告。关闭则不触发。后续实现。

### 5.7 自适应需求采集表单（待商议）

表单步骤根据项目类型动态调整，不展示与项目无关的问题。

| Step | Web | 移动端 | CLI/API | 桌面 |
|------|-----|--------|---------|------|
| 1. 项目概述 | ✅ | ✅ | ✅ | ✅ |
| 2. 技术偏好 | ✅ | ✅ | ✅ | ✅ |
| 3. 功能清单 | ✅ | ✅ | ✅ | ✅ |
| 4. UI 风格 | ✅ | ✅ | — | ✅ |
| 5. 部署方式 | ✅ | ✅ | ✅ | ✅ |

Step 1 填完项目类型后，后续 Step 自动适配。做服务端项目不会问 UI 风格，做 CLI 工具不会问移动端适配。

### 5.8 UI 原型预览（待商议）

接入 open-design 的原型生成能力。用户完成需求采集后，一键生成可交互 HTML 原型，提前看到 App 长什么样。open-design 采用 Apache 2.0 协议，可集成。方案待定：先通过提示词调用，验证后再考虑自动集成或嵌入简易版。

### 5.9 自适应测试流程（待商议）

评估模式中的测试策略根据项目平台动态调整：

| 项目类型 | 测试方式 |
|---------|---------|
| Web 前端 | Playwright 截图 + image-vision 视觉验证 |
| 桌面（Electron） | Playwright 测 Vite dev server 的 DOM |
| 移动端 | 暂不考虑（有模拟器环境可以） |
| CLI / API / 服务端 | TDD 模式，先写测试用例再开发 |

### 5.10 Token 消耗提醒（待商议）

不同模式的 Token 消耗差异显著，用户启用前需明确提示：

| 模式 | Token 消耗 | 说明 |
|------|-----------|------|
| 普通开发（Vibe Coding） | ⭐ 基准 | 单次 worker 调用 |
| 评估模式 | ⭐⭐ | 每轮追加一次 evaluator 调用 |
| TDD 模式 | ⭐⭐⭐ | 先写测试 → 开发 → 迭代修复 |
| 截图验证 | ⭐⭐ | 额外 Playwright + image-vision 调用 |
| 全开（TDD + 截图 + 评估） | ⭐⭐⭐⭐ | 效果好但消耗最高 |

界面在对应开关旁标注大致消耗等级，用户开启前知情。默认全部关闭。

### 5.11 DeepSeek 视觉能力桥接（待商议）

评估模式中的截图验证依赖视觉模型分析。当前 DeepSeek 不支持图片输入，评估流程需切换至 Claude 完成视觉分析。考虑集成 image-vision MCP 作为桥接层：截图 → image-vision 转文字描述 → 喂给 DeepSeek 判断。不增 Token 消耗（image-vision 是本地模型），且评估链路可全走 DeepSeek。若 DeepSeek 后续原生支持图片输入，此能力可移除。

---

## 6. 页面布局

```
HomePage
┌──────────────────────────────────────────────┐
│  EasyMint                                    │
│  ─────────────────────────────────────────── │
│  [项目卡片列表]                                │
│  [  + 新建项目  ]                            │
└──────────────────────────────────────────────┘

SetupPage
┌────────┬─────────────────────────────────────┐
│  步进   │  Step N/4: 标题                       │
│  指示   │  ─────────────────────────────────  │
│       │  表单内容区                              │
│       │  [上一步]                  [下一步]    │
└────────┴─────────────────────────────────────┘

ProjectPage
┌────┬──────────────────────────┬──────┐
│ 左 │  编辑区                    │  右  │
│ 侧 │  - 查看文档/代码            │  侧  │
│ 工 │  - 文件树                  │  暂   │
│ 具 │                           │  不   │
│ 栏 │──────────────────────────│  规   │
│   │  流式输出面板                │  划   │
│ 📁 │  Claude 正在执行任务1...     │      │
│ 💬 │  ✓ 读取 task.json          │      │
│ 🖥 │  ✓ 创建 src/index.ts       │      │
│ ⚙ │  ⏳ 正在 npm install...     │      │
│   │  [启动开发] [启动评估] [终端] │      │
└────┴──────────────────────────┴──────┘

左侧工具栏按钮：
  📁 新建项目 / 打开项目
  🌳 项目结构（点击 → 编辑区展示文件树）
  💬 对话历史（点击 → 编辑区展示历史列表）
  🖥 终端（点击 → 打开嵌入式终端面板）
  ⚙ 设置（含评估模式开关）
```

---

## 7. 功能范围

**P0（本期做）**：新建项目、自适应需求采集表单（按项目类型调整步骤）、自动化模式（JSONL 流式渲染）、Chat 模式（长会话双向 JSONL 通信）、文件浏览、对话历史管理、评估模式开关、暗色/亮色主题。

**P2（后续做）**：嵌入式终端（xterm.js + node-pty，Claude 原生 TUI）。

**本期不做**：多模型支持、代码编辑器、远程协作、插件系统、多项目 Tab。

---

## 8. 设计风格

### 色彩

取"EasyMint"中 Mint（薄荷）之意：**清爽淡绿，干净鲜活**。

| 变量 | 暗色 | 亮色 |
|------|------|------|
| 底色 | `#0d1f17`（深绿黑） | `#f5faf7`（白底淡绿） |
| 次底色 | `#132a20` | `#ecf5f0` |
| hover | `#1a3a2c` | `#e0f0e8` |
| 边框 | `#2a4a3a` | `#c8ddd2` |
| 主文字 | `#e0f0e8` | `#0d1f17` |
| 次文字 | `#7a9a8a` | `#5a7a6a` |
| 强调色 | `#4ade80`（mint-400） | `#16a34a`（mint-600） |
| 强调hover | `#22c55e`（mint-500） | `#15803d`（mint-700） |

### 交互

- 全局过渡：`cubic-bezier(0.4, 0, 0.2, 1)`，0.2s，所有按钮/hover/焦点
- 主题切换：html/body `background-color` 和 `color` 平滑过渡
- 滚动条：6px 宽，mint 色调，圆角

### 默认

暗色 Mint 主题。亮色可选。
