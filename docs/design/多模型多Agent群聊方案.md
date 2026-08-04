# 多模型 / 多供应商 / 多 Agent 群聊方案

> 本文档是 5 条需求(默认模型、Agent 指定模型/供应商、会话绑供应商、多 Agent 群聊)的**唯一真相源**。
> 设计定稿于 2026-08-03,实现完成于 2026-08-03/04。任何会话改此功能前必读本文件。

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

## 2. SDK 能力边界调研(关键技术结论)

Pi SDK(`@earendil-works/pi-coding-agent`):

- `createAgentSession({ model })` 创建**单模型** session;`session.setModel(model)` 可热切换(跨 provider 需已 `setRuntimeApiKey`)
- **无"多 Agent 共享上下文"能力**——每个 session 独立 jsonl/上下文 → 群聊必须应用层实现
- API key 通过 `setRuntimeApiKey(providerId, key)` 作为基础配置存储;模型信息(端点/格式/成本)嵌入 Model 对象,请求时按 `model.provider` 组合
- `getModel(provider, id)` **精确查找**(无 fallback 概念,需自己实现降级);`getProviderAuthStatus(providerId)` 返回 `{configured}`
- 关键方法:`prompt(text)`、`steer(text)`(打断)、`followUp(text)`(当前回合结束后发)、`getLastAssistantText()`(累计全文)、`sendCustomMessage(payload, {triggerTurn})`

**结论**:需求 1/2/3/5 用 SDK 能力 + 应用层配置实现;需求 4 需完整应用层群聊容器。

## 3. 总体架构

```
用户消息 → 群聊容器(GroupSessionManager) → 路由(@提及/主Agent) → 目标 Pi session
                                                          → turn_end 提取结论 → 转发给其他 Agent
                                                          → 事件广播(注入 groupId + agentRole) → 前端群聊视图
```

- **群聊 = 多个 Pi session 的虚拟聚合**:每个参与 Agent 一个独立 session(独立 jsonl/上下文)
- 前端按 `groupId` 过滤事件,按 `agentRole` 标注消息来源
- 持久化:项目级 `.easymint/group-sessions.json`(结构元数据)

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

## 8. 群聊交互设计(7 点,全部定稿)

### 8.1 发起群聊

- Sidebar「+ 新建 → 群聊会话」→ GroupComposerDialog
- 从 AgentTemplate 选参与角色(预设组合 + 自由勾选,受 maxGroupAgents 限制)
- 内置预设:开发三人组(Mint+Builder+Evaluator)、设计协作(Mint+Mint-D)
- 现有单 Agent 会话不受影响(群聊是独立模式)

### 8.2 用户消息路由

- 默认发给主 Agent(第一个角色)
- `@角色名` 切换目标;不广播(避免并发请求风暴 + 上下文污染)

### 8.3 Agent 间转发显示

- 每条消息标注 Agent 身份:角色头像(固定色)+ 名称
- 转发消息显示来源标记:`[来自 X 的消息]` 文本前缀 + 前端"· 来自 {X}"
- 时间线交错排列(按 piTs 有序插入)

### 8.4 持久化与恢复

- 项目级 `.easymint/group-sessions.json`(groupId/agents/sessionId/provider/model)
- 各 Agent 消息在各自 Pi jsonl
- **恢复(resume)未实现**(见待办)——group-sessions.json 已存结构,无 resumePiSession 路径

### 8.5 防环机制(三层)

① 消息 ID 去重(forwardSeen)——**已废弃**(深度递增链 ID 每次都不同,去重失效;防环实际靠 ②③)
② 最大转发深度(默认 3):`depth+1 > maxForwardDepth` 停止
③ 结论才转发:只转 turn 结束的文本结论,不转工具过程/thinking → 自然不形成实时循环

### 8.6 Agent 失败处理

| 场景 | 处理 |
|------|------|
| 503/网络 | 重试 ≤3 次(循环重试);重试前 `trySwitchFallback` 切兜底 |
| 仍有失败 | 标记 offline,跳过(不阻塞其他 Agent);状态栏提示 |
| 硬错误(配置/权限) | 同上(统一走重试计数) |
| 整群聊 | 不停——其他 Agent 继续;离线 Agent 无法自动恢复 |

### 8.7 上下文轮转

- 各 Agent 独立 compact(Pi 原生)
- 群聊整体不 compact(无"群聊级上下文")
- EM 层主动压缩(contextThreshold)/轮转追踪**未接入群聊**(靠 Pi 自动)

## 9. 工程层面(3 点)

| 数据 | 位置 | 说明 |
|------|------|------|
| 群聊结构 | 项目级 `.easymint/group-sessions.json` | 持久化,恢复用 |
| 各 Agent 消息 | 各自 Pi jsonl | Pi 原生 |
| 转发记录/排队 | 运行时内存 | 不持久化 |

- **并发控制**:maxGroupAgents 限制;回合天然串行(转发结论触发);不做额外限流
- **权限模式**:群聊各 Agent 写 session-cache(permissionMode),`createCanUseTool` 实时读取;创建弹窗可选 auto/plan/acceptEdits/bypass

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

1. **群聊跨重启恢复未实现**:group-session 为内存态;重启后 tab 恢复但 group 清空,发送报"群聊不存在";group-sessions.json 已存结构,无 resume 路径
2. **群聊历史聚合加载未实现**:重启后前端不加载各 Agent jsonl 历史(只读展示)
3. **模板编辑 UI 未实现**:provider/model 无法在 UI 配置(IPC CRUD 已通)
4. **tab 品牌图标 + 会话切换供应商 UI 未实现**
5. **群聊 Agent 用 task 工具断链**:若模板声明 task,委派完成通知 `injectSystemMessage(tempSessionId)` 找不到 activeChat 被吞(默认模板无 task 已规避)
6. **群聊 Agent 无 product 工具**:`buildGroupTools` 按模板 tools,默认模板不含 show_*/set_task_status 等
7. **forwardSeen 已删**:防环靠 maxForwardDepth + 结论才转发(每跳都是新结论,无同内容循环)

## 13. 关键实现决策(重要信息)

- **群聊回合天然串行**:转发是"结论才触发 + 目标忙则排队",各 Agent 回合串行 → 前端复用单 `latestAiIdRef`,无需按角色分块跟踪
- **群聊事件不广播 agent:exit**:前端靠群聊 turn_end 清 busy(onExit 是单会话信号)
- **用户消息本地 append**:主进程 `sendGroupMessage` 不广播 user_message,前端(含创建弹窗)本地写 chat-store(groupId 为 key),防重复
- **busy 排队不触发转发链**:`injectQueued` 挂临时 subscribe 只广播,回合输出不转发,防 busy 队列链式爆炸
- **模型解析统一入口**:`getModel(preferredProvider, preferredModel)`(会话/群聊指定)→ 无指定走 `getActiveModel`(默认→活跃→兜底)
- **模板 tools 语义**:基础 coding 工具(Read/Write/Edit/Bash 等)由 createPiSession 强制追加,无法按模板裁剪;模板 tools 只控制 task/MCP 等 extraTools
