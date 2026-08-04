# 多模型 / 多供应商 / 多 Agent 群聊方案

> 本文档是 5 条需求(默认模型、Agent 指定模型/供应商、会话绑供应商、多 Agent 群聊)的**唯一真相源**。
> 设计定稿于 2026-08-03,群聊交互重设计 2026-08-04。任何会话改此功能前必读本文件。
> 本次重设计基于 Pi SDK 源码调研(`@earendil-works/pi-coding-agent`)和 cc 源码分析(`/Users/amon/dev/project/GitHub/claude-code-analysis`)。

## 1. 背景与需求

用户提出的 5 条需求(互相有重合):

| # | 需求 | 说明 |
|---|------|------|
| 1 | 默认模型 + 兜底模型 | 全局默认;主模型失败/无 auth 时降级 |
| 2 | 任意 Agent 单独指定模型 | 委派时指定模型 id |
| 3 | 任意 Agent 单独指定供应商 + 模型 | 委派时指定 provider + model |
| 4 | 多 Agent 在同一会话工作(群聊) | SDK 不支持共享上下文 → 应用层消息转发,方案 B |
| 5 | 不同会话使用不同供应商 | 会话绑供应商,新建会话可指定 |

需求 4 的取舍:能共享上下文最好,不能则将一方消息转发给其他 Agent,**至少在表面上像同一个会话(群聊)**。用户选方案 B(应用层转发)。

## 2. SDK 能力边界调研(关键技术结论,2026-08-04 更新)

Pi SDK(`@earendil-works/pi-coding-agent`):

### 消息注入(群聊核心)

| 方法 | 行为 | 触发回合? |
|------|------|----------|
| `prompt(text, options?)` | 发消息。options:`{images?, streamingBehavior?: "steer"|"followUp"}` | ✅ |
| `sendCustomMessage(msg, {triggerTurn?, deliverAs?})` | custom 消息;**triggerTurn:false 只注入上下文不回话,true 开回合** | 可选 |
| `steer(text)` | 中断当前回合注入消息 | ✅ |
| `followUp(text)` | 当前回合结束后注入 | ✅ |

**关键发现**:`sendCustomMessage` 的 `triggerTurn` 是群聊背景注入 vs 激活的核心开关——false 只进上下文+落盘+广播事件,不开回合;true 开回合回话。`deliverAs: "nextTurn"` 可排队到下一回合。`prompt` 的 `streamingBehavior` 选项统一了 steer/followUp 的底层语义。

### 上下文机制

- **上下文 = `AgentState.messages`**:包含 user + assistant + toolResult 消息。`defaultConvertToLlm` **只按 role 过滤**(user/assistant/toolResult),**不裁剪 content**。thinking、toolCall、toolResult 完整进 LLM 上下文
- **工具输出完整进上下文**:Read 读到的代码源码作为 toolResult 进入上下文 + 完整落 jsonl。**无回合间清理机制**(cc 有 microcompact 清空旧工具结果,Pi 没有)
- **省 token 靠 prompt caching**:API 层对 system prompt + 工具定义 + 对话历史打 `cache_control`,重复前缀命中缓存(cache read ≈ 1/10 价),而非裁剪内容
- **压缩:compaction**:阈值/溢出触发,摘要替换旧消息(被动,非回合间)。EM 还有 contextThreshold 主动压缩

### Session 创建方式

| 方法 | 场景 | 群聊用途 |
|------|------|---------|
| `SessionManager.create(cwd)` | 全新会话 | 每个 Agent 独立空会话 |
| `SessionManager.open(sessionFile)` | 恢复历史 | 重启恢复 Agent 会话 |
| `SessionManager.forkFrom(sourcePath, cwd)` | **复制源全部历史到新会话**(header.parentSession 指向源) | 新 Agent 继承群聊历史 |
| `SessionManager.inMemory(cwd)` | 不落盘 | 临时 Agent(如 evaluator 一次性检查) |
| `SessionManager.continueRecent(cwd)` | 恢复最近 | — |

### 扩展性

