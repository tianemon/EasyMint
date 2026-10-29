---
name: ui-sync
description: >-
  已登记项目需要维护 task.json 正式任务清单或同步 building/evaluating/done 等状态时使用。
  不按「做个」「加个」「新增」等词自动触发，不为普通自由会话、局部修改或临时研究创建正式任务。
  负责正式任务与 UI 的同步，不复制会话进度清单。
---

# UI Sync — 新需求 UI 同步

已登记项目确实需要新增/调整正式任务或同步执行状态时，按本清单检查 UI。task.json 是正式任务状态的真相源，
UI 会自动读取它——你只需在运行时状态切换时主动调用 UI 工具。

## 检查清单

需要同步正式任务时，逐项检查：

### 1. 是否需要追加 task？

- 已有 task.json 对应本次工作时，沿用相关任务；普通局部修改或临时研究不因行数、文件数而新建正式任务。没有对应正式任务时跳过第 2 步的状态同步
- **执行方式按 Mint 主提示词「任务执行」判定**（creation-guide 同口径）：默认亲自推进，只在长任务上下文隔离、独立方向并行或独立复核有实际收益时委派，不因项目档位自动派 Builder/Evaluator
- 创建流程按判档需要正式清单，或已登记项目确需跨会话管理一批独立交付、依赖与验收状态时，新增/调整 task.json；新任务带 `status: "pending"`，不重复创建已有任务
- 写完 task.json 后 **不要** 逐条调 `set_task_status`——pending 状态 UI 自动读取

### 2. 开始执行时同步运行时状态

仅本次工作有对应的正式任务 id 时，进入编码/验收环节调用 `set_task_status`，让进度条实时滚动；无对应正式任务时不调用，也不为调用状态工具补建任务：

- 调 Builder 或自己动手前 → `set_task_status(id, "building")`
- 当前正式任务仍为 building、本次独立复核要关联 taskId 时 → `set_task_status(id, "evaluating")`；已完成任务的临时复核不回退原状态
- **你亲自实现并自验通过 → `set_task_status(id, "done")`**（亲自做的没有委派结果可回写，不标记进度条会停在 building）
- **委派实现的验收通过/失败/中止 → 由委派执行结果自动回写，不要手动标记**

## 何时不要调用 UI 工具

- 新增 pending 任务时（task.json 已记录，UI 自动读）
- 读取 task.json 之后（状态已在文件里）
- 重置已完成任务时（除非用户明确要求重做）

## 工具说明

- `set_task_status(taskId, status)` — 手动调用时机：开始正式任务(building)、仍为 building 的关联复核(evaluating)、**你亲自实现并自验通过(done)**；委派实现的 done / failed / aborted 由委派执行结果自动回写，不要手动标记

此工具只在 Mint 主会话可用，Builder 和 Evaluator 调不了——由你在调度前后调用。

## 与会话进度的边界

已有 task.json 时用它维护正式任务与验收状态，不为执行本技能再复制一份同名 todo_write 清单。仅当前正式任务内部确需多阶段推进时，按 Mint 主提示词的会话进度条件展示内部步骤；todo_write 不替代本技能的正式任务状态同步。
