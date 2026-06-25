<p align="center">
  <img src="assets/icon.png" width="128" alt="EasyMint" />
</p>

<h1 align="center">EasyMint</h1>

<p align="center">
  <strong>不用懂代码，用 AI 造出自己的软件。</strong>
</p>

<p align="center">
  <a href="https://github.com/tianemon/EasyMint/releases"><img src="https://img.shields.io/github/v/release/tianemon/EasyMint?style=flat-square&color=16a34a" alt="Version" /></a>
  <img src="https://img.shields.io/badge/Electron-42.3-47848f?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19.2-61dafb?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/platform-macOS%20|%20Windows-lightgrey?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/Claude%20Agent%20SDK-0.3.186-blue?style=flat-square" alt="Claude Agent SDK" />
  <img src="https://img.shields.io/badge/license-AGPL--3.0-green?style=flat-square" alt="License" />
</p>

---

## 这是什么

EasyMint 是一个面向零基础用户的 AI 编程助手桌面应用，核心理念是让不懂技术的人也能掌握 Vibe Coding。

打开软件不是面对一个空项目发呆 -- 项目创建向导会一步步引导你填写需求，不知道怎么描述？直接点 AI 推荐，你只需要说出自己想要的功能。底层基于 claude-agent-sdk，跟 Claude Code 同款 AI 能力，不用担心专业性。内置提示词针对新手做了大量优化，全程中文引导，不会抛出一堆看不懂的技术术语。

记不住 Claude Code 的各种命令也没关系，界面里把命令用法都列出来了，点击选择即可。内置了实用 Skill 和 MCP 工具，装好就能用。会话聊久了上下文太多导致模型能力下降？EasyMint 设计了自动总结压缩机制 -- 达到阈值自动整理，关键信息不丢失，上下文无缝衔接，对话越长越聪明。

你的项目文件存在自己电脑上，不属于任何云服务。随时可以离开 EasyMint，用其他工具继续开发。

## 设计理念

**Harness Engineering** -- 软件本身只提供编排层和约束层，不替你写代码，而是调度 AI Agent 去完成实际工作。EasyMint 的角色是「项目经理的经理」：管好任务状态、校验流程合规、自动压缩上下文、确保 Agent 按规矩办事。

**Loop Engineering** -- 采用多 Agent 协作循环：主会话 Mint（PM/架构师）理解需求、拆解任务、委派 Builder 编码、交给 Evaluator 验收，自动循环直到任务完成。任务进度通过鱼骨图实时可见，做到哪了一目了然。

**数据主权** -- 项目文件和会话数据全部存储在你本地电脑（`~/.easymint/` + 项目目录下的 `.easymint/`），不上传任何云服务。你可以随时用 VS Code、Cursor 或其他工具继续开发，EasyMint 不会锁定你的项目。

## 三 Agent 协作

EasyMint 内置了三个 AI Agent，各司其职，自动协同：

- **Mint（AI 项目经理）** -- 跟你对话，理解需求，拆解成可执行的任务清单（task.json），调度 Builder 和 Evaluator。全程用中文跟你沟通，报错也会翻译成大白话。
- **Builder（编码 Agent）** -- 自动写代码、跑测试、修 Bug。支持 TDD（测试驱动开发）模式，先写测试再写实现。
- **Evaluator（验收 Agent）** -- Builder 写完后自动检查：代码能不能跑、功能是否符合需求、测试是否通过。不合格退回 Builder 重做。

你只需要跟 Mint 聊天，Builder 和 Evaluator 在后台自动配合。任务进度通过鱼骨图实时展示，每个任务的状态（等待中/开发中/验收中/已完成/失败）一目了然。

## 新手友好

项目创建向导：
- 全中文表单，填写项目名称、描述、目标用户、功能清单
- 不知道怎么选技术方案？点 AI 推荐，AI 根据你的项目类型自动选择合适的技术栈和验收策略
- 支持 Web / 移动端 / 桌面端 / CLI / API / 库等多种项目场景
- 快速启动：说「直接开始」跳过文档阶段，立即进入开发

对话体验：
- 提示词针对零基础用户做了大量优化，AI 会主动用通俗语言跟你沟通
- 界面直接列出 Claude Code 各种命令的中文说明和用法，点击选择即可，不需要特意去记
- 内置实用 Skill（如 Ponytail 简化方案）和 MCP 工具，开箱即用
- 思考过程、工具调用可选择显示/隐藏，想看细节就打开，喜欢干净界面就关掉

