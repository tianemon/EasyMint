# Cognitive Workspace Engine — 开发任务

## V0.1 目标

Task → Primary Workspace → Builder System Prompt。

V0.1 只有一个 MCP Server 进程，能生成单焦点 Workspace 并注入 Builder。

---

## 任务依赖图

```
Sprint 1 — 基础设施
T-001 types.ts
T-002 codegraph-client.ts
T-003 cache.ts
    │
Sprint 2 — 核心管线
T-004 llm-client.ts
T-005 task-parser.ts
    │
T-006 graph-locator.ts
T-007 graph-expander.ts
    │
T-008 workspace-builder.ts
    │
Sprint 3 — 输出 + 集成
T-009 context-builder.ts
T-010 index.ts (MCP Server)
    │
Sprint 4 — 测试 + 文档
T-011 测试
T-012 README
```

---

## Sprint 1：基础设施

### T-001 — types.ts

**做什么**

定义所有共享类型：TaskIntent、WorkspaceGraph、FocusGroup、FocusNode、ContextPackage。直接引用需求规格-数据结构。

**验收**

- `npx tsc --noEmit` 通过
- 所有接口有 JSDoc 注释

**参考**：`需求规格.md` 第 4 节

---

### T-002 — codegraph-client.ts

**做什么**

封装 SQLite 直读 CodeGraph DB。实现 7 个方法：

| 方法 | SQL |
|------|-----|
| `search(name)` | `SELECT * FROM nodes WHERE name LIKE '%name%' LIMIT 20` |
| `callers(id)` | edges WHERE target=id AND kind='calls' → JOIN nodes |
| `callees(id)` | edges WHERE source=id AND kind='calls' → JOIN nodes |
| `imports(id)` | edges WHERE source=id AND kind='imports' → JOIN nodes |
| `impact(id)` | callers + callees + imports 的并集（去重） |
| `contains(id)` | edges WHERE source=id AND kind='contains' → JOIN nodes |
| `getNode(id)` | `SELECT * FROM nodes WHERE id = ?` |

**验收**

- 对 EasyMint 自己的 .codegraph DB 跑 `search("agent")` 返回结果
- 对不存在的 DB 路径返回友好错误 `{ error: "CodeGraph 未初始化" }`

**依赖**：`npm install better-sqlite3`

---

### T-003 — cache.ts

**做什么**

内存缓存层。`Map<string, WorkspaceGraph>`，key 为任务描述 hash。TTL 5 分钟。

**验收**

- 同一任务描述 5 分钟内重复调用命中缓存
- 5 分钟后过期返回 null

---

## Sprint 2：核心管线

### T-004 — llm-client.ts

**做什么**

调 Anthropic Messages API（`POST /v1/messages`）。

```
llmClient.complete(systemPrompt, userPrompt, { json: true })
  → parsed JSON

llmClient.complete(systemPrompt, userPrompt)
  → text
```

**环境变量**：读 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`。

**超时**：10 秒。超时抛出 `LLMTimeoutError`。

**验收**

- 用 DeepSeek API 成功调用并返回结果
- 超时后正确抛出错误

---

### T-005 — task-parser.ts

**做什么**

接收自然语言任务描述 → LLM 解析 → TaskIntent。

Prompt 见 `技术方案.md` 2.2 节。

**验收**

- 输入 "修复登录页面样式错乱" → domains=["Login"] intent="fix"
- 输入空字符串 → domains=[] intent="unknown"
- LLM 超时 → 抛出 TaskParserError

---

### T-006 — graph-locator.ts

**做什么**

对每个 domain 调 `codegraphClient.search(domain)`，合并结果去重。

**验收**

- 对已索引项目，domain="Auth" → 返回 AuthService, AuthModule 等节点
- 无匹配 domain → 返回空数组

---

### T-007 — graph-expander.ts

**做什么**

从入口节点扩散 1 层：callees + callers + imports + impact。

**验收**

- 输入 AuthService 节点 → 返回其直接调用、被调用、import 的邻居
- 总数 >50 时截断到 50
- 标记每个节点的 relation 字段

---

### T-008 — workspace-builder.ts

**做什么**

按分层规则将节点分配到 Primary/Secondary/Dependency/Background。

V0.1 简化：**只生成 Primary**。其余三组为空数组 `[]`。

对于 V0.1：所有入口节点 + 所有关联节点 → 全部放入 primary。

调用 `llmClient.complete()` 生成 group summary。

**验收**

- 输入 nodes → 输出 WorkspaceGraph（primary 有内容，其余为空数组）
- primary 中每个 FocusGroup 有 summary
- LLM 失败时 summary fallback 为 domain 名

---

## Sprint 3：输出 + 集成

### T-009 — context-builder.ts

**做什么**

输入 WorkspaceGraph + Impact → 组装 System Prompt 文本。

模板见 `技术方案.md` 2.7 节。

**验收**

- 输出包含任务描述、Primary Focus 列表、约束
- Primary Focus 中每个节点有 name + summary
- 纯文本格式，无 JSON

---

### T-010 — index.ts（MCP Server）

**做什么**

注册 3 个 MCP tool，stdio transport。

```
tool: focus_build     → buildWorkspace → JSON
tool: focus_context   → buildContext   → text
tool: focus_summarize → llmClient.complete(nodeId) → text
```

**参考实现**：`resources/mcp/image-vision/server.js`

**验收**

- `node dist/index.js` 启动，stdio 通信正常
- `mcp__cognitive_workspace__focus_context` 返回有效的 System Prompt 文本
- CodeGraph DB 不存在时返回友好错误

---

## Sprint 4：测试 + 文档

### T-011 — 测试

**做什么**

| 文件 | 测试内容 |
|------|---------|
| `task-parser.test.ts` | 正常解析 / 空输入 / 模糊输入 |
| `graph-locator.test.ts` | 匹配 / 无匹配 / DB 不存在 |
| `workspace-builder.test.ts` | 单节点 / 多节点 / LLM 超时 |

**验收**：`npm test` 全部通过，覆盖核心路径和异常路径

---

### T-012 — README.md

**做什么**

- 项目说明：是什么、怎么用
- 安装：`npm install && npm run build`
- 配置：MCP JSON 示例
- 环境变量说明

---

## 任务汇总

| # | 模块 | Sprint | 类型 |
|---|------|--------|------|
| T-001 | types.ts | 1 | 类型定义 |
| T-002 | codegraph-client.ts | 1 | SQLite 封装 |
| T-003 | cache.ts | 1 | 缓存 |
| T-004 | llm-client.ts | 2 | LLM 调用 |
| T-005 | task-parser.ts | 2 | 任务解析 |
| T-006 | graph-locator.ts | 2 | 入口定位 |
| T-007 | graph-expander.ts | 2 | 扩散 |
| T-008 | workspace-builder.ts | 2 | 工作区构建 |
| T-009 | context-builder.ts | 3 | 上下文组装 |
| T-010 | index.ts | 3 | MCP Server |
| T-011 | 测试 | 4 | 测试 |
| T-012 | README.md | 4 | 文档 |

共 12 个 Task，4 个 Sprint。每个 Task 是 Builder 可以独立完成、Evaluator 可以独立验收的粒度。
