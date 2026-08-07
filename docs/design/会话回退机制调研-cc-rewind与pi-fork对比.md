# 会话回退机制调研：cc rewind vs pi fork

> 背景：2026-08-06 用户在 cc 长会话（~1M 上下文）中手动 `/compact` 触发 `API Error 400: This model's maximum context length is 1048576 tokens. However, you requested 1055684 tokens`。随后使用 `/rewind` 恢复会话节点后继续工作。本调研回答三个问题：① cc 的 rewind 机制如何设计、如何实现节点选择；② 与 pi（pi-coding-agent）对比，哪个设计更合理、各有什么优缺点；③ 400 报错的根因与 cc 的防御机制。
>
> 结论摘要：**cc 是「单时间线 + 原地重来」（undo 哲学），pi 是「多时间线 + 分支文件」（git 哲学）。** 日常使用 cc 更优（瞬时、无损、体验连续），结构清晰与可探索性 pi 更优（物理隔离、双向导航）。cc 的明显缺陷是孤儿分支永留、无 GC、单向不可回切。若为 EM 设计，推荐 cc 模型 + 孤儿分支 GC + 树导航。

---

## 一、cc 的 rewind 机制

### 1.1 核心概念：append-only + parentUuid 链

cc 的会话文件是 **append-only JSONL**（`~/.claude/projects/<项目>/<sessionId>.jsonl`），每条消息携带 `parentUuid` 形成**单向链表**。任何回退**不删改历史**，靠「内存视图截断 + conversationId 换渲染 key + 新消息从回退点续链」实现。

关键源码（`claude-code-analysis`）：

| 符号 | 位置 | 作用 |
|------|------|------|
| `rewindConversationTo` | `src/screens/REPL.tsx:3661` | 核心回退：截断数组 + 换 key + 清压缩缓存 |
| `MessageSelector` | `src/components/MessageSelector.tsx` | 节点选择 UI（Restore conversation/code） |
| `selectableUserMessagesFilter` | `src/components/MessageSelector.tsx:767` | 可回退节点过滤 |
| `textForResubmit` | `src/utils/messages.ts:2873` | 回退后还原输入框（原话/bash/命令） |
| `recordTranscript` | `src/utils/sessionStorage.ts:1408` | 磁盘写入 + UUID 去重 + 链续接 |
| `resetSessionFile` | `src/utils/sessionStorage.ts:688` | 文件指针重置（仅 `/clear`/`/resume` 用） |
| `regenerateSessionId` | `src/bootstrap/state.ts:435` | 换 sessionId → 新文件（仅 `/clear` 用） |
| `buildConversationChain` / 死分支预过滤 | `src/utils/sessionStorage.ts:3229` 附近 | 恢复时沿 parentUuid 走主链，丢弃孤儿分支 |

### 1.2 节点选择（Restore conversation 界面）

`/rewind` → `MessageSelector`，可选节点**必须是用户消息**，过滤条件（`selectableUserMessagesFilter`）：

- ✅ 保留：用户亲手发过的、有意义的文本消息
- ❌ 排除：
  - `tool_result` 消息（`content[0].type === 'tool_result'`）
  - 合成消息：bash 输出、命令输出、task 通知、tick（`<bash-output>` 等标签）
  - compact 摘要消息（`isCompactSummary`）
  - `isMeta` / `isVisibleInTranscriptOnly`
- 默认选中**最后一条**可选节点，可上下导航，最多显示 7 条（`MAX_VISIBLE_MESSAGES = 7`）

### 1.3 回退执行

```js
// rewindConversationTo（REPL.tsx:3661）
const messageIndex = prev.lastIndexOf(message);
setMessages(prev.slice(0, messageIndex));   // 1. 截断内存消息数组
setConversationId(randomUUID());            // 2. 换渲染 key（旧消息行组件 remount）
resetMicrocompactState();                   // 3. 清压缩缓存
// 4. 恢复该消息时的 permissionMode，清 promptSuggestion
// 5. textForResubmit 把原话还原回输入框（bash-input → bash 模式；命令 → /cmd args）
```

特点：
- **不调用** `switchSession` / `regenerateSessionId`（只有 `/clear` 才换 sessionId → 新文件）
- **不写磁盘**——纯内存操作，O(1) 截断
- 回退后输入框**自动还原用户原话**，直接回车重发

### 1.4 磁盘层：不删、不改、只续链

