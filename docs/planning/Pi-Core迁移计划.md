# Pi-Core 迁移计划

> 分支：`Pi-Core`（已创建，基于 main）
> 目标：将 EasyMint 的 AI 内核从 `@anthropic-ai/claude-agent-sdk` 完全替换为 `@earendil-works/pi-coding-agent`，前端功能体验不变。

---

## 一、项目上下文

### EasyMint 项目

- **路径**：`/Users/amon/dev/project/EasyMint`
- **技术栈**：Electron 28+, React 18, Vite 5, TypeScript 5, Tailwind CSS, zustand
- **目标平台**：macOS（主）/ Windows / Linux
- **启动命令**：`npm run dev`
- **CodeGraph 已初始化**，使用 `codegraph_*` 工具查询

### 当前架构（Claude SDK）

```
app/main/services/
├── agent-service.ts       # 核心：query(), sendMessage(), startChatLoop(), 流事件处理
├── session-service.ts     # 会话存储：listSessions(), getSessionMessages(), rename/delete
├── agent-templates.ts     # Agent 模板：mint, builder, evaluator, designer
├── builtin-mcp.ts         # MCP 工具：show_prototype, set_task_status 等
├── mcp-service.ts         # MCP 服务器管理
├── store.ts               # 设置存储
└── session-cache.ts       # 会话缓存（权限模式、模型选择）

app/main/
├── ipc-handlers.ts        # IPC 注册
├── index.ts               # 主进程入口

app/renderer/src/
├── components/
│   ├── ChatPanel.tsx      # 聊天面板（唯一的重点改动前端文件）
│   ├── SessionHistory.tsx # 项目会话列表
│   ├── DesignSessionList.tsx # 设计会话列表
│   ├── ChatInput.tsx      # 输入框（不改）
│   ├── ChatBlocks.tsx     # 消息块渲染（不改）
│   └── StreamPanel.tsx    # 流事件归一化（需要简化）
├── stores/                # zustand stores（不改）
└── pages/ProjectPage.tsx  # 项目页面（不改）
```

### 关键设计概念

**会话分类**：项目会话（Mint）和 UI 设计会话（Mint-D）通过 `session-types.json`（`~/.easymint/session-types.json`）区分。`agentType: "designer"` 的会话出现在设计列表，其他在项目列表。

**Agent 模板**：存在 `agent-templates.ts`，每种模板有 `id`、`prompt`（系统提示词）、`agentType`。

**前端的流事件处理**：`ChatPanel.tsx` 通过 `onStream` 监听 `StreamEvent`，逐 delta 追加到 `useChatStore`。有两个 Effect：
- Effect A：启动时从 `getBufferedStream` 回放缓冲事件
- Effect B：实时 `onStream` 订阅
- 两者通过 `processedSeqRef`（seq number Set）防止重复
- `normalizeEvent()` 把 SDK 格式转成 `StreamEntry`

---

## 二、Claude SDK vs Pi 核心差异

| 维度 | Claude SDK | Pi |
|------|-----------|-----|
| **会话模型** | `query()` 返回 `AsyncIterable`，一次 query = 整个会话生命周期 | `createAgentSession()` 返回 `AgentSession`，`prompt()` 一次 = 一轮 |
| **消息注入** | `AsyncGenerator`（createMessageChannel）+ `channel.enqueue()` | `session.steer()` / `session.followUp()` |
| **流式** | `includePartialMessages: false/true` 控制 delta 粒度 | `message_update` 事件，每次推送累计完整消息 |
| **中断** | `query.interrupt()` 软中断 | `session.abort()` 硬中断 |
| **子进程** | spawn `claude` CLI binary | 进程内运行（in-process） |
| **工具注册** | MCP 协议（JSON Schema） | `ToolDefinition`（TypeBox + async execute） |
| **会话存储** | SDK 管理 JSONL 文件 | `SessionManager`（SQLite + JSONL） |
| **系统提示词** | `options.systemPrompt = { type: "preset", preset: "claude_code", append: "..." }` | `systemPromptOverride`（直接返回 string） |

### Pi 的 API 签名（关键）

