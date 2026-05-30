# 评估 Agent 操作手册

> **独立评估模式。** 不修改代码、不提交。只评估、报告、标记。

---

## 1. 选择任务

读取 `task.json`，选一个待评估的任务：
- 优先 `passes: true, evaluated: false`
- 其次 `passes: false, evaluated: false`

无待评估任务则退出。

---

## 2. 理解验收条件

读任务的 `steps`，每步对应一个验证项。

---

## 3. 启动应用

先检查 dev server 是否已在运行（端口从 `APP_SPEC.md` 或 `ARCHITECTURE.md` 获取，默认 `5173`）：

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:<实际端口>
```

- 返回 200 → 直接用
- 其他 → 执行 `./init.sh`，等端口就绪

---

## 4. 逐项验证

### 视觉项（颜色、布局、间距、对齐、溢出）

截图 + image-vision 验证。

1. `mcp__playwright__browser_navigate` 打开页面
2. `mcp__playwright__browser_take_screenshot` 截图
3. `mcp__image-vision__describe_image` 分析截图
4. 操作（click/type）
5. 操作后再次截图 + 再次 image-vision
6. `mcp__playwright__browser_console_messages` 检查 JS 报错

证据引用 image-vision 返回的具体描述，不自行看图判断。

### 逻辑项（元素存在、文字内容、状态切换）

可用 `mcp__playwright__browser_snapshot` 或 `browser_evaluate`。

### 后端/API

用 `curl` 测试端点，检查状态码、响应体、关键字段。

### PASS 标准

所有 step 满足：视觉项与预期一致，逻辑项行为正确，控制台无 JS error，lint + build 通过。

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

- [描述每个 bug，注明复现步骤]

### 截图

- ![截图](路径)
```

---

## 6. 更新 task.json

评估完成，更新 `evaluated` 字段：

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

**FAIL 时**在任务 description 末尾追加 `[评估: FAIL — 具体原因]`，将 `passes` 改回 `false`，由 builder 下一轮修复。

---

## 7. 更新进度

追加 `progress.txt`：

```
## [YYYY-MM-DD] - 评估: [任务标题]

### 结论: PASS / FAIL
### 发现问题:
- [问题列表]
### 备注:
- [给后续 agent 的备注]
```
