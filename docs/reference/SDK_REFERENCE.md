# Claude Agent SDK 完整参考

> 来源: `@anthropic-ai/claude-agent-sdk/sdk.d.ts` (5964 行)
> 日期: 2026-05-31

## 一、核心 API（EasyMint 已使用）

### query() — 发送消息，启动 Agent 会话

```ts
function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query;
```

**返回的 Query 对象**:
```ts
interface Query extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<void>;  // 中断当前执行
}
```

**Options 完整字段**:
```ts
interface Options {
  // 工作目录
  cwd?: string;

  // 权限模式 (我们已用)
  permissionMode?: PermissionMode;
  // 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'

  // 会话管理
  resume?: string;           // 续写 session ID
  sessionId?: string;        // 指定 session ID

  // 模型
  model?: string;

  // 系统提示词 (我们已用)
  systemPrompt?: {
    type: "preset";
    preset: "claude_code";
    append?: string;         // 追加自定义内容
  };

  // 环境变量
  env?: Record<string, string>;

  // 工具控制
  allowedTools?: string[];            // 白名单工具
  disallowedTools?: string[];         // 黑名单工具
  canUseTool?: CanUseTool;            // 自定义工具权限回调

  // 思考模式
  thinking?: {
    budgetTokens?: number;  // 思考 token 预算
  };

  // 输出格式
  outputFormat?: {
    type: "json_schema";
    schema: Record<string, unknown>;
  };

  // Agent (子任务)
  agents?: Record<string, AgentDefinition>;

  // MCP 服务器
  mcpServers?: Record<string, McpServerConfig>;

  // Hooks (生命周期回调)
  hooks?: Record<string, HookCallbackMatcher[]>;

  // 允许危险权限跳过
  allowDangerouslySkipPermissions?: boolean;

  // Plan 模式指令
  planModeInstructions?: string;

  // 设置来源（项目/用户/本地）
  settingSources?: SettingSource[];

  // 工作树
  worktree?: { path: string };

  // 绕过权限的最大确认次数
  maxBypassTurns?: number;

  // 上级 session（用于 preflight）
  parentSession?: string;
}
```

### 会话管理 API

```ts
// 列出所有会话
function listSessions(options?: {
  dir?: string;      // 按项目路径过滤
  first?: number;    // 分页
  cursor?: string;   // 分页游标
}): Promise<SDKSessionInfo[]>;

// 获取会话详情
function getSessionInfo(
  sessionId: string,
  options?: { dir?: string }
): Promise<SDKSessionInfo | undefined>;

// 获取会话消息历史
function getSessionMessages(
  sessionId: string,
  options?: { dir?: string; includeToolUse?: boolean }
): Promise<SessionMessage[]>;

// 重命名会话
function renameSession(
  sessionId: string,
  title: string,
  options?: { dir?: string }
): Promise<void>;

// 删除会话
function deleteSession(
  sessionId: string,
  options?: { dir?: string }
): Promise<void>;

// Fork 会话（分支复制）
function forkSession(
  sessionId: string,
  options?: { dir?: string; title?: string }
): Promise<{ sessionId: string }>;

// 获取子 agent 消息
function getSubagentMessages(
  sessionId: string,
  agentId: string,
  options?: { dir?: string }
): Promise<SessionMessage[]>;
```

### SDKSessionInfo 结构
```ts
interface SDKSessionInfo {
  sessionId: string;
  customTitle?: string;
  summary?: string;
  firstPrompt?: string;
  createdAt: number;
  lastModified: number;
  // ...
}
```

### SessionMessage 结构
```ts
interface SessionMessage {
  type: "user" | "assistant";
  uuid: string;
  session_id: string;
  message: unknown;  // BetaMessage from Anthropic SDK
  parent_tool_use_id: string | null;
}
```

---

## 二、SDK 内置工具（Agent 自动可用）

Mint 在会话中可以直接使用这些工具，无需额外配置：

| 工具 | 功能 |
|------|------|
| **Bash** | 执行 shell 命令 |
| **Read** | 读取文件 |
| **Write** | 写入文件 |
| **Edit** | 精确字符串替换编辑 |
| **Glob** | 文件模式匹配搜索 |
| **Grep** | 文本内容搜索 |
| **WebSearch** | 网络搜索 |
| **WebFetch** | 获取网页内容 |
| **Task** | 启动子 Agent 执行任务 |
| **TaskOutput** | 获取子 Agent 输出 |
| **TaskStop** | 停止子 Agent |
| **EnterPlanMode** | 进入计划模式 |
| **ExitPlanMode** | 退出计划模式 |
| **AskUserQuestion** | 向用户提问 |
| **TodoWrite** | 写任务清单 |
| **NotebookEdit** | 编辑 Jupyter Notebook |
| **ListMcpResources** | 列出 MCP 资源 |
| **ReadMcpResource** | 读取 MCP 资源 |

---

## 三、SDKMessage 流事件类型

`query()` 返回的 AsyncIterable 产生这些消息：

```ts
type SDKMessage =
  | { type: "assistant"; message: { content: ContentBlock[] } }
  | { type: "user"; message: { content: ContentBlock[] } }
  | { type: "result"; subtype: "success" | "error"; result?: string }
  | { type: "system"; subtype: string; ... }
  | { type: "status"; status: string | null; ... };
```