- **AgentSession 不可继承**(大量 private 状态,重写脆弱)
- **组合/依赖注入是正道**:`createAgentSession` 接受自定义 `sessionManager`/`modelRuntime`/`settingsManager`/`resourceLoader`
- **Agent 类可完全自定义**:构造选项注入 `convertToLlm`/`transformContext`/`streamFn`/`prepareNextTurn`/`shouldStopAfterTurn`/`beforeToolCall`/`afterToolCall` 等 hook
- **`CustomMessageEntry`**:进 jsonl + 进上下文(转为 user 角色),`CustomEntry` 只客 jsonl 不进上下文

## 3. 总体架构

```
群聊 = 多个 Pi session 的虚拟聚合 + 全量背景注入 + 显式激活回合。

用户消息 / Agent 结论
  → sendCustomMessage forward_message triggerTurn:false 注入所有其他 Agent(背景同步,不回话)
  → 用户 @ / Agent 调用 assign_to_agent({target}) → 目标 prompt() 或 sendCustomMessage(triggerTurn:true) 开回合
```

核心原则:
- **背景注入(triggerTurn:false)**:每条消息全量注入所有 Agent 上下文——确保任一 Agent 被激活时上下文完整
- **显式激活**:用户 `@`(前端路由)或 Agent 调 `assign_to_agent` MCP 工具 → 目标开回合
- **激活不携带内容**:内容已由背景注入同步,激活只是"现在轮到你回话了"
- **防环天然**:背景注入不回话,显式激活按需触发,无隐式转发链
- **记录文件**:独立 `groupId.json`(纯结论+角色+piTs),不进任何 agent 上下文,UI 显示用

## 4. 数据模型扩展

### 4.1 Settings(`app/main/services/store.ts`)

```ts
// 需求 1/2 默认、兜底、子 Agent 默认模型:2026-08-04 起全部移入每条供应商配置
// (ProviderConfig.model/fallbackModel/subagentDefaultModel),全局不再有
// defaultProvider/defaultModel/fallbackProvider/fallbackModel/subagentDefaultModel 字段。
// 当前激活供应商的 model 为默认,fallbackModel 为兜底,subagentDefaultModel 为 task 子 Agent 默认。
// 需求 4:群聊配置
maxGroupAgents?: number;              // 最大 Agent 数(默认 3)
groupForwardStrategy?: "all" | "conclusion";  // 转发策略(默认 conclusion 只转结论)
groupInjectMode?: "steer" | "followUp";       // 注入方式(默认 followUp 等空闲)
maxForwardDepth?: number;             // 最大转发深度(默认 3,防环)
groupPresets?: GroupPreset[];         // 预设组合(内置 + 用户自定义)
```

供应商配置(`app/shared/platform-presets.ts` ProviderConfig):

```ts
export interface ProviderConfig {
  // ...现有(id/presetId/name/apiKey/models/createdAt)
  model: string;                     // 该供应商的默认模型(激活时优先使用)
  fallbackModel?: string;            // 该供应商的兜底模型(默认模型不可用时降级,从 models 选)
  subagentDefaultModel?: string;     // 该供应商的 task 工具子 Agent 默认模型(委派子 Agent 未指定时用,从 models 选)
}
```

### 4.2 AgentTemplate(扩展)

```ts
interface AgentTemplate {
  // ...现有
  model?: string;    // 模型 id
  provider?: string; // 供应商 piId(需求 3)
  tools: string[];   // 工具集(需求 4:群聊 Agent 按此构建)
}
```

内置模板:`mint`(Mint 系统提示词)/ `default-builder` / `mint-designer` / `default-evaluator`

### 4.3 SubagentOptions(executor.ts 扩展)

```ts
interface SubagentOptions {
  // ...现有
  model?: string;
  provider?: string;
}
```

### 4.4 SessionCache(扩展)

```ts
interface SessionCache {
  // ...现有(permissionMode/model/contextUsage)
  provider?: string;  // 会话绑定的供应商 piId(需求 5)
}
```

## 5. 设置项汇总(11 项)

