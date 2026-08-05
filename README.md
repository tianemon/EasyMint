<p align="center">
  <img src="assets/icon.png" width="128" alt="EasyMint" />
</p>

<h1 align="center">EasyMint</h1>

<p align="center">
  <strong>不用懂代码，用 AI 造出自己的软件。</strong>
</p>

<p align="center">
  <a href="https://github.com/tianemon/EasyMint/releases"><img src="https://img.shields.io/github/v/release/tianemon/EasyMint?style=flat-square&color=16a34a" alt="Version" /></a>
  <img src="https://img.shields.io/badge/Electron-43.2-47848f?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19.2-61dafb?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/platform-macOS%20|%20Windows-lightgrey?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/Pi%20Coding%20Agent-0.82-blue?style=flat-square" alt="Pi Coding Agent" />
  <img src="https://img.shields.io/badge/license-AGPL--3.0-green?style=flat-square" alt="License" />
</p>

---

## 这是什么

EasyMint 是一个面向零基础用户的 AI 编程助手桌面应用，核心理念是让不懂技术的人也能掌握 Vibe Coding。

打开软件不是面对一个空项目发呆 -- 项目创建向导会一步步引导你填写需求，不知道怎么描述？直接点 AI 推荐，你只需要说出自己想要的功能。底层基于 pi-coding-agent，提供企业级 AI 编程能力，不用担心专业性。内置提示词针对新手做了大量优化，全程中文引导，不会抛出一堆看不懂的技术术语。

内置了实用 Skill 和 MCP 工具，装好就能用。会话聊久了上下文太多导致模型能力下降？EasyMint 设计了自动总结压缩机制 -- 达到阈值自动整理，关键信息不丢失，上下文无缝衔接，对话越长越聪明。

你的项目文件存在自己电脑上，不属于任何云服务。随时可以离开 EasyMint，用其他工具继续开发。

## 设计理念

**Harness Engineering** -- 软件本身只提供编排层和约束层，不替你写代码，而是调度 AI Agent 去完成实际工作。EasyMint 的角色是「项目经理的经理」：管好任务状态、校验流程合规、自动压缩上下文、确保 Agent 按规矩办事。

**Loop Engineering** -- 采用多 Agent 协作循环：主会话 Mint（PM/架构师）理解需求、拆解任务、委派 Builder 编码、交给 Evaluator 验收，自动循环直到任务完成。任务进度在侧边栏任务面板实时可见（进行中/已完成/失败），做到哪了一目了然。

**数据主权** -- 项目文件和会话数据全部存储在你本地电脑（`~/.easymint/` + 项目目录下的 `.easymint/`），不上传任何云服务。你可以随时用 VS Code、Cursor 或其他工具继续开发，EasyMint 不会锁定你的项目。

## 多 Agent 协作

EasyMint 内置了多个 AI Agent，各司其职，自动协同：

- **Mint（AI 项目经理）** -- 跟你对话，理解需求，拆解成可执行的任务清单（task.json），调度其他 Agent。全程用中文跟你沟通，报错也会翻译成大白话。
- **Builder（编码 Agent）** -- 自动写代码、跑测试、修 Bug。支持 TDD（测试驱动开发）模式，先写测试再写实现。
- **Evaluator（验收 Agent）** -- Builder 写完后自动检查：代码能不能跑、功能是否符合需求、测试是否通过。不合格退回 Builder 重做。

除了这三个内置 Agent，你还可以在设置中**创建自己的 Agent 模板**（比如"测试员""UI 设计师""代码审查员"），Mint 会按你的要求调度它们。

你只需要跟 Mint 聊天，其他 Agent 在后台自动配合。任务进度在任务面板实时展示，每个任务的状态（等待中/开发中/验收中/已完成/失败）一目了然。

**委派分工**：查资料、读代码、分析问题等通用任务，Mint 用标准子 Agent（无模板人设）完成；写代码、验收等特定角色任务，Mint 指定对应模板。

## 新手友好

项目创建向导：
- 全中文表单，填写项目名称、描述、目标用户、功能清单
- 不知道怎么选技术方案？点 AI 推荐，AI 根据你的项目类型自动选择合适的技术栈和验收策略
- 支持 Web / 移动端 / 桌面端 / CLI / API / 库等多种项目场景
- 快速启动：说「直接开始」跳过文档阶段，立即进入开发

