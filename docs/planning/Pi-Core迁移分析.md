# Pi-Core 迁移分析

> 基于对 EasyMint-Pi-Core 现状 + 原始 Pi 源码 + Proma 参考项目 + oh-my-pi 参考项目的综合分析
> 日期：2026-07-23

---

## 一、参考项目关系

```
pi-mono (Mario Zechner, badlogic/pi-mono)
  │
  ├── @earendil-works/pi-coding-agent (原始 Pi npm 包)
  │     ↑ Proma 用这个  |  EasyMint 迁移目标  |  原始 Pi 源码在 /GitHub/pi
  │
  └── oh-my-pi (Can Bölük fork, can1357/oh-my-pi)
        └── @oh-my-pi/pi-coding-agent (oh-my-pi npm 包)
```

- **Proma**（`/Users/amon/dev/project/GitHub/Proma`）使用的是原始 Pi（`@earendil-works/pi-coding-agent`），不是 oh-my-pi
- **oh-my-pi** 是 Pi 的社区 fork，核心 API 同源（`createAgentSession`、`ModelRuntime`、`SessionManager`、`SettingsManager`、`DefaultResourceLoader`），在此之上增加了 32 个内置工具、~55k 行 Rust 原生层、插件/扩展系统、LSP/DAP 等
- **迁移直接参考**：原始 Pi 源码（`/Users/amon/dev/project/GitHub/pi`）+ Proma 的 Pi 适配器（`/Users/amon/dev/project/GitHub/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts`，1814 行）
- **oh-my-pi 参考价值**：API 层面和原始 Pi 一致（同源），可作为"以后需要更多能力"的扩展方向

---

## 二、当前 EasyMint-Pi-Core 现状

### 2.1 依赖情况

```
已安装：
  ✅ @anthropic-ai/claude-agent-sdk  0.3.186  (要被替换)
  ✅ @earendil-works/pi-agent-core    0.80.10  (低层 Agent 原语，已安装)
  ❌ @earendil-works/pi-coding-agent  缺失！    (高层 SDK，包含 createAgentSession 等核心 API)
```

**关键问题**：`pi-agent-core` 只有底层 `Agent`、`AgentLoop`、`compact`、会话存储等原语，**没有**以下核心 API：

- `createAgentSession()` — 创建高层会话
- `ModelRuntime` — 模型注册与运行时
- `SessionManager` — 会话文件管理
- `SettingsManager` — 设置管理
- `DefaultResourceLoader` — 资源加载（Skills、SystemPrompt、上下文文件）

这些都在 `@earendil-works/pi-coding-agent` 包里。**必须额外安装**。

### 2.2 Claude SDK 的耦合点（需要拆除的地方）

#### 主进程（6 个文件）

| 文件 | 行数 | 与 Claude SDK 的关系 |
|------|------|---------------------|
| `app/main/services/agent-service.ts` | 882 | **核心**：`query()`、`SDKMessage`、`PermissionMode`、`createMessageChannel`、流事件处理 |
| `app/main/services/session-service.ts` | 278 | `listSessions`、`getSessionMessages`、`renameSession`、`deleteSession` |
| `app/main/services/builtin-mcp.ts` | 443 | `createSdkMcpServer`、`tool()` — EM 产品工具（show_prototype、set_task_status 等 5 个） |
| `app/main/services/hooks.ts` | 143 | `PreToolUseHookInput`、`HookInput` 类型 |
| `app/main/index.ts` | ~250 | `require("claude-agent-sdk").listSessions`（启动清理死会话） |
| `app/main/ipc-handlers.ts` | 398 | IPC 注册（主要改 import 指向，接口签名尽量不变） |

#### 前端（3 个文件）

| 文件 | 行数 | 与 Claude SDK 的关系 |
|------|------|---------------------|
| `app/renderer/src/components/ChatPanel.tsx` | 718 | `StreamEvent`、`normalizeEvent()`、`processedSeqRef`（seq 去重）、delta 追加逻辑 |
| `app/renderer/src/components/StreamPanel.tsx` | 524 | `normalizeEvent()` — SDK 格式 → `StreamEntry` |
| `app/renderer/src/components/SettingsDialog.tsx` | ~800 | 仅一处字符串 `"claude-agent-sdk"` 版本显示 |

### 2.3 不在改动范围内的文件

- 所有 zustand stores（project-status、workspace、settings、chat-actions 等）
- ProjectPage、LeftPanel、SessionHistory、DesignSessionList、ChatInput、ChatBlocks
- project-service、file-service、skill-service、upload-cache、store、session-cache
- process-service、shell-service、auto-updater、window-manager

