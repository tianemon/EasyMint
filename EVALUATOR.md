# 评估 Agent 操作手册

> **独立评估模式。** 不修改代码、不提交。只评估、报告、标记。

---

## 1. 选择任务

读取 `task.json`，选择一个待评估的任务：
- 优先选 `passes: true, evaluated: false` 的任务（构建完成但未评估）
- 其次选 `passes: false, evaluated: false` 的任务（可能需要先构建）

如果没有待评估任务，输出「没有待评估任务」并退出。

---

## 2. 理解验收条件

阅读任务的 `description` 和 `steps`，从中提取验收条件清单。每个 step 至少对应一个验证项。

例：step 写"用户可点击登录按钮进入主页"，验收条件就是"点击登录按钮后跳转到主页，页面标题包含'欢迎'"。

---

## 评估范围

**只验证 UI 层交互，不测试需要实际调用 Claude CLI 的功能。** mock-ipc 已注入所有 electronAPI 假数据，评估只关注 DOM 层面的正确性。

### 验证什么
- 页面布局：元素是否存在、位置是否正确、暗色/亮色主题下颜色是否正常
- 导航：点击跳转是否到达正确的 route
- 表单交互：输入、选择、提交按钮状态变化
- 状态切换：toolbar 按钮切换、步进器步数切换、tab 切换
- 空状态/错误状态：是否显示正确的占位或错误提示
- 控制台：有无 JS 报错

### 不验证什么
- agent-service 的 spawn/JSONL 流 — 需要真实 Claude CLI
- StreamPanel 实时流渲染 — 需要 Claude 实际输出
- ChatPanel 双向对话 — 需要 `--input-format stream-json`
- evaluator-service 调度 — 需要 worker 实际完成
- 终端嵌入（P2）— 本期不做

涉及以上功能的任务评估时，仅验证 UI 框架是否正确（组件挂载、占位内容、按钮可点击），不验证数据流。

---

## 3. 启动应用

先检查 Vite dev server 是否已在运行：

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

- **返回 200** → 直接用，跳过启动。
- **其他** → 执行 `npm run dev:renderer &` 后台启动 Vite，等待端口就绪（最多 30 秒）：

```bash
for i in {1..30}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5173 2>/dev/null)
  if [ "$code" = "200" ]; then break; fi
  sleep 1
done
```

**禁止启动 Electron。** 评估只验证 renderer 层，Playwright 直接连 Vite dev server 的 `localhost:5173`。mock-ipc 已为所有 electronAPI 调用注入假数据，无需 Electron 进程。

---

## 4. 逐项验证

**每个验收条件都必须验证。** 根据条件类型选择验证方式：

### 前端/UI 验证

**每个截图后必须调 `mcp__image-vision__describe_image` 分析，禁止直接看图。**

1. `mcp__playwright__browser_navigate` 打开页面
2. `mcp__playwright__browser_take_screenshot` → `temp/evaluator/screenshot-<任务ID>-<序号>.png`
3. `mcp__image-vision__describe_image({path: "/完整路径/.../screenshot-1-1.png"})` 分析截图
4. `mcp__playwright__browser_click` / `browser_type` 操作
5. **操作后再次截图 + 识图**，验证状态变化
6. `mcp__playwright__browser_console_messages` 检查 JS 报错

### 后端/API 验证

用 `curl` 测试端点：
```bash
curl -s http://localhost:PORT/api/endpoint
```

检查状态码、响应体结构、关键字段。

---

## 5. 输出评估报告

完成后将报告追加到 `temp/evaluator/report-<task-id>.md`：

```markdown
## 评估报告 — [任务标题]

**评估时间**: YYYY-MM-DD HH:MM
**结论**: PASS / FAIL

### 逐项检查

| # | 验收条件 | 结果 | 证据 |
|---|---------|------|------|
| 1 | xxx | ✅ | 截图显示标题"xxx"正常渲染 |
| 2 | yyy | ❌ | 点击按钮后页面未跳转，控制台报错: ... |

### 发现的问题

- [描述每个 bug，注明复现步骤]

### 截图

- ![页面全貌](截图路径)
- ![操作后状态](截图路径)
```

---

## 6. 更新 task.json

评估完成后，更新对应任务的 `evaluated` 字段：

```python
python3 -c "
import json
with open('task.json') as f:
    data = json.load(f)
for t in data['tasks']:
    if t['id'] == <TASK_ID>:
        t['evaluated'] = True
        break
with open('task.json', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
"
```

**如果 FAIL 且问题明确可复现：** 在对应任务的 description 末尾追加评估结论（PASS 或 FAIL + 问题摘要），方便 builder 在后续轮次修复。

---

## 7. 更新进度

追加到 `progress.txt`：

```
## [YYYY-MM-DD] - 评估: [任务标题]

### 评估结论:
- PASS / FAIL

### 发现问题:
- [问题列表]

### 备注:
- [给后续 agent 的备注]
```

---

## 禁止

- 不修改代码、不 commit、不标记 passes、不删除任务
