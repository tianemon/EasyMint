---
name: requirement-breakdown
description: >-
  Decomposes user requirements into structured, verifiable checklists before
  any coding begins. Use when the user requests new features, modifications,
  optimizations, or expresses vague dissatisfaction with current results.
  Triggers on phrases like "帮我加一个", "能不能改", "再做一个", "还要",
  "另外", "对了", "顺便", "感觉少了", "不太对", "能不能优化", "这里有个bug",
  "我想要", "调整一下", "加个功能", "改一下". Do NOT trigger on purely
  conversational questions, read-only research, or when the user is only
  asking for information without requesting a code change.
---

# Requirement Breakdown — 需求拆解

Decompose every user request before touching code. The depth depends on
complexity — simple asks get a quick confirmation; complex ones get full
structural decomposition.

## Instructions

### Step 1: Detect complexity

Read the user's request and classify it using these signals. If you are
uncertain between modes, default to deep mode.

**Fast mode signals (1–2 items, clear):**
- 1–2 distinct requirements, each concrete and unambiguous
- Request fits in ≤ 2 lines
- User said "就改一下" with a specific target
- Technical details are explicit ("登录按钮颜色改成 #16a34a")

**Deep mode signals (3+ items, vague, or mixed):**
- 3+ requirements mixed together without numbering
- A long paragraph with no structure
- Bridging phrases: "还有..." "对了..." "顺便..." "另外..." "再加一个"
- Vague expressions: "感觉不够好" "少了点什么" "不太对" "能不能更好看"
- An追加请求 right after a task round completed
- The user seems to be brainstorming rather than giving clear instructions

### Step 2: Fast mode

When the request is simple and clear:

1. **Confirm understanding** in one sentence. Restate what you heard.
2. **State your approach** in one sentence. Which files, what change.
3. **Wait** for explicit confirmation before editing any file.

> **Validation gate:** Did you restate the request AND describe the approach
> AND wait for a "可以" / "动手" / "开始" response? If you skipped any of
> these, stop and fix it.

### Step 3: Deep mode

When the request is complex, vague, or unstructured. Follow the methodology
in `references/aord-principles.md`. Key steps:

1. **Extract** — identify every independent requirement from the user's
   message. Treat each sentence and each "还有/另外/对了" as a potential
   separate item.

2. **Structure** — organize requirements as a numbered tree, starting from
   user goals (principle 2), then breaking down into modules → features →
   subtasks (principle 3). Assign preliminary P0/P1/P2 priorities:

   ```
   用户目标: [一句话]
     ├── P0: [没它不成立的功能]
     │   ├── 1.1 [功能点]
     │   └── 1.2 [功能点]
     ├── P1: [核心体验]
     │   ├── 2.1 [功能点]
     │   └── 2.2 [功能点]
     └── P2: [锦上添花]
         └── 3.1 [功能点]
   ```

3. **Fill gaps** — for each item the user mentioned, apply CRUD exhaustiveness
   (principle 7): is Create/Read/Update/Delete all covered? For each item,
   ask yourself whether input, output, and exceptions are defined
   (principle 4). If something is missing, flag it with a `⚠️ 待确认` marker
   rather than guessing.

4. **Present** — show the numbered list and ask three questions:
   - "优先级对吗？"
   - "有没有遗漏的功能？"
   - "有没有理解错误的地方？"

5. **Wait** — do not proceed to any implementation until the user confirms
   the list. The user may reorder, delete items, or add new ones.

> **Validation gate:** Before moving into implementation, confirm you have
> shown a structured numbered list and the user has explicitly acknowledged
> it.

### Step 4: One item at a time after confirmation

Once the user confirms the list, tackle items sequentially in priority order.
For each item, present a brief implementation plan (per plan-first skill
rules), execute, then report completion before moving to the next.

## Examples

### Example 1: Fast mode — simple, clear request

```
User: "帮我把设置页的保存按钮颜色改成 #16a34a"

You: "明白，把 SettingsDialog 里保存按钮的背景色改成 #16a34a。
只改这一个颜色值。确认后我开始？"

User: "做吧"

You: [Edit the file]
```

**Key point:** One sentence to confirm, one sentence for approach. Minimal
ceremony for a clear request.

