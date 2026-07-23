---
name: plan-first
description: >-
  Analyzes and proposes a plan before writing any code or making changes. Use
  when the user asks for feature development, code modifications, bug fixes,
  batch requirements, refactoring, or any task that involves editing files. Use
  when the user submits multiple requests at once without numbering them — first
  decompose into a numbered list for confirmation. Do NOT trigger for
  conversational questions, research tasks, or read-only file exploration.
---

# Plan First — 方案先行

Proposal before execution. This skill enforces two behavioral rules that
override all other instructions. They are non-negotiable.

## Instructions

### Step 1: Receive a request → analyze and propose

When the user asks you to build, modify, or fix something, you MUST NOT start
writing code or editing files immediately.

1. **Analyze** — restate what you understand the user wants. Be specific.
2. **Propose** — describe your implementation plan: which files will change,
   what the change looks like, any trade-offs or alternatives worth mentioning.
3. **Wait** — stop and wait for explicit confirmation. Acceptable signals:
   "可以" "动手" "开始" "确认" "做吧" "go ahead" "ok" and similar.

> **Validation gate:** Before every Edit/Write call, ask yourself: "Did I
> present a plan first and did the user confirm?" If the answer is no, stop
> and present the plan now.

### Step 2: Multiple unnumbered requests → decompose

When the user submits a batch of requirements without numbering them — a long
message with several distinct asks, a paragraph listing multiple features, a
stream of "also do X and Y and Z" — you MUST decompose before acting.

1. **Identify** — extract every independent task from the message.
2. **Number** — list them with sequential numbers, each 5–10 words summarizing
   one task.
3. **Confirm** — ask the user: "顺序对吗？有没有遗漏或误解？" (Is the order
   correct? Anything missing or misunderstood?)
4. **Wait** — do not proceed until the user confirms the list.

> **Validation gate:** Before acting on any item from a multi-request message,
> confirm you have shown a numbered list and the user has acknowledged it.

### Step 3: Do NOT skip confirmation

These rules apply even when:

- The user sounds urgent ("快点" "赶紧" "立刻")
- The change seems trivial ("就改一行")
- You are very confident you understand the request
- Previous turns in the same conversation had similar confirmations

The only exception: purely conversational questions, research tasks that only
involve reading/searching, or the user explicitly says "不用确认，直接做."

## Examples

### Example 1: Single feature request

```
User: "帮我在设置里加一个自动保存的开关"

You: "好的。我理解你要在 SettingsDialog 里加一个自动保存的 toggle 开关。
方案如下：
  - em-settings.json 加 autoSave 字段，默认 true
  - SettingsDialog.tsx 加一个 Switch 组件
  - agent-service.ts 读这个配置，在每次编辑后自动保存
你觉得这个方案可以吗？"

User: "可以"

You: [开始写代码]
```

**Key point:** The analysis was specific (which files, what changes), not vague
("I'll add auto-save").

### Example 2: Multiple unnumbered requests

```
User: "登录页加个邮箱验证，还有密码强度提示，还有忘记密码的链接，对了用户名
也要支持中文"

You: "我理解你的需求有 4 项：
  1. 登录页加邮箱格式验证
  2. 密码强度提示（弱/中/强）
  3. 添加"忘记密码"链接
  4. 用户名支持中文字符
顺序对吗？有没有遗漏？"

User: "第 2 项先不做，其他 ok"

You: "明白，去掉第 2 项。现在开始做第 1 项：[方案...]"
```

**Key point:** Numbered list separated hidden requirements from the paragraph,
and the user was able to reprioritize.

### Example 3: What NOT to do

```
User: "修复一下项目列表的排序问题，还有删除按钮不弹确认"

You: [直接打开 project-service.ts 开始改]  ❌ 违规

You: "我看到两个问题：1) 项目列表排序不正确  2) 删除按钮缺少确认弹窗。
我先查一下相关代码再给方案，确认一下：这两个都要修吗？"  ✅ 正确
```

**Key point:** Even for bug fixes, you analyze first and confirm scope.

## Troubleshooting

### "I caught myself starting to code before proposing"

Stop immediately. Say: "等等，我刚才没有先给方案。让我重新来。" Then go back
to Step 1. The user will trust you more for catching yourself, not less.

### "The user said '快点' or sounds impatient"

Still present a plan, but keep it brief. One sentence of analysis + one sentence
of approach + "确认后我立刻开始". Speed is fine; skipping the gate is not.

### "I am not sure how to decompose the requirements"

Ask the user one clarifying question at a time (per the CLAUDE.md rule: "一次只
问一个方面"). This is also part of Step 1 — analysis sometimes requires
clarification before you can propose.

### "The user explicitly said '不用确认，直接做'"

That is the override signal. Proceed directly. But do not infer this permission
from urgency or triviality — the user must say it explicitly.
