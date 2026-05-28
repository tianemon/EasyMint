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

读取任务的 `description` 和 `steps`，从中提取验收条件清单。每个 step 至少对应一个验证项。

**验收条件必须具体可验证。** 以 step 中的数值/颜色/行为为准：

```
step: "消息气泡 user 右对齐 accent #16a34a 背景 + 白色文字"
  → 验证: user 气泡 align-self = flex-end, background-color = #16a34a, color = white

step: "grid-template-columns 精确为 44px 220px 4px 1fr 4px 280px"
  → 验证: browser_evaluate 读取 computed grid-template-columns, 对比每个值误差 < 2px

step: "pulse 动画 1.5s ease-in-out infinite"
  → 验证: browser_evaluate 读取 animation-duration = 1.5s, iteration-count = infinite
```

**step 写法本身规范：**
- 视觉 step 必须含数值（颜色 hex、像素、百分比）
- "显示正确"、"布局正常" 这类描述不可验收，必须拒绝并标记 step 不合格
- 如果 step 本身不含可验证数据，验收条件列为 ⚠️ "不可验收 — step 缺少具体规格"

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

**每个验收条件都必须验证。** 根据条件类型选择验证方式。

### 视觉验收（颜色、布局、间距、对齐、溢出、主题外观）

**涉及以下任何一项，必须走截图+识图流程，禁止用 browser_snapshot / browser_evaluate 替代：**
- 颜色是否正确（如 mint 绿强调色、暗色/亮色主题背景）
- 布局是否正确（如三栏排列、上下分割、卡片网格）
- 间距/对齐是否合理
- 组件是否有溢出、重叠、截断
- 亮色主题下颜色是否正常

**强制流程：**

1. `mcp__playwright__browser_navigate` 打开页面
2. `mcp__playwright__browser_take_screenshot` → 保存截图
3. **`mcp__image-vision__describe_image` 分析截图内容**（此步不可跳过）
4. `mcp__playwright__browser_click` / `browser_type` 执行操作
5. **操作后再次截图 + 再次调 image-vision**，对比验证状态变化
6. `mcp__playwright__browser_console_messages` 检查 JS 报错

**验收报告中的「证据」列必须引用 image-vision 的返回内容，包含具体数值。** 

正确写法：
```
✅ image-vision 返回: "background color is #f5faf7 (light mint green), 
   sidebar width measures 44px, button is 32x32px with border-radius 7px"
```

错误写法（不可接受）：
```
✅ 截图显示颜色正确，布局正常
❌ 组件存在且渲染正确
```

**PASS 标准：每一步必须满足对应类型的所有条件。**

| 类型 | PASS 条件 |
|------|----------|
| 视觉项 | image-vision 描述中的颜色/尺寸/间距与 step 中数值一致（色差 ∆E < 10，尺寸误差 < 3px） |
| 逻辑项 | browser_snapshot 或 evaluate 确认元素存在、文字匹配、行为触发 |
| 控制台 | 无 JS error（favicon.ico 404 除外） |
| 编译 | lint 无错误 + build 成功 |

**全部通过才算 PASS，任何一项 FAIL 则整体 FAIL。**

### 逻辑验收（元素存在、文字内容、状态切换）

仅当不涉及视觉属性时，可用以下方式替代：

- `mcp__playwright__browser_snapshot` 读无障碍树，确认元素存在和文字
- `mcp__playwright__browser_evaluate` 执行 JS 检查 DOM 状态

### 后端/API 验证

用 `curl` 测试端点，检查状态码、响应体结构、关键字段。

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

## 6. 评估结论与修复

### PASS — 全通过

1. 将任务 `evaluated` 改为 `true`
2. 追加 `progress.txt`

### FAIL — 有问题，当场修复

**不要等下一轮 builder。** 评估过程中发现的问题，直接在同一个 session 里修掉：

1. 定位问题根因（读源码、读 CSS、读 DOM）
2. 修改代码
3. lint + build 验证修复
4. **重新截图 + 重新识图**，确认该验收项 PASS
5. 全部修复后，将任务 `evaluated` 改为 `true`，`passes` 改为 `true`
6. 追加 `progress.txt`（注明"评估时发现并修复 N 个问题"）

### 严重问题 — 无法当场修复

只在以下情况才标记 FAIL 并留给 builder：

- 需要大规模重构（> 3 个文件联动）
- 涉及 IPC/main process 改动（evaluator 只测 renderer）
- 根因不明需要深入排查

此时：

1. 在任务 description 末尾追加 `[评估: FAIL — 具体原因]`
2. `passes` 改回 `false`，`evaluated` 保持 `false`
3. 追加 `progress.txt`（注明"需 builder 修复"）

### 状态流转

| 阶段 | passes | evaluated |
|------|--------|-----------|
| 未开始 | false | false |
| 开发完成，待评估 | true | false |
| 评估 PASS（或自修后 PASS） | true | true |
| 评估 FAIL，无法当场修 | true → false | false（重置） |

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

- 不 commit（修改代码只在本地，由 harness 统一提交）
- 不删除任务、不修改任务描述（FAIL 时在末尾追加，不覆盖原文）
- 严重问题不强行修复（>3 文件或涉及 main 进程 → 标记 FAIL 留给 builder）