```typescript
// 创建会话
import { createAgentSession, SessionManager, DefaultResourceLoader, SettingsManager, ModelRuntime } from '@earendil-works/pi-coding-agent';

const modelRuntime = await ModelRuntime.create({ authPath, modelsPath });
const sessionManager = SessionManager.create(cwd, sessionDir);
const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true } });
const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });

const { session } = await createAgentSession({
  cwd,
  modelRuntime,
  settingsManager,
  resourceLoader,
  sessionManager,
  model,
  thinkingLevel: 'medium',
  customTools: [...],
});

// 恢复会话
const sessionManager = SessionManager.open(sessionFile, sessionDir, cwd);
// 其他同上

// 发送消息
await session.prompt(text);

// 订阅事件
session.subscribe((event: AgentSessionEvent) => {
  switch (event.type) {
    case 'message_update':  // 累计完整 message（非 delta！）
    case 'message_end':     // 最终消息
    case 'agent_end':       // { messages, willRetry }
    case 'compaction_start': // { reason }
    case 'compaction_end':   // { reason, result, aborted, errorMessage }
    case 'tool_execution_update': // { toolCallId, toolName, args }
    case 'auto_retry_start': // { attempt, maxAttempts, delayMs, errorMessage }
    case 'auto_retry_end':   // { success, attempt, finalError }
  }
});

// 中断
await session.abort();

// 回合中插入消息
await session.steer(text);
await session.followUp(text);

// 销毁
session.dispose();

// 会话列表
SessionManager.list(cwd);
SessionManager.listAll();

// 工具定义
sdk.defineTool({
  name: 'my_tool',
  label: '显示名',
  description: '...',
  parameters: Type.Object({ ... }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    return { content: [{ type: 'text', text: 'result' }] };
  }
});
```

---

## 三、参考项目：Proma

### 路径

`/Users/amon/dev/project/GitHub/Proma`

### CodeGraph

该项目也有 `.codegraph/`，使用方式相同：`codegraph_*` 工具 + `projectPath: "/Users/amon/dev/project/GitHub/Proma"`

### 关键文件

| 文件 | 作用 |
|------|------|
| `apps/electron/src/main/lib/adapters/pi-agent-adapter.ts` | Pi 内核适配器（~1800 行），完整展示了如何用 `createAgentSession` + `subscribe` 替代 Claude SDK |
| `apps/electron/src/main/lib/adapters/claude-agent-adapter.ts` | Claude 内核适配器，对比理解两个内核的差异 |
| `apps/electron/src/main/lib/adapters/runtime-routing-agent-adapter.ts` | 双内核路由（EM 暂时不需要，但可以参考接口设计） |
| `apps/electron/src/main/lib/adapters/pi-message-adapter.ts` | Pi 消息 → SDK 消息格式转换 |
| `apps/electron/src/main/lib/adapters/pi-model-registry.ts` | 模型注册/构建 |
| `apps/electron/src/main/lib/adapters/pi-builtin-tools.ts` | Pi 内置工具定义 |
| `apps/electron/src/main/lib/adapters/pi-streaming-control.ts` | 流式控制（partial message coalescing） |
| `apps/electron/src/main/lib/adapters/pi-resource-loader-overrides.ts` | SystemPrompt / Skills 覆盖 |

### Proma 的核心模式（EM 应该借鉴）

1. **用 `AgentSession.prompt()` 替代 `query()`**
2. **用 `session.subscribe()` 替代 `for-await` 循环**
3. **用 `createAsyncQueue` 桥接 push 事件和 pull 消费**（见 `pi-agent-adapter.ts:233-286`）
4. **partial message 合并**：Pi 每个 delta 都是完整累计消息，不必每次都发前端，用 50ms 间隔合并（`pi-streaming-control.ts`）
5. **工具权限通过 `wrapToolWithPermission`** 统一处理

---

## 四、参考项目：Pi 源码

### 路径

`/Users/amon/dev/project/GitHub/pi`

### CodeGraph

已初始化，使用方式相同：`projectPath: "/Users/amon/dev/project/GitHub/pi"`

### 关键包

| 包 | 路径 | 作用 |
|----|------|------|
| `pi-coding-agent` | `packages/coding-agent/src/` | `createAgentSession`, `AgentSession`, `SessionManager`, `DefaultResourceLoader`, `SettingsManager`, `ToolDefinition` |
| `pi-agent-core` | `packages/agent/src/` | `Agent` 类, `AgentOptions`, `AgentEvent`, `StreamFn` |
| `pi-ai` | `packages/ai/src/` | `Model`, `ModelRuntime`, `streamSimple`, provider API |

### 常用查询方式

```bash
# 查找符号定义
codegraph_search --query "createAgentSession" --projectPath "/Users/amon/dev/project/GitHub/pi"

# 理解某个功能的上下文
codegraph_context --task "how does AgentSession.prompt work" --projectPath "/Users/amon/dev/project/GitHub/pi"

# 追踪调用链
codegraph_trace --from "AgentSession prompt" --to "Agent loop" --projectPath "/Users/amon/dev/project/GitHub/pi"

# 同时看多个文件源码
codegraph_explore --query "AgentSession prompt subscribe dispose" --projectPath "/Users/amon/dev/project/GitHub/pi"
```

---

## 五、新架构设计

