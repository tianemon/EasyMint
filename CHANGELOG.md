# Changelog

## v0.0.4 (2026-06-20)

### 新增
- 快捷命令面板：支持 `/` 触发或工具栏按钮打开，按分组表格展示 SDK 全部命令，中文描述
- 时间感知：每条消息注入精确时间上下文（模型可见，聊天列表自动过滤）
- 提示词增强：新增「输出与协作规范」规则 — 代码块语言标注、大文件写入拆分、CLAUDE.md 维护指引、交付完整性要求
- 上下文压缩阈值改为优先 compact（最多 3 次），失败后兜底轮转
- Builder Agent 新增大文件拆分规则

### 优化
- 命令列表动态同步：启动时从 SDK 拉取，运行时通过 `commands_changed` 推送更新
- 状态栏抽成独立 StatusBar 组件，密集更新不牵连 ChatPanel 整体渲染
- 流式事件密集时避免冗余 React state 更新导致卡顿

### 修复
- 清理 20 处空 try/catch，本地文件操作错误不再被静默吞掉
- contextThreshold 持久化修复（writeEmSettings 漏写该字段）
- 新建会话 onStream 事件被拦截导致一直显示「思考中」
- resolveModel 去掉 /pro/i 限制，supportsContext1M 已控制开关
- 会话点击时不再重复创建 Tab
- StatusBar 错位修正（移到 attach preview 上方，去背景残留）

### 移除
- 所有自定义日志（console.log/log/sdlog/dlog/console.error）
- tddMode 和 screenshotVerification 两个未接入逻辑的预留开关

---

## v0.0.3 (2026-06-17)

### 新增
- 内置 ponytail/ponytail-review/ponytail-audit 三个 Skill
- QuickPrompts 集成 ponytail 入口

### 优化
- 系统提示词分层——通用/Mint/subagent 各司其职，去重复
- CLAUDE.md 只保留三方通用内容，其余挪到 Mint 提示词
- 消除重复代码——抽 getWorkspaceDir、resolveHome、IMAGE_MIME 共享函数
- 任务/项目状态由 Mint MCP 工具实时驱动，替换轮询

### 修复
- Fishbone 全部完成时不再将第一个节点错误聚焦
- set_project_stage(done) 最后一个节点颜色修正
- 新建窗口内置会话状态栏不显示
- Monaco Editor web worker 加载失败
- 翻译会话删除泄漏 + 滚动卡顿
- 整合 ipc-handlers 统一 import

### 移除
- 7 个零引用依赖

---

## v0.0.2 (2026-06-16)

### 新增
- 新建项目表单新增 AI 集成选项，init 改用 composeProfile 组合维度
- UI 按钮由 Mint MCP Tool Call 驱动，替代关键词匹配
- 项目场景自动检测——Web/桌面/CLI/API/库，6 种产品形态

### 优化
- 模板系统升级——从 6 个静态 Profile 重构为多维度组合引擎
- ask() 改为 chat-store 作为唯一消息通道，消除消息丢失
- init 消息精简——基础流程在 Mint 提示词中，只追加场景差异

### 修复
- 创建项目时立即写入 init 消息到 store，消除跳转空白
- loadSession 改为合并而非覆盖，handleCreate 预写入不丢失
- TabBar 宽度计算修正——按比例压缩，60px minWidth 触底后滚动

---

## v0.0.1 (2026-06-10)

### 新增
- 初始发布：Electron 桌面应用，基于 claude-agent-sdk
- 项目管理：创建、删除、多项目切换
- 需求采集：新建项目表单——名称、描述、目标用户、功能清单、技术偏好、设计风格
- AI 对话：ChatPanel 流式聊天，Mint/Builer/Evaluator 三 Agent 协作
- 任务系统：task.json 驱动开发，Builder 编码 → Evaluator 验收循环
- 文件面板：项目文件树浏览、代码编辑
- 设置面板：API 配置、模型切换、权限模式
- 多窗支持：同项目可开多个窗口
- CI/CD：GitHub Actions 三平台构建（macOS/Windows/Linux）