### Example 2: Deep mode — multiple mixed requests

```
User: "我想加导出功能，还要搜索，还有用户头像。对了排序也加上。"

You: "我帮你梳理一下，4 个需求：

  用户目标: 数据管理和展示更便捷

  P0（核心功能）:
    1. 数据搜索 — 关键词筛选
    2. 列表排序 — 按时间/名称排序

  P1（体验增强）:
    3. 数据导出 — 导出为 CSV/Excel
    4. 用户头像 — 上传和显示头像

  ⚠️ 待确认:
    - 导出：要支持哪些格式？CSV 够不够？
    - 搜索：实时搜索还是按回车搜索？
    - 头像：需要裁剪功能吗？

  优先级、遗漏、理解错误 — 这三点你帮我看看？"

User: "导出加个 Excel 就行，搜索实时，头像不用裁剪。优先级对。"

You: [开始按 1→2→3→4 顺序实现，每项先给方案再动手]
```

**Key point:** Extracted 4 hidden items, assigned priorities, flagged unknowns
without guessing, waited for confirmation.

### Example 3: Deep mode — vague dissatisfaction

```
User: "感觉这个页面不太好用"

You: "我帮你理一下。你说'不好用'，是哪个方面？

  1. 布局 — 东西找不到，按钮位置不合理？
  2. 速度 — 加载慢，操作卡顿？
  3. 信息 — 缺少关键数据，或者信息太多太乱？
  4. 流程 — 操作步骤多，逻辑不顺畅？
  5. 视觉 — 颜色/间距/字体不协调？

  能不能具体说说你遇到什么问题了？"

User: "主要是信息乱，各种数据堆在一起"

You: "明白了，是信息架构的问题。我来拆一下改善方向：

  用户目标: 页面信息清晰可读，一眼找到关键数据

  P0:
    1. 数据分组 — 按类别分区展示
    2. 关键指标提取 — 核心数据置顶

  P1:
    3. 筛选/折叠 — 次要信息默认收起
    4. 视觉层级 — 标题/副标题/正文的字号权重

  先确认方向对，我再细化每个点的方案。"
```

**Key point:** Don't guess what the user means. Ask a structured multiple-choice
to narrow the vague feedback into concrete requirements. One question at a time.

### Example 4: What NOT to do

```
User: "帮我加导出、搜索、排序，还有权限管理"

You: "好的，导出用 CSV 格式，搜索用全文检索..."  ❌ 违规
→ 没有拆解，直接跳到实现。4 项需求混在一起处理。
→ 没问优先级、没确认理解、没等用户说"可以"。

You: "我拆一下，4 项需求按优先级排列：..."  ✅ 正确
→ 先结构化展示，等确认，再动手。
```

## Troubleshooting

### "用户说'太啰嗦了，直接做吧'"

If the user explicitly rejects the breakdown process, respect it. But provide
a one-line summary of what you understood before executing: "好的。我理解你要
做 X 和 Y 两件事，我现在开始。" This satisfies the "先确认" requirement with
minimal friction.

### "用户发了一个很长的、已经带序号的需求列表"

If the user's message is already structured (numbered, with clear priorities),
do not re-decompose it. Fast mode applies — confirm understanding in one
sentence and proceed item by item.

### "我在拆解时发现部分需求完全不懂"

Flag those items with `⚠️ 需进一步讨论` and focus on what you do understand.
Do not skip or guess. Present the structured list with unknowns clearly marked,
and ask the user about the flagged items specifically.

### "用户追加了一个需求，但前一批还没做完"

Append the new item(s) to the existing numbered list and re-present the full
list with the additions highlighted. Ask: "之前的顺序要调整吗？新需求排第几？"
Never silently insert new requirements into a running implementation sequence.

### "我不知道该标 P0 还是 P1"

Use these definitions:
- **P0** — 没它，项目不成立。核心功能、阻断性问题。
- **P1** — 核心体验。没有也能用，但有就是好产品。
- **P2** — 锦上添花。做了更好，不做也行。

When in doubt, mark it P0 and let the user demote it. Users prefer being asked
"Is this really P0?" over discovering something critical was marked optional.