### 目标模块结构

```
app/main/services/
├── pi-init.ts              # Pi 环境初始化（ModelRuntime, SettingsManager）
├── pi-session.ts           # 单个 Pi 会话的封装（create/resume/prompt/steer/abort/dispose）
├── pi-session-service.ts   # 多会话管理（activeSessions Map, 替代 agent-service.ts）
├── pi-session-store.ts     # 会话存储（基于 SessionManager, 替代 session-service.ts）
├── tool-registry.ts        # 工具注册（Pi ToolDefinition, 替代 builtin-mcp.ts）
├── prompt-manager.ts       # 系统提示词管理（默认/Designer/模板复制, 替代 agent-templates.ts 的部分功能）
├── event-bridge.ts         # Pi AgentSessionEvent → 前端事件格式
├── agent-templates.ts      # 保留（模板定义仍需要）
├── store.ts                # 保留
├── session-cache.ts        # 保留（权限模式缓存）
├── project-service.ts      # 保留
├── file-service.ts         # 保留
├── skill-service.ts        # 保留
├── mcp-service.ts          # 保留或删除（如果无用户自定义 MCP）
├── process-service.ts      # 保留
└── upload-cache.ts         # 保留
```

### 前端事件新格式

```typescript
// 新的事件格式（简化，去掉 Claude SDK 概念）
type PiChatEvent =
  | { type: 'message'; sessionId: string; blocks: Block[]; partial: boolean }
  | { type: 'turn_end'; sessionId: string; usage: Usage }
  | { type: 'tool_progress'; sessionId: string; toolCallId: string; toolName: string }
  | { type: 'compacting'; sessionId: string }
  | { type: 'compacted'; sessionId: string; summary?: string }
  | { type: 'session_id'; sessionId: string; chatId: string }
  | { type: 'error'; sessionId: string; message: string; canRetry: boolean }
```

---

## 六、实施步骤

### 步骤 1：环境准备

- [ ] 在 `package.json` 中添加 `@earendil-works/pi-coding-agent` 依赖
- [ ] `npm install`
- [ ] 验证 Pi 可以正常 import

### 步骤 2：pi-init.ts — Pi 环境初始化

**参考**：Proma 的 `pi-agent-adapter.ts:1298-1368`（ModelRuntime + SettingsManager 创建）

- [ ] 创建 `ModelRuntime`（指定 authPath: `~/.easymint/pi-auth.json`, modelsPath）
- [ ] 创建 `SettingsManager.inMemory()`
- [ ] 导出 `getModelRuntime()`, `getSettingsManager()` 单例

### 步骤 3：tool-registry.ts — 工具注册

**参考**：Proma 的 `pi-builtin-tools.ts` + `pi-agent-adapter.ts:1197-1223`

- [ ] 用 Pi 的 factory 创建内置工具（read, write, edit, bash, grep, find, ls）
- [ ] 用 `defineTool` 创建 EM 产品工具（show_prototype, set_task_status, set_project_stage, show_confirm_dev, show_new_project）
- [ ] 导出 `getAllTools(cwd) → ToolDefinition[]`

### 步骤 4：pi-session-store.ts — 会话存储

**参考**：Proma 的 `pi-agent-adapter.ts:565-573`（findSessionFile）+ `SessionManager.list()`

- [ ] 实现 `listSessions(projectPath) → SessionListItem[]`（用 `SessionManager.list(cwd)`）
- [ ] 实现 `listDesignSessions(projectPath)`（过滤 `session-types.json`）
- [ ] 实现 `getSessionMessages(sessionId) → Message[]`
- [ ] 实现 `renameSession / deleteSession / togglePin / archive / unarchive`
- [ ] 替换 `session-service.ts`

### 步骤 5：pi-session.ts — 单会话封装

**参考**：Proma 的 `pi-agent-adapter.ts:1262-1717`（query 方法）

- [ ] 封装 `createSession(cwd, options) → PiSession`
- [ ] 封装 `resumeSession(sessionFile, cwd) → PiSession`
- [ ] 封装 `prompt()` + `subscribe` + 事件转换（通过 EventBridge）
- [ ] 封装 `steer()`, `abort()`, `dispose()`

关键逻辑：

```typescript
// prompt() 的调用模式
async prompt(session: AgentSession, text: string, onEvent: (e: PiChatEvent) => void): Promise<void> {
  const unsub = session.subscribe((event) => {
    // 通过 EventBridge 转换成 PiChatEvent，回调 onEvent
  });
  await session.prompt(text);
  unsub();
}
```

### 步骤 6：event-bridge.ts — 事件转换

**参考**：Proma 的 `pi-agent-adapter.ts:1476-1603`（subscribe 回调）

