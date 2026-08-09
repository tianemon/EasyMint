# UI 组件合理化重构方案

> **状态：✅ 已实现**（SRP/行数红线重构）。
> 2026-08-06 定稿。按业界标准（SRP、关注点分离、行数红线）重构超标组件。
> 原则：拆职责不包容器；大文件拆到 <500 行；小组件不动。

## 现状（超标项）

| 组件 | 行数 | 问题 | 红线 |
|------|------|------|------|
| ChatPanel | 1383 | 上帝组件:消息渲染+事件订阅+委派+便签+输入 | >1000 硬红线 |
| SettingsDialog | 906 | 全部 tab 内联,Section 塞一个文件 | >800 |
| NewProjectDialog | 866 | 向导多步内联 | >800 |

## 拆分方案

### 1. ChatPanel（1383 → 目标 ~400）

拆 4 块（保持行为不变,纯搬移）:

**a. hooks/useChatEvents.ts（事件订阅）**
- onDelegationProgress / onDelegationInit / onDelegationCount / onShellCount / onSubagentStream 等 14 个 useEffect 中与事件流相关的
- 返回：delegation state、各回调
- 职责：Mint 回合事件流 → 状态

**b. hooks/useChatInput.ts（输入协调）**
- attaches / uploadFiles / handlePaste / handleDragDrop / img/doc 上传
- 返回：attaches、preview、各 handler

**c. components/ChatMessageList.tsx（消息渲染）**
- 虚拟化列表 + MemoChatMessage + 消息行(用户/AI/系统/群聊) + BubbleActions
- 展示组件,接收 messages + 回调 props

**d. components/ChatBubbleActions.tsx（气泡操作）**
- CopyBubbleBtn / PinBubbleBtn / BubbleActions 移出(已有独立倾向,收敛到一个文件)

ChatPanel 保留：组装 + 核心 sendText/轮转/压缩逻辑 + 挂载子组件

### 2. SettingsDialog（906 → 目标 ~400）

拆 tab 到 settings/ 目录（已有先例 ProviderSettings）:
- settings/GeneralTab.tsx（路径/聊天开关/压缩阈值/字体滑杆…）
- settings/AppearanceTab.tsx（界面:聊天字体分级）
- settings/PluginsTab.tsx（Skills + MCP）
- settings/AgentTab.tsx（AgentTemplateSettings + GroupSettingsSection）
- settings/AboutTab.tsx
- SettingsDialog 保留:tab 切换框架 + 头部 + 各 tab 引用

### 3. NewProjectDialog（866 → 目标 ~400）

按向导步骤拆:
- components/new-project/WizardStep.tsx(表单步骤通用)
- components/new-project/FeatureStep.tsx
- components/new-project/TechStep.tsx
- components/new-project/ConfirmStep.tsx
- NewProjectDialog 保留:步骤状态机 + 组装

## 实施顺序（风险从低到高）

1. **SettingsDialog**（拆分最机械,tab 边界清晰,风险最低）
2. **NewProjectDialog**（步骤边界清晰）
3. **ChatPanel**（最复杂,事件流+消息渲染耦合,最后做,需完整验证）

## 验证

- 每拆一块:lint + 手动过关键路径(聊天/设置/新建向导)
- 行为不变:纯搬移,不重构逻辑
- 保持 git 提交粒度:每组件一次提交,便于回退

## 不动

- <500 行的组件(SessionBar/TaskPanel 等已合理)
- 无独立状态的纯展示小组件