**ContentBlock 类型**:
- `{ type: "text"; text: string }` — 文本回复
- `{ type: "tool_use"; id: string; name: string; input: unknown }` — 工具调用
- `{ type: "tool_result"; tool_use_id: string; content: unknown }` — 工具结果
- `{ type: "thinking"; thinking: string }` — 思考过程

**System subtype 常见值**:
- `"init"` — 会话初始化
- `"status"` — 状态更新 (requesting, compacting, idle)
- `"hook_started"` / `"hook_response"` — 生命周期回调
- `"compacting"` — 上下文压缩中
- `"session_state_changed"` — 会话状态变更

---

## 四、PermissionMode 全部选项

```ts
type PermissionMode =
  | "default"            // 标准行为，危险操作弹窗确认
  | "acceptEdits"        // 编辑文件自动过，执行命令弹窗确认
  | "bypassPermissions"  // 跳过所有权限检查
  | "plan"              // 计划模式，不执行任何工具
  | "dontAsk"           // 不弹窗，未预批准的直接拒绝
  | "auto";             // AI 分类器自动判断批准/拒绝
```

---

## 五、Hooks 生命周期（高级）

SDK 支持 30+ 个生命周期钩子，可以在关键节点插入自定义逻辑：

```ts
type HookEvent =
  // 工具相关
  | "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "PostToolBatch"
  // 会话相关
  | "SessionStart" | "SessionEnd"
  // 用户交互
  | "UserPromptSubmit" | "UserPromptExpansion" | "Notification"
  // 权限
  | "PermissionRequest" | "PermissionDenied"
  // 压缩
  | "PreCompact" | "PostCompact"
  // 子 Agent
  | "SubagentStart" | "SubagentStop"
  // 任务
  | "TaskCreated" | "TaskCompleted"
  // 停止
  | "Stop" | "StopFailure"
  // 设置
  | "Setup" | "ConfigChange"
  // 文件
  | "FileChanged" | "CwdChanged"
  // 其他
  | "TeammateIdle" | "Elicitation" | "ElicitationResult"
  | "WorktreeCreate" | "WorktreeRemove"
  | "InstructionsLoaded" | "MessageDisplay";
```

**Hook 回调签名**:
```ts
type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<HookJSONOutput>;
```

---

## 六、答案：Mint 能否直接写 init.sh 并执行？

**可以，已经具备所有条件。**

SDK 内置工具链完全覆盖这个流程：

```
用户在聊天说"帮我初始化开发环境"
  │
  ▼
Mint 用 Read 工具 → 读 需求规格.md / 架构设计.md
  │
  ▼
Mint 用 Write/Edit 工具 → 写 init.sh
  │
  ▼
Mint 用 Bash 工具 → 执行 bash init.sh
  │
  ▼
Bash 的 tool_result → 自动回到 Mint 的上下文中
  │
  ▼
Mint 分析结果 → 告诉用户成功还是失败
```

**不需要 TaskPanel 的 shell:exec。** Mint 在聊天会话里就能走完整个流程。

**TaskPanel 的定位**：不是替代 Mint 执行，而是——
- 监控 Mint 正在做什么
- 任务历史记录（带时间轴）
- 重试失败的任务（一键重新触发）
- 用户手动执行脚本（不经过聊天）

---

## 七、Agent / Subagent（子任务系统）

SDK 支持定义自定义 Agent 并通过 Task 工具调用：

```ts
interface AgentDefinition {
  description: string;       // Agent 描述
  tools?: string[];          // 可用工具列表
  prompt: string;            // Agent 系统提示词
  model?: string;            // 指定模型
  // ...
}
```

```ts
// 在 Options 中配置
{
  agents: {
    "code-reviewer": {
      description: "Review code for bugs",
      tools: ["Read", "Grep", "Glob"],
      prompt: "You are a code reviewer...",
    }
  }
}
```

Mint 就可以用 `Task` 工具拉起子 Agent 做代码审查。这对应我们之前讨论的"每个任务开新会话，做完就结束"的模式。

---

## 八、Settings API

```ts
interface Settings {
  permissionMode?: PermissionMode;
  model?: string;
  apiKeyHelper?: string;
  env?: Record<string, string>;
  // ...
}

function resolveSettings(options?: {
  scope?: "local" | "user" | "project";
}): Promise<ResolvedSettings>;
```

---

## 九、与 EasyMint 当前实现的对照

| SDK 能力 | EasyMint 使用情况 |
|-----------|------------------|
| `query()` | 已用 — agent-service 封装 |
| `listSessions()` | 已用 — session-service 封装 |
| `getSessionMessages()` | 已用 — ChatPanel 加载历史 |
| `getSessionInfo()` | 已用 |
| `renameSession()` | 已用 |
| `deleteSession()` | 已用 |
| `query.interrupt()` | 已用 — abort/stopChat |
| `permissionMode` | 已用 — ChatPanel 下拉选择 |
| `systemPrompt.append` | 已用 — system-prompt-manager |
| `resume` | 已用 — 会话续写 |
| `options.agents` | **未用** — 子 Agent 系统 |
| `options.hooks` | **未用** — 生命周期回调 |
| `options.allowedTools` | **未用** — 工具白名单 |
| `options.thinking` | **未用** — 思考模式配置 |
| `SessionStore` | **未用** — 自定义存储后端 |
| `forkSession()` | **未用** — 会话分支 |
