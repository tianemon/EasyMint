# EasyMint

AI 项目工作台 — 让不懂技术的人也能用 AI 构建软件。

## 这是什么

EasyMint 是一个 Electron 桌面应用，通过图形界面 + AI Chat 帮你完成项目创建、需求分析、代码开发的全流程。
你只需要打字描述想法，AI 会像产品经理和工程师一样引导你、帮你实现。

**不需要懂代码。**

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron |
| 前端 | React + Vite + TypeScript |
| 样式 | Tailwind CSS + Radix UI |
| 编辑器 | Monaco Editor (VS Code 同款) |
| AI 引擎 | Claude Agent SDK (长生命周期进程 + 消息通道) |
| 状态管理 | zustand |
| 存储 | JSON 文件（`~/.easymint/`） |

## 快速开始

```bash
npm install
npm run dev        # 开发模式
npm run build      # 生产构建
```

安装后打开应用，配置 API Key 即可使用。不需要安装 Claude Code CLI。

## 项目结构

```
EasyMint/
├── app/
│   ├── main/          # Electron 主进程 (services, utils, ipc)
│   ├── preload/       # contextBridge 预加载
│   ├── renderer/      # React 前端 (pages, components, stores)
│   └── shared/        # 共享类型和工具
├── resources/         # 内置 Skill 模板
│   └── skills/        # plan-first, requirement-breakdown 等
├── shared/            # 跨进程提示词集中管理 (prompts.ts)
├── docs/              # 项目文档
└── template/          # 新建项目时复制的模板
```

## 主要功能

- **Chat 驱动开发** — Mint AI 助手引导需求分析、技术选型、任务拆解
- **Skill 管理** — 内置 4 个 Skill（plan-first / requirement-breakdown / describe-image / web-verify），支持导入和自定义
- **MCP 管理** — 与 Claude Code 共享 MCP 服务器配置，支持 API Key 管理
- **图片/文档上传** — 支持粘贴、拖拽、多文件，分离式附件预览
- **Fishbone 进度面板** — 六阶段鱼骨图指示器 + 任务时间轴 + 万能推进按钮
- **Monaco 编辑器** — VS Code 同款引擎，HTML/CSS/JS/TS/JSON/Markdown 全语法高亮
- **多窗口支持** — 每个项目独立窗口，Tab 管理

## License

MIT
