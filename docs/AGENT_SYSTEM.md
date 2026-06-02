# Agent 系统设计

## 开发背景

EasyMint 当前是单一 Mint 会话模式：用户和一个 AI 对话，Mint 负责需求分析、项目管理、代码开发全部角色。问题是：

1. **上下文压力**：一个会话承载所有对话，随着项目变大，上下文窗口会被塞满
2. **角色混淆**：Mint 既当 PM 又当开发者又当测试员，没有分工
3. **不可持续**：一个 Agent 一旦上下文满了就只能 compact 或重建，丢失关键上下文
4. **无法并行**：单一会话只能串行处理任务

## 目标场景

**场景 1：任务分配后自动执行**

```
用户填写项目信息 → Mint 分配任务 → task.json 就绪
  → 用户点击"执行任务"
    → Orchestrator Agent 启动
      → 逐任务：创建 Builder 实现 → 创建 Evaluator 验收
        → 验收通过 → 标记 passes:true → 下一任务
        → 验收失败 → 通知 Mint → 用户决定重试/跳过
    → 全部完成 → 通知 Mint 总结
```

**场景 2：单次对话式的开发**

```
用户: "帮我修一下登录页的样式"
  → Mint: "需要我调 Builder 来做吗？"
  → 用户: "好"
    → Mint 激活 Builder Agent
      → Builder 修改代码
      → Evaluator 用 Playwright 截图对比
    → Builder 汇报结果给 Mint
  → Mint: "改好了，你看看"
```

**场景 3：临时 Agent，用完即弃**

```
每个开发任务:
  1. Mint/Orchestrator 创建新的 Builder Agent
  2. Builder 独立上下文，拿到任务描述+相关代码
  3. Builder 完成 → 返回结果
  4. Evaluator 验收
  5. Builder 会话存档 → 进程销毁 → 释放上下文
```

## 会话层级

Mint 和 Orchestrator 是**平级独立会话**（各自的 ActiveChat），通过 `notifySession` 通信。Orchestrator 内部用 SDK Task 工具创建 Builder/Evaluator Subagent。

```
独立会话（平级，各自有 options.agents）
  ┌──────────────┐     notifySession     ┌─────────────────┐
  │  Mint        │ ←──────────────────→  │  Orchestrator   │
  │  ActiveChat  │                       │  ActiveChat     │
  └──────────────┘                       └────────┬────────┘
                                                   │
                                    内部调 Task 工具（SDK 自动匹配模板）
                                                   │
                          ┌──────────────┬─────────┴──────────┐
                          │              │                    │
                     Task(builder)  Task(evaluator)   Task(builder)
                     Subagent       Subagent          Subagent
                     (临时、自动销毁) (临时、自动销毁)  (下一任务)
```

> **为什么 Orchestrator 不能是 Mint 的 Subagent？** SDK Task 不保证 Subagent 继承 `options.agents`。如果 Orchestrator 是 Subagent，它拿不到 Builder/Evaluator 模板，链式调用就断了。独立 ActiveChat 通过 `buildQueryOptions` 正常注入 `options.agents`。

## 架构分层

```
Layer 3  产品     预设模板库 · 文档生成 · 报表 · 最佳实践建议
Layer 2  协同     Orchestrator 调度 · Builder/Evaluator 协作 · 升级机制 · 上下文管理
Layer 1  核心     Agent 模板 CRUD · 模板注入到 SDK · notifySession · spawnAgentChat · 设置 UI
Layer 0  地基     多 ActiveChat 并存 · 消息通道 · query 封装 · SDK 集成
                  ✅ 全部完成
```

## SDK 原生支持（不需要自己实现）

SDK 通过 `options.agents` + Task 工具原生提供了 Agent 模板定义和 Subagent 生命周期管理。

### 模板定义

```ts
// 在 query() 的 options 中直接声明。SDK 原生支持，不需要额外封装。
options: {
  agents: {
    "builder": {
      description: "实现代码任务。当需要实现 task.json 中的开发任务时使用此 Agent",
      prompt: "你是 Builder Agent。工作流程: 1.读 docs/需求规格.md 2.读 task.json 3.实现 4.测试 5.标记 passes:true",
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    },
    "evaluator": {
      description: "验收代码变更。当需要验证 builder 的工作成果时使用此 Agent",
      prompt: "你是 Evaluator Agent。读 task.json 找到待验证的任务，运行测试，检查代码，返回通过或失败",
      tools: ["Read", "Bash", "Glob", "Grep", "mcp__playwright__*"]
    }
  }
}
```

### 模板提示词注入机制

SDK 内部自动完成，不需要我们写代码：

```
主会话调用 Task 工具:
  { name: "Task", input: { prompt: "实现 task.json 第 3 个任务", subagent_type: "builder" } }

SDK 内部:
  1. 读 options.agents["builder"]
  2. 取 AgentDefinition.prompt → "你是 Builder Agent..."
  3. 创建 Subagent 子进程:
     query({
       prompt: "实现 task.json 第 3 个任务",    ← Task 参数
       options: {
         systemPrompt: {
           type: "preset",
           preset: "claude_code",
           append: "你是 Builder Agent..."     ← 模板 prompt 自动注入
         },
         tools: ["Read", "Write", "Bash", ...]  ← 模板 tools 自动应用
       }
     })

Subagent 看到:
  [system] Claude Code 默认 + "你是 Builder Agent..."
  [user]   "实现 task.json 第 3 个任务"
```