对话体验：
- 提示词针对零基础用户做了大量优化，AI 会主动用通俗语言跟你沟通
- 内置实用 Skill（如 Ponytail 简化方案）和 MCP 工具，开箱即用
- 思考过程、工具调用可选择显示/隐藏，想看细节就打开，喜欢干净界面就关掉
- 思考等级 7 档可调（关闭/极简/低/中/高/超高/最大），可设全局默认，聊天中随时临时切换

上下文管理：
- 自动检测上下文用量，达到阈值自动触发压缩
- 压缩时保留关键信息，不会丢失对话中的重要决策和需求
- 输入框显示「正在整理会话」提示，整理完毕弹出通知
- 压缩失败时自动兜底轮转，开启新会话继续工作
- 会话历史完整存储在本地 JSONL 文件中，不受压缩影响，随时可回溯

## 内建工具和集成

**Skill 系统**
| Skill | 用途 |
|-------|------|
| Ponytail | 强制 AI 用最简单的方式实现，拒绝过度设计 |
| Ponytail Review | 审查代码变更中是否存在不必要的复杂度 |
| Ponytail Audit | 全项目扫描臃肿代码，给出精简建议 |
| UI Sync | 用户提出新需求时自动触发，同步任务列表 |

Skill 分三级管理：EM 内置（仅 EasyMint 可用）、全局级、项目级（跟随项目）。可从设置面板启用/禁用。

**MCP 工具集成**
EasyMint 内置产品工具（确认开发按钮、新建项目按钮、刷新任务列表、显示原型编辑器、更新任务状态、查看 Issue 清单、项目重命名），与外部 MCP 服务器无缝集成——自动读取并连接已配置的 MCP 服务器（与 Claude Code 共用配置），支持 CodeGraph（代码符号图谱分析）、Playwright（浏览器自动化，用于验收测试）、Image Vision（图片识别）等，装好就能用。

**AI 供应商管理**
内置 DeepSeek、Kimi、MiniMax、Xiaomi MiMo、智谱、OpenCode 等主流 AI 平台预设，选择平台、填 API Key 即可使用。也支持**自定义供应商**：填写 Base URL、API 协议（Anthropic / OpenAI 兼容）和模型列表，任何兼容 API 的服务都能接入。可同时配置多个供应商，随时切换激活；每个供应商可单独设置默认模型、兜底模型和子 Agent 默认模型。

推荐组合：DeepSeek V4 Pro（主引擎）+ Qwen 3.6 Flash（识图）+ Tavily API（网页抓取），在设置中填入对应 API Key 即可自动识别。

**Agent 模板系统**
Mint、Builder、Evaluator 各有内置模板（系统提示词），可在设置→Agent 页查看。内置模板除 Mint 外均可**编辑并持久生效**（重启不丢失）；你还能**新建自定义模板**——指定名称、职责提示词、供应商、模型和思考级别，Mint 委派时可选用。甚至可以让 Mint 在对话中**一句话创建模板**。

## 内容便签

AI 总结的重要内容，可以**钉成悬浮便签**固定在聊天区：

- **一键钉住**：消息气泡上的图钉按钮钉住整条内容；选中文字右键钉住，自动还原 Markdown 格式
- **可调大小**：拖动便签边缘自由调整尺寸，位置和大小自动保存
- **书签式贴纸**：拖到屏幕边缘自动吸附成彩色贴纸（8 色随机分配），点击展开回卡片；多张贴纸自动层叠，鼠标悬停抽出标题
- **会话级持久化**：切换会话、重启软件都不丢失

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
| 桌面框架 | Electron 43 |
| 前端 | React 19 + Vite 8 + TypeScript 6 |
| UI | Tailwind CSS 4 + Radix UI |
| 状态管理 | Zustand 5 |
| 代码编辑器 | Monaco Editor |
| AI 引擎 | pi-coding-agent 0.82 |
| 终端 | xterm + node-pty |

## 本地开发

```bash
git clone https://github.com/tianemon/EasyMint.git
cd EasyMint
npm install
npm run dev          # 启动 Vite dev server + Electron
npm run build        # 生产构建
npm run lint         # ESLint + TypeScript 类型检查
```

需要 Node.js 环境。首次 `npm install` 会自动安装所有依赖。

---

EasyMint 不替你写「最好的代码」，它让你**不用懂代码也能做出自己的软件**。
