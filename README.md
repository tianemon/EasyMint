<p align="center">
  <img src="assets/icon.png" width="128" alt="EasyMint" />
</p>

<h1 align="center">EasyMint</h1>

<p align="center">
  <strong>围绕 Pi Coding Agent 构建的通用 AI Agent 桌面软件，为不懂编程的人优化了「从想法到成品」的引导流程。</strong>
</p>

<p align="center">
  <a href="https://github.com/tianemon/EasyMint/releases"><img src="https://img.shields.io/github/v/release/tianemon/EasyMint?style=flat-square&color=16a34a" alt="Version" /></a>
  <img src="https://img.shields.io/badge/Pi%20Coding%20Agent-0.84-blue?style=flat-square" alt="Pi Coding Agent" />
  <img src="https://img.shields.io/badge/Electron-43.2-47848f?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19.2-61dafb?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/platform-macOS%20|%20Windows-lightgrey?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

---

## 这是什么

EasyMint 是一个**通用 AI Agent 桌面软件**，底层是 [Pi Coding Agent](https://github.com/pi-ai-engineering/pi-coding-agent) —— 企业级 AI 编程引擎。它不锁定任何项目形态，无论是新建项目、导入已有目录、还是打开任意代码库，都能用多 Agent 协作完成开发。

在此之上，EasyMint 针对一个具体痛点做了大量投入：**不懂编程的人，怎么从「一个模糊的想法」走到「一个能跑的软件」？** 为此它内置了完整的项目引导流程 —— 全中文表单 + 对话引导 + 原型确认，AI 帮你补全需求、出界面原型、定技术方案，你只需要点选、确认、提意见，全程不抛技术术语。

> 换句话说：EasyMint 对程序员是一个能用的通用 Agent 工作台；对编程小白，它把「造软件」这件事变得像填表和聊天一样简单。

## 核心特性

- **对话式项目引导** —— 表单 + 直接创建双路径。表单采结构化信息（名称/场景/功能/风格/交付），直接创建则让 AI 从头引导；「场景定流程、认知定表达」双因子自动判断该问多细，7 道 Gate 把关，不遗漏不越界
- **原型先行** —— 中等以上项目先出可交互 HTML 原型（内置 UI 设计师 Mint-D），你确认了才进入开发，避免「做出来的不是想要的」
- **多 Agent 协作** —— Mint（项目经理）拆需求、Builder 写代码、Evaluator 验收、Mint-D 出原型，自动循环直到完成
- **上下文自管理** —— 达到阈值自动压缩整理、失败自动轮转开新会话，长对话不「失忆」
- **数据主权** —— 项目文件和会话数据全存本地（`~/.easymint/` + 项目 `.easymint/`），不上云、不锁定，随时用 VS Code/Cursor 继续

## 项目引导流程（为新手设计）

这是 EasyMint 最花心思的部分。你不用一次性想清楚所有事，AI 会带着你一步步把想法变成可开发的项目：

```
① 意图采集 → ② 功能共创 → ③ 设备与成本 → ④ 快速原型 → ⑤ 实现
```

- **表单帮你搭基本盘**：填名称、一句描述、选「这个项目你打算怎么用」（自己用/做成产品/验证想法/做着玩/学习/技术实验…）、勾功能（点「AI 推荐」让 Mint 帮你列）、选 UI 风格、定完成度/部署/AI/预算
- **对话帮你补开放信息**：细节功能、成本取舍、原型确认这些「没有标准答案」的事，边聊边定
- **能繁能简**：商业交付走完整流程，做着玩就快速出成果；你懂技术就少解释，说大白话就零术语
- **7 道 Gate 硬约束**：需求意图 → 范围（过大切 MVP）→ 原型 → 确认原型 → 技术方案 → 开发 → 对照原型验证，每一步没通过不往下走

## 多 Agent 协作

- **Mint（AI 项目经理）** —— 跟你对话，理解需求，拆解成 task.json 任务清单，调度其他 Agent。报错也翻译成大白话
- **Builder（编码 Agent）** —— 写代码、跑测试、修 Bug，支持 TDD 测试驱动开发
- **Evaluator（验收 Agent）** —— 检查代码能不能跑、功能符不符合需求，不合格退回 Builder
- **Mint-D（UI 设计师）** —— 出 HTML 原型，内置品牌库和设计规范

你只跟 Mint 聊天，其他 Agent 在后台自动配合。任务进度在面板实时展示。

**委派分工**：查资料、读代码、分析问题等通用任务，Mint 用标准子 Agent 完成；写代码、验收、UI 设计等角色任务，指定对应模板。

## 新手友好

- 全中文对话，AI 主动用通俗语言沟通，技术报错翻译成人话
- 技术选型 AI 代选并告诉你理由，不让你在技术选项间纠结
- 输入模糊时 AI 先拆解复述、给你大白话方案再确认，不瞎猜
- 思考过程 / 工具调用可显示/隐藏；思考等级 7 档可调

## 内建工具和集成

**Skill 系统**（三级管理：EM 内置 / 全局 / 项目级，可从设置启用/禁用）
- 创建项目引导（creation-guide + 5 个流程子 Skill）
- UI Sync（新需求自动同步任务列表）
- 运行面板配置、项目文档规范
- Ponytail 系列（强制最简单方案、审查/审计过度设计）

**MCP 工具集成**
内置产品工具（确认开发/新建项目/刷新任务/显示原型/更新任务状态/查看 Issue/重命名），自动连接已配置的 MCP 服务器（与 Claude Code 共用配置），支持 CodeGraph、Playwright、Image Vision 等。

**AI 供应商管理**
内置 DeepSeek、Kimi、MiniMax、智谱等主流平台预设，填 API Key 即用；支持自定义供应商（Base URL + Anthropic/OpenAI 兼容协议）；可同时配置多个、随时切换。

**视觉识别（可选，可配置）**
DeepSeek 等纯文本模型没有识图能力。EasyMint 内置了独立的视觉模型配置——默认阿里 qwen3.7-flash（公共 DashScope 端点，有免费额度），**不限于此**：只要提供 OpenAI 兼容（`/chat/completions`）或 Anthropic 兼容（`/v1/messages`）接口的视觉模型都能接入，在设置里填 API 地址 + 模型名 + Key 即可。配置后 Mint 就能看图、核对界面截图。

**Agent 模板系统**
Mint / Builder / Evaluator / Mint-D 各有内置模板，除 Mint 外可编辑；可新建自定义模板，指定职责、供应商、模型、思考级别。

## 项目管理

- 文件树 + Monaco 编辑器（语法高亮、智能提示）
- 多 Tab 会话、多窗口协作
- 终端面板（xterm）
- 项目重命名（自动迁移会话数据）/ 重新定位 / 导入已有目录
- Git 集成
- 设备互联（跨设备迁移项目与会话，实验功能）

## 内容便签

AI 总结的重要内容可钉成悬浮便签固定在聊天区：一键钉住、可调大小、吸附成彩色贴纸、会话级持久化。

## 怎么用

1. **新建项目** —— 点「新建项目」填中文表单，或点「直接创建」让 AI 从头引导
2. **对话引导** —— Mint 帮你明确需求、出原型、定方案
3. **自动开发** —— Mint 调度 Builder/Evaluator 循环开发，你看着进度，随时提修改
4. **持续迭代** —— 完成后想改，继续跟 Mint 聊就行

## 怎么装

去 [Releases 页面](https://github.com/tianemon/EasyMint/releases) 下载安装包：

- **macOS**：`.dmg` 拖进 Applications
- **Windows**：`.exe` 运行

首次启动引导选择 AI 供应商（推荐 DeepSeek），填 API Key 即可。

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Electron 43 |
| 前端 | React 19 + Vite + TypeScript 6 |
| UI | Tailwind CSS 4 + Radix UI |
| 状态管理 | Zustand 5 |
| 代码编辑器 | Monaco Editor |
| AI 引擎 | Pi Coding Agent 0.84 |
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

需要 Node.js 环境。

---

EasyMint 既专业又新手友好 —— 底层是企业级 Pi Coding Agent 引擎，提供完整的 Agent 编排、多角色协作、上下文管理能力；上层把复杂度藏进引导流程，让不懂代码的人也能做出自己的软件，让懂代码的人有一个顺手的 Agent 工作台。
