# Agent 系统设计

## 架构分层

```
Layer 3  产品层   预设模板库 · 文档生成 · 报表 · 最佳实践建议（预留）
Layer 2  协同层   Builder/Evaluator 协作 · Task 调度 · 升级机制
Layer 1  核心层   Agent 模板系统 · 模板注入 · notifySession · spawnAgentChat · 设置 UI
Layer 0  地基     多 ActiveChat 并存 · 消息通道 · query 封装 · SDK 集成
                 ✅ 全部完成
```

## 会话层级

Mint 作为主会话（唯一），内部通过 SDK 的 Task 工具驱动 Builder/Evaluator Subagent。Subagent 用完即销毁，不积累上下文。

```
独立会话
  ┌─────────────────────────────────────────────┐
  │  Mint（唯一的 ActiveChat）                     │
  │  options.agents 注入 builder + evaluator 模板  │
  └──────────────┬──────────────────────────────┘
                 │ 内部调 SDK Task 工具
    ┌────────────┴──────────┐
    │                       │
  Task(builder)         Task(evaluator)
  Subagent               Subagent
  (临时、自动销毁)         (临时、自动销毁)
```

## 功能树

```
Agent 系统
├─ 1.1 模板管理
│   ├─ 1.1.1 创建模板（名称、描述、提示词、工具、模型）
│   ├─ 1.1.2 编辑模板
│   ├─ 1.1.3 删除模板
│   └─ 1.1.4 模板列表（设置面板 UI）
│
├─ 1.2 模板注入
│   ├─ 1.2.1 启动会话时写入 options.agents
│   ├─ 1.2.2 SDK Task 工具调用时自动匹配模板
│   └─ 1.2.3 spawnAgentChat：从模板创建独立 ActiveChat
│
├─ 1.3 Agent 间通信
│   ├─ 1.3.1 notifySession(targetId, msg) — channel enqueue 即时通信
│   ├─ 1.3.2 Session 身份标记（ActiveChat.agentType）
│   └─ 1.3.3 notify.ts 脚本（供 Bash 工具调用）
│
├─ 1.4 任务执行（Layer 2）
│   ├─ 1.4.1 读 task.json 获取待执行任务列表
│   ├─ 1.4.2 逐任务调 Task(builder) 实现
│   ├─ 1.4.3 逐任务调 Task(evaluator) 验收
│   └─ 1.4.4 通过→下一任务，失败→重试或升级
│
└─ 1.5 升级机制（Layer 2）
    ├─ 1.5.1 Builder/Evaluator 遇阻塞→写入 .easymint/escalation.json
    ├─ 1.5.2 Mint 检测 escalation→通知用户
    └─ 1.5.3 用户决策（重试/跳过/人工介入）
```

## 用户角色

| 角色 | 权限 |
|------|------|
| 项目创建者 | 管理 Agent 模板（增删改）、启停 Agent、查看执行进度 |
| Mint（PM） | 分配任务到 task.json、调 Builder/Evaluator 执行、处理升级 |
| Builder | 实现单个任务，完成后返回结果 |
| Evaluator | 验收 Builder 工作，返回 pass/fail |

## 状态机

```
Agent 模板:
  草稿 → 已保存 → (编辑) → 已更新
               └─→ 已删除

Agent 实例（SDK Task 自动托管）:
  未启动 → 执行中 → 已完成（返回结果）→ 已销毁
                   └─→ 失败（返回错误）→ 已销毁

任务:
  pending → running（Builder 实现中）→ evaluating（Evaluator 验收中）
    ├─→ done（passes:true）
    └─→ escalated（需用户决策）
          ├─→ retry
          └─→ skipped
```

## SDK 原生支持

### 模板定义

```ts
// 在 query() 的 options 中直接声明。SDK 原生支持。
options: {
  agents: {
    "builder": {
      description: "实现代码任务",
      prompt: "你是 Builder Agent。工作流程: 1.读 docs/需求规格.md 2.读 task.json 3.实现 4.测试 5.标记 passes:true",
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    },
    "evaluator": {
      description: "验收代码变更",
      prompt: "你是 Evaluator Agent。读 task.json 找到待验证的任务，运行测试，检查代码，返回通过或失败",
      tools: ["Read", "Bash", "Glob", "Grep", "mcp__playwright__*"]
    }
  }
}
```

