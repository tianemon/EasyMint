# Changelog

## 0.1.0 (2026-06-20)

EasyMint 首个正式版本。基于 claude-agent-sdk 的桌面开发工具，通过 Mint（PM/架构师）、Builder（编码）、Evaluator（验收）三 Agent 协作，让不懂技术的人也能构建软件。

### 核心功能
- 项目管理：创建、删除、多项目切换
- 需求采集：新建项目表单 — 名称、描述、目标用户、功能清单、技术偏好、设计风格、AI 集成
- 项目场景自动检测：Web / 桌面 / CLI / API / 库，按维度自动组合技术方案和验收策略
- 任务系统：task.json 驱动开发，Builder 编码 → Evaluator 验收循环，TDD 可选
- 文件面板：项目文件树浏览、代码编辑（Monaco Editor）
- 多窗支持：同项目可开多个窗口，独立会话

### AI 能力
- Mint/Builer/Evaluator 三 Agent 协作，提示词分层——通用/Mint/subagent 各司其职
- 系统提示词强化：代码块语言标注、大文件写入拆分、CLAUDE.md 维护指引、交付完整性要求
- 时间感知：每条消息注入精确时间上下文（模型可见，用户不可见）
- 上下文管理：compact 优先（最多 3 次），失败后兜底轮转
- 内置 ponytail/ponytail-review/ponytail-audit 三个 Skill

### 交互体验
- 快捷命令面板：`/` 触发或工具栏按钮，按分组表格展示，中文描述，动态同步 SDK 命令
- 状态栏独立组件，密集更新不牵连 ChatPanel 渲染
- 流式事件密集时避免冗余 React state 更新
- Tab 系统支持无限标签，等分压缩 + 触底滚动
- QuickPrompts 快捷 Skill 入口

### 基础设施
- API 配置：多供应商切换、模型选择、权限模式、上下文阈值设置
- CI/CD：GitHub Actions 三平台构建（macOS/Win），自动发布 + CHANGELOG 驱动 Release Notes
- 本地优先：JSON 配置 + JSONL 追加日志，无本地数据库
- 20 处空 try/catch 清理，本地文件操作错误自然暴露
- 自定义日志、死旗、零引用依赖全部清理
