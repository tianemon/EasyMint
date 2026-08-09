# 多模型 / 多供应商 / 多 Agent 群聊方案

> **状态：✅ 主体已实现**——Agent 模板 + task 动态委派（2026-08-05 收敛方案）已落地；群聊保留实验性，降级待办见 `docs/待办事项.md` 第 4 条。
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

### 8.0 核心原则(2026-08-05 收敛:交接摘要式指派,替代全量背景注入)

- **按需交接,不共享上下文**:用户只跟主 agent(Mint)正常对话,上下文完整在 Mint;
  需要执行时 `@` 指派,应用层让 Mint 生成**交接摘要**,连用户原文注入目标 agent
- **显式激活**:用户 `@`或 Agent 调用 `assign_to_agent` 工具 → 目标 agent 开回合
- **交接摘要(B)**:指派时,主 agent 针对当前指令**现场生成任务交接摘要**(一次额外 LLM 调用,
  用性价比模型执行时成本可接受),保证转发信息足够丰富
- **上下文成本**:N 份全量复制 → 仅目标 1 份摘要 + 原文,不膨胀
- **模型分工**:贵模型规划(上下文完整)→ 便宜模型执行(摘要驱动)

### 8.0a 创建群聊时的上下文注入(初始化消息)

所有 agent 创建完成后,主进程对每个 agent 注入一条**初始化消息**(triggerTurn:false,只进上下文不回话,UI 不显示):

```
[群聊已创建] 参与成员: Mint / Builder / Evaluator。
协作模式: 用户只与 Mint 对话;被 @ 或收到"群聊激活"系统消息时才回话;
Mint 负责理解用户意图并指派(assign_to_agent);被指派者基于交接摘要+用户原文执行;
你的回复结论会作为背景注入群聊记录(UI 显示)。
```

### 8.0b 群聊 system prompt(注入每个 agent)

`GROUP_COLLABORATION_RULE`(agent-service.ts),`{members}` 和 `{role}` 由 createGroup 替换:

```
[群聊协作规则]
你正在一个多 Agent 群聊会话中协作。群聊成员: {members}

协作模式: 用户主要与 {role}(你)或主 Agent 对话;被 @ 或收到"群聊激活"系统消息时才回话。

核心规则:
1. 只有被 @ 或收到"群聊激活"系统消息时才回话。
   回话时,优先响应当前最新指令,不要纠结于历史对话。
2. 当你(Mint/主 Agent)认为某部分工作更适合其他成员处理时,
   调用 assign_to_agent({target:"<角色名>"}) 工具指派。
   指派后,对方会收到你生成的交接摘要 + 用户原文,基于这些执行。
3. 被指派者:基于交接摘要 + 用户原文执行,结论保持清晰、独立可读。
4. 用户只发指令,不转述长上下文——你的结论会作为背景记录在群聊(UI 显示)。

禁止事项:
- 不要在非激活情况下主动回话
- 不要臆测其他成员未提供的代码或信息(用交接摘要为准)
```

各 agent 的 system prompt 组装:`模板 prompt` + `@{role}(你): 负责{任务说明}` + `协作规则` + `skills` + `项目环境` + `项目类型规范`。

### 8.1 发起群聊

- Sidebar「+ 新建 → 群聊会话」→ GroupComposerDialog
- 从 AgentTemplate 选参与角色(预设组合 + 自由勾选,受 maxGroupAgents 限制)
- 内置预设:开发三人组(Mint+Builder+Evaluator)、设计协作(Mint+Mint-D)
- 现有单 Agent 会话不受影响(群聊是独立模式)

### 8.2 消息流(按需交接,无全量背景注入)

```
用户消息(不 @) → 只激活主 Agent(Mint),上下文完整在 Mint
用户消息(@Builder 按方案做) → 应用层:
    ① 让 Mint 生成"交接摘要"(针对当前指令,一次额外 LLM 调用)
    ② 注入 Builder: [交接摘要] + [用户原文]
    ③ 激活 Builder 开回合执行
Builder 结论 → 应用层注入回 Mint(作为背景,triggerTurn:false)
  → 用户 @Mint 时, Mint 看到 Builder 成果,继续规划/验收
```

**设计约束**:
- 不注入工具过程/代码——代码长在干活 agent 自己的上下文和 jsonl
- 用户消息不广播所有 agent,只发目标(避免 N 份全量复制)
- 交接摘要由主 agent 生成(保证信息足够丰富),一次额外 LLM 调用可接受

### 8.3 回合激活(显式 + 交接摘要)