### Subagent 生命周期（SDK 自动托管）

```
一次 Task 调用 = 创建 Subagent → 执行 → 返回结果 → 自动销毁

- 上下文隔离：每个 Subagent 独立进程，不污染主会话
- 用完即弃：Task 返回后 Subagent 自动销毁
- 成本可控：只在实际执行任务时消耗 token
```

### 上下文传递方式

推荐用文件约定，而不是把所有信息塞进 Task 参数：

```
Task 参数（轻量）:
  "实现 task.json 第 3 个任务。先读 docs/需求规格.md 了解项目"

Builder 内部（自己读文件获取完整上下文）:
  ① Read docs/需求规格.md  → 项目全貌
  ② Read docs/架构设计.md  → 技术栈
  ③ Read task.json          → 具体任务
  ④ 实现 → 测试 → 标记
```

---

## Layer 1 — 核心能力（全部完成）✅

| 功能 | 实现位置 | 说明 |
|------|---------|------|
| Agent 模板 CRUD | `agent-templates.ts` | JSON 存储（`em-settings.json`），系统管理模板 |
| 设置面板模板管理 UI | `SettingsDialog.tsx` | 只读展示 |
| 模板写入 `options.agents` | `agent-service.ts` `buildQueryOptions` | 启动会话时加载模板 |
| `notifySession(targetId, msg)` | `agent-service.ts` | A→B channel enqueue，跨 Agent 通信 |
| `spawnAgentChat(projectPath, templateId, msg)` | `agent-service.ts` | 从模板创建独立 ActiveChat |
| Session 身份标记 | `ActiveChat` 加 `type` 字段 | 区分 mint/builder/evaluator |

## Layer 2 — 任务协同（设计就绪，待联调）

| 功能 | 状态 | 说明 |
|------|------|------|
| Mint 直接驱动 Task(builder) | ⬜ | spawnAgentChat + 模板已就绪，需实际跑通完整流程 |
| Task(evaluator) 验收 | ⬜ | Evaluator 模板已定义 |
| 升级机制 | ⬜ | Escalation/Decision 类型已定义，前端 UI 待实现 |
| 上下文管理 | ✅ | SDK 自动：每个 Task 调用 = 新的 Subagent = 独立上下文 |

## Escalation 协议类型

```ts
/** Builder/Evaluator 遇阻塞时写入 .easymint/escalation.json */
interface Escalation {
  type: "escalation";
  from: string;        // Agent name
  taskId: string;      // task.json task id
  reason: string;      // human-readable reason
  details: string;     // detailed error / context
  options: string[];   // suggested actions, e.g. ["重试", "跳过", "人工介入"]
  timestamp: number;
}

/** Mint 写入用户决策到 .easymint/decision.json */
interface Decision {
  taskId: string;
  action: "retry" | "skip" | "abort";
  reason?: string;
  timestamp: number;
}
```

## Agent 模板数据结构

```ts
interface AgentTemplate {
  id: string;
  name: string;           // 显示名，如 "Builder"
  description: string;    // 用途说明（SDK 用于匹配何时调用此 Agent）
  prompt: string;         // 系统提示词（SDK 自动注入到 Subagent）
  tools: string[];        // 可用工具白名单
  model?: string;         // 模型（不填则继承默认）
  agentType: "mint" | "builder" | "evaluator";
}
```

## 异常流程

| 场景 | 处理 |
|------|------|
| Builder 执行超时 | 写入 escalation.json → notifySession Mint → 用户决策 |
| Evaluator 验证失败 | 重试（最多 3 次）或升级 |
| 用户中断 | Mint 的 interrupt() → 标记当前任务 escalated |
| 所有任务完成 | Mint 写总结 |
| SDK 返回错误 | 捕获 → 写入 escalation → 升级 |

## 交付标准（Layer 1）

- [x] 设置面板可以创建/编辑/删除 Agent 模板
- [x] 启动 Mint 会话时，模板自动注入 `options.agents`
- [x] `notifySession()` 可以跨 ActiveChat 推消息
- [x] `notify.ts` 脚本可以独立运行，注入消息到指定 session
- [x] `spawnAgentChat(templateId, projectPath, message)` — 从模板创建独立 ActiveChat
- [x] 类型检查零错误
- [ ] Task(builder)/Task(evaluator) 实际联调验证
- [ ] escalation.json UI 展示 + 升级决策循环