| 设置项 | 位置 | 默认 | 阶段 |
|--------|------|------|------|
| 模型(默认)(每条供应商) | 供应商详情页(编辑) | 无 | 1 |
| 兜底模型(每条供应商) | 供应商详情页(编辑) | 无 | 1 |
| 子 Agent 默认模型(每条供应商) | 供应商详情页(编辑) | 同模型 | 2 |
| 群聊最大 Agent 数 | 设置→Agent | 3 | 4 |
| 群聊转发策略 | 设置→Agent | conclusion | 4 |
| 群聊注入方式 | 设置→Agent | followUp | 4 |
| 群聊最大转发深度 | 设置→Agent | 3 | 4 |
| 群聊预设组合 | 设置→Agent | 开发三人组/设计协作 | 4 |
| Agent 模板(占位) | 设置→Agent | 内置模板 | 4 |
| AgentTemplate 供应商+模型 | 模板编辑(UI 待做) | 无(用默认) | 2 |

> 默认/兜底/子 Agent 默认模型均为 **per-provider 配置**(2026-08-04 起):每条供应商在详情页配自己的 model/fallbackModel/subagentDefaultModel,从该供应商模型列表选。全局不再有相关字段——默认/兜底从**当前激活供应商**读取。

## 6. 主进程设计

### 6.1 getActiveModel 降级(需求 1)

候选优先级(取**当前激活供应商** config,依次尝试,模型不存在或无 auth 跳过):
1. `defaultModel`(该供应商默认模型,若配置)
2. `model`(活跃模型)
3. `fallbackModel`(该供应商兜底模型,若配置)

> 切换供应商时 `settings:set(apiProviders)` → `resetModelRuntime()` 清模型缓存,新会话立即用新供应商的默认/兜底。

命中兜底时 `broadcast("agent:fallback-used")` → 前端状态栏提示 8s。

### 6.2 executor resolveSubagentModel(需求 2/3)

优先级:委派指定(provider+model) → AgentTemplate(模板的 provider/model)→ 当前激活供应商的 `subagentDefaultModel` → 全局默认(活跃供应商 model,getActiveModel 降级)。

**群聊 Agent 模型解析**:模板配了 provider/model 用模板(优先级最高);否则走 getActiveModel(与主会话一致,当前活跃供应商 model → fallbackModel)。

### 6.3 会话绑供应商(需求 5)

`sendMessage(..., preferredProvider)` → `getModel(preferredProvider, preferredModel)` 创建会话;前端从 session-cache 读 provider 传入。

### 6.4 群聊容器(`app/main/services/group-session.ts`,需求 4)

`GroupSessionManager`,依赖注入(store/getAgentDir/buildGroupTools/buildSystemPrompt/resolveModel/broadcast/injectSystemMessage),复用 agent-service 私有方法(同 finishRotation 模式)。

- **createGroup**:每模板建独立 Pi session;工具集按模板 tools(`buildGroupTools`);写 session-cache(permissionMode);传 thinkingLevel;持久化 meta
- **sendGroupMessage**:@提及路由到目标 Agent(无 @ → 主 Agent);用户消息前端本地 append(主进程不广播,防重复)
- **runTurn**:单次回合,挂 subscribe 广播事件(注入 groupId/agentRole/forwarded/forwardedFrom),回合结束提取 `getLastAssistantText()` 触发转发
- **onAgentTurnEnd**:结论转发;深度控制;busy → `injectQueued` 排队(不触发转发链)
- **trySwitchFallback**:失败重试前切兜底模型(`session.setModel`)
- **closeGroup**:释放所有 session

## 7. 前端设计

| 改动 | 文件 | 说明 |
|------|------|------|
| 设置 UI(默认/兜底/子 Agent) | settings/ProviderSettings.tsx | ModelDefaultsSettings |
| 群聊设置(4 参数 + 预设) | GroupSettingsSection.tsx | 设置→群聊 tab |
| 群聊创建弹窗 | GroupComposerDialog.tsx | 预设/自由组合 + 权限模式 + 首条消息 |
| 群聊视图 | ChatPanel.tsx(群聊模式) | 角色气泡 + 转发标记 |
| 会话绑供应商 | ChatPanel.tsx | chatProvider → preferredProvider(切换 UI 待做) |
| tab 品牌图标 | TabBar.tsx | 待做 |

