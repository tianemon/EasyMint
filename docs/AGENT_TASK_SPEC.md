# Agent 系统 — 开发任务书

## 开发背景

EasyMint 当前是单一 Mint 会话模式：用户和一个 AI 对话，Mint 负责需求分析、项目管理、代码开发全部角色。痛点：

1. **上下文压力** — 一个会话承载所有对话，上下文窗口会被塞满
2. **角色混淆** — Mint 同时当 PM、开发者、测试员，没有分工
3. **不可持续** — 上下文满了只能 compact 或重建
4. **无法并行** — 单一会话串行处理

目标：升级为多 Agent 协作系统。用户在设置中创建不同角色的 Agent 模板，Mint 或 Orchestrator 调 SDK 的 Task 工具启动 Subagent 执行具体任务。每个 Subagent 用完即销毁，不积累上下文。

### 关键发现

- SDK 原生支持 Agent 模板定义：`options.agents: Record<string, AgentDefinition>`
- SDK 的 Task 工具自动注入模板 prompt：取 `AgentDefinition.prompt` → 写入 `systemPrompt.append` → 子进程启动
- Subagent 生命周期由 SDK 自动托管：一次 Task 调用 = 创建→执行→返回→销毁
- 模板的 `description` 字段用于 SDK 匹配"何时调用此 Agent"
- 跨会话通信：同一进程内所有 ActiveChat 共享 agent-service，通过 `channel.enqueue()` 即时送达
- SDK 无独立 `listModels()` 函数，模型列表由 EasyMint 自己配置（`availableModels` 在 settings 中）
- 当前 Layer 0（地基层）全部完成：长生命周期进程 + 消息通道 + 多 ActiveChat + 主题 + 提示词集中管理 + 表单

### 开发顺序（原子化编号）

```
1.1 Agent 模板 CRUD（agent-templates.ts 存储 + IPC + 类型）      ✅
1.2 设置面板模板管理 UI（创建/编辑/删除）                        ✅
1.3 模板注入 buildQueryOptions（options.agents）                 ✅
1.4 notifySession（跨 Agent channel 通信）                       ✅
1.5 spawnAgentChat（从模板创建独立 ActiveChat，注入首条消息）     ⬜
─── Layer 1 「核心能力」完成 ───
2.1 Builder 模板 + 手动 Task 调用验证                            ⬜
2.2 Evaluator 模板 + 验收验证                                    ⬜
2.3 Orchestrator 模板 + 任务循环                                 ⬜
2.4 升级机制                                                     ⬜
─── Layer 2 「任务协同」完成 ───
```

后续 Layer 3（体验层：预设模板库、报表）以后再说。

---

## 1. 用户角色

| 角色 | 权限 |
|------|------|
| 项目创建者 | 管理 Agent 模板（增删改）、启停 Agent、查看执行进度 |
| Mint（PM） | 分配任务到 task.json、激活 Orchestrator、接收升级通知、决策 |
| Orchestrator | 读 task.json、调度 Builder/Evaluator、升级阻塞 |
| Builder | 实现单个任务，完成后返回结果 |
| Evaluator | 验收 Builder 工作，返回 pass/fail |

## 2. 用户工作流

```
设置中创建 Agent 模板
  ↓
项目中分配完任务（task.json 就绪）
  ↓
用户/Mint 点击「执行任务」
  ↓
Mint 创建独立的 Orchestrator 会话（spawnAgentChat）
  ↓                            （非 Task 调用，是平级 ActiveChat）
Orchestrator 内部逐任务:
  调 Task(builder) → 调 Task(evaluator) → 标记结果
  ├─ 通过 → 下一任务
  └─ 阻塞 → notifySession 升级给 Mint → 用户决策
  ↓
全部完成 → notifySession Mint 总结
```

> **关键**：Orchestrator 是独立 ActiveChat，不是 Mint 的 Subagent。因为 SDK Task 不保证 Subagent 继承 `options.agents`（Builder/Evaluator 模板），Orchestrator 作为 Subagent 会调不到 Builder。
>
> 独立 ActiveChat 通过 `buildQueryOptions` 注入 `options.agents`，Orchestrator 内部可正常调 Task(builder) 和 Task(evaluator)。

