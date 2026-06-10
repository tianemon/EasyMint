# Cognitive Workspace Engine — 技术方案

Version 0.1

---

## 一、项目结构

```
cognitive-workspace-engine/
├── src/
│   ├── index.ts              # MCP Server 入口，stdio transport
│   ├── task-parser.ts        # 需求 1: Task Parser
│   ├── graph-locator.ts      # 需求 2: Graph Locator
│   ├── graph-expander.ts     # 需求 3: Graph Expander
│   ├── workspace-builder.ts   # 需求 4: Workspace Builder
│   ├── context-builder.ts     # 需求 5: Context Builder
│   ├── codegraph-client.ts    # CodeGraph MCP 调用封装
│   ├── llm-client.ts          # LLM 调用封装（Task Parser + Summary）
│   ├── cache.ts               # 内存缓存层
│   └── types.ts               # 共享类型定义
├── tests/
│   ├── task-parser.test.ts
│   ├── graph-locator.test.ts
│   └── workspace-builder.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## 二、模块设计

### 2.1 入口 — index.ts

MCP Server 主入口。定义 3 个 tool，注册 handler，启动 stdio transport。

```
MCP Server
├── tool: focus_build     → WorkspaceBuilder.build() → JSON
├── tool: focus_context   → ContextBuilder.build()   → text
└── tool: focus_summarize → LLM 调用                  → text
```

**技术选型**：`@modelcontextprotocol/sdk` 的 `StdioServerTransport`，与 image-vision MCP Server 一致。

**参考实现**：`resources/mcp/image-vision/server.js`

---

### 2.2 task-parser.ts

**职责**：需求 1.1-1.3

```
输入: task_description (string)
    ↓
LLM 调用（system prompt 内置解析格式）
    ↓
输出: TaskIntent { domains, intent, keywords, complexity }
```

**LLM Prompt 设计**：

```
你是任务解析器。从以下开发任务描述中提取结构化信息。

任务描述：{task_description}

返回 JSON：
{
  "domains": ["涉及的模块名"],
  "intent": "create | modify | fix | understand",
  "keywords": ["中文关键词"],
  "complexity": "simple | medium | complex"
}

规则：
- domains 按 PascalCase 提取模块名
- keywords 只保留功能性词汇
- 如果任务描述过于模糊无法解析，返回 { "domains": [], "intent": "unknown" }
```

**异常处理**（需求规格-异常流程）：
- 返回 `domains: []` 时，上游降级为全文搜索模式

---

### 2.3 codegraph-client.ts

**职责**：封装对 CodeGraph MCP 的调用。本项目作为 MCP Server 运行，不能直接调另一个 MCP Server 的 tool。

**方案**：直接读写 CodeGraph 的 SQLite 数据库。

CodeGraph DB 路径：`{project_path}/.codegraph/codegraph.db`

```
┌─────────────────────────────┐
│ Cognitive Workspace Engine  │
│         │                   │
│         ▼                   │
│   codegraph-client.ts       │
│   SQLite 直读               │
│         │                   │
│         ▼                   │
│  .codegraph/codegraph.db    │
└─────────────────────────────┘
```

**封装方法**：

| 方法 | SQL / 逻辑 | 对应 CodeGraph MCP |
|------|-----------|-------------------|
| `search(name)` | `SELECT * FROM nodes WHERE name LIKE ?` | codegraph_search |
| `callers(nodeId)` | 查 edges WHERE target = nodeId AND kind = 'calls' | codegraph_callers |
| `callees(nodeId)` | 查 edges WHERE source = nodeId AND kind = 'calls' | codegraph_callees |
| `imports(nodeId)` | 查 edges WHERE source = nodeId AND kind = 'imports' | - |
| `impact(nodeId)` | callers + callees + imports 的并集 | codegraph_impact |
| `contains(nodeId)` | 查 edges WHERE source = nodeId AND kind = 'contains' | - |
| `getNode(id)` | `SELECT * FROM nodes WHERE id = ?` | codegraph_node |

**依赖**：`better-sqlite3`（同步 SQLite 驱动，npm 包）

---

### 2.4 graph-locator.ts

**职责**：需求 2.1-2.2

```
输入: domains[], projectPath
    ↓
codegraph-client.search(domain) × domains.length
    ↓
输出: FocusNode[]  入口节点列表
```

**异常处理**（需求规格-异常流程）：
- 无匹配 → 返回空数组，Workspace Builder 降级为全文搜索

---

### 2.5 graph-expander.ts

**职责**：需求 3.1-3.3

```
输入: entryNodes[], depth=1
    ↓
for each node:
  codegraph-client.callees(nodeId)  → 调用了谁
  codegraph-client.callers(nodeId)  → 谁调用了它
  codegraph-client.imports(nodeId)  → import 了谁
  codegraph-client.impact(nodeId)   → 影响范围
    ↓
去重 + 标记 relation 类型
    ↓
输出: FocusNode[]  关联节点列表（不含入口节点）
```

**限制**（需求规格-异常流程）：
- 扩散后总数 >50 → 按 relation 优先级排序取前 50（direct > calls > imports > depends_on）

---

### 2.6 workspace-builder.ts

**职责**：需求 4.1-4.2

```
输入: entryNodes[], relatedNodes[]
    ↓
按分层分配规则（需求规格-分层分配规则）：
  - 入口节点 → Primary
  - imports/calls 邻居 → Secondary
  - depends_on / 被 impact → Dependency
  - 项目根模块/主入口 → Background
    ↓
