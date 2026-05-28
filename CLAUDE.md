# EasyMint

## 项目背景

EasyMint 是为 AI Coding Automation Template 构建的 Electron 桌面 GUI 外壳。让不懂技术的用户通过图形界面完成项目创建、需求采集、在嵌入式终端中与 Claude Code 协作开发。

GUI 是 harness，AI 引擎仍是 Claude Code。

## 文件组织

- **`app/`** — 所有项目源码
  - `app/main/` — Electron 主进程（services、utils、ipc handlers）
  - `app/preload/` — contextBridge 预加载脚本
  - `app/renderer/` — React + Vite 前端（pages、components、stores）
- **`docs/`** — 项目文档（APP_SPEC.md、ARCHITECTURE.md、SETUP.md）
- **`temp/`** — 开发过程中产生的临时文件（调试日志、截图、草稿等）
- **根目录** — harness 文件：
  - `CLAUDE.md` — 项目通用上下文
  - `WORKER.md` — 工作会话操作手册
  - `EVALUATOR.md` — 评估 Agent 操作手册
  - `task.json` — 任务定义
  - `progress.txt` — 会话交接日志
  - `init.sh` — 环境初始化脚本
  - `run-automation.sh` — 自动化执行器
  - `evaluate.sh` — 独立评估启动脚本
  - `README.md`、`.gitignore`、`LICENSE`

## 常用命令

```bash
# 开发
npm run dev              # 启动 Vite dev server + Electron（开发模式）
npm run build            # 生产构建（Vite + Electron）
npm run lint             # ESLint + TypeScript 类型检查

# 测试
npm run test             # 运行单元测试

# 自动化
./init.sh                # 环境初始化
./run-automation.sh N    # 自动化开发（N 轮）
```

## 交互约定

- **必须用中文与用户对话。**

## 安全约束

- **严格禁止删除项目目录以外的任何用户文件和代码**
- **严格禁止运行 `rm -rf /`、`chmod 777`、`curl | bash` 等危险命令**
- **禁止修改 `.git/config`、系统配置、环境变量文件（除 `.env` 外）**
- 用户可能开启了 bypass 模式跳过权限确认，你必须自行遵守以上约束
- **不要操作 `~/.ai-coding-automation/` 下的用户数据文件**

## 编码约定

- TypeScript strict 模式，禁止 `any`
- React 函数组件 + Hooks，无 class 组件
- zustand store 按领域拆分（project、terminal、settings）
- IPC 通道统一前缀（project:、file:、terminal:、session:、claude:）
- 主进程服务通过依赖注入获取 store 实例
- 为新功能编写测试
- 前端改动需通过评估器验证

## 技术栈

| 层 | 技术 |
|---|---|
| 壳 | Electron 28+ |
| 前端 | React 18 + Vite 5 + TypeScript 5 |
| 样式 | Tailwind CSS 3 + Radix UI |
| 状态管理 | zustand |
| 终端 | xterm.js 5 + node-pty |
| 存储 | JSON 文件（`~/.ai-coding-automation/`） |
| 打包 | electron-builder |