- 旧消息**已写入磁盘的原样保留**（append-only；`recordTranscript` 按 UUID 去重，已存在直接跳过）
- rewind 后的新消息从回退点最后一条消息的 UUID 接 `parentUuid` 续链（`recordTranscript` 的 prefix-tracking 逻辑：已记录消息仅当构成前缀才作为 parent 候选）
- 结果：jsonl 数据一条不少，但形成**孤儿分支**。源码注释原文：

  > "Every rewind/ctrl-z leaves an orphaned chain branch in the append-only JSONL forever"（sessionStorage.ts:3229）

- 恢复时 `buildConversationChain` 从最新 leaf 沿 parentUuid 走，**自动丢弃死分支**；另有字节级预过滤器在 `parseJSONL` 前剔除死分支（41MB 99% 死数据时解析 56ms → 3.9ms，-93%）

### 1.5 与 compact 的关系

- compact 是**前缀保留**（新摘要在前，旧消息 keep 在后）
- rewind 是**前缀截断**（保留到某条用户消息为止）
- 两者共享同一套「append-only + UUID 去重 + 链重建」基础
- compact 边界消息（`compact_boundary`）在加载时用于截断 `--continue` 链

### 1.6 实证：当前会话的孤儿分支

对用户实际会话文件（`4b64c175-...jsonl`，67MB）尾部 500KB 分析：

- 211 条 user/assistant 消息，**11 个叶子节点**（链末端）
- **11 条断链消息**（`parentUuid` 指向更早位置）——与叶子数完全对应
- 结论：会话中 11 次回退/压缩操作，每次都在文件里留下一条不可达的孤儿分支。数据完整（67MB 全在），但旧分支从当前视图不可达

---

## 二、pi（pi-coding-agent）的对应能力

### 2.1 总体：没有 rewind，但有更激进的 fork/分支机制

| 能力 | cc | pi |
|------|-----|-----|
| 回退到历史节点 | ✅ `/rewind`（内存截断 + 还原输入框） | ❌ 无 |
| 从历史节点分支出新会话 | ⚠️ 内部有 chain 但无 UI | ✅ `/fork` + `/clone` + `/tree` |
| 会话树导航 | ❌ | ✅ `/tree`（分支切换） |
| 压缩 | ✅ compact（含 PTL 重试） | ✅ compact（文本序列化，天然规避 PTL） |
| 文件模型 | 单文件 append-only + parentUuid 链 | 单文件 + parentId 链 + **分支文件** |
| 节点标签化 | ❌ | ✅ label 条目挂树上 |

关键源码（`pi` monorepo，`packages/coding-agent/`）：

| 符号 | 位置 | 作用 |
|------|------|------|
| `fork` | `core/agent-session-runtime.ts:262` | 选 entry → 分支/新会话 |
| `createBranchedSession` | `core/session-manager.ts:1412` | 生成新 sessionId + 新 jsonl 文件 |
| `/tree` | `core/slash-commands.ts:33` | 会话树导航（切分支） |
| `label` | `session-manager` | 条目标签，挂树上可导航 |
| `serializeConversation` | `core/compaction/utils.ts:113` | 压缩时把对话序列化成纯文本 |

### 2.2 fork 机制

`/fork` 选一个 entry → `createBranchedSession(targetLeafId)`：

- 新 sessionId + 新文件 `<时间戳>_<sessionId>.jsonl`
- 新文件只含**到目标节点的链路径**（`getBranch` 沿 parentId 回溯），header 的 `parentSession` 字段指向旧文件
- label 条目需要重链（过滤 label 后重建 parentId，避免孤儿子树）
- 即 **物理分叉**：新旧分支完全隔离

### 2.3 压缩机制（关键差异）

pi 的压缩**不把 message 数组发 API**，而是先 `serializeConversation` 把对话序列化为纯文本（工具结果截断到 2000 字符），包装进 `<conversation>` 标签，作为**单个 user 消息**发送（compaction.ts `generateSummaryWithUsage`）：

```ts
// compaction/utils.ts
const TOOL_RESULT_MAX_CHARS = 2000;
// 每条消息: [User]: ... / [Assistant]: ... / [Assistant tool calls]: ... / [Tool result]: ...
// compaction.ts
let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
```

效果：**压缩请求本身极不可能超限**（文本已压缩），且模型不会把压缩当对话延续。这是 pi 从架构上规避 400 的手段。

---

## 三、设计对比：哪个更好？

### 3.1 本质区别

