# Pi SDK API 参考

> 基于 `@earendil-works/pi-coding-agent` v0.80.10 源码分析
> 日期：2026-07-25

---

## 一、createAgentSession — 创建会话

```typescript
import { createAgentSession } from "@earendil-works/pi-coding-agent";

const { session, extensionsResult, modelFallbackMessage } = await createAgentSession({
  // ── 基本 ──
  cwd: "/path/to/project",          // 工作目录
  agentDir: "~/.pi/agent",          // 全局配置目录
  model: myModel,                   // 模型实例
  thinkingLevel: "medium",          // low | medium | high | xhigh | max

  // ── 工具 ──
  noTools: "builtin",               // "all" | "builtin" — 禁用默认工具
  tools: ["read", "bash"],          // 工具允许列表
  excludeTools: ["edit"],           // 工具拒绝列表
  customTools: [...],               // 自定义工具 (ToolDefinition[])

  // ── 会话 ──
  modelRuntime: myRuntime,          // ModelRuntime 实例
  settingsManager: settingsMgr,     // SettingsManager 实例
  resourceLoader: myLoader,         // ResourceLoader 实例
  sessionManager: sessionMgr,       // SessionManager 实例
  scopedModels: [...],              // Ctrl+P 循环的模型列表
});

// 返回值
session.sessionId        // 会话 ID
session.sessionFile      // 会话文件路径
session.model            // 当前模型
session.thinkingLevel    // 当前思考级别
```

### 工具工厂函数

```typescript
createCodingTools(cwd)   // read + bash + edit + write + grep + glob + ls
createReadOnlyTools(cwd)  // read + grep + glob + ls
createReadTool(cwd, opts)
createBashTool(cwd, opts)
createEditTool(cwd, opts)
createWriteTool(cwd, opts)
createGrepTool(cwd, opts)
createFindTool(cwd, opts)
createLsTool(cwd, opts)
```

---

## 二、AgentSession — 会话实例方法

### 核心操作

| 方法 | 签名 | 说明 |
|------|------|------|
| `prompt` | `(text, options?) => Promise<void>` | 发送消息。options: `{ images?: ImageContent[], streamingBehavior?: "steer"|"followUp" }` |
| `subscribe` | `(listener) => () => void` | 订阅事件，返回取消函数 |
| `abort` | `() => Promise<void>` | 中止当前操作 |
| `dispose` | `() => void` | 清理并销毁 |
| `waitForIdle` | `() => Promise<void>` | 等待 agent 空闲 |

### 模型/思考

| 方法 | 说明 |
|------|------|
| `setModel(model)` | **热切换模型**（不需要重建 session） |
| `cycleModel("forward"\|"backward")` | Ctrl+P 循环切模型 |
| `setThinkingLevel(level)` | 设置思考级别 |
| `cycleThinkingLevel()` | 循环到下一个思考级别 |
| `getAvailableThinkingLevels()` | 当前模型支持的级别 |
| `supportsThinking()` | 是否支持 thinking |

### 上下文

| 方法 | 说明 |
|------|------|
| `getContextUsage()` | 返回 `{ tokens, contextWindow, percent }` |
| `getSessionStats()` | 返回 `{ tokens: {input,output,total}, cost, contextUsage }` |
| `compact(customInstructions?)` | 手动压缩上下文 |
| `setAutoCompactionEnabled(bool)` | 开关自动压缩 |

### 消息注入

| 方法 | 说明 |
|------|------|
| `steer(text, images?)` | 中断当前回合并注入消息 |
| `followUp(text, images?)` | 当前回合结束后注入消息 |
| `sendUserMessage(content)` | 以编程方式发送用户消息 |
| `sendCustomMessage(msg)` | 发送自定义类型消息 |

### 工具管理

| 方法 | 说明 |
|------|------|
| `getActiveToolNames()` | 当前活跃工具名列表 |
| `getAllTools()` | 所有工具（含元数据） |
| `setActiveToolsByName(names)` | 运行时切换工具集 ✅ |
| `getToolDefinition(name)` | 按名获取工具定义 |

### 会话管理

| 方法 | 说明 |
|------|------|
| `setSessionName(name)` | 重命名会话（写入 session_info 条目） |
| `reload()` | 重新加载扩展/技能/设置 |
| `exportToHtml(path?)` | 导出为 HTML |

### 属性（只读）