---

## 三、核心 API 差异速查

### 3.1 Claude SDK → Pi SDK 概念映射

| EasyMint 原有能力 | Claude SDK 实现 | Pi 对应方案 | 差异程度 |
|---|------|------|------|
| 发送消息 | `query(prompt, options)` | `session.prompt(text)` | 小 |
| 流式响应 | `for await (msg of query)` | `session.subscribe(callback)` | 中 — push 替代 pull |
| 中断 | `query.interrupt()` | `session.abort()` | 小 |
| 会话消息注入 | `createMessageChannel` + `channel.enqueue()` | `session.steer()` / `session.followUp()` | 中 — 语义不同 |
| 会话列表 | `listSessions()` | `SessionManager.list(cwd)` | 中 — 接口不同 |
| 会话历史 | `getSessionMessages(id)` | `SessionManager.getEntries()` | 中 — 需格式转换 |
| 重命名/删除会话 | `renameSession()` / `deleteSession()` | `SessionManager.rename()` / 文件操作 | 中 |
| EM 产品工具 (5个) | `createSdkMcpServer` + `tool()` | Pi 的 `defineTool()` | 中 — 不同工具 API |
| 系统提示词 | `options.systemPrompt` | `DefaultResourceLoader.systemPromptOverride` | 小 |
| 权限模式 | `PermissionMode` (4 级) | Pi 的 `ToolExecutionMode` | 待评估 |
| 自动上下文压缩 | EM 自建（阈值检测→总结→轮转） | Pi 原生 `compaction: { enabled: true }` | 可简化 |
| 多 Agent 模板 | `agent-templates.ts` | `systemPromptOverride` 按 agentType 返回不同提示词 | 中 |
| Hooks 校验 | `hooks.ts` (PreToolUse) | Pi 的 Hooks / Extension 系统 | 待评估 |
| TDD 模式 | 在 SystemPrompt 中指定 | SystemPrompt 覆盖 | 小 |

### 3.2 Pi AgentSessionEvent 全集（`session.subscribe` 回调）

```typescript
// AgentEvent (来自 pi-agent-core):
agent_start           // 会话开始
agent_end             // 回合结束 { messages, telemetry, coverage }
turn_start            // 轮次开始
turn_end              // 轮次结束 { message, toolResults }
message_start         // 消息开始
message_update        // 流式更新（累计全文！非 delta！）
message_end           // 消息完成（最终内容）
tool_execution_start  // 工具开始 { toolCallId, toolName, args }
tool_execution_update // 工具进度 { toolCallId, toolName, partialResult }
tool_execution_end    // 工具结束 { toolCallId, toolName, result, isError }

// AgentSessionEvent (pi-coding-agent 扩展):
auto_compaction_start // 自动压缩开始 { reason: "threshold"|"overflow"|"idle"|"incomplete", action }
auto_compaction_end   // 压缩结束 { action, result, aborted, willRetry, errorMessage, skipped }
auto_retry_start      // 自动重试开始 { attempt, maxAttempts, delayMs, errorMessage }
auto_retry_end        // 重试结束 { success, attempt, finalError }
retry_fallback_applied // 模型回退 { from, to, role }
retry_fallback_succeeded // 回退成功 { model, role }
ttsr_triggered        // 流式规则触发 { rules }
todo_reminder         // Todo 提醒
irc_message           // Agent 间消息
notice                // 通知 { level, message, source }
thinking_level_changed // 思考级别变更
goal_updated          // 目标更新
```

### 3.3 Pi 核心 API 速查