## 3. 会话层级

```
独立会话（平级，各自有 options.agents）
  ┌──────────────┐     notifySession     ┌─────────────────┐
  │  Mint        │ ←──────────────────→  │  Orchestrator   │
  │  ActiveChat  │                       │  ActiveChat     │
  └──────────────┘                       └────────┬────────┘
                                                   │
                                    内部调 Task 工具
                                                   │
                          ┌──────────────┬─────────┴──────────┐
                          │              │                    │
                     Task(builder)  Task(evaluator)   Task(builder)
                     Subagent       Subagent          Subagent
                     (临时、自动销毁) (临时、自动销毁)  (下一任务)
```

## 4. 功能树

```
Agent 系统
├─ 1.1 模板管理
│   ├─ 1.1.1 创建模板（名称、描述、提示词、工具、模型）
│   ├─ 1.1.2 编辑模板
│   ├─ 1.1.3 删除模板
│   └─ 1.1.4 模板列表（设置面板 UI）
│
├─ 1.2 模板注入
│   ├─ 1.2.1 启动 Mint/Orchestrator（独立 ActiveChat）时写入 options.agents
│   ├─ 1.2.2 SDK Task 工具调用时自动匹配模板（仅独立会话可用）
│   └─ 1.2.3 spawnAgentChat：从模板创建独立 ActiveChat，注入首条消息
│
├─ 1.3 Agent 间通信
│   ├─ 1.3.1 notifySession(targetId, msg) — A→B channel enqueue，独立会话间即时通信
│   ├─ 1.3.2 Session 身份标记（ActiveChat.agentType）
│   └─ 1.3.3 notify.ts 脚本（供 Bash 工具调用，向目标 session 注入消息）
│
├─ 1.4 任务编排（Orchestrator）— Layer 2
│   ├─ 1.4.1 读 task.json 获取待执行任务列表
│   ├─ 1.4.2 逐任务调 Task(builder) 实现
│   ├─ 1.4.3 逐任务调 Task(evaluator) 验收
│   ├─ 1.4.4 判断结果（pass→下一任务，fail→重试或升级）
│   └─ 1.4.5 全部完成→notifySession Mint 汇报
│
└─ 1.5 升级机制 — Layer 2
    ├─ 1.5.1 Builder/Evaluator 遇阻塞→写入 .easymint/escalation.json
    ├─ 1.5.2 Orchestrator 检测 escalation→notifySession Mint
    ├─ 1.5.3 用户决策（重试/跳过/人工介入）
    └─ 1.5.4 Mint 写决策→Orchestrator 继续
```

## 4. 状态机

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

## 5. 输入/输出定义

### 1.1 模板管理

| 节点 | 输入 | 处理 | 输出 | 异常 |
|------|------|------|------|------|
| 1.1.1 创建 | 用户填写表单（name, description, prompt, tools, model） | JSON 写入 em-settings.json 的 agentTemplates 数组 | AgentTemplate 对象 | 表单校验失败→提示 |
| 1.1.2 编辑 | 模板ID + 修改字段 | JSON 更新 | 更新后的模板 | 模板不存在→提示 |
| 1.1.3 删除 | 模板ID | JSON 移除该项 | void | 模板不存在→忽略 |

### 1.3 通信

| 节点 | 输入 | 处理 | 输出 | 异常 |
|------|------|------|------|------|
| 1.3.1 notifySession | targetSessionId + message | channel.enqueue() | 消息即时送达目标 Agent | session 不存在→写 error log |
| 1.3.3 notify.ts | sessionId + message（CLI args） | 读 settings.json → SDK query + resume → 注入 | exit 0 | API 错误→exit 1 |

### 1.4 编排（Layer 2）

| 节点 | 输入 | 处理 | 输出 | 异常 |
|------|------|------|------|------|
| 1.4.1 读 task.json | 项目路径 | Read 文件 | tasks 数组 | 文件不存在→提示未分配 |
| 1.4.2 调 Builder | 任务对象 | Task(builder, prompt="实现第 N 个任务，先读 docs/需求规格.md") | 任务结果 | 超时/错误→升级 |
| 1.4.3 调 Evaluator | 任务对象 | Task(evaluator, prompt="验收第 N 个任务") | pass/fail | 超时→升级 |