- [ ] `message_update` → `{ type: 'message', blocks, partial: true }`
- [ ] `message_end` → `{ type: 'message', blocks, partial: false }`
- [ ] `agent_end` → `{ type: 'turn_end', usage }`
- [ ] `tool_execution_update` → `{ type: 'tool_progress', toolName }`
- [ ] `compaction_start/end` → `{ type: 'compacting' }` / `{ type: 'compacted' }`

### 步骤 7：pi-session-service.ts — 多会话管理

**参考**：现有的 `agent-service.ts`（接口）+ Proma 的 `pi-agent-adapter.ts`（实现）

- [ ] `activeSessions: Map<string, PiSession>`
- [ ] `sendMessage(projectPath, message, resumeSessionId, opts)` → 创建或恢复会话，调 prompt
- [ ] `spawnAgentChat(projectPath, templateId, initialMessage)` → 同上，使用模板 prompt
- [ ] `abort(sessionId)`
- [ ] `killChat(sessionId)`
- [ ] `setModel(sessionId, model)`
- [ ] 会话类型追踪（session-types.json）
- [ ] 替换 `agent-service.ts`

### 步骤 8：prompt-manager.ts — 提示词管理

- [ ] `getDefaultPrompt() → string`（从 `prompts.ts` 组装）
- [ ] `getDesignerPrompt() → string`（从模板获取）
- [ ] `copyDesignerTemplates(projectPath)`（从 `resources/em-html-editor/` 复制）

### 步骤 9：更新 IPC + Preload

- [ ] 更新 `ipc-handlers.ts` 的 import（指向新服务）
- [ ] 事件广播改为新的事件类型名
- [ ] `preload/index.ts` 方法名对齐
- [ ] 去掉 `agent:spawnAgentChat`（如果不再需要独立通道）

### 步骤 10：ChatPanel 简化

**核心改动**：去掉 delta 追加逻辑。

- [ ] 删除 `normalizeEvent()` — Pi 事件已归一化
- [ ] 删除 `processedSeqRef` — 不需要 seq 去重
- [ ] 将 `appendAiEntry` 改为 `replaceAiMessage`（全文替换）
- [ ] 去掉 Effect A 和 Effect B 的双路径去重
- [ ] 简化 `updateStreamStatus`（工具名映射表改为 Pi 的工具名）
- [ ] 简化 `mapSessionMessages`（Pi 消息格式更直接）

### 步骤 11：清理

- [ ] 删除 `builtin-mcp.ts`（工具已迁移到 tool-registry）
- [ ] 删除 `mcp-service.ts`（如果没有用户自定义 MCP）
- [ ] 从 `package.json` 移除 `@anthropic-ai/claude-agent-sdk`
- [ ] `npm install` 清理
- [ ] 删除不再需要的类型定义

---

## 七、验证清单

每完成一步，运行以下验证：

```bash
npm run lint          # ESLint + TypeScript 类型检查
npm run dev           # 启动应用
```

功能验证：
- [ ] 新建项目会话 → 发消息 → 收到回复（流式正常）
- [ ] 停止按钮 → AI 立即中断
- [ ] 恢复已有会话 → 加载历史 → 继续对话
- [ ] 新建设计会话 → 发消息 → 设计师 prompt 生效
- [ ] 设计会话列表独立显示
- [ ] 置顶/重命名/删除会话
- [ ] 多 tab 切换，会话互不干扰
- [ ] 图片粘贴上传
- [ ] 上下文压缩
- [ ] show_prototype 工具生效

---

## 八、注意事项

1. **不要改动前端组件除了 ChatPanel.tsx（和可能的 StreamPanel.tsx）以外的任何文件。** SessionHistory、DesignSessionList、LeftPanel、ProjectPage、所有 stores 保持不变。

2. **保持 IPC 接口签名不变。** 前端调用的 `window.electronAPI.agent.sendMessage()` 等方法签名不变，只是内部实现换了。

3. **Pi 的 `message_update` 是累计全文，不是 delta。** ChatPanel 从"追加末尾"改为"替换当前 AI 消息"。50ms 合并（Proma 的做法）可以保留，减少重渲染。

4. **Pi 的 `prompt()` 是一次性调用。** 不像 Claude SDK 的 `query()` 是长生命周期。每轮对话 = 一次 `prompt()`。多轮通过 `agent_end` 后再次调 `prompt()`。

5. **会话类型（session-types.json）逻辑保留。** 创建时 `agentType` 写入 JSON，列表查询时过滤。

6. **模板复制逻辑保留。** Mint-D 的 4 个 HTML 模板仍然复制到 `.easymint/templates/`。

7. **所有操作必须符合 TypeScript strict 模式，禁止 `any`。**