```typescript
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";

// 1. 模型初始化
const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
modelRuntime.registerProvider("my-provider", {
  apiKey: "sk-xxx",
  api: "anthropic-messages",
  baseUrl: "https://api.deepseek.com/anthropic",
  models: [{
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    contextWindow: 200000,
    maxTokens: 32000,
    input: { costPerMTok: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 1.10 } },
  }],
});
const model = modelRuntime.getModel("my-provider", "deepseek-v4-pro");

// 2. 设置
const settingsMgr = SettingsManager.inMemory({
  compaction: { enabled: true },
  retry: { enabled: true, maxRetries: 8, baseDelayMs: 1000 },
});

// 3. 资源加载（Skills、SystemPrompt、Agents.md 等）
const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir,
  settingsManager: settingsMgr,
  systemPromptOverride: () => assembledSystemPrompt,  // ← EM 的 prompts.ts 在这里注入
});

// 4. 会话
const sessionMgr = SessionManager.create(cwd, sessionDir);        // 新建
const sessionMgr = SessionManager.open(sessionFile, dir, cwd);     // 恢复
const sessionMgr = SessionManager.inMemory();                     // 仅内存（测试用）

const { session } = await createAgentSession({
  cwd,
  agentDir,
  modelRuntime,
  settingsManager: settingsMgr,
  resourceLoader,
  sessionManager: sessionMgr,
  model,
  thinkingLevel: "medium",
  customTools: [...],
});

// 5. 对话
const unsub = session.subscribe((event) => { /* 事件转换 → IPC → 前端 */ });
await session.prompt("消息文本");                              // 发送消息
await session.abort();                                         // 中断
await session.steer("转向文本");                                // 立即中断当前回合并注入
await session.followUp("跟进文本");                              // 当前回合结束后注入
session.dispose();                                             // 销毁
```

---

## 四、阶梯式改造方案

### 第一步：拆除 Claude SDK 依赖

**目标**：注释/删除所有 `@anthropic-ai/claude-agent-sdk` 的 import，让项目"干净地不工作"。

| # | 文件 | 操作 |
|---|------|------|
| 1.1 | `package.json` | 移除 `@anthropic-ai/claude-agent-sdk` 及其 4 个平台 optionalDependencies |
| 1.2 | `package.json` | 添加 `@earendil-works/pi-coding-agent` 依赖 |
| 1.3 | `package.json` | 修改 `build:main` 的 `--external:@anthropic-ai/claude-agent-sdk` → 指向 pi 包 |
| 1.4 | `package.json` | 修改 `build.files` 和 `build.asarUnpack` 去掉 `@anthropic-ai/**`，添加 pi 相关 |
| 1.5 | `app/main/services/agent-service.ts` | 注释 Claude SDK import，保留函数签名骨架，标记 `// TODO: 步骤三替换为 Pi` |
| 1.6 | `app/main/services/session-service.ts` | 同上 |
| 1.7 | `app/main/services/builtin-mcp.ts` | 同上 |
| 1.8 | `app/main/services/hooks.ts` | 同上 |
| 1.9 | `app/main/index.ts` | 注释 `require("claude-agent-sdk").listSessions` |
| 1.10 | `app/renderer/src/components/SettingsDialog.tsx` | 修改版本号显示为 Pi SDK |
| 1.11 | `app/main/services/session-cache.ts` | 移除 `PermissionMode` 类型引用 |

**验证**：`npm run typecheck` 预期有类型错误（第一步的目标是确认依赖拆除干净，类型错误留到后续步骤修复）。

### 第二步：缺口分析

**目标**：基于 Pi SDK 的实际 API，逐项对比，产出详细的文件级迁移映射表。

核心产出：

1. **每个被改文件的 Claude API 调用点清单** → Pi 对应 API 及参数映射
2. **数据格式转换表**：SDKMessage → Pi 事件、SessionMessage → Pi Entry、StreamEvent → Pi Event
3. **IPC 通道兼容性检查**：现有 IPC 通道哪些可复用、哪些需新增、哪些可废弃
4. **类型映射表**：Claude SDK 类型 → Pi SDK 类型

重点评估以下高不确定性项：

- Pi 的 `ToolExecutionMode` vs EM 的 `PermissionMode` 四级的对应关系
- Hooks 系统：Pi 是否有等价的 PreToolUse 回调机制
- 多 Agent（Builder/Evaluator）的实现方式：Pi SubAgent vs 独立 Session

**验证**：产出一份详细的文件级迁移映射表（可作为第三步开始的 Task List 依据）。

### 第三步：基础 Pi 对话

**目标**：用 Pi 实现最简对话 — 发送一条消息，收到流式回复。

| # | 任务 | 参考来源 |
|---|------|---------|
| 3.1 | `npm install @earendil-works/pi-coding-agent` | |
| 3.2 | 新建 `app/main/services/pi-init.ts`：`ModelRuntime.create()` + `SettingsManager.inMemory()` | Proma `pi-model-registry.ts:434` |
| 3.3 | 新建 `app/main/services/tool-registry.ts`（骨架）：`defineTool` 定义 read/write/edit/bash 基础工具 | Proma `pi-builtin-tools.ts` |
| 3.4 | 新建 `app/main/services/pi-session.ts`：封装 `createAgentSession` + `prompt()` | Proma `pi-agent-adapter.ts:1370-1420` |
| 3.5 | 新建 `app/main/services/event-bridge.ts`：`subscribe` → Pi 事件转前端格式 | Proma `pi-agent-adapter.ts:1476-1604` |
| 3.6 | 重写 `app/main/services/agent-service.ts` 的 `sendMessage()` 使用 Pi | |
| 3.7 | **简化 `ChatPanel.tsx`**：delta 追加 → 全文替换（Pi 推累计全文） | 迁移计划步骤 10 |
| 3.8 | **简化 `StreamPanel.tsx`**：去掉 `normalizeEvent()` + `processedSeqRef` | |

