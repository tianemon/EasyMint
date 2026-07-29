# Changelog

## v0.4.0 (2026-07-29) — Pi SDK 迁移

### 🏗️ AI 引擎迁移

Claude SDK (`@anthropic-ai/claude-agent-sdk`) → Pi SDK (`@earendil-works/pi-coding-agent` v0.82.1)：

- `agent-service.ts`：`query()` + message channel → `createAgentSession()` + `session.subscribe()` + `session.prompt()`
- `event-bridge.ts`：Pi 的 `AgentSessionEvent` → 前端 `PiChatEvent` 格式转换，`messageToBlocks` 统一处理 text/toolCall/thinking
- `pi-sdk.ts`：ESM-only 动态 import 懒加载 wrapper
- `pi-session.ts`：`createPiSession` / `resumePiSession` 工厂函数，`customTools` + `codingTools` 组装
- 全局配置路径：`~/.easymint/` → `~/.easymint_pi_core/`
- 会话存储：`~/.easymint_pi_core/sessions/<编码路径>/`
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

项目级 `.easymint/` 被批量错写为全局 `.easymint_pi_core/`：

| 文件 | 错误 | 修正 |
|------|------|------|
| `process-service.ts` | `<project>/.easymint_pi_core/run.json` | `<project>/.easymint/run.json` |
| `issue-service.ts` | `<project>/.easymint_pi_core/issues.json` | `<project>/.easymint/issues.json` |

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
