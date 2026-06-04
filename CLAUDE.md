# EasyMint

## 项目背景

EasyMint 是一个 Electron 桌面应用，让不懂技术的用户通过图形界面完成项目创建、需求采集，与 AI 对话驱动开发。AI 交互基于 claude-agent-sdk，Chat 模式采用长生命周期进程 + 消息通道，无需反复启停子进程。

GUI 是 harness，AI 引擎是 claude-agent-sdk。

## 文件组织

- **`app/`** — 所有项目源码
  - `app/main/` — Electron 主进程（services、utils、ipc handlers）
  - `app/preload/` — contextBridge 预加载脚本
  - `app/renderer/` — React + Vite 前端（pages、components、stores）
- **`docs/`** — 项目文档（APP_SPEC.md、ARCHITECTURE.md、SETUP.md）
- **`temp/`** — 开发过程中产生的临时文件（调试日志、截图、草稿等）
- **根目录** — `CLAUDE.md`、`README.md`、`.gitignore`、`LICENSE`，以及构建配置文件（`package.json`、`tsconfig.json`、`tailwind.config.js` 等）

## 常用命令

```bash
# 开发
npm run dev              # 启动 Vite dev server + Electron（开发模式）
npm run build            # 生产构建（Vite + Electron）
npm run lint             # ESLint + TypeScript 类型检查

# 测试
npm run test             # 运行单元测试
```

## 行为准则

- **对用户的提问和需求，永远先给出分析和方案**，和用户确认后再动手。不要在未经允许的情况下直接开始编码
- **如果用户发了一堆需求且没有标注序号，先拆解用户的需求**，列出序号请用户确认，确保没有遗漏和理解错误
- **网页访问**：DeepSeek 不支持直接 fetch 网页，需要时使用 Tavily MCP 工具（`tavily_search`、`tavily_extract`）代替 `WebFetch`
- **删除文件前必须列出清单**，逐项说明原因，等用户明确确认后再动手。禁止直接 `rm -f`

## 交互约定

- **必须用中文与用户对话。**

## 安全约束

- **严格禁止删除项目目录以外的任何用户文件和代码**
- **严格禁止运行 `rm -rf /`、`chmod 777`、`curl | bash` 等危险命令**
- **禁止修改 `.git/config`、系统配置、环境变量文件（除 `.env` 外）**
- 用户可能开启了 bypass 模式跳过权限确认，你必须自行遵守以上约束
- **不要操作 `~/.easymint/` 下的用户数据文件**

## 编码约定

- TypeScript strict 模式，禁止 `any`
- React 函数组件 + Hooks，无 class 组件
- zustand store 按领域拆分（project、agent、settings）
- IPC 通道统一前缀（project:、file:、agent:、evaluator:、settings:）
- 主进程服务通过依赖注入获取 store 实例
- 为新功能编写测试
- 前端改动需通过评估器验证（Playwright 测 Vite dev server DOM，不启动 Electron）

## 代码规范

### 时序值用 ref，不用 state
需要立刻生效的值用 `useRef`，state 只给 UI 渲染用。

### 异步路径必须有失败态
空 `catch(() => {})` 禁止。至少加 `console.error` 或设 error 状态。

### 一个文件只做一件事
如果改一个功能要翻到同一个文件的另一个区域，说明该拆了。拆成 hook（逻辑）、子组件（展示）、工具函数（纯计算）。写代码考虑边界：状态不串、资源不泄、异常不崩。

### 排查问题优先加日志，不要猜
行为不符合预期时，先在关键路径加 `console.log` 看实际输入输出，用日志定位问题。不要凭推测反复修改代码。

## 文档阅读时机

以下文档在特定场景下必须阅读：

| 场景 | 文档 | 原因 |
|------|------|------|
| 分析用户需求、设计功能、拆分开发任务 | `docs/AI驱动开发需求设计原则.md` | 11 条原则，决定任务粒度和结构 |
| 新增/修改配置文件、调整存储路径、处理 SDK 数据 | `docs/CONFIG_PATHS.md` | 全局和项目级的所有配置路径 |
| 使用 SDK API、会话管理、工具调用 | `docs/SDK_REFERENCE.md` | SDK 完整方法列表和类型 |

## 技术栈

| 层 | 技术 |
|---|---|
| 壳 | Electron 28+ |
| 前端 | React 18 + Vite 5 + TypeScript 5 |
| 样式 | Tailwind CSS 3 + Radix UI |
| 状态管理 | zustand |
| AI 集成 | claude-agent-sdk + 长生命周期进程 + 消息通道 |
| 存储 | JSON 文件（`~/.easymint/`） |
| 打包 | electron-builder |

## CodeGraph

本项目已初始化 CodeGraph（`.codegraph/`），是一个基于 tree-sitter 的符号知识图谱。查询亚毫秒级，返回 grep 拿不到的结构信息。

**自动同步**：CodeGraph MCP server 通过 FSEvents 监听文件变更，2 秒消抖后增量更新索引。不需要手动 `codegraph sync`。代码改了，索引自动跟上。

**检查索引健康**：`codegraph_status` — 如果输出里有 `Pending sync:` 说明还有未同步的文件，Read 那些文件即可。

### 何时优先用 codegraph 而非原生搜索

| 问题 | 工具 |
|------|------|
| "X 定义在哪？" / "找符号 X" | `codegraph_search` |
| "谁调用了函数 Y？" | `codegraph_callers` |
| "Y 调用了谁？" | `codegraph_callees` |
| "X 如何到达 Y？" / "从 X 到 Y 的完整流程" | `codegraph_trace`（一次调用返回全路径，含 callback/React/JSX 动态跳转） |
| "改了 Z 会影响到什么？" | `codegraph_impact` |
| "看 Y 的签名/源码/文档" | `codegraph_node` |
| "给我某个任务/模块的聚焦上下文" | `codegraph_context` |
| "同时看几个相关符号的源码" | `codegraph_explore` |
| "某个路径下有哪些文件？" | `codegraph_files` |
| "索引是否健康？" | `codegraph_status` |

### 经验法则

- **直接回答，不要委托探索。** "X 是怎么工作的"这类问题，2-3 个 codegraph 调用就够了：先用 `codegraph_context`，再用一个 `codegraph_explore` 看它返回的符号源码。跟踪流程用 `codegraph_trace` from→to。
- **信任 codegraph 的结果。** 它们来自完整 AST 解析。不要用 grep 重新验证——更慢、更不准、浪费上下文。
- **不要先 grep 再查符号名。** `codegraph_search` 一次调用就返回 kind + 位置 + 签名。
- **不要 chain `codegraph_search` + `codegraph_node`。** 只要上下文的话一个 `codegraph_context` 就够了。
- **不要在多个符号上循环 `codegraph_node`。** 一个 `codegraph_explore` 就能返回多个符号的源码，每个单独的 node/Read 调用会重复读取上下文，成本更高。
- **索引滞后 — 检查 staleness banner，不要猜。** codegraph 返回内容开头如果出现 "⚠️ Some files referenced below were edited since the last index sync…"，列出的文件待重新索引——Read 那些文件获取最新内容。没在 banner 里的文件都是最新的，codegraph 是权威来源。

### 如果 `.codegraph/` 不存在

运行 `codegraph init -i` 建索引。