**ChatPanel 简化要点**：
- 删除 `normalizeEvent()` — Pi 事件已归一化（或通过 event-bridge 归一化）
- 删除 `processedSeqRef` — 不需要 seq 号去重
- `appendAiEntry` → `replaceAiMessage`（全文替换而非尾部追加）
- 去掉 Effect A（getBufferedStream）和 Effect B（onStream）的双路径去重
- 简化 `updateStreamStatus`（工具名映射表改为 Pi 的工具名）

**验证**：`npm run dev` → 新建项目 → 发消息 → 看到流式回复（文本 + 工具调用）。

### 第四步：会话管理

**目标**：会话持久化、列表、恢复、多 Tab。

| # | 任务 |
|---|------|
| 4.1 | 新建 `app/main/services/pi-session-store.ts` |
| 4.2 | 实现 `listSessions(projectPath)` — 基于 `SessionManager.list(cwd)` |
| 4.3 | 实现 `listDesignSessions(projectPath)` — 过滤 `session-types.json` |
| 4.4 | 实现 `getSessionMessages(sessionId)` — 基于 `SessionManager.getEntries()` + 格式转换 |
| 4.5 | 实现 `renameSession` / `deleteSession` / `togglePin` / `archive` / `unarchive` |
| 4.6 | 重写 `session-service.ts`，替换 Claude SDK 的 `listSessions` 等函数 |
| 4.7 | 实现多 Tab 会话切换（`activeSessions: Map<string, PiSession>`） |
| 4.8 | 会话类型支持（Mint 项目会话 / Mint-D 设计会话，通过 `session-types.json` 区分） |
| 4.9 | 中断功能：`session.abort()` → 前端停止按钮 |
| 4.10 | 会话恢复：`SessionManager.open(sessionFile, dir, cwd)` |

**验证**：
- 多 Tab 切换，会话互不干扰
- 停止按钮 → AI 立即中断
- 恢复已有会话 → 加载历史 → 继续对话
- 置顶 / 重命名 / 删除会话

### 第五步：全功能集成

**目标**：补全所有剩余功能。

#### 5.1 产品工具迁移

`builtin-mcp.ts` → `tool-registry.ts`：用 Pi 的 `defineTool()` 重建 5 个 EM 产品工具：

- `show_confirm_dev` — 显示「确认开发」按钮
- `show_new_project` — 显示「新建项目」按钮
- `set_task_status(taskId, status)` — 更新 task.json status
- `set_project_stage(stage)` — 写 state.json stage
- `rename_project(newName)` — 重命名当前项目

参考：Proma `pi-agent-adapter.ts` 中 `buildPromaProductToolDefinitions()`。

#### 5.2 提示词管理

- 新建 `app/main/services/prompt-manager.ts`
- Port 现有 `prompts.ts` 的组装逻辑 → `DefaultResourceLoader.systemPromptOverride`
- 实现 `getDefaultPrompt()`（Mint）和 `getDesignerPrompt()`（Mint-D）
- Builder / Evaluator 模板复用现有的 `agent-templates.ts`

#### 5.3 项目创建流程

- 确保新项目创建 → 表单提交 → Mint 初始化流程完整
- `buildInitInstruction` 等函数适配 Pi SDK
- 6 个场景模板（web-frontend / web-fullstack / cli / api-backend / mobile / library）保持不变

#### 5.4 Builder / Evaluator 多 Agent 协作

- Pi SubAgent（`task()` 工具）vs 独立 Session 两种方案评估
- 实现 Mint → Builder → Evaluator 的调度循环
- 任务状态更新（`set_task_status` 工具）验证

#### 5.5 上下文自动压缩

- Pi 原生 `compaction: { enabled: true }` 替代 EM 自建的阈值检测 + 总结 + 轮转
- 监听 `compaction_start/end` 事件 → 前端 UI 反馈
- 保留 EM 的阈值设置项，映射到 Pi 的 compaction 配置