| 方式 | 触发 | 目标 |
|------|------|------|
| **用户 `@`** | 前端文本解析 `@角色名` → 主进程路由 | 匹配的 Agent |
| **Agent `assign_to_agent` 工具** | Agent 回复中调用 `assign_to_agent({ target })` → 应用层拦截 | 指定的 Agent |
| **兜底语法解析** | Agent 回复含 `【转交@角色名】` 但没调工具 | 指定的 Agent |

**激活实现**(交接摘要式):
1. 用户 @ 目标(非主 agent)或 Mint 调 assign 工具 → 应用层
2. **生成交接摘要**:调用主 agent(Mint)session `prompt("生成任务交接摘要…")` 或复用 `compact` 摘要机制(指定目标指令)
3. **注入目标**:`sendCustomMessage(forward_message, triggerTurn:true)`,content = `[交接摘要]...\n[用户原文]...`
4. 目标 agent 基于摘要+原文执行

**`assign_to_agent` MCP 工具**:
- 参数:`{ target: string }`(目标角色名)。不携带任务(交接摘要由应用层生成)
- 注入群聊所有 Agent;应用层拦截 tool_use → 生成摘要 → 注入目标 → 前端渲染"`[Mint → Builder]`"

### 8.4 Agent 间显示

- 每条消息标注 Agent 身份:角色头像(固定色)+ 名称
- 激活消息显示来源标记:`[Mint → Builder]`(tool_use 事件 / forward_message customType 驱动)
- 交接摘要/用户原文在目标 agent 回复中可见(角色气泡)
- 时间线交错排列(按 piTs 有序插入)

### 8.5 防环(天然成立)

无自动转发链:激活是显式的(用户 @ 或 Mint 调 assign 工具 → 应用层只开一次目标回合)。无隐式链式转发 → 无需深度/ID 去重。Mint 调 assign 由 system prompt 约束(不滥用),应用层可加"每回合最多 N 次指派"兜底。

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
- **2026-08-04 群聊重设计实现 A-D 阶段**:
  - A(eeeb36d)群聊记录文件:appendRecord + IPC group:messages + 前端历史加载
  - B(f6b44d0)全量背景注入(triggerTurn:false)+ @ 显式激活;删旧自动转发链
  - C(40bb90f)assign_to_agent 工具注入 + 兜底语法【转交@X】解析
  - D(a4fbe78)设置项标注"已由显式激活取代" + activation 标记
- **2026-08-05 方案收敛(交接摘要式指派)**:全量背景注入 → 按需交接。
  核心:用户只跟 Mint 对话,指派时让 Mint 生成交接摘要 + 用户原文注入目标。
  背景注入相关代码需重构(见 12 章待办)

## 12. 已知缺陷与待办

1. **群聊跨重启恢复未实现**:group-session 内存态;重启后 tab 可看历史(记录文件),但不能继续对话。需从 group-sessions.json 读 meta + 各 agent resumePiSession
2. **【收敛中】全量背景注入待重构为交接摘要式**:现有代码是全量背景注入(每消息注入所有 agent);
   方案已收敛为"用户只跟 Mint 对话,指派时交接摘要+原文注入目标"。需改:
   - sendGroupMessage:用户消息不再广播所有 agent,只激活主 agent(或 @ 目标)
   - turn_end:结论注入回主 agent(triggerTurn:false)供其掌握
   - activateAgent:非主 agent 被激活时,生成 Mint 交接摘要(compact/现场 prompt)+ 注入目标
3. **模板编辑 UI 未实现**:provider/model 无法在 UI 配置(IPC CRUD 已通)
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

## 14. Agent 模板模块 + 动态委派(2026-08-05 收敛,替代群聊方案)

> 核心结论:task 委派已支持 model/provider 指定;群聊的"多 agent 长期会话 + 全量背景注入"过度复杂。
> 收敛为**"主会话(Mint)+ task 工具动态委派 + Agent 模板模块"**——复用 executor,改动小。

### 14.0 设计原理

```
用户跟 Mint 正常对话(贵模型,上下文完整)
  → Mint 调 task 工具(template 参数) 委派给指定模板
  → executor 用模板的 systemPrompt/provider/model/tools 创建一次性子 session
  → 子 agent(性价比模型)执行结果 injectSystemMessage 回 Mint
  → 子 session 用完即弃,不长期保留——上下文不膨胀
```

**对比群聊方案**:
| | 群聊(已实现) | 动态委派(收敛后) |
|---|---|---|
| agent 生命周期 | 长期 session(持续对话) | **一次性**(用完即弃) |
| 上下文成本 | N 份全量复制 | 仅子 agent 单次任务(token 少) |
| UI | 多 jsonl 聚合(复杂) | **Mint 主会话 + 委派进度条**(已有) |
| 模型指定 | 模板 provider/model | **同理**(executor resolveSubagentModel) |
| 工具集 | 模板 tools | **同理**(buildGroupTools) |
| system prompt | 模板 prompt + 协作规则 | **模板 prompt 直接作为子 agent system prompt** |
| 实现 | 群聊容器 ~600 行 | **复用 executor + 小幅扩展** |