## 8. 群聊交互设计(2026-08-04 重设计,已定稿全部细节)

### 8.0 核心原则

- **背景注入(triggerTurn:false)**:每条消息全量注入所有 Agent 上下文(不含代码/toolResult,只有 user 文本 + 各 agent 结论文本)
- **显式激活**:用户 `@`或 Agent 调用 `assign_to_agent` 工具 → 应用层对目标 agent 调用 `prompt()` 或 `sendCustomMessage(triggerTurn:true)` 开回合
- **激活不携带任务**:内容已由背景注入同步,激活只是"轮到你回话了"
- **上下文独立**:各 Agent 上下文 ≈ 完整群聊对话(全量注入的结论),但 **没有其他 agent 的代码/toolResult/thinking**

### 8.0a 创建群聊时的上下文注入(初始化消息)

所有 agent 创建完成后,主进程对每个 agent 注入一条**初始化消息**(triggerTurn:false,只进上下文不回话,UI 不显示):

```
[群聊已创建] 参与成员: Mint / Builder / Evaluator。
群聊规则:
  1. 被 @ 或收到"群聊激活"系统消息时才回话
  2. 不要重复回应历史消息(之前的回复已处理)
  3. 需要指派他人时调用 assign_to_agent({target:"角色名"})
  4. 回话时优先响应当前最新指令,不纠结历史对话
  5. 你的回复结论会自动同步给所有成员
```

### 8.0b 群聊 system prompt(注入每个 agent)

`GROUP_COLLABORATION_RULE`(agent-service.ts),`{members}` 和 `{role}` 由 createGroup 替换:

```
[群聊协作规则]
你正在一个多 Agent 群聊会话中协作。群聊成员: {members}

你会持续收到共享上下文(其他成员的发言和结论)——这些是累积的历史记录,你不需要逐条回复。

核心规则:
1. 只有被 @ 或收到"群聊激活"系统消息时才回话。
   回话时,优先响应当前最新指令,不要纠结于历史对话。
2. 当某部分工作更适合其他成员处理时,调用 assign_to_agent({target:"<角色名>"}) 工具,
   指定目标角色即可,不要硬编角色名称。
   无需重复说明任务——对方上下文里已有全部信息。
3. 你的回复结论会自动同步给所有成员作为背景上下文。
   请保持结论清晰、独立可读,不引用其他成员未提供的代码或信息。

禁止事项:
- 不要在每条背景消息后都回话——只在被显式激活(@ 或系统激活消息)时才回话
```

各 agent 的 system prompt 组装:`模板 prompt` + `@{role}(你): 负责{任务说明}` + `协作规则` + `skills` + `项目环境` + `项目类型规范`。

### 8.1 发起群聊

- Sidebar「+ 新建 → 群聊会话」→ GroupComposerDialog
- 从 AgentTemplate 选参与角色(预设组合 + 自由勾选,受 maxGroupAgents 限制)
- 内置预设:开发三人组(Mint+Builder+Evaluator)、设计协作(Mint+Mint-D)
- 现有单 Agent 会话不受影响(群聊是独立模式)

### 8.2 消息同步(全量背景注入)

| 消息源 | 注入范围 | 机制 |
|--------|---------|------|
| 用户消息 | 所有 Agent | `sendCustomMessage(forward_message, triggerTurn: false)` |
| Agent 结论(turn_end) | 除自己外所有 Agent | 同上 |
| agent 工具过程/代码 | **不注入**(只在自己 jsonl) | — |

**设计约束**:只注入 `getLastAssistantText()`(纯结论正文),**不注入** toolResult/thinking/toolCall——代码长在干活 agent 自己的上下文和 jsonl 里,不灌入其他 agent。

### 8.3 回合激活(显式)

