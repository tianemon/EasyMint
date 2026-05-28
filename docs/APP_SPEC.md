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
| AI 集成（自动化） | spawn Claude 子进程 + JSONL 流式解析 | Claude `--output-format stream-json` |
| AI 集成（Chat） | spawn Claude 子进程 + 双向 JSONL | Claude `--input-format stream-json --output-format stream-json` |
| 终端嵌入（P2） | xterm.js + node-pty | xterm 5, node-pty 1 |
| 数据存储 | `~/.easymint/` JSON 文件 | — |
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
- 左侧工具栏（新建、文件树、对话历史、Chat、设置含评估开关）
- 中上编辑区（文档/代码查看、文件树、对话历史、Chat 面板）
- 中下流式输出面板（JSONL 流式渲染，文本→Markdown、工具调用→可折叠卡片）
- 底部操作按钮：[启动开发] [启动评估]
- 右侧暂不规划

## 功能清单

### P0（没它不成立）
- 新建项目（复制模板到目标目录）
- 需求采集分步表单 → 生成 requirements.md
- 自动化模式：spawn Claude 子进程 + JSONL 流式渲染到 StreamPanel
- Chat 模式：长会话双向 JSONL 通信（替代终端中的自由对话）
- 暗色/亮色主题

### P1（核心体验）
- 项目列表管理（CRUD）
- 文件树浏览
- 对话历史管理（保存/resume）
- Claude CLI 自动检测
- 评估模式开关 + 自动触发 evaluator

### P2（后续做）
- 嵌入式终端（xterm.js + node-pty，Claude 原生 TUI）
- 对话历史搜索
- 项目导入（已有目录）
- 快捷键支持

### 本期不做
- 多模型支持
- 代码编辑器
- 远程协作
- 插件系统
- 多项目 Tab

## 设计风格

取"Mint"之意：**清爽淡绿，干净鲜活**。

- **暗色**：`#0d1f17` 深绿黑底，`#4ade80` mint 高亮，低对比度边框
- **亮色**：`#f5faf7` 白底淡绿，`#16a34a` 深绿强调
- **交互**：全局 cubic-bezier 过渡 0.2s，按钮/hover/焦点丝滑
- **滚动条**：6px mint 色调，圆角
- 默认暗色，亮色通过 settings 切换
- Radix UI 提供无障碍交互组件

## 数据存储

```
~/.easymint/
├── projects.json          # 项目列表
├── settings.json          # 用户设置（主题、评估模式等）
└── sessions/
    └── <project-id>/
        └── sessions.json  # 对话历史
```

## 参考项目

| 项目 | 路径 | 参考内容 |
|------|------|---------|
| ai-coding-automation-template | `ai-coding-automation-template/` | 模板项目（复制源），SETUP.md 流程 |
| Proma | `/Users/amon/dev/project/Proma` | Electron 架构、React UI 模式、SDKMessageRenderer.tsx 结构化渲染 |
| open-design | `/Users/amon/dev/project/open-design` | Claude CLI 检测、JSONL 流式解析（claude-stream.ts）、session 管理 |