LLM 生成每个 group 的 summary
    ↓
输出: WorkspaceGraph { primary, secondary, dependency, background }
```

**V0.1 简化**：只生成 primary（secondary/dependency/background 为空数组）。

**Summary 生成**：
- 对每个 FocusGroup 调 `llm-client.summarize(domain, nodes)`
- LLM 生成一句话描述，如 "OrganizationModule 管理组织架构的增删改查"
- Summary 不缓存（V0.2 缓存到 CodeGraph nodes.summary）

---

### 2.7 context-builder.ts

**职责**：需求 5.1-5.2

```
输入: taskDescription, WorkspaceGraph, ImpactResult
    ↓
组装文本模板
    ↓
输出: ContextPackage { task, workspace, impact, constraints, prompt }
```

**Prompt 模板**：

```
当前任务: {taskDescription}

Primary Focus:
{primary.nodes 逐行列出}

Secondary Focus:
{secondary.nodes}

Dependency:
{dependency.nodes}

影响范围:
{impact.affected}

约束:
- 遵循项目现有编码规范
- 不修改 {impact.critical} 的核心接口
```

---

### 2.8 llm-client.ts

**职责**：封装 LLM 调用。

Task Parser 和 Workspace Builder 的 Summary 生成都需要调 LLM。统一封装：

```
llmClient.complete(systemPrompt, userPrompt, responseFormat)
  → JSON（用于 Task Parser）
  → text（用于 Summary）
```

**技术选型**：
- 复用环境变量 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`（与 EasyMint / claude-agent-sdk 共用）
- 直接调 Anthropic Messages API（`fetch` + `POST /v1/messages`）
- 不需要 SDK，纯 HTTP 调用即可

**超时**：10 秒。超时则跳过 summary，用 node name 作为 fallback。

---

### 2.9 cache.ts

**职责**：内存缓存，避免同一任务重复计算。

```
Map<taskDescriptionHash, WorkspaceGraph>
```

**TTL**：5 分钟（任务通常不会在 5 分钟内重复执行）。

**V0.1 不持久化**。后续版本可考虑基于 task.json task id 的持久缓存。

---

## 三、数据流

```
focus_context 调用
    │
    ▼
task-parser.ts
    │ TaskIntent
    ▼
graph-locator.ts ──→ codegraph-client.ts ──→ .codegraph/codegraph.db
    │ entryNodes[]
    ▼
graph-expander.ts ──→ codegraph-client.ts
    │ relatedNodes[]
    ▼
workspace-builder.ts ──→ llm-client.ts (summary)
    │ WorkspaceGraph
    ▼
context-builder.ts
    │ ContextPackage.prompt
    ▼
返回给 Builder System Prompt
```

---

## 四、与需求的交叉验证

| 需求 | 技术方案覆盖 | 模块 |
|------|------------|------|
| 1.1 Task Parser | ✅ LLM 调用 + 结构化 prompt | task-parser.ts + llm-client.ts |
| 1.2 提取 domain/intent/keywords | ✅ TaskIntent 接口 | types.ts |
| 1.3 判断复杂度 | ✅ complexity 字段 | task-parser.ts |
| 2.1 定位入口节点 | ✅ SQL LIKE 查询 | graph-locator.ts + codegraph-client.ts |
| 3.1 扩散 1 层 | ✅ callees/callers/imports 组合 | graph-expander.ts |
| 3.2/3.3 impact | ✅ callers + callees + imports 并集 | graph-expander.ts |
| 4.1 分层分配 | ✅ 4 层规则 | workspace-builder.ts |
| 4.2 summary 生成 | ✅ LLM 调用 | workspace-builder.ts + llm-client.ts |
| 5.1/5.2 Context Builder | ✅ 文本模板 | context-builder.ts |
| 6.1 focus_build MCP tool | ✅ StdioServerTransport | index.ts |
| 6.2 focus_context MCP tool | ✅ 同上 | index.ts |
| 6.3 focus_summarize MCP tool | ✅ 同上 | index.ts |
| 异常: CodeGraph 不可用 | ✅ check DB file exists | codegraph-client.ts |
| 异常: 扩散 >50 节点 | ✅ 截断 | graph-expander.ts |
| 异常: LLM 超时 | ✅ 10s timeout + fallback | llm-client.ts |
| 异常: 缓存命中 | ✅ Map + TTL | cache.ts |

**缺口**：无。V0.1 所有需求和异常都有对应模块。

---

## 五、依赖

| 包 | 用途 | npm |
|----|------|-----|
| `@modelcontextprotocol/sdk` | MCP Server 框架 | 已有（image-vision 在用） |
| `better-sqlite3` | SQLite 直读 CodeGraph DB | 需新增 |
| `typescript` | 类型检查 | 已有 |

**零外部服务依赖**：不调 CodeGraph MCP Server（直读 SQLite），不调第三方 API（LLM 用 EasyMint 已有的 API 配置）。

---

## 六、本地开发

```bash
# 初始化
npm install
npm run build

# 配置 MCP（~/.easymint/.claude.json 或 ~/.claude/.claude.json）
{
  "cognitive-workspace": {
    "type": "stdio",
    "command": "node",
    "args": ["/path/to/cognitive-workspace-engine/dist/index.js"],
    "env": {
      "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
      "ANTHROPIC_AUTH_TOKEN": "sk-xxx"
    }
  }
}

# 或通过环境变量继承现有配置（和 EasyMint 共用同一 API）
```
