# Changelog

## v0.3.4 (2026-06-26)

### 环境检测修复
- npx / CodeGraph 在打包版中检测失败：它们是 node 脚本，执行时 env 需在 PATH 找到 node，但 GUI 应用的 PATH 不含 Homebrew 目录
- execSync 传入补全的 PATH（/opt/homebrew/bin、/usr/local/bin），三件套检测均正常

### 缓存管理修复
- 安装包缓存小于 1MB 视为无缓存（electron-updater 元数据残留不算），不再误显示「0.0 MB」
- 打开文件夹时目录不存在回退到临时目录，不再静默失败

### 自动更新
- 下载进度显示已下载/总大小（如 90.1 MB / 200.3 MB）
- 设置按钮更新菜单移至按钮上方左对齐

## v0.3.3 (2026-06-26)

### 缓存管理
- 整合更新缓存和上传缓存为统一的「缓存管理」区
- 打开设置自动扫描缓存大小（MB），不再列出单独文件
- 有缓存时显示大小 +「打开文件夹」按钮（跳转 Finder 手动查看/清理）
- 无缓存时显示「暂无缓存」

### 环境检测修复
- 打包版应用 PATH 受限导致 Node.js / npx / CodeGraph 检测失败
- 追加 Homebrew（/usr/local/bin、/opt/homebrew/bin）等多路径扫描

## v0.3.2 (2026-06-26)

### 自动更新
- 接入 electron-updater，对接 GitHub Releases 实现应用内自动更新
- 启动后 10s 首次检测，之后每 4 小时自动检测一次
- 检测到新版本立即在设置按钮显示红点，后台自动下载
- 下载中点击红点弹出「有新版本 vX.X.X」→ 跳转关于页查看实时进度
- 下载完成后菜单变为「重启升级到 vX.X.X」→ 点击安装并重启
- 下载进度精确显示（electron-updater 流式进度回调）
- 关于页版本号动态读取、手动检测刷新按钮、下载进度条
- macOS：shell 脚本解压替换 app，绕过 ShipIt 签名校验
- Windows：NSIS 原生差量更新，无需额外处理
- 设置页通用 tab 新增更新缓存清理按钮

## v0.3.1 (2026-06-25)

- 修复自定义平台保存失败（选择「自定义」时误报「请选择平台」）
- 添加/编辑供应商改为独立弹窗，保存按钮始终可见

## v0.3.0 (2026-06-25)

### Skill 注入机制
- EM 内置 Skill 不再 seeding 到 ~/.claude/skills/，改为直接扫描 resources/skills/，CC 无法读取
- 两层分级：`EM_SKILLS`（EM 专用，仅 builtin）和 `BUNDLED_SKILLS`（ponytail 等第三方，全局优先、builtin 兜底）
- 新增 `ui-sync` Skill：用户表达新需求时自动触发，同步 UI 状态（task 追加、stage 切换、MCP 调用时机）
- 种子逻辑只装 BUNDLED_SKILLS 到全局（已有则跳过），EM 专用技能永不泄露

### 开发流程防护
- PreToolUse Hook 四条校验规则：building 前检查其他任务是否结束、evaluating 必须 preceded by building、failed 必须 preceded by building/evaluating、done 前所有任务必须完成
- EM 自有 MCP 工具 bypass auto-mode 分类器，不被误拦

### Compact 体验
- 自动 compact 时广播状态 + 设 busy："正在整理会话..."全程显示直到 compact 完成
- 输入框加毛玻璃蒙版，禁用输入 + 文案"Mint 正在总结对话，请稍后…"
- Compact 完成后 toast 提示"会话已整理完毕"（3 秒）
- Compact 状态在 compact_boundary 到达时正确清除

### 会话历史
- `getSessionMessages` 从调 SDK 改为直接读 JSONL，全量消息加载
- 不受 compact 的 parentUuid 链限制，旧历史可正常回显
- 只过滤 isMeta，其他消息全部保留

### 其他修复
- 新建项目后跳转空白问题：handleCreate 改为轮询 conv.messages 等 `[系统消息] 项目已创建完毕` 落盘
- 会话删除防复活：先 killChat 再 deleteSession，切项目/切换项目时正确关闭 query
- 关闭 Tab 10 分钟无输入自动回收 query（scheduleIdleTimeout）
- 已有项目时打开/新建弹出窗口选择弹窗（当前窗口 / 新窗口）
- Markdown 渲染：装 @tailwindcss/typography + 暗色模式 prose 覆盖
- resume 时注入最新 EM 提示词 + setMcpServers 刷新 MCP 工具清单
- thinking 块标题"思考中"→"思考过程"
- 提示词精简：删除 keep_ui_alive 块，步骤 6 强调必须先调 done

## v0.2.4 (2026-06-23)

- 消息气泡溢出修复（长文本自动换行、overflow-x-hidden 防止撑宽）
- 流式等待期显示加载占位泡，消除空白行
- 会话手动重命名后不再被自动命名覆盖
- Bash 标签统一「执行: cmd」
- README 补充定位描述 + Claude Agent SDK 徽章

## v0.2.3 (2026-06-23)

- SDK 升级到 0.3.186（17 个版本更新），适配 tool_use_meta/model_fallback/worker_shutting_down

### 状态栏优化
- 对齐 SDK 事件：api_retry 显示「正在重试...」、compacting 「整理上下文中...」、compact_boundary 「上下文已压缩」
- 区分 requesting（正在请求）和 thinking（正在思考），不再混用
- 工具调用的状态标签根据文件类型/命令内容显示差异化文案（如「加载配置: package.json」、「委托 Builder 编码」）
- 思考块关闭时不占空白位；状态栏在 exit/cleanup/mount 三处重置，不会残留

### 输入体验
- 输入区抽为独立组件，流式输出密集时不卡输入框
- 支持粘贴文档（Ctrl+V）
- 输入历史（↑↓）完整保留

### UI 修正
- 面板宽度从比例制改为固定像素（左 260px / 右 280px），窗口缩放不影响两侧
- 拖拽手柄热区 hover 扩张，滚动条 8px，不再与滚动条冲突
- Bash 命令标签显示完整命令、MCP 工具显示「调用 MCP」

### 工程
- CLAUDE.md 加 Git 提交与推送分离规则
- 版本号徽章、AGPL 3.0 协议

## v0.2.2 (2026-06-22)

- 消息原样显示，不做任何XML标签剥离和过滤
- 移除 `<current_time>` 时间注入
- 会话改名/自动命名时同步更新Tab标题
- 输入框支持粘贴文档（Ctrl+V）
- 面板宽度从比例制改为固定像素制（左260/右280），窗口缩放只影响中间区域
- 拖拽手柄热区 hover 扩张，滚动条 8px
- README 优化：shields.io 徽章、AGPL 协议、SDK 同源说明
- CLAUDE.md 加 Git 提交与推送分离规则

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