### 14.1 AgentTemplate 扩展

现有 `AgentTemplate`:id/name/description/prompt/tools/model/provider/agentType

需要扩展:
- **`agentType`**:从 `"mint"|"builder"|"evaluator"|"designer"` 改为 **`string`**(放开为自定义类型,用户创建任意角色)
- **`default`**:新增字段,标记该模板为"默认模板"(task 工具不指定 agent 时用它)
- **`thinkingLevel`**:可选,子 agent 思考级别(默认 medium)
- **创建/删除/编辑**:IPC CRUD 已有,需加 `default` 管理

**内置模板**(DEFAULTS):
| id | name | 说明 | provider/model |
|----|------|------|---------------|
| `default-builder` | Builder | 编码实现 | 默认走全局,用户可配 |
| `default-evaluator` | Evaluator | 验收 | 同上 |
| `mint` | Mint | 调度/方案 | 同上 |
| `mint-designer` | Mint-D | UI 设计 | 同上 |

### 14.2 模板模块功能

| 功能 | 说明 |
|------|------|
| **默认模板** | 标记一个模板为"默认",task 不指定 agent 时用它 |
| **自定义模板** | 用户自由创建:名称/描述/人格 prompt/供应商+模型/上下文/工具集/思考级别 |
| **模板编辑 UI** | 设置→Agent 页:列表 + 表单(增删改,设默认) |
| **Mint 建模板工具** | `create_agent_template({name, description, prompt, provider?, model?, tools?})`——一句话让 Mint 创建模板 |
| **模板可见性** | task 工具的 `agent` 参数描述动态注入模板清单(名称+一句话职责+模型) |

### 14.3 task 工具改造

**agent 参数描述动态化**:
```
"可选 Agent 模板:
  - default-builder: 编码实现(默认,DeepSeek flash)
  - test-writer: 测试员(自定义,DeepSeek pro)
  选择适合任务的模板;省略则用默认模板"
```
由 `listTemplates()` 动态生成,每次 task 工具创建时更新。

**子 agent system prompt**:executor 改用模板的 `prompt` 字段作为子 agent 的 system prompt(目前用 `opts.task`),描述/指令作为首条 user 消息。

### 14.4 executor 改造

现有 `resolveSubagentModel` 正确(委派指定 > 模板 > 子默认 > 全局),需要补:
- **system prompt**:模板的 `prompt` + `opts.task`(作为首条 user 消息)替代当前 `opts.task` 作为 system prompt
- **tools**:已有 `buildGroupTools`(按模板 tools)——但**需放开车加 task 工具**(子 agent 可递归委派,或禁用,由模板 tools 声明)
- **thinkingLevel**:读模板的 `thinkingLevel`(默认 medium)

### 14.5 设置→Agent 页

| 区域 | 内容 |
|------|------|
| **群聊设置**(保留,但简化) | 最大 Agent 数/转发策略/注入方式/深度——标注"群聊实验性,后续移除" |
| **Agent 模板列表**(新增) | 模板卡片(名称/描述/默认模型/默认标记)+ 编辑/删除/设为默认 |
| **新建/编辑模板表单** | 名称/描述/人格 prompt/供应商+模型/上下文大小/工具勾选/思考级别 |
| **预设组合**(保留) | 开发三人组等——可用于批量委派 |

### 14.6 群聊代码处置

群聊容器(`group-session.ts`、`GroupComposerDialog`、`GroupSettingsSection`)降级规划:
- **保留但标记实验性**:不继续投入开发
- **记录文件**(.easymint/group-sessions/)保留作为群聊历史(UI 显示)
- **assign_to_agent 工具 + 兜底语法**:保留(可转为 task 工具的轻封装)
- **未来评估**:如果"多 agent 长期会话协作"成为刚需,再从群聊方案升级;目前收敛

### 14.7 实现阶段

| 阶段 | 内容 | 文件 | 风险 |
|------|------|------|------|
| **A** | AgentTemplate 扩展(agentType→string,+default+thinkingLevel,+default 管理) | agent-templates.ts, store.ts | 低 |
| **B** | task 工具 agent 参数动态清单(读模板列表拼接) + executor 用模板 prompt | task/tool.ts, executor.ts | 低 |
| **C** | 模板编辑 UI(列表+表单,取代占位),默认模板设置 | GroupSettingsSection.tsx 或新组件 | 中 |
| **D** | Mint 建模板工具(`create_agent_template`) | task/tool.ts 或独立 | 低 |
| **E** | 群聊代码降级标注(UI/注释) | group-session.ts 等 | 低 |
