# Shell 与子 Agent 面板体验修复方案

> 定稿：2026-08-25。场景：shell/子 Agent 输出面板的 4 个问题（供应商默认模型、日志无输出、复制与滚动、日志路径跳转）。

## 背景

用户反馈 4 个问题：

1. **自定义供应商编辑页没有默认模型的配置** — 只能配模型列表，无法指定默认模型
2. **shell 日志无输出** — 手动运行 shell 时建立了空日志文件但没有内容；后台运行 shell 时前端一直显示「等待输出」
3. **面板不能复制 + 滚动被锁定** — 子 agent 和 shell 运行面板内容无法选中复制；输出流式更新时无条件贴底，用户无法自由滚动查看历史
4. **标题栏缺日志路径** — shell 运行面板标题栏不显示输出文件地址，无法跳转到文件所在文件夹

## 方案

### 1. 自定义供应商默认模型（ProviderSettings.tsx）

- 根因：「模型(默认)」下拉包在 `{!isCustom && ...}` 内，自定义供应商分支缺失
- 改动：把该下拉移到条件外，两种模式都渲染；选项统一走 `availableModels`（自定义 = textarea 解析列表）
- `handleSave` 已写入 `cfg.model`（`model || modelList[0]`），保存链路无需改动

### 2. shell 日志空文件 + 等待输出（真根因：命令自带重定向）

**根因（2026-08-25 深夜实测确认）**：Mint 生成的背景命令自带 shell 重定向——
`cd ... && flutter run -d macos --debug > /tmp/macos_show2.log 2>&1`
输出全部被 shell 重定向走，registry 的 stdout/stderr 管道收不到任何数据 → 日志文件空 + 面板「等待输出」（实测 `/tmp/macos_show2.log` 有完整输出佐证）。运行面板（process:start）不带重定向，故输出正常。

**修复（提示词引导治本）**：
- 系统提示词 + 增强 bash 工具描述/guidelines/返回文本：明确「后台命令输出自动收集（面板实时显示/落盘/退出注入），**禁止手动重定向**（`> file 2>&1`、`| tee`、`nohup ... &`）——重定向绕过自动收集；读完整输出用 read 读返回的日志路径」
- ShellProcessView 面板兜底提示：运行中无内容时提示可能原因

**防御性修复（保留）**：decodeSeg 前缀即时输出（混非 UTF-8 字节不再吞输出）；日志改同步写（openSync/writeSync）运行中实时落盘

**用户决策（2026-08-25）**：不做「面板改文件轮询」和「重定向目标解析兜底」——曾评估两全方案（logPath 文件为唯一真相源 + 面板增量轮询，以及命令末尾重定向解析兜底），用户判断该功能非核心（偶尔查看），仅提示词约束即可。已知局限：提示词效力弱时 AI 重定向到非 logPath 路径，面板仍无输出（面板提示会说明可能原因）。

### 3. 面板复制 + 滚动控制（index.css + 三个弹层组件）

**根因**：`index.css` 全局 `user-select: none`，恢复可选白名单不含弹层内容区。

- 改动：给 ShellProcessView / SubagentProcessView / LogOverlay 内容区恢复 `user-select: text`

**滚动控制**（ShellProcessView / SubagentProcessView / LogOverlay 统一）：

- 内容更新时仅当「用户未滚离底部」才自动贴底（`distFromBottom < 8` 判定）
- 用户滚动（wheel/touch/mousedown）离开底部 → 停止跟随，可自由滚动
- 滚离底部时显示悬浮「回到底部」按钮 → 点击贴底 + 恢复自动跟随
- SubagentProcessView 已有跟随判定逻辑（autoScrollRef），补回底按钮即可；ShellProcessView / LogOverlay 无任何控制，按 ChatPanel 已有模式（`ChatPanel.tsx:413-492`）实现

### 4. 标题栏日志路径跳转（ShellProcessView + IPC）

- ShellProcessView 标题栏加 logPath 展示（font-mono 截断 + title 提示），点击 → 打开所在文件夹（不打开文件）
- 新增 IPC：主进程 `shell.showItemInFolder(logPath)`（校验路径存在）→ preload 暴露 `shell.revealInFolder` → vite-env.d.ts 类型

## 涉及文件

| 文件 | 改动 |
|------|------|
| `app/renderer/src/components/settings/ProviderSettings.tsx` | 默认模型下拉两模式共用 |
| `app/shared/prompts.ts` | 后台命令禁止手动重定向规则 |
| `app/main/services/background-shell/tool.ts` | 工具描述/guidelines/返回文本：输出自动收集、勿重定向 |
| `app/main/services/background-shell/encoding.ts` | decodeSeg 前缀输出修复（防御性） |
| `app/main/services/background-shell/registry.ts` | 日志同步写（防御性） |
| `app/renderer/src/index.css` | 弹层内容区 user-select 恢复 |
| `app/renderer/src/components/ShellProcessView.tsx` | 滚动控制 + 回底按钮 + 日志路径 + 空输出提示 |
| `app/renderer/src/components/SubagentProcessView.tsx` | 回底按钮 |
| `app/renderer/src/components/LogOverlay.tsx` | 滚动控制 + 回底按钮 |
| `app/main/ipc-handlers.ts` | shell:reveal-in-folder handler |
| `app/preload/index.ts` | revealInFolder API |
| `app/renderer/vite-env.d.ts` | 类型声明 |

## 验证

- `npm run lint` 全通过
- 实测：对话中让 AI 后台运行长命令（如 `npm run dev`）→ 日志文件运行中即有内容、面板实时输出、可复制、可自由滚动 + 回底、标题栏路径点击跳转文件夹
