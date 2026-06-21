# Changelog

## v0.2.1 (2026-06-22)

- 重命名改为完整复制项目（含 node_modules 和 .git），保留 git 历史和依赖
- 异步复制 + 进度条动画，大项目不会卡死
- 自动同步 package.json 的 `name` 字段
- 复制失败自动清理半成品目录，不会残留
- CI Actions 全升级最新版（checkout@v6, setup-node@v6, upload-artifact@v7, download-artifact@v8, gh-release@v3）
- 新建项目名称输入框提示使用英文

## v0.2.0 (2026-06-22)

### 项目重命名
- 重命名弹窗：LeftToolbar「+」→「重命名项目」，输入新名称，二次确认后执行
- 全自动流程：完整复制项目目录 → 复制 SDK 会话数据 → 更新项目记录 → 重启 → 新进程清理旧目录
- 零外部依赖：纯 Electron + Node.js 内置 API（`fs.cpSync`、`app.relaunch`），macOS / Windows 跨平台
- 安全策略：copy-then-delete，验证通过后才删旧数据；失败自动回滚
- Mint 可调用：`rename_project` MCP 工具，和 UI 按钮走同一路径

### 项目管理增强
- 打开已有目录：「打开项目」弹窗加「浏览文件夹…」，首页加「打开已有目录」按钮，支持导入任意目录为项目
- 项目重新定位：文件夹在 Finder 中被移动或重命名后，TitleBar 红色提示「重新定位」，选择新路径自动迁移会话数据
- 项目列表显示目录是否存在的状态标记

### Mint 提示词优化
- 生命周期闭环：done 之后用户提新需求 → 自动切回 developing → 追加 task.json → 继续循环
- 决策树简化：两层判断（① 单文件微调 ≤ 20 行 → 自己改；② 其余 → 必须委派 Builder + 更新 UI）
- UI 工具解耦：`set_task_status` / `set_project_stage` 不再绑定 Builder，自行编码时也强制调用
- 新增 `<keep_ui_alive>` 指令：任何代码产出都要让用户通过进度条和任务列表感知

### UI 改进
- Fishbone 进度条：全部任务完成后横轴保持亮色渐变，不再变灰
- TitleBar 简化：纯状态展示（项目名 + 目录删除时重新定位入口）
- 图标规范：CLAUDE.md 新增 SVG 优先规则，降低 emoji 使用率

---

## v0.1.0 (2026-06-20)

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
