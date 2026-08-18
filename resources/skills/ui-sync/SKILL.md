---
name: ui-sync
description: >-
  用户提出新需求、新建功能时使用。触发词如「做个」「加个」「新增」「写个」
  「需求」「我想要一个」「帮我实现一个」。不用于修改现有功能、修复 bug 或
  调整配置——那些不是新需求。此 skill 确保 UI 状态与新增任务同步。
---

# UI Sync — 新需求 UI 同步

用户提了新需求后，按本清单确保 UI 反映最新状态。task.json 是任务状态的真相源，
UI 会自动读取它——你只需在运行时状态切换时主动调用 UI 工具。

## 检查清单

收到新需求后，逐项检查：

### 1. 是否需要追加 task？

- 小微修改（只 1 个文件、≤20 行、无新依赖、无状态机变化）→ 不写 task.json，直接做，跳到第 2 步
- 2 个及以上独立功能，或超出小微范围 → 写入 task.json，每条带 `status: "pending"`
- 写完 task.json 后 **不要** 逐条调 `set_task_status`——pending 状态 UI 自动读取

### 2. 开始执行时同步运行时状态

进入编码/验收环节才调用 `set_task_status`，让进度条实时滚动：

- 调 Builder 或自己动手前 → `set_task_status(id, "building")`
- 交 Evaluator 验收前 → `set_task_status(id, "evaluating")`
- **验收通过/失败/中止 → 状态由委派执行结果自动回写，不要手动标记**

## 何时不要调用 UI 工具

- 新增 pending 任务时（task.json 已记录，UI 自动读）
- 读取 task.json 之后（状态已在文件里）
- 重置已完成任务时（除非用户明确要求重做）

## 工具说明

- `set_task_status(taskId, status)` — 只在 building / evaluating 时手动调用（调 Builder 前、交 Evaluator 前）；done / failed / aborted 由委派执行结果自动回写，不要手动标记

此工具只在 Mint 主会话可用，Builder 和 Evaluator 调不了——由你在调度前后调用。
