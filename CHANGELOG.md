# Changelog

## v0.5.2 (2026-08-02) — Windows 窗口自绘 & UI 精致化

### 🪟 Windows 体验

- **自绘窗口按钮**：win32 隐藏系统标题栏（保留 Snap 布局/缩放/阴影），右上角自绘最小化/最大化/关闭按钮——主题跟随（亮暗自动适配）、最大化状态图标联动、关闭按钮 hover 红色（Windows 惯例）
- **移除默认菜单栏**：Windows/Linux 不再显示 Electron 默认 File/Edit/View/Window 菜单
- **字体渲染适配**：中文字体回退栈（PingFang SC / 微软雅黑）+ 小字号 12→13px（雅黑可读性）
- **布局对齐**：顶部拖拽区与 macOS 一致、TabBar 空态可拖拽、项目名称固定宽度超长 hover 滚动

### 🎨 UI 精致化

- **右键菜单**：宽度完全内容自适应、hover 高亮贴合圆角
- **删除项目确认**：EM 风格弹窗（提示移动到回收站/废纸篓，平台自适应）
- **浏览文件夹打开项目**：与列表点击一致，提示当前/新窗口
- **聊天区拖放上传**：拖入图片/文档不再触发系统打开文件
- **图标升级**：下拉菜单/空会话图标换 Lucide 素材（folder-plus/folder-open/pencil/copy/message-square）
- **Onboarding 风格对齐**：特性卡片 card 层、Logo 卡片容器、步骤指示器语义层

### 🔧 修复

- 关闭按钮 hover 红背景被 surface-hover 覆盖、空 tab 时 tab 栏不可拖拽、WindowControls 双挂载、项目名称过长顶走新建按钮

---
## v0.5.1 (2026-08-01) — 内容便签

### 📌 内容便签（v1-v5）

- **悬浮便签卡片**：AI 总结的大段内容可钉成悬浮卡片固定在聊天区，随时查看（会话级持久化，切换会话/重启不丢失）
- **双钉住入口**：消息气泡操作条一键钉整条；右键菜单（复制/全选/钉住）——选中文字钉住自动还原 Markdown（列表/标题/代码/加粗）
- **可调大小**：四周边缘/拐角自由拖拽调整尺寸，位置与大小持久化
- **书签式贴纸**：拖到边缘自动吸附折叠成彩色贴纸（左右边缘、8 色调色板随机分配不重复）；同边层叠可见（hover 抽出横条显示标题）；点击展开回卡片
- **重复检查**：同内容重复钉住自动拒绝并提示
- **吸附动画**：折叠/展开平滑过渡（贴纸滑入淡入、卡片缩放展开）
- **气泡操作条**：复制/钉住一体化工具条，hover 消息显示、离开 1s 缓冲
- **交互细节**：拖到边缘自动吸附、贴纸贴紧边缘单侧圆角、沿边拖动单独吸附、手动叠放自动错开

### 🎨 UI 微调

- 用户头像改为与 Mint 同风格（同底色仅字母区分），头像放大 20%
- 用户消息上方增加 USER 名称标签

---
## v0.5.0 (2026-07-31) — v3 UI 全面改版 & 上下文压缩增强

### 🎨 v3 UI 改版

- **布局**：三栏合并为双栏——250px 固定侧边栏 + 主区，纯色差分层（无分割线）
- **Layer 色彩体系**：L0-L4 层级色（canvas/sidebar/content/card/elevated），阴影代替边框区分
- **侧边栏**：项目名+菜单（新建/打开/重命名项目/新建窗口）、会话|文件 tabs、底部抽屉（任务/Issue/运行，点击外部关闭）、主题三模式切换
- **TabBar**：固定宽度、常显关闭按钮、flex 压缩（至 60px 下限）、marquee 滚动（标题超出时）
- **消息区**：M/U 头像+来源标签、悬浮复制按钮、气泡对齐原型（去边框、阴影分层）
- **会话列表**：今天/之前/更早分组（7 天边界）、时间移到标题右侧、项目会话圆点/设计会话菱形点
- **主题切换**：View Transitions 扩散动画（亮→暗左下角圆形揭开，暗→亮右上角）
- **编辑器**：暖乳白色系（去冷灰/绿）、Monaco 语法高亮 CSS 变量化、markdown 标题标准 token 修正
- **文件树**：folder/folder-open/file 图标（Lucide），展开状态视觉切换

### 🤖 上下文压缩增强

