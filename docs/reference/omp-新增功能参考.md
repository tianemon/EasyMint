# omp 新增功能参考

> 基于 oh-my-pi (`@oh-my-pi/pi-coding-agent` v17.0.8) 相比原始 Pi 的增量分析
> 标注 Node.js 移植可行性：✅纯JS / ⚠️需适配 / ❌Bun依赖

---

## 一、移植策略总览

omp 的核心新增功能分为三层：

```
Tier 1 — 立即可用（纯 JS，对 EasyMint 价值最高）
Tier 2 — 需替换 Bun API（用 Node 等价物替代即可）
Tier 3 — 完整子系统（移植成本高，按需选择）
```

**关键结论：omp 几乎所有核心逻辑都是纯 TypeScript。Bun 依赖集中在 CLI 入口、TUI 渲染、原生工具层。SDK 层面的代码（session、task、mcp、model registry）基本不依赖 Bun。**

---

## 二、Tier 1 — 立即可用

### 1. MCPManager — 完整 MCP 生命周期

```typescript
// omp mcp/manager.ts
const manager = new MCPManager({...});
await manager.discoverAndConnect();        // 从 .mcp.json 自动连接
const tools = manager.getTools();          // 获取所有 MCP 工具
const status = manager.getConnectionStatus(name);  // 连接状态
const instructions = manager.getServerInstructions(); // 系统提示注入
```

**EasyMint 价值**：我们有 `@modelcontextprotocol/sdk`，可以直接桥接 omp 的 MCPManager 逻辑。CodeGraph、Playwright 等 MCP 服务器就能用。纯 JS，零 Bun 依赖。

### 2. 并发控制 — mapWithConcurrencyLimit + Semaphore

```typescript
// omp task/parallel.ts — 已移植到 app/main/services/task/parallel.ts
const { results, aborted } = await mapWithConcurrencyLimit(items, concurrency, fn, signal);
```

### 3. 结构化子 Agent — runStructuredSubagent

```typescript
// omp task/structured-subagent.ts
const result = await runStructuredSubagent({
  discovery, agentName, task,
  outputSchema: {...},      // schema 验证
  isIsolated: true,         // worktree 隔离
  applyChanges: true,       // 自动合并
});
```

**EasyMint 价值**：我们的 `task/executor.ts` 是简化版。omp 的 `structured-subagent.ts` 包含 schema 验证输出、yield 工具、隔离模式。纯 JS，可直接移植。

### 4. ModelRegistry — 增强的模型注册表

```typescript
// omp config/model-registry.ts
const registry = new ModelRegistry(authStorage);
registry.registerProvider("my-provider", {
  apiKey, api, baseUrl,
  models: [{...}],
  compat: { disableStrictTools: true },  // 兼容性覆盖
});
registry.refreshInBackground();           // 后台刷新
```

**EasyMint 价值**：比原始 Pi 的 ModelRuntime 多了动态刷新、compat 覆盖、模型缓存等。纯 JS，但引入后改动面大。

### 5. createAgentSession 新增选项

omp 的 `CreateAgentSessionOptions` 增加了约 30 个选项，最实用的：

| 选项 | 说明 |
|------|------|
| `deadline` | 会话截止时间（Unix ms） |
| `autoApprove` | 自动批准所有工具调用 |
| `hasUI` | 区分 UI/headless |
| `outputSchema` | 结构化输出 schema |
| `enableMCP` | MCP 开关 |
| `mcpManager` | 复用已有 MCP Manager |
| `eventBus` | 共享事件总线 |
| `settings` | Settings 实例 |

---

## 三、Tier 2 — 需替换 Bun API

omp 中 Bun API 的使用集中在以下几类，每种都有 Node.js 等价物：

| Bun API | Node.js 替代 |
|---------|-------------|
| `Bun.file(path).text()` | `fs.promises.readFile(path, 'utf-8')` |
| `Bun.write(path, data)` | `fs.promises.writeFile(path, data)` |
| `Bun.sleep(ms)` | `new Promise(r => setTimeout(r, ms))` 或 `await new Promise(...)` |
| `Bun.randomUUIDv7()` | `crypto.randomUUID()` |
| `Bun.env.XXX` | `process.env.XXX` |
| `Bun.deepEquals(a, b)` | `assert.deepStrictEqual` 或 `JSON.stringify` 比较 |
| `Bun.fetch.preconnect()` | 不需要（纯优化），可省略 |
| `YAML.parse(str)` / `YAML.stringify(obj)` | `js-yaml` 库 |
| `JSONC.parse(str)` | `jsonc-parser` 库 |

**关键发现**：omp 的 SDK 核心（session、task、mcp、model registry）中只有约 5 处 Bun API 调用。其余大量代码是纯 TypeScript，可以直接拷。

---

## 四、Tier 3 — 需评估的子系统

### Worktree 隔离 (task/isolation-runner.ts + task/worktree.ts)

需 `@oh-my-pi/pi-natives` 的 PAL（平台抽象层）。但核心逻辑（git worktree、captureDeltaPatch、mergeTaskBranches）是纯 git 命令，可用 `child_process.execSync` 替代 N-API 调用。

### Settings YAML 支持

omp 用 `bun:YAML` 做持久化。替换为 `js-yaml` 即可。

### Extension 系统

omp 的 Extension 系统深度绑定 session 生命周期、TUI 事件、命令触发。EasyMint 暂时不需要。

### Advisor 系统

副驾驶/代码审查 agent，依赖压缩基础设施和消息队列。可后置。

---

## 五、直接移植优先级

按 EasyMint 的实际需求排序：

1. **MCPManager** — 让 CodeGraph 等 MCP 工具在 Pi 会话中可用（Tier 1，纯 JS）
2. **structured-subagent** — schema 验证 + yield 工具 + 隔离模式（Tier 1）
3. **Settings.override() + provider 自定义覆盖** — 从 omp config/settings.ts 取运行时覆盖逻辑（Tier 2）
4. **Worktree 隔离** — 并行任务文件隔离（Tier 3）
5. **Advisor 系统** — 可后置

---

## 六、不建议移植的部分

| 功能 | 原因 |
|------|------|
| TUI 渲染器 | EasyMint 是 Electron GUI |
| LSP 集成 | 需要完整的 LSP 客户端端实现 |
| Snapcompact | 依赖 `@oh-my-pi/snapcompact` 原生包 |
| CLI 参数解析 | EasyMint 没有 CLI |
| Collab 实时协作 | EasyMint 不存在协作需求 |
| Eval (Python/Bun kernel) | 超出 EasyMint 范围 |