| 属性 | 说明 |
|------|------|
| `sessionId` | 会话 ID |
| `sessionFile` | 文件路径 |
| `sessionName` | 显示名称 |
| `model` | 当前模型 |
| `thinkingLevel` | 当前思考级别 |
| `isStreaming` | 是否在流式传输 |
| `isIdle` | 是否空闲 |
| `messages` | 所有消息 |

---

## 三、SessionManager — 会话持久化

### 静态方法

```typescript
// 新建
SessionManager.create(cwd, sessionDir?)

// 恢复
SessionManager.open(sessionFile, sessionDir?, cwdOverride?)

// 继续最近的
SessionManager.continueRecent(cwd, sessionDir?)

// 内存（不落盘）
SessionManager.inMemory(cwd?)

// 列表
SessionManager.list(cwd, sessionDir?)         → Promise<SessionInfo[]>
SessionManager.listAll()                      → Promise<SessionInfo[]>

// 从其他项目 fork
SessionManager.forkFrom(sourcePath, targetCwd, sessionDir?)
```

### SessionInfo 结构

```typescript
{ path, id, cwd, name?, created: Date, modified: Date,
  messageCount, firstMessage, allMessagesText }
```

### 实例方法

| 方法 | 说明 |
|------|------|
| `getEntries()` | 所有条目（消息、压缩、模型变更等） |
| `getSessionId()` | 会话 ID |
| `getSessionFile()` | 文件路径 |
| `getSessionName()` | 来自 session_info 条目的名称 |
| `appendSessionInfo(name)` | 写入重命名条目 ✅ |
| `getBranch(fromId?)` | 某节点到根的路径 |
| `newSession()` | 清空历史，开新会话 |

---

## 四、ModelRuntime — 模型管理

```typescript
// 创建
const runtime = await ModelRuntime.create({
  allowModelNetwork: false,   // 是否联网刷新目录
  authPath: "~/.pi/auth.json",
  modelsPath: "~/.pi/models.json",
});

// 注册自定义 provider
runtime.registerProvider("my-provider", {
  name: "My Provider",
  apiKey: "sk-xxx",
  api: "anthropic-messages",     // Api 类型
  baseUrl: "https://api.xxx.com",
  models: [{
    id: "model-id",
    name: "Model Name",
    reasoning: true,                 // 必需！
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },  // 必需！
    contextWindow: 200000,
    maxTokens: 32000,
    input: ["text", "image"],        // 必需！
    compat: { supportsDeveloperRole: false },
  }],
});

// 获取模型
runtime.getModel("my-provider", "model-id")     → Model<any> | undefined
runtime.getModels("my-provider")                → Model<any>[]

// Provider 管理
runtime.registerNativeProvider(provider)
runtime.unregisterProvider("my-provider")
```

---

## 五、SettingsManager — 配置管理

```typescript
// 内存模式（EasyMint 当前用法）
const sm = SettingsManager.inMemory({
  compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
  retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000 },
});

// 从文件创建
const sm = SettingsManager.create(cwd, agentDir);
```

### 关键配置项

| 分类 | 配置项 | 默认值 |
|------|--------|--------|
| compaction | `enabled`, `reserveTokens`, `keepRecentTokens` | true, 16384, 20000 |
| retry | `enabled`, `maxRetries`, `baseDelayMs` | true, 3, 2000 |
| steering | `steeringMode`, `followUpMode` | "one-at-a-time" |
| terminal | `showImages`, `imageWidthCells` | true, 60 |
| images | `autoResize`, `blockImages` | true, false |

---

## 六、DefaultResourceLoader — 资源加载

```typescript
const loader = new DefaultResourceLoader({
  cwd,                              // 必需
  agentDir,                         // 必需
  settingsManager,                  // SettingsManager 实例

  // 覆盖
  systemPromptOverride: (base) => customPrompt,   // 替换系统提示
  skillsOverride: (base) => ({ skills, diagnostics }),
  agentsFilesOverride: (base) => ({ agentsFiles }),

  // 禁用
  noSkills: true,          // 不加载 Skills
  noExtensions: true,      // 不加载 Extensions
  noContextFiles: true,    // 不加载 AGENTS.md

  // 追加
  additionalSkillPaths: [...],
});

// 必须调用
await loader.reload();
```

---

## 七、ToolDefinition — 自定义工具

