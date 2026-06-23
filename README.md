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
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19.2-61dafb?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/platform-macOS%20|%20Windows-lightgrey?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/Claude%20Agent%20SDK-0.3.186-blue?style=flat-square" alt="Claude Agent SDK" />
  <img src="https://img.shields.io/badge/license-AGPL--3.0-green?style=flat-square" alt="License" />
</p>

---

## 这能做什么

EasyMint 的目标是帮助初次接触编程的人渡过面对一个项目工程的迷茫期。通过引导式的新手流程帮你建立第一个编程项目，配合表单、可视化进度等设计，让你在真正理解编程之前就能亲手做出软件。后续的开发体验和 Claude Code 几乎一致，不会因为照顾新手而削弱专业性。

你不需要会编程，不需要配环境，不需要看懂任何一行代码。用中文描述想法，EasyMint 的 AI 项目经理会帮你梳理需求、拆解任务，然后自动调度两个 AI 助手——一个写代码，一个验收——直到把软件做出来。

整个过程像聊天一样简单。你不需要会编程，不需要配环境，不需要看懂任何一行代码。

EasyMint 底层基于 Claude Agent SDK，Agent 能力和 Claude Code 同源。在此之上，我们用新手引导、可视化进度和中文对话流程，降低了没有编程经验的用户的使用门槛。

## 怎么用

**第一步**：点击「新建项目」，用中文填写表单，描述你想做的软件。

**第二步**：AI 项目经理（Mint）会跟你聊天，帮你明确需求，然后自动进入开发循环。

**第三步**：Mint 调度 Builder 写代码、Evaluator 验收，你只需要看着进度条跑完，或者中途随时提修改意见。

**第四步**：开发完成，你的项目文件都在自己电脑上。想改？继续跟 Mint 聊天就行。

## 怎么装

去 [Releases 页面](https://github.com/tianemon/EasyMint/releases) 下载最新安装包：

- **macOS**：下载 `.dmg` 文件，拖进 Applications
- **Windows**：下载 `.exe` 安装包运行

### 推荐配置

EasyMint 内置了 AI 接口管理。以下是在设置中推荐的搭配：

| 用途 | 推荐 | 说明 |
|------|------|------|
| 主引擎 | **DeepSeek V4 Pro** | 性价比最高，编程能力强 |
| 识图（可选） | Qwen 3.6 Flash | 给 DeepSeek 补充视觉能力，用于截图验收 |
| 网页抓取（可选） | Tavily API | 给 DeepSeek 补充联网搜索能力 |

只需在设置中填入对应 API Key，EasyMint 自动识别组合。

## 特色

### 你只管说，AI 负责做

- **AI 项目经理（Mint）** — 听懂你的需求，帮你拆成可执行的任务
- **Builder（编码）** — 自动写代码、跑测试、修 Bug
- **Evaluator（验收）** — 写完后自动检查，不合格退回重做
- **进度面板** — 鱼骨图展示项目走到哪一步，任务列表显示每个任务在做/做完/失败

### 新手友好

- 全中文界面，表单引导建项目
- 技术选型由 AI 决定，不需要你操心
- 看不懂的报错 AI 自动翻译成大白话
- 快速启动：说「直接开始」跳过文档，立即开发

### 内建 AI 工具

- **Ponytail（简化方案）** — 强制 AI 用最简单的方式实现
- **Ponytail Review** — 审查代码有没有过度设计
- **Ponytail Audit** — 全项目扫描臃肿代码
- 快捷工具：点击聊天输入框右侧的按钮，选择「简化方案」「精简审查」「全库体检」

### 项目管理

- 项目文件存在自己电脑上，不属于任何云服务
- 随时可以离开 EasyMint，用其他工具继续开发
- 想改就改——回到 EasyMint 继续跟 AI 聊天，它记得之前做的一切
- 支持项目重命名，自动迁移会话数据
- 支持打开任意已有目录，导入外部项目

---

EasyMint 不替你写"最好的代码"，它让你**不用懂代码也能做出自己的软件**。