#### 5.6 其他功能

- 图片上传（clipboard paste + file upload）
- Hooks 校验（评估 Pi Hook 系统能否替代现有 `hooks.ts`）
- 环境检测（Git、Node.js）
- 清理 Claude SDK 所有残留

**验证**：
- 完整新建项目 → Mint 初始化 → 分配任务 → Builder 开发 → Evaluator 验收
- 新建设计会话 → 设计师 prompt 生效
- 设计会话列表独立显示
- 图片粘贴上传
- 上下文自动压缩
- `show_prototype` 工具生效

---

## 五、前端事件新格式（提案）

```typescript
// 替代 Claude SDK 的 SDKMessage / StreamEvent
type PiChatEvent =
  | { type: "message"; sessionId: string; blocks: Block[]; partial: boolean }
  | { type: "turn_end"; sessionId: string; usage: Usage }
  | { type: "tool_progress"; sessionId: string; toolCallId: string; toolName: string }
  | { type: "compacting"; sessionId: string }
  | { type: "compacted"; sessionId: string; summary?: string }
  | { type: "session_id"; sessionId: string; chatId: string }
  | { type: "error"; sessionId: string; message: string; canRetry: boolean };
```

**与 Claude SDK 格式的关键区别**：

- `message` 事件携带完整 `blocks`，不仅是 delta — ChatPanel 用 `replaceAiMessage` 替换全文
- 不再有 `seq` 字段 — 不需要去重
- 不再有 `tool_use` / `tool_result` 独立事件 — 工具调用作为 message 的 block 类型之一

---

## 六、关键风险点

1. **Pi 的 `message_update` 是累计全文，不是 delta** — ChatPanel 必须从"追加末尾"改为"替换当前 AI 消息"，这是前端最大的改动。Proma 用 50ms 合并减少重渲染（`pi-streaming-control.ts`）。

2. **Pi 的 `prompt()` 是一次性调用** — 不像 Claude SDK 的 `query()` 是长生命周期。每轮对话 = 一次 `prompt()`。多轮通过 `agent_end` 后再次调 `prompt()` 实现。

3. **缺少 `@earendil-works/pi-coding-agent` 包** — 当前只装了 `pi-agent-core`（底层原语），高层 SDK 包未安装。

4. **不要直接用 `pi-agent-core` 的底层 `Agent` 类** — 应该用 `pi-coding-agent` 的 `createAgentSession` 高层封装。

5. **oh-my-pi 的额外功能 EasyMint 暂时不需要** — 32 工具、Rust 原生层、插件系统、LSP/DAP 等眼下不纳入迁移范围，直接参考原始 Pi。

6. **ChatPanel.tsx + StreamPanel.tsx 的前端改动需谨慎** — 这两个文件合计 ~1242 行，改动量最大。但外部接口（props、store 调用）尽量不变。

---

## 七、参考文件索引

| 参考内容 | 路径 |
|---------|------|
| EasyMint 架构 | `docs/技术架构.md` |
| EasyMint 需求 | `docs/需求文档.md` |
| EasyMint 开发进度 | `docs/开发进度.md` |
| 迁移总计划 | `docs/planning/Pi-Core迁移计划.md` |
| **Proma Pi 适配器（核心参考）** | `/Users/amon/dev/project/GitHub/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts` |
| Proma 模型构建 | `/Users/amon/dev/project/GitHub/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts` |
| Proma 流式控制 | `/Users/amon/dev/project/GitHub/Proma/apps/electron/src/main/lib/adapters/pi-streaming-control.ts` |
| Proma 内置工具 | `/Users/amon/dev/project/GitHub/Proma/apps/electron/src/main/lib/adapters/pi-builtin-tools.ts` |
| 原始 Pi SDK | `/Users/amon/dev/project/GitHub/pi/packages/coding-agent/src/core/sdk.ts` |
| 原始 Pi AgentSession | `/Users/amon/dev/project/GitHub/pi/packages/coding-agent/src/core/agent-session.ts` |
| 原始 Pi SessionManager | `/Users/amon/dev/project/GitHub/pi/packages/coding-agent/src/core/session-manager.ts` |
| 原始 Pi ModelRuntime | `/Users/amon/dev/project/GitHub/pi/packages/coding-agent/src/core/model-runtime.ts` |
| oh-my-pi SDK（扩展参考） | `/Users/amon/dev/project/GitHub/oh-my-pi/packages/coding-agent/src/sdk.ts` |