## 6. 上下文传递方式

```
Orchestrator → Task(builder):
  prompt: "实现 task.json 第 N 个任务。先读 docs/需求规格.md 了解项目"

Builder 内部:
  起点: docs/需求规格.md + docs/架构设计.md + task.json
  中转: Builder 进程内上下文（Read 工具获取）
  终点: 代码文件 + passes:true 标记

原则: Task 参数只给执行指令，项目上下文通过文件获取
```

## 7. 异常流程

| 场景 | 处理 |
|------|------|
| Builder 执行超时 | Orchestrator 检测→写入 escalation.json→notifySession Mint |
| Evaluator 验证失败 | Orchestrator 判断→重试(最多3次)或升级 |
| 用户中断 | Mint 调 Orchestrator 的 interrupt()→标记当前任务 escalated |
| 所有任务完成 | Orchestrator 写总结→notifySession Mint→Orchestrator 自行销毁 |
| SDK 返回错误 | Orchestrator 捕获→写入 escalation→升级 |

## 8. Agent 模板数据结构

```ts
interface AgentTemplate {
  id: string;
  name: string;           // 显示名，如 "Builder"
  description: string;    // SDK 用于匹配何时调用此 Agent
  prompt: string;         // 系统提示词（SDK 自动注入到 systemPrompt.append）
  tools: string[];        // 可用工具白名单
  model?: string;         // 模型（不填继承默认）
  agentType: "mint" | "orchestrator" | "builder" | "evaluator";
}
```

`description` 和 `prompt` 字段名与 SDK 的 `AgentDefinition` 保持一致，可直接展开到 `options.agents` 中。

## 9. 实现指引

### 文件清单

| 文件 | 作用 |
|------|------|
| `app/main/services/agent-templates.ts` | ✅ 模板 CRUD + 默认值 + 升级协议类型 |
| `app/main/ipc-handlers.ts` | ✅ 加 `agent-template:*` + `agent:notifySession` |
| `app/preload/index.ts` | ✅ 暴露 `agentTemplates` + `notifySession` |
| `app/renderer/vite-env.d.ts` | ✅ 补类型 |
| `app/renderer/src/components/SettingsDialog.tsx` | ✅ "Agent 模板" Tab |
| `app/main/services/agent-service.ts` | ✅ `notifySession` + `options.agents` 注入 + `agentType` |
| `app/main/index.ts` | ✅ `seedDefaults()` |
| `app/main/services/agent-service.ts` | ⬜ `spawnAgentChat(templateId, projectPath, initialMessage)` |

### 技术要点

- 模板存储复用现有 `Store` 的 JSON 读写模式
- `buildQueryOptions` 调用 `agent-templates.list()` 后展开到 `options.agents`
- `notifySession` 直接 enqueue 到目标 chat 的 channel
- **`spawnAgentChat`**：从模板读配置 → 创建 ActiveChat + channel → `sendMessage` 发首条消息 → 返回 chatId。后续 Mint 和 Orchestrator 通过 `notifySession` 通信

### 不要做的

- ~~Orchestrator 作为 Mint 的 Subagent~~ — Subagent 不保证继承 `options.agents`，链式调用会断
- ~~跨进程通信~~ — 同一 Electron 进程内 channel.enqueue() 即时送达
- ~~Subagent 持久化~~ — SDK 自动托管生命周期

## 10. 交付标准（Layer 1 完成时）

- [x] 设置面板可以创建/编辑/删除 Agent 模板
- [x] 启动 Mint 会话时，模板自动注入 `options.agents`
- [x] `notifySession()` 可以跨 ActiveChat 推消息
- [x] `notify.ts` 脚本可以独立运行，注入消息到指定 session
- [ ] `spawnAgentChat(templateId, projectPath, message)` — 从模板创建独立 ActiveChat
- [x] 类型检查零错误
