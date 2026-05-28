# EasyMint

AI 项目工作台 — 让不懂技术的人也能用 Claude Code 构建软件。

## 这是什么

EasyMint 是一个 Electron 桌面应用，为 AI Coding Automation Template 提供图形界面。你通过分步表单描述需求，在嵌入式终端里与 Claude Code 对话，AI 自动完成开发。

**不需要懂代码。** 只需要会打字。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron |
| 前端 | React + Vite + TypeScript |
| 样式 | Tailwind CSS + Radix UI |
| 终端 | xterm.js + node-pty |
| AI 引擎 | Claude Code CLI |

## 前提条件

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code](https://claude.ai/code) CLI（需在 PATH 中可用）

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式
npm run dev

# 生产构建
npm run build
```

## 项目结构

```
EasyMint/
├── app/
│   ├── main/         # Electron 主进程
│   ├── preload/      # contextBridge 预加载
│   └── renderer/     # React 前端
├── docs/             # 项目文档
├── task.json         # 开发任务定义
├── init.sh           # 环境初始化
└── run-automation.sh # 自动化开发
```

## 自动化开发

EasyMint 自身也使用 AI Coding Automation 流程开发：

```bash
./init.sh                # 初始化环境
./run-automation.sh 5    # 自动执行 5 轮开发
```

## License

MIT
