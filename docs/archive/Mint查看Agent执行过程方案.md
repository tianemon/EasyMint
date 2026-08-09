# Mint 查看子 Agent 执行过程（read_agent_log）方案

> **状态：✅ 已实现**（Mint 完整掌控 Agent 生命周期）。
> 2026-08-05 定稿。阶梯式递进：默认看结论，不够再看过程。

## 背景

Mint 已能创建（task）、观察（list_agents）、停止（stop_agent）子 Agent，但**无法查看执行过程**（思考/工具/输出）。
子 Agent 执行过程已完整落盘 jsonl（`childSessionFiles[index]`，executor 创建 session 后写入，运行中即可读），
前端弹层已能查看，但 Mint 上下文没有访问工具。

## 核心原则（阶梯式递进）

**先看结论，不够再看过程**——绝不默认看全量：

| 级别 | 内容 | token | 适用 |
|------|------|-------|------|
| 1（默认） | 最新一条输出总结 | ~200 | 绝大多数情况够判断 |
| 2 | 工具执行清单（名+参数截断+结果） | ~800 | 看"做了什么/卡在哪" |
| 3 | 思考过程 + 工具 + 输出全量 | 数千+ | 深层排查（谨慎） |

判断规则：level 1 能得出结论 → 停；不能 → 升 level 2；再不行 → level 3。

## 工具设计

```
read_agent_log({ delegation_id, index, level?: 1|2|3 })
```

**level=1（默认）**：最新一条文本输出
```
[运行中 32s] 最近输出: "...3 tests passed, 1 failed..."
```
- 运行中 = 当前最新输出；已完成 = 最终结论
- 统一读最后一条 text 消息，不区分状态

**level=2**：工具执行清单（按时间序）
```
1. [Bash] npm test → exit 1 (32s)
2. [Read] src/utils.ts → 已完成
3. [Edit] src/utils.ts → 已应用
当前: [Bash] npm test
```
- 每条：工具名 + 参数摘要（200 字符截断）+ 结果（exit code/完成）
- 总数上限 20 条

**level=3**：全量（思考 + 工具 + 输出）
- 思考块原文、工具调用、输出完整
- 用于排查深层问题

## 数据流

```
list_agents 拿 delegation_id, index
→ registry: childSessionFiles[index] (jsonl 路径)
→ getSubagentMessages(sessionFile) (解析 jsonl → SessionMessage[])
→ 按 level 裁剪 → 文本返回
```

## 触发时机（Mint guidelines）

**看**：
1. list_agents 显示任务卡住（running 但耗时异常久）→ level 1，不够 level 2
2. 子 agent 完成但结果异常 → level 1 看结论，不够看工具过程
3. 用户问"它在干嘛？" → level 1

**不看**（默认）：
- 子 agent 正常跑 → 等完成通知
- 已完成且结果正常 → 结果注入已够

**反模式**：每个 agent 都看 → 上下文爆炸 + 过度干预。

## 实施点

- `agent-service.ts`：`createReadAgentLogTool(sessionId)`，注入 allTools
- 复用：`getSubagentMessages`（session-service.ts）、registry `childSessionFiles`
- 裁剪逻辑：jsonl message content 块解析（thinking/tool_use/text 区分）
- promptSnippet/guidelines 补全（含"先看结论"原则）