上下文管理：
- 自动检测上下文用量，达到阈值自动触发压缩
- 压缩时保留关键信息，不会丢失对话中的重要决策和需求
- 输入框显示「正在整理会话」提示，整理完毕弹出通知
- 压缩失败时自动兜底轮转，开启新会话继续工作
- 会话历史完整存储在本地 JSONL 文件中，不受压缩影响，随时可回溯

## 内建工具和集成

**快捷命令面板**
输入 `/` 或点击工具栏按钮，弹出分组表格展示所有可用命令，每条带中文说明和参数提示，不需要去记 CLI 语法。

**Skill 系统**
| Skill | 用途 |
|-------|------|
| Ponytail | 强制 AI 用最简单的方式实现，拒绝过度设计 |
| Ponytail Review | 审查代码变更中是否存在不必要的复杂度 |
| Ponytail Audit | 全项目扫描臃肿代码，给出精简建议 |
| UI Sync | 用户提出新需求时自动触发，同步任务列表和进度条 |

Skill 分三级管理：EM 内置（仅 EasyMint 可用）、全局级（与 Claude Code 共用）、项目级（跟随项目）。可从设置面板启用/禁用。

**MCP 工具集成**
EasyMint 内置了 easymint-ui MCP Server，为 AI Agent 提供 UI 交互能力：确认开发按钮、新建项目按钮、更新任务状态、切换项目阶段、项目重命名。同时与 Claude Code 共享 MCP 配置，你在终端 `claude mcp add` 添加的服务器在 EasyMint 中同样可用。

**AI 供应商管理**
内置 DeepSeek、Kimi、MiniMax、Xiaomi MiMo、智谱等国内主流 AI 平台预设，选择平台、填 API Key 即可使用。支持一键获取模型列表、自定义模型、1M 上下文。可同时配置多个供应商，随时切换激活。

推荐组合：DeepSeek V4 Pro（主引擎）+ Qwen 3.6 Flash（识图）+ Tavily API（网页抓取），在设置中填入对应 API Key 即可自动识别。

**Agent 模板系统**
Mint、Builder、Evaluator 各有独立的 Agent 模板（系统提示词 + 工具列表），可从设置面板查看。如需自定义 Agent 行为，编辑项目的 CLAUDE.md 即可。

## 项目管理

完整的项目工作台：
- 文件树面板 + Monaco 代码编辑器，语法高亮和智能提示
- 多 Tab 会话，同一个项目可开多个独立对话
- 多窗口协作，同项目可开多个窗口
- 终端面板（xterm），直接在当前项目目录执行命令
- 项目重命名 -- 自动迁移所有会话数据，不丢失历史
- 项目重新定位 -- 文件夹在 Finder 中被移动后，重新指向新路径
- 导入已有目录 -- 把外部项目纳管到 EasyMint
- Git 集成（检测 Git 安装状态，可在终端中使用）

## 怎么用

**第一步**：点击「新建项目」，用中文填写表单，描述你想做的软件。不知道怎么填？点 AI 推荐，说你想要什么就行。

**第二步**：AI 项目经理（Mint）会跟你聊天，帮你明确需求、梳理功能点，然后自动进入开发循环。

**第三步**：Mint 调度 Builder 写代码、Evaluator 验收，你只需要看着进度条跑完，或者中途随时提修改意见。

**第四步**：开发完成，你的项目文件都在自己电脑上。想继续改？继续跟 Mint 聊天就行。

## 怎么装

去 [Releases 页面](https://github.com/tianemon/EasyMint/releases) 下载最新安装包：

- **macOS**：下载 `.dmg` 文件，拖进 Applications
- **Windows**：下载 `.exe` 安装包运行

首次启动会引导你选择 AI 供应商（推荐 DeepSeek），填好 API Key 即可开始使用。

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Electron 42 |
| 前端 | React 19 + Vite 8 + TypeScript 6 |
| UI | Tailwind CSS 4 + Radix UI |
| 状态管理 | Zustand 5 |
| 代码编辑器 | Monaco Editor |
| AI 引擎 | claude-agent-sdk 0.3.186 |
| 终端 | xterm + node-pty |

## 本地开发

```bash
git clone https://github.com/tianemon/EasyMint.git
cd EasyMint
npm install
npm run dev          # 启动 Vite dev server + Electron
npm run build        # 生产构建
npm run lint         # ESLint + TypeScript 类型检查
npm run test         # 运行单元测试
```

需要 Node.js 环境。项目同时依赖 claude-agent-sdk 的原生二进制包（`@anthropic-ai/claude-agent-sdk-darwin-arm64` 等），首次 `npm install` 会自动下载对应平台的二进制。

---

EasyMint 不替你写「最好的代码」，它让你**不用懂代码也能做出自己的软件**。