```typescript
import { defineTool } from "@earendil-works/pi-coding-agent";

const myTool = defineTool({
  name: "my_tool",                   // LLM 看到的名称
  label: "我的工具",                  // UI 标签
  description: "工具描述",
  parameters: {                      // JSON Schema
    type: "object",
    properties: { ... },
    required: [...],
  },
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // 5 个参数：toolCallId, params, signal, onUpdate, ExtensionContext
    return { content: [{ type: "text", text: "result" }] };
  },
});
```

---

## 八、AgentSessionEvent — 事件类型

```
agent_start/end/settled
turn_start/end
message_start/update/end
tool_execution_start/update/end
compaction_start/end          ← 压缩开始/结束
auto_retry_start/end          ← 自动重试
summarization_retry_*         ← 摘要重试
queue_update                  ← steer/followUp 队列变化
entry_appended                ← 会话条目追加
session_info_changed          ← 会话名变更
thinking_level_changed        ← 思考级别变更
```

agent_end 特殊字段：`{ messages, willRetry: boolean }`

---

## 九、SessionEntry — 会话条目类型

```
SessionMessageEntry      ← 用户/助手消息
CompactionEntry          ← 压缩摘要
ModelChangeEntry         ← 模型切换记录
ThinkingLevelChangeEntry ← 思考级别变更
SessionInfoEntry         ← 会话显示名称（重命名）
BranchSummaryEntry       ← 分支摘要
CustomEntry              ← 扩展自定义数据
```

---

## 十、EasyMint 使用情况对照

> 更新于 2026-07-31：核对 agent-service / pi-session / session-service 实际代码。

| Pi API | EM 已用 | 备注 |
|--------|---------|------|
| `createAgentSession` | ✅ | pi-session.ts |
| `session.prompt()` | ✅ | agent-service.ts（10 分钟超时保护） |
| `session.subscribe()` | ✅ | agent-service.ts → event-bridge |
| `session.abort()` | ✅ | killChat / agent:abort |
| `session.dispose()` | ✅ | killChat |
| `session.getContextUsage()` | ✅ | context-usage 广播 + ctx-ring 显示 |
| `session.getSessionStats()` | ✅ | agent:sessionStats |
| `session.setModel()` | ✅ | agent:setModel（热切换） |
| `session.cycleModel()` | ✅ | agent:cycleModel |
| `session.setThinkingLevel()` | ✅ | agent:setThinkingLevel（前端思考下拉） |
| `session.setActiveToolsByName()` | ✅ | agent:setActiveTools |
| `session.steer()` | ✅ | agent:steer（中轮打断注入） |
| `session.followUp()` | ✅ | agent:followUp |
| `session.compact()` | ✅ | agent:compact（手动）+ 自动压缩追踪（compaction_end 计数） |
| `SessionManager.appendSessionInfo()` | ✅ | session-service 重命名（等价 setSessionName） |
| `SessionManager.list()` | ✅ | 会话列表（listPiSessions） |
| `SessionManager.open()` | ✅ | 恢复会话（resumePiSession） |
| `SettingsManager.inMemory()` | ✅ | pi-init.ts |
| `DefaultResourceLoader` | ✅ | pi-session.ts |
| `defineTool()` | ✅ | builtin-mcp.ts, task/tool.ts |

**未使用（EM 无对应需求）：** `sendUserMessage`/`sendCustomMessage`（steer/followUp 已覆盖）、`setAutoCompactionEnabled`（Pi 默认自动压缩）、`reload`/`exportToHtml`/`waitForIdle`、`cycleThinkingLevel`/`getAvailableThinkingLevels`/`supportsThinking`、`getActiveToolNames`/`getAllTools`/`getToolDefinition`。

**EM 自定义实现（Pi 无原生等价物，2026-07-31 核对）：**
- **权限系统**：`permissionService` + `wrapToolWithPermission` + 前端 PermissionPrompt——Pi SDK 无 permissionMode（仅有 `tools`/`excludeTools` 工具开关），"智能判断/手动确认/完全自主"需自行实现
- **上下文轮转**：compact 计数达 3 次 → 归档旧会话 + 新建会话 + handoff 接力（用原生 compact 摘要 + SessionManager 归档实现）
- **自动标题**：首条用户消息生成中文标题
- **事件桥接**：`event-bridge.ts`（Pi 事件 → 前端格式）
- **流缓存**：bufferedStream（断线恢复）
