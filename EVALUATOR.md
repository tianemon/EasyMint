# 评估 Agent 操作手册

> **独立评估 + 现场修复。** 发现小问题当场修掉重新验证，大问题标记 FAIL。代码修改不 commit，由 harness 统一提交。

---

## 1. 选择任务

读取 `task.json`，选一个待评估的任务：
- 优先 `passes: true, evaluated: false`
- 其次 `passes: false, evaluated: false`

无待评估任务则退出。

---

## 2. 启动应用

先检查 Vite dev server 是否已在运行：

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

- 返回 200 → 直接用
- 其他 → `npm run dev:renderer &` 后台启动，等端口就绪（最多 30 秒）

mock-ipc 已注入所有假数据，Playwright 直连 `localhost:5173`。

---

## 3. 逐项验证

读任务的 `steps`，每步对应一个验证项。

### 视觉项（颜色、布局、间距、对齐、溢出）

截图 + image-vision 验证。不用 snapshot/evaluate。

1. `browser_navigate` 打开页面
2. `browser_take_screenshot` 截图
3. `mcp__image-vision__describe_image` 分析截图
4. 操作（click/type）
5. 操作后再次截图 + 再次 image-vision
6. `browser_console_messages` 检查 JS 报错

证据引用 image-vision 的具体描述和数值。

### 逻辑项（元素存在、文字内容、状态切换）

可用 `browser_snapshot` 或 `browser_evaluate` 验证。

### PASS 标准

所有 step 满足：视觉项颜色/尺寸与 step 中数值一致，逻辑项行为正确，控制台无 JS error（favicon 404 除外），lint + build 通过。

---

## 4. 发现问题 → 当场修复

优先自行修复，不留给 builder。

1. 定位根因（读源码、CSS、DOM）
2. 修改代码
3. lint + build 验证
4. **重新截图 + 重新识图**确认 PASS
5. 全部修完后，标记 `evaluated: true`，更新 progress.txt

**只在以下情况才标记 FAIL 留给 builder：**
- 需要改 > 3 个文件
- 涉及 main 进程（evaluator 只测 renderer）
- 根因不明

此时在任务 description 末尾追加 `[评估: FAIL — 具体原因]`，将 `passes` 改回 `false`。

---

## 5. 输出报告

完成后追加 `temp/evaluator/report-<task-id>.md`：

```markdown
## 评估报告 — [任务标题]

**评估时间**: YYYY-MM-DD HH:MM
**结论**: PASS / FAIL

### 逐项检查

| # | 验收条件 | 结果 | 证据 |
|---|---------|------|------|
| 1 | xxx | ✅/❌ | image-vision 返回的具体描述 |

### 发现的问题

- [问题描述]
- [修复记录]

### 截图

- ![截图](路径)
```

---

## 6. 更新进度

追加 `progress.txt`：

```
## [YYYY-MM-DD] - 评估: [任务标题]

### 结论: PASS / FAIL
### 修复: [具体修复了什么问题]
### 备注: [给后续 agent 的备注]
```

---