- **主动压缩**：上下文使用率达到阈值（默认 75%，设置可调）提前触发 compact——不等 Pi 自动压缩（近 100% 时性能已下降）
- **压缩状态机修复**：type 值不匹配（manual/compact）、compacting 永不清除（会锁死输入框）
- **轮转链路修复**：前端事件断链（rotate-create 从未广播）、Pi 原生摘要未接入 summaryBuffer（轮转从未真正执行）
- **轮转进度提示**：归档+新会话期间显示"正在整理并开启新会话..."

### ⚡ 性能

- **消息列表虚拟化**（@tanstack/react-virtual）：长对话 DOM 从数千节点降到 ~30，动态测量
- **busy 穿透优化**：回合切换时全量重渲染从 N 条降到 1 条
- **虚拟化 HMR 防御**：容器 state 驱动 + measure 兜底，开发模式热更新不丢状态

### 🔧 修复

- **会话置顶无效**：togglePin 返回 void 导致前端状态未更新
- **用户气泡布局**：flex 压缩导致逐字换行/位置乱飘（中文 min-content 陷阱）
- **打开会话不在底部**：虚拟化测量异步 + smooth 动画中断 autoScroll 误判
- **编辑器绿色调**：monaco 变量亮色全绿 + 主题切换不更新
- **md 标题红色**：Monaco 内置 markdown 标题 token 是 keyword（已修正为标准 markup.heading）
- **flushSync 报错**：虚拟化 measureElement 在 commit 阶段触发（useFlushSync: false）

### 🧹 工程

- **死代码清理 4 轮**（-2500+ 行）：v2 遗留组件/页面、快捷命令死链路、safe-path、terminal 死链
- **lint 全绿**：no-var 26 处、tsc 既有错误、any 类型化
- **模块拆分**：chat-utils.ts（纯函数层）、rotation.ts（轮转状态机，依赖注入）
- **Pi SDK 对照表更新**：按实际代码核对，标注自定义实现清单
- **Mint 项目进度链路清理**：set_project_stage 工具全链路删除（提示词 12 处引用、builtin-mcp、hooks 校验、白名单、前端监听、store 残留）——Mint 不再更新鱼骨图面板
- **MintButton 残留**：agent:notifySession 死链删除（前端 0 调用）
- **state.json 死链**：stage 体系删除后 readState/writeState IPC/preload/类型/提示词注释全清理
- **打包签名修复**：brand-tokens/linear.app 被 codesign 误判为 bundle（mac.signIgnore）
- **测试修复**：store 测试文件名（settings.json → em-settings.json，历史改名遗留）

### 📄 文档

- **CHANGELOG/README/开发进度**：v0.5.0 全量记录、README 鱼骨图描述更新、开发进度新增第 9 章

## v0.4.1 (2026-07-30) — UI 细节优化 & Mint-D 增强

### 🎨 UI 细节优化

- **动画**：Tab 切换淡入淡出、按钮 transition 收窄（仅 colors/opacity/transform）、聊天平滑滚动、session 列表入场动画
- **色彩**：语义色补充 soft 层（danger/success/warning-soft）、暗色模式 warning/info 恢复语义色、文件树背景改为 bg-surface-alt
- **图标**：右侧栏图标全部换为语义化 SVG（看板/感叹号/播放圆圈）、README 图标路径修正
- **性能**：ChatPanel 消息 memo、zustand selector 细粒度化（避免 runningSessions 变化触发整页重渲染）、lastToolUses 用 useMemo 缓存

### 🤖 Mint-D 增强

- **品牌库**：内置 74 个品牌的 DESIGN.md（Airbnb、Stripe、Apple 等），创建设计会话时自动复制到 `.easymint/brand-tokens/`
- **品牌库被动参考**：Mint-D 知道品牌库存在但不主动读取，用户需要时列出候选品牌

### 🔧 修复

- **状态栏**：工具操作详情恢复（"检查代码: ChatPanel.tsx"、"执行: npm build"），不再被文本消息清空
- **MemoChatMessage**：hooks 顺序修复（React 严格模式报错）
- **displayToolLabel**：适配 Pi 小写工具名（read → 读取文件）
- **运行面板**：刷新按钮点击旋转动画
- **引导页**：图标路径修正

### ⚙️ 工程

- **Provider 重构**：适配 Pi 内置 Provider，使用静态 JSON 数据，去掉自定义路径/registerProvider
- **引导页**：图标路径修正、与设置页供应商表单保持一致

## v0.4.0 (2026-07-29) — Pi SDK 迁移