| 方式 | 触发 | 目标 |
|------|------|------|
| **用户 `@`** | 前端文本解析 `@角色名` → 主进程 sendGroupMessage 路由 | 匹配的 Agent |
| **Agent `assign_to_agent` 工具** | Agent 回复中调用 `assign_to_agent({ target: "角色名" })` → 应用层拦截 tool_use | 指定的 Agent |
| **兜底语法解析** | Agent 回复中含 `【转交@角色名】` 但没调工具 | 指定的 Agent |

**激活实现**:`sendCustomMessage(forward_message, triggerTurn: true)`(custom 类型,不污染 user 消息流;`details` 带 `from` 角色,前端渲染"`[X → Y]`";content 带"你被 @ 了,基于上下文回复")。另一种等价:直接 `prompt(text)`。

**`assign_to_agent` MCP 工具**:
- 参数:`{ target: string }`(目标角色名)。不需要 task 参数(内容已背景注入)
- 注入群聊所有 Agent(内置工具,群聊创建时自动注入到所有 agent 的工具集)
- 应用层拦截 tool_use → 对目标 `prompt("你被 @ 了…")` → 前端渲染"`[Mint → Builder]`"

### 8.4 Agent 间显示

- 每条消息标注 Agent 身份:角色头像(固定色)+ 名称
- 激活消息显示来源标记:`[Mint → Builder]`(tool_use 事件 / forward_message customType 驱动)
- 时间线交错排列(按 piTs 有序插入)

### 8.5 防环(天然成立)

背景注入 triggerTurn:false 不产生新回合,激活是显式的(user @ 或 agent 调工具 → 应用层只开一次目标回合),**不存在隐式链式转发** → 无需深度/ID 去重。旧"结论转发触发链"设计废弃。

### 8.6 Agent 失败处理(保留)

| 场景 | 处理 |
|------|------|
| 503/网络 | 重试 ≤3 次;重试前 `trySwitchFallback` 切兜底 |
| 仍有失败 | 标记 offline,跳过(不阻塞其他 Agent);状态栏提示 |
| 整群聊 | 不停——其他 Agent 继续 |

### 8.7 上下文轮转(保留)

- 各 Agent 独立 compact(Pi 原生)
- EM 层主动压缩/轮转追踪**未接入群聊**(靠 Pi 自动)

### 8.8 群聊记录文件(UI 显示专用)

项目级 `.easymint/group-sessions/<groupId>.json`(独立 JSON,不进任何 agent 上下文,不经过 SDK 解析):
```json
{
  "groupId": "group-xxx",
  "messages": [
    { "agentRole": "user", "text": "帮我分析项目", "piTs": 123 },
    { "agentRole": "Builder", "text": "分析结论...", "piTs": 456, "forwardedFrom": "Mint" }
  ]
}
```
- **写入时机**:用户消息/agent turn_end 时,广播同步后立即写入
- **内容粒度**:只写结论文本(与背景注入内容一致),不含工具过程
- **前端加载**:群聊 ChatPanel 挂载 → 读文件 → 按 piTs 排序 → loadSession → 角色头像渲染
- **价值**:重启后可看历史(解决"重启丢消息"),排序天然正确,免合并三个 jsonl

### 8.9 持久化与恢复

- 项目级 `.easymint/group-sessions.json`(元数据:groupId, agents, sessionId, provider/model, presetId)
- 各 Agent 消息各自 Pi jsonl(完整,含工具/thinking)
- 群聊记录文件(8.8)作为 UI 显示的权威源
- **恢复(resume,本期不做)**:重启后群聊 tab 可看历史(记录文件),但不能继续对话(内存态 group 清空)——resume 留待后续,需从 group-sessions.json 读 meta + 各 agent resumePiSession

## 9. 工程层面

| 数据 | 位置 | 说明 |
|------|------|------|
| 群聊元数据 | 项目级 `.easymint/group-sessions.json` | 持久化,恢复用 |
| 各 Agent 消息 | 各自 Pi jsonl | Pi 原生,含工具/代码/thinking |
| 群聊记录(UI 显示) | 项目级 `.easymint/group-sessions/<groupId>.json` | 纯结论+角色+piTs,不进上下文 |
| 群聊预设 | settings(groupPresets) | 全局 |

