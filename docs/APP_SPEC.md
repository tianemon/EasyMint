# EasyMint — 需求规格

## 项目概述

EasyMint 是为 AI Coding Automation Template 构建的 **Electron 桌面 GUI 外壳**。让不懂技术的用户通过图形界面完成项目创建、需求采集、AI 协作开发的全流程。

GUI 是 harness，不是替代品。AI 引擎仍是 Claude Code。

## 已锁定技术栈

| 层 | 选择 | 版本要求 |
|---|---|---|
| 壳 | Electron | >= 28 |
| 前端 | React + Vite + TypeScript | React 18, Vite 5 |
| 样式 | Tailwind CSS + Radix UI | Tailwind 3, Radix latest |
| 状态管理 | zustand | latest |
| 终端嵌入 | xterm.js + node-pty | xterm 5, node-pty 1 |
| 数据存储 | `~/.ai-coding-automation/` JSON 文件 | — |
| AI 集成 | 本地 `claude` CLI | 严格绑定 |
| 打包分发 | electron-builder | latest |

## 页面/模块结构

### HomePage — 项目列表
- 已有项目卡片列表（名称、路径、上次打开时间）
- 空状态引导文案
- [新建项目] 按钮 → 弹窗输入名称、选择目录

### SetupPage — 需求采集
- 4 步分步表单（对应 SETUP Phase 1-3）：
  1. 项目概述（做什么、给谁用、平台、完成度期望）
  2. 技术偏好（技术栈偏好、成本敏感度、功能清单 P0/P1/P2）
  3. 功能清单详情（逐项确认）
  4. UI 风格（iOS 液态玻璃 / 新拟物 / Material Design / 黑白极简 / 毛玻璃）
- 提交后生成 `requirements.md` 写入项目目录

### ProjectPage — 项目工作台
- 左侧工具栏（新建、文件树、对话历史、终端、设置）
- 中上编辑区（文档/代码查看，本期占位）
- 中下终端区（xterm.js，多 Tab）
- 右侧暂不规划

## 功能清单

### P0（没它不成立）
- 新建项目（复制模板到目标目录）
- 需求采集分步表单 → 生成 requirements.md
- 嵌入式终端（xterm.js + node-pty）
- Claude Code 启动（`claude` 命令写入 PTY）
- 暗色/亮色主题

### P1（核心体验）
- 项目列表管理（CRUD）
- 文件树浏览
- 对话历史管理（保存/resume）
- Claude CLI 自动检测
- 多终端 Tab

### P2（锦上添花）
- 对话历史搜索
- 项目导入（已有目录）
- 快捷键支持
- 系统托盘

### 本期不做
- 多模型支持
- 代码编辑器
- Chat 模式
- 远程协作
- 插件系统
- 多项目 Tab

## 设计风格

默认暗色主题 + 亮色可选。参考 VSCode / Warp 终端风格：深色背景、低对比度边框、等宽字体终端区。Radix UI 提供无障碍交互组件。

## 数据存储

```
~/.ai-coding-automation/
├── projects.json          # 项目列表
├── settings.json          # 用户设置（主题、默认目录等）
└── sessions/
    └── <project-id>/
        └── sessions.json  # 对话历史
```

## 参考项目

| 项目 | 路径 | 参考内容 |
|------|------|---------|
| ai-coding-automation-template | `ai-coding-automation-template/` | 模板项目（复制源），SETUP.md 流程 |
| Proma | `/Users/amon/dev/project/Proma` | Electron 架构、React UI 模式、workspace 管理 |
| open-design | `/Users/amon/dev/project/open-design` | Claude CLI 扫描检测、session 管理 |
