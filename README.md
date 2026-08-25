<p align="center">
  <img src="assets/icon.png" width="128" alt="EasyMint" />
</p>

<h1 align="center">EasyMint</h1>

<p align="center">
  <strong>围绕 Pi Coding Agent 构建的开源 AI 编程 Harness。</strong>
</p>

<p align="center">
  <a href="https://github.com/tianemon/EasyMint/releases"><img src="https://img.shields.io/github/v/release/tianemon/EasyMint?style=flat-square&color=16a34a" alt="Version" /></a>
  <img src="https://img.shields.io/badge/Pi%20Coding%20Agent-0.84-blue?style=flat-square" alt="Pi Coding Agent" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

---

## 定位

EasyMint 是一个**开源 AI 编程 Harness**——围绕 [Pi Coding Agent](https://github.com/pi-ai-engineering/pi-coding-agent) 构建的桌面应用。Pi Coding Agent 是开源的 AI 编程引擎，其专业能力足以支撑完整的软件开发流程；EasyMint 在其之上提供图形化界面、多 Agent 协作与项目引导，覆盖从需求采集到成品交付的完整链路。

面向两类使用场景：

- **编程新手**：通过对话引导完成需求采集、原型确认与技术方案确认，以点选和对话的方式驱动开发
- **开发者**：使用多 Agent 协作、会话管理与跨设备迁移等能力，作为日常的 AI 编程工作台

## 核心特性

- **对话式项目引导**——表单与直接创建双路径，按场景与认知水平自动调整引导深度；7 道 Gate 把关（需求意图 → 范围 → 原型 → 确认 → 技术方案 → 开发 → 对照验证）
- **原型先行**——中等及以上项目先产出可交互 HTML 原型（内置设计师 Agent 与品牌库），确认后才进入开发
- **多 Agent 协作**——项目经理 Agent 拆解需求、编码 Agent 实现、验收 Agent 检查、设计师 Agent 出原型，自动循环直至完成
- **子 Agent 委派**——查资料、读代码、分析问题等任务委派标准子 Agent 执行并回传摘要，避免挤占主会话上下文
- **上下文自管理**——接近阈值时提示整理，长对话自动压缩保持上下文可用
- **内容便签**——AI 输出的重要内容可一键钉成悬浮便签，调整大小、吸附固定、随会话持久化
- **数据主权**——项目文件与会话数据全部存储本地（`~/.easymint/` 与项目内 `.easymint/`），不上云、不锁定
- **跨设备迁移**——项目文件与历史会话可完整迁移到另一台设备，支持文件级选择、多会话迁移与忽略配置

## 多 Agent 协作

- **Mint（项目经理）**——需求理解、任务拆解（task.json）、Agent 调度、进度把控
- **Builder（编码）**——按任务实现代码、运行测试、修复问题，支持 TDD
- **Evaluator（验收）**——对照需求检查产出，不合格退回重做
- **Mint-D（UI 设计）**——产出 HTML 原型，内置品牌库与设计规范
- **子 Agent（通用委派）**——探索、审查、实现等类型化委派，回传摘要不占主上下文

任务进度在面板实时展示；角色任务指定对应模板，通用任务使用标准子 Agent，委派深度与类型受控。

## 项目管理

- 文件树 + Monaco 编辑器（语法高亮、智能提示）
- 多 Tab 会话、多窗口
- 项目重命名（会话数据自动迁移）/ 重新定位 / 导入已有目录
- Git 集成
- 跨设备项目迁移（文件与会话）

## 内容便签

AI 输出的重要内容可钉成悬浮便签固定在聊天区：一键钉住、可调大小、吸附成彩色贴纸、随会话持久化。

## Agent 模板

Mint / Builder / Evaluator / Mint-D 各有内置模板，除 Mint 外可编辑；可新建自定义模板，指定职责、供应商、模型与思考级别。

## 使用流程

1. **新建项目**——填表或直接创建，由对话引导补全需求
2. **对话引导**——需求采集 → 功能共创 → 原型确认 → 技术方案
3. **自动开发**——任务拆解后由编码/验收 Agent 循环推进，进度实时可见
4. **持续迭代**——需求变更直接对话，任务增量追加

## 安装

前往 [Releases 页面](https://github.com/tianemon/EasyMint/releases) 下载安装包：

- **macOS**：`.dmg`
- **Windows**：`.exe`

首次启动选择 AI 供应商并配置 API Key。

## AI 供应商

内置 DeepSeek、Kimi、MiniMax、智谱等主流平台预设，填写 API Key 即可使用；支持自定义供应商（OpenAI/Anthropic 兼容协议）；支持同时配置多个供应商并随时切换。

## 视觉识别

纯文本模型不具备识图能力时，可配置独立的视觉模型（OpenAI 或 Anthropic 兼容接口），使 AI 具备读取图片、核对界面截图的能力。

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Electron 43 |
| 前端 | React 19 + Vite + TypeScript 6 |
| UI | Tailwind CSS 4 + Radix UI |
| 状态管理 | Zustand 5 |
| 代码编辑器 | Monaco Editor |
| AI 引擎 | Pi Coding Agent 0.84 |

## 本地开发

```bash
git clone https://github.com/tianemon/EasyMint.git
cd EasyMint
npm install
npm run dev          # Vite dev server + Electron
npm run build        # 生产构建
npm run lint         # ESLint + TypeScript 类型检查
```

需要 Node.js 环境。

---

EasyMint 以开源的 Pi Coding Agent 为引擎，提供完整的 Agent 编排、多角色协作与上下文管理能力；上层通过引导流程降低上手门槛，覆盖从想法到成品的主要路径。
