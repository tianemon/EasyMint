# EasyMint

AI 项目工作台 — 让不懂技术的人也能用 AI 构建软件。

## 这是什么

EasyMint 是一个 Electron 桌面应用。你只需要打字描述想法，AI 项目经理（Mint）会引导需求分析、技术选型、拆解任务，然后调度 Builder（编码）和 Evaluator（验收）自动完成开发。

**不需要懂代码。**

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron |
| 前端 | React + Vite + TypeScript |
| 样式 | Tailwind CSS |
| 编辑器 | Monaco Editor (VS Code 同款) |
| AI 引擎 | Claude Agent SDK (长生命周期消息通道) |
| 状态管理 | zustand |
| 存储 | JSON 文件（`~/.easymint/`） |

## 快速开始

```bash
npm install
npm run dev        # 开发模式
npm run build      # 生产构建
```

安装后打开应用，配置 API Key 即可使用。内置 Claude Agent SDK，无需额外安装。

## 项目结构

```
EasyMint/
├── app/
│   ├── main/          # Electron 主进程 (services, utils, ipc)
│   ├── preload/       # contextBridge 预加载
│   ├── renderer/      # React 前端 (pages, components, stores)
│   └── shared/        # 共享类型、提示词、平台预设
├── resources/skills/  # 内置 Skill 模板
├── docs/              # 项目文档
└── template/          # 新建项目时复制的模板
```

## 主要功能

### 核心流程
- **Chat 驱动开发** — Mint AI 助手引导需求分析、技术选型、任务拆解
- **Builder/Evaluator 多 Agent** — Mint 只负责"想"，Builder 负责"写"，Evaluator 负责"验"。三角色各司其职，自动化推进
- **Fishbone 进度面板** — 六阶段进度条 + 任务状态时间轴。Mint 实时更新（`set_task_status` / `set_project_stage`）
- **快速启动模式** — 用户说"直接开始"跳过文档，直接生成 task.json 开发

### 会话管理
- **多窗口** — 每个项目独立窗口，Tab 管理
- **会话归档/置顶** — 时钟按钮弹出归档列表，可继续聊天
- **上下文轮转** — 自动检测用量，超阈值总结并切换新会话
- **图片/文档上传** — 粘贴、拖拽、多文件，分离式附件预览

### AI 能力
- **Skill 管理** — 与 Claude Agent SDK 共享 Skill。内置 6 个：
  `plan-first`、`requirement-breakdown`、`easymint-guide`、`ponytail`、`ponytail-review`、`ponytail-audit`
- **快捷提示词** — 聊天输入框旁一键触发精选 Skill
- **MCP 管理** — 与 Claude Agent SDK 共享 MCP 配置。内置图片识别（`describe_image`）和网页抓取（`web_fetch`）
- **多平台 API** — 支持 Anthropic / DeepSeek / GLM 等多供应商，带余额查询

### 开发体验
- **Monaco 编辑器** — VS Code 同款引擎，多语言语法高亮
- **终端面板** — 内嵌 xterm，项目目录即开即用
- **文件树** — 项目目录浏览，点击即编辑

## License

MIT