- **并发控制**:maxGroupAgents 限制;回合显式激活(非自动转发链)
- **权限模式**:群聊各 Agent 写 session-cache(permissionMode),`createCanUseTool` 实时读取
- **assign_to_agent MCP 工具**:群聊创建时自动注入所有 agent 的工具集,应用层拦截 tool_use 激活目标回合

## 10. 分阶段执行计划(4 阶段)

| 阶段 | 需求 | 依赖 | 状态 |
|------|------|------|------|
| 1 | 默认+兜底模型 | 无 | ✅ |
| 2 | Agent 指定模型/供应商 | 阶段 1 | ✅ |
| 3 | 会话绑供应商 | 阶段 1 | ✅(UI 切换入口待做) |
| 4 | 多 Agent 群聊 | 阶段 2/3 | ✅ |

## 11. 实现与修复记录

- **2026-08-03 阶段 1-3**:store 字段 + getActiveModel 降级 + executor resolveSubagentModel + session-cache.provider + sendMessage(preferredProvider)
- **2026-08-03/04 阶段 4**:group-session.ts + 前端群聊视图 + GroupComposerDialog + GroupSettingsSection + 设置→群聊 tab
- **2026-08-04 审查修复 5 项**(commit 4a35e1e):补 mint 模板、群聊首条消息显示、转发来源标记、busy 排队(injectQueued)、retries 归零、删 forwardSeen、兜底状态栏提示
- **2026-08-04 方案差距补齐**(commit ec062bd):失败真重试+切兜底、群聊权限模式、模板 tools 驱动工具集(buildGroupTools)、thinkingLevel

## 12. 已知缺陷与待办

1. **群聊跨重启恢复未实现**:group-session 内存态;重启后 tab 可看历史(记录文件),但不能继续对话。需从 group-sessions.json 读 meta + 各 agent resumePiSession
2. **全量背景注入上下文累积** ⚠️:triggerTurn:false 注入仍进目标上下文占 token。需监控长对话成本
3. **assign_to_agent MCP 工具未实现**:需自定义工具定义 + 群聊创建时注入 + 应用层拦截 tool_use
4. **模板编辑 UI 未实现**:provider/model 无法在 UI 配置(IPC CRUD 已通)
5. **tab 品牌图标 + 会话切换供应商 UI 未实现**
6. **群聊 Agent 无 product 工具**:`buildGroupTools` 按模板 tools,默认模板不含 show_*/set_task_status 等

## 13. 关键实现决策(重要信息,2026-08-04 更新)

- **全量背景注入 + 显式激活**:背景注入不回话,激活只触发回合不带内容——防环天然,上下文可控
- **转发粒度=纯结论**:只注 `getLastAssistantText()` 正文,不注 toolResult/thinking/toolCall——代码留在干活 agent 上下文,协作方不污染
- **上下文 ≠ jsonl**:上下文包含 user+assistant+toolResult 全量,无回合间清理;jsonl 包含更多(compaction/custom/model_change)。转发不跨 session 命中缓存
- **缓存不是共享**:prompt cache 按请求前缀匹配,跨 session 只有 system prompt+工具定义可命中,转发内容不共享缓存
- **Pi 省 token 靠缓存不靠裁剪**:与 cc 不同,Pi 无 microcompact(回合间清旧工具结果),省 token 靠 prompt caching(重复前缀按 1/10 计费)
- **`sendCustomMessage` 是核心调度原语**:triggerTurn 控制回话与否,deliverAs 控制排队,forward_message customType 区分转发
- **群聊回合天然串行**:显式激活(非自动转发链)→ 复用单 `latestAiIdRef`,无需按角色分块跟踪
- **群聊事件不广播 agent:exit**:前端靠 turn_end 清 busy,激活回合的 turn_end 由 onAgentTurnEnd 广播
- **模板 tools 语义**:基础 coding 工具(Read/Write/Edit/Bash)由 createPiSession 强制追加,task/MCP 等 extraTools 按模板 tools 声明过滤