| | cc rewind | pi fork |
|---|---|---|
| 模型 | 单时间线 + 撤销（undo 哲学） | 多时间线 + 分支（git branch 哲学） |
| 操作语义 | 回到过去，原地重来 | 从过去长出新的未来 |
| 数据 | append-only 永留，孤儿分支逻辑忽略 | 新分支物理复制链路径，新文件 |
| 会话连续性 | 保持（conversationId、成本、上下文延续） | 断开（全新 sessionId，重开会话） |
| 复杂度位置 | 读路径（链解析、死分支过滤） | 写路径（分支创建、label 重链） |

### 3.2 cc rewind 优缺点

**优点**
- **瞬时且无损**：O(1) 内存截断，零磁盘写
- **会话连续**：回退后成本统计、会话 ID、上下文状态延续，"同一场对话重来"
- **体验好**：自动把用户原话还原回输入框，直接回车重发
- **模型简单**：单文件，无文件管理负担

**缺点**
- **文件无限膨胀**：孤儿分支永留，jsonl 可达 GB 级（源码注释自认）。**无 GC**——这是最实质的设计缺陷
- **回退单向**：rewind 后旧分支不可从当前视图切回（数据在磁盘，UI 无导航）。所谓"无损"是磁盘无损，UX 是单向门
- **读路径复杂度爆炸**：parentUuid 首键 invariant、深度扫描、字节级预过滤——都是从历史 bug 里长出的防御逻辑
- **内存/磁盘不一致**：磁盘有、内存无，滋生无穷边界 bug

### 3.3 pi fork 优缺点

**优点**
- **物理隔离**：每分支独立文件，大小可控，加载只解析当前分支
- **双向可导航**：`/tree` 切回任意分支继续——真正"探索多条路径"
- **存储即结构**：文件列表 = 会话树，直观；删分支 = 删文件
- **读路径简单**：无孤儿数据，链解析直接

**缺点**
- **操作重**：fork = 复制整条链路径到新文件（写放大），且语义是"新会话"而非"回退"
- **存储冗余**：共享前缀在每分支文件重复（parentSession 指针缓解但复制仍在）
- **没有轻量撤销**：误操作想"回到 10 轮前重新来"——要先 fork 再从新会话继续，**没有原地回退动作**，真实功能缺口
- **写路径复杂度**：分支创建、label 重链、路径重建的边界处理（createBranchedSession 的 label 重链段就是证明）

### 3.4 工程权衡本质

- cc 把复杂度**压在读路径**（链解析），写操作零成本，读操作慢慢还历史债
- pi 把复杂度**压在写路径**（文件管理），fork 时物理复制，读路径干净

对用户感知：cc 更适合**偶发的轻量撤销**（80% 场景）；pi 适合**刻意的多路径探索**（fork 是刻意操作，写成本可接受）。

### 3.5 结论：理想设计（结合两者）

1. **cc 的轻量 rewind**：瞬时、无损、还原输入框、保持会话连续性
2. **pi 的分支文件管理 + `/tree`**：物理隔离、双向导航
3. **补 cc 缺的 GC**：孤儿分支超过 N 代后提示归档/删除——cc 唯一称得上"设计缺陷"的点（GB 级文件拖慢一切）
4. **节点标签化**（pi 有 label，cc 无）

> 一句话：cc 赢在日常体验和实现简单，输在历史债累积和单向性；pi 赢在结构清晰和可探索性，输在没有轻量撤销且操作笨重。若只选一个做进产品，选 **cc 模型 + 孤儿分支 GC**——"误操作撤销"是更普遍的需求，文件膨胀是可通过清理解决的工程问题，单向性可加树导航补。

---

## 四、400 报错根因（用户实际遇到的问题）

### 4.1 报错信息拆解

```
API Error: 400 This model's maximum context length is 1048576 tokens.
However, you requested 1055684 tokens (924612 in the messages, 131072 in the completion).
```

- `131072 in the completion`：max output tokens 是 131072（128k）
- **这是「正常对话请求」而非「压缩请求」**——cc 的压缩请求 `maxOutputTokensOverride` 上限 20k（`COMPACT_MAX_OUTPUT_TOKENS = 20_000`），不会出现 131072
- 即：**压缩之前已经发出了一个超限的对话请求**（924k messages + 131k completion > 1M）

### 4.2 cc 的防御机制（发送前预检）

cc 在每次发送前运行 `shouldAutoCompact`（`src/services/compact/autoCompact.ts:160`）：