### Subagent 生命周期（SDK 自动管理）

```
一次 Task 调用 = 创建 Subagent → 执行 → 返回结果 → 自动销毁

- 上下文隔离：每个 Subagent 独立进程，不污染主会话
- 用完即弃：Task 返回后 Subagent 自动销毁，不积累上下文
- 成本可控：只在实际执行任务时消耗 token
```

### 上下文传递方式

推荐用文件约定，而不是把所有信息塞进 Task 参数：

```
Task 参数（轻量）:
  "实现 task.json 第 3 个任务。先读 docs/需求规格.md 了解项目"

Builder 内部:（自己读文件获取完整上下文）
  ① Read docs/需求规格.md  → 项目全貌
  ② Read docs/架构设计.md  → 技术栈
  ③ Read task.json          → 具体任务
  ④ 实现 → 测试 → 标记
```

这和 Claude Code 的工作方式一致——每个新会话先读 CLAUDE.md 了解项目。

---

## Layer 1 — 核心能力（需要实现）

| 功能 | 实现位置 | 说明 |
|------|---------|------|
| Agent 模板 CRUD | `agent-templates.ts` | JSON 存储（`em-settings.json`），增删改查 |
| 设置面板模板管理 UI | `SettingsDialog.tsx` 新 Tab | 创建/编辑/删除模板 |
| 模板写入 `options.agents` | `agent-service.ts` `buildQueryOptions` | 启动 Mint/Orchestrator 时加载模板 |
| `notifySession(targetId, msg)` | `agent-service.ts` | A→B channel enqueue，跨 Agent 通信 |
| Session 身份标记 | `ActiveChat` 加 `type` 字段 | 区分 mint/orchestrator/builder/evaluator |

> `spawnAgent` 和 `destroyAgent` 不需要了——SDK 的 Task 工具自动管理 Subagent 的创建和销毁。

## Layer 2 — 任务协同（需要实现）

| 功能 | 说明 |
|------|------|
| Orchestrator 模板 + 循环 | 读 task.json，为每个任务调 Task(builder) → Task(evaluator) → 判断结果 → 下一任务 |
| Builder 模板 | 实现单个任务。context 通过文件获取，Task 参数只给执行指令 |
| Evaluator 模板 | 验收 Builder 工作。调 Playwright/Bash 测试 → 返回 pass/fail |
| 升级机制 | Subagent 遇阻塞 → 写入 `.easymint/escalation.json` → Orchestrator 检测 → notifySession Mint → 用户决策 |
| 上下文管理 | SDK 自动：每个 Task 调用 = 新的 Subagent 进程 = 独立上下文。不做持久存活 |

## 开发顺序

```
Layer 1.1 → Agent 模板 CRUD（agent-templates.ts + IPC + 设置 UI）
Layer 1.2 → 模板注入 buildQueryOptions（options.agents）
Layer 1.3 → notifySession（跨 Agent 即时通信）
─── Layer 1 完成，可在设置中管理模板，Agent 间可通信 ───
Layer 2.1 → Builder 模板 + 手动 Task 调用验证
Layer 2.2 → Evaluator 模板 + 验收验证
Layer 2.3 → Orchestrator 模板 + 任务循环
Layer 2.4 → 升级机制
─── Layer 2 完成，Agent 自主执行全部任务 ───
Layer 3   → 体验层（预设库、报表，以后再说）
```

## Agent 模板数据结构

```ts
interface AgentTemplate {
  id: string;
  name: string;           // 显示名，如 "Builder"
  description: string;    // 用途说明（SDK 用于匹配何时调用此 Agent）
  prompt: string;         // 系统提示词（SDK 自动注入到 Subagent 的 system prompt）
  tools: string[];        // 可用工具白名单（SDK 自动限制 Subagent）
  model?: string;         // 模型（不填则继承默认）
  agentType: "mint" | "orchestrator" | "builder" | "evaluator";
}
```

> 注意：`description` 和 `prompt` 字段名与 SDK 的 `AgentDefinition` 保持一致，可以直接展开到 `options.agents` 中。

## 和 Bash 脚本方案的对比

| | Bash 脚本循环 | Agent + Task |
|------|---------|---------|
| 会话连续性 | ❌ 每轮独立 | ✅ 主会话常驻 |
| 上下文管理 | ❌ 无隔离，进程级 | ✅ 每个 Subagent 独立窗口 |
| 决策能力 | ❌ exit code 二元判断 | ✅ AI 级分析 |
| 实时反馈 | ❌ 只有最终结果 | ✅ 实时 stream |
| 用户介入 | ❌ 跑完才知道 | ✅ 随时可中断/调整 |
| 模板 prompt 注入 | ❌ 需要自己拼 command | ✅ SDK 自动注入 |
| Subagent 生命周期 | ❌ 脚本管理 | ✅ SDK 自动托管 |