### 🏗️ AI 引擎迁移

Claude SDK (`@anthropic-ai/claude-agent-sdk`) → Pi SDK (`@earendil-works/pi-coding-agent` v0.82.1)：

- `agent-service.ts`：`query()` + message channel → `createAgentSession()` + `session.subscribe()` + `session.prompt()`
- `event-bridge.ts`：Pi 的 `AgentSessionEvent` → 前端 `PiChatEvent` 格式转换，`messageToBlocks` 统一处理 text/toolCall/thinking
- `pi-sdk.ts`：ESM-only 动态 import 懒加载 wrapper
- `pi-session.ts`：`createPiSession` / `resumePiSession` 工厂函数，`customTools` + `codingTools` 组装
- 全局配置路径：`~/.easymint/` → `~/.easymint/`
- 会话存储：`~/.easymint/sessions/<编码路径>/`
- 删除：`claude-detector.ts`、`notify.ts`、`pi-chat-event.ts`、Claude SDK 依赖

### 🔧 流式输出修复

Pi SDK 的 `message_update` 携带累计全文，但原 `replaceAiEntries` 在多轮工具调用时互相覆盖：

- `chat-store.ts`：新增 `replaceAiEntriesFrom(sid, fromIdx, entries)`，按 turn 边界保留旧内容
- `ChatPanel.tsx`：`turnEntryIdxRef` 追踪 turn 边界，`message_start` 作为新 turn 信号
- `event-bridge.ts`：新增 `message_start` 处理，`messageToBlocks` 统一转换 `toolCall` → `tool_use`

### 🛡️ 权限系统修复

- `wrap-tool.ts`：`displayToolName` 变形（如 `Bash(echo hello)`）导致 `canUseTool` 匹配全失效，改为原始名匹配 + displayName 分离
- `permission-rules.ts`：10 个内置 easymint-ui MCP 工具加入 `SAFE_TOOLS` 白名单（Pi SDK `customTools` 无 `mcp__` 前缀）
- `ChatPanel.tsx`：修正 `show_confirm_dev` / `show_new_project` 按钮检测的工具名
- `event-bridge.ts`：新增 `tool_execution_start` 处理，所有工具执行时状态栏显示工具名

### 🎭 角色模板修复

- `agent-service.ts`：选模板时用模板 prompt **替代**默认 Mint prompt，不再叠加两套身份（Mint 架构师 vs Mint-D 设计师 平行独立）

### 📁 路径修正

项目级 `.easymint/` 被批量错写为全局 `.easymint/`：

| 文件 | 错误 | 修正 |
|------|------|------|
| `process-service.ts` | `<project>/.easymint/run.json` | `<project>/.easymint/run.json` |
| `issue-service.ts` | `<project>/.easymint/issues.json` | `<project>/.easymint/issues.json` |

### 🚦 状态栏优化

- 纯文本到达时自动清除"正在请求..."和旧工具标签
- 工具完成后 LLM 继续返回文本时，状态栏不再显示已完成的工具名

### 🔒 多 Tab 事件隔离

- `ChatPanel.tsx`：`event.runId` 在 `PiChatEvent` 中永远为 `undefined`，导致 `&&` 短路 → `chatId` 过滤失效。改为 `runId`/`chatId` 独立判断

### 📝 文档更新

- `docs/开发进度.md`：新增 v0.4.0 条目
- `docs/技术架构.md`：SDK 名、路径、MCP 工具清单补全、Hook → canUseTool
- `docs/design/CONFIG_PATHS.md`：全局目录树重建、settings.json 重写、项目目录补全
- `docs/design/AGENT_SYSTEM.md`：Layer 0 描述、Agent 通信方式更新
- `CLAUDE.md`：AI 引擎、存储路径、SDK API 描述
- `README.md`：徽章、链接、技术栈全部更新至新仓库

### 🤖 CI/CD

- `.github/workflows/release.yml`：tag push (`v*`) 触发 macOS + Windows 双平台自动构建发布
- 新仓库 `tianemon/EasyMint-Pi-Core`

---

## v0.3.0 (2026-06-25)

- Skill 注入机制改造（两层分级：EM_SKILLS vs BUNDLED_SKILLS）
- Hook 校验系统（PreToolUse 状态一致性校验）
- Compact 体验优化（状态显示 + 输入框蒙版）
- 会话历史直读 JSONL（不受 compact parentUuid 链限制）
- 多个 Bug 修复（新建项目跳转、会话删除复活、MCP 热刷新等）