```ts
// 阈值 = 有效窗口 - 13k buffer
export function getAutoCompactThreshold(model: string): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model);
  return effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS;
}
// AUTOCOMPACT_BUFFER_TOKENS = 13_000
// 有效窗口 = 模型窗口 - min(maxOutputTokens, 20k)   // 摘要输出预留
```

触发链：`query.ts:454` → `deps.autocompact` → `shouldAutoCompact` → `compactConversation`

失败兜底（`compactConversation`，compact.ts:387）：
- **PTL 重试**（CC-1180）：压缩请求自身触发 prompt-too-long 时，`truncateHeadForPTLRetry` 按 API round 组丢弃最旧消息，最多重试 3 次（`MAX_PTL_RETRIES = 3`）
- 熔断器：连续 3 次压缩失败（`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`）后本会话不再自动重试
- token gap 解析：从错误文本 `"prompt is too long: N tokens > M maximum"` 正则解析差额，一次性跳过多组

### 4.3 为什么预检没拦住？（可能原因）

1. **估算偏低**：`tokenCountWithEstimation` 优先用**上次 API 响应的 usage**（`getTokenCountFromUsage`）加上后续消息的 rough 估算（4 chars/token）。rough 估算对 JSON 类内容用 2 chars/token（`bytesPerTokenForFileType`），但对其他内容可能低估——尤其大量 tool_result、thinking 块时
2. **预检与发送间的时间窗口**：预检基于 messagesForQuery，实际发送时可能附加了更多内容
3. **手动 compact 的触发点**：用户手动 `/compact` 时，压缩请求本身有 PTL 重试兜底；但**压缩前那个触发预检失败的对话请求**已经发出去了——即问题出在"预检通过但实际超限"
4. **131072 completion 的角色**：即使 messages 略低于上限，131072 的 completion 预留使总请求超限

### 4.4 pi 为何不易触发

pi 的压缩是**文本序列化**（`<conversation>` 包纯文本 + 工具结果截断 2000 字符），压缩请求本身极难超限；对话请求则由模型提供方限制。pi 无对话级预检（无 `shouldAutoCompact` 等价物），靠 `tokenCountWithEstimation` 类似的估计 + 模型窗口管理。

---

## 五、对 EM（EasyMint）的启示

EM 目前**只有 compact，没有 rewind 也没有 fork**（基于 pi-coding-agent 的 `createAgentSession` + 会话文件）。若未来要加回退/分支能力：

### 可选路径

1. **轻量 rewind（推荐优先）**：仿 cc——前端消息数组截断 + 后端 session 文件支持「从某条消息续链」。成本低，解决"误操作撤销"最痛场景
2. **分支文件（中期）**：仿 pi `createBranchedSession`——从历史节点生成新 session 文件。解决"多路径探索"
3. **GC/归档（必须的卫生机制）**：无论选哪个模型，孤儿/过期分支要有清理策略，避免 jsonl 无限膨胀

### 设计决策清单（未来做时对照）

- [ ] 回退是否还原用户输入框（cc 体验关键）
- [ ] 回退是否保持会话连续性（成本统计、模型设置）
- [ ] 是否需要树导航（`/tree` 等价物）
- [ ] 分支的存储模型：单文件链 vs 多文件（隔离性 vs 简单性）
- [ ] 孤儿分支的 GC 策略（代际、大小、时间）
- [ ] 压缩请求的输入形式：message 数组 vs 文本序列化（pi 的方案天然防 PTL）

---

## 六、参考源码位置

| 项目 | 仓库 | 关键路径 |
|------|------|----------|
| cc | `~/dev/project/GitHub/claude-code-analysis` | `src/screens/REPL.tsx`、`src/components/MessageSelector.tsx`、`src/utils/sessionStorage.ts`、`src/services/compact/autoCompact.ts`、`src/services/compact/compact.ts`、`src/utils/messages.ts` |
| pi | `~/dev/project/GitHub/pi` | `packages/coding-agent/src/core/agent-session-runtime.ts`、`core/session-manager.ts`、`core/compaction/compaction.ts`、`core/compaction/utils.ts`、`core/slash-commands.ts` |
| pi 壳 | `~/dev/project/GitHub/oh-my-pi` | 未深入，仅确认结构 |
| EM SDK | `node_modules/@oh-my-pi` | pi-coding-agent 打包产物 |

> 注：cc 源码为 GitHub 泄露版（`claude-code-analysis`），行号以 2026-08 时点为准；pi 为官方开源 monorepo。
