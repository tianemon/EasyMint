# 工作会话操作手册

> **非交互模式。** 不提问、不等反馈。任务完成则标记 passes 并提交，遇到阻塞则记录并停止。

---

## 1. 初始化环境

```bash
./init.sh
```

安装依赖并启动开发服务器。每个会话必须执行，禁止跳过。

---

## 2. 读取评估反馈

如果 `temp/evaluator/` 下有评估报告，先读最近一份。报告中有 **FAIL** 项时，**必须**优先修复那些问题，跳过本节其余步骤。修复完成后重新 lint + build，标记当前任务 passes: true，在 progress.txt 记录修复内容，然后提交。

如果没有 FAIL 项或没有报告，继续下一步。

---

## 3. 选择任务

读取 `task.json`，选择一个 `passes: false` 的任务：

- 优先选择被其他任务依赖的基础任务
- 同级优先级选 ID 最小的

---

## 4. 实现

阅读任务的 description 和 steps，实现代码。遵循 CLAUDE.md 中的编码约定。

---

## 5. 测试

**所有改动必须：** lint 无错误 + build 成功。

**后端 / API 改动：** 用 curl 测试正常和异常情况。

**前端改动：** lint + build 验证即可。视觉验证由独立 evaluator agent 在后续轮次中完成（见 EVALUATOR.md）。

自查通过后**不要**标记 passes。passes 是最后一步（见 Step 8）。

---

## 6. 更新进度

追加到 `progress.txt`：

```
## [YYYY-MM-DD] - 任务: [任务标题]

### 完成内容:
- [具体改动]

### 测试:
- [测试方法]

### 备注:
- [给后续 Agent 的备注]
```

---

## 7. 提交

1. 停止自己启动的所有后台进程（init.sh 启动的不要动）
2. 一次性提交代码和 progress.txt：

```bash
git add .
git commit -m "[任务标题] - 已完成"
```

提交规则：
- 不删除任务、不修改任务描述
- 代码 + progress.txt 必须在同一 commit
- **此时 task.json 中的 passes 仍然是 false，不要动它**

---

## 8. 标记完成（最后一步）

**这是全部流程的终点。** commit 成功后，将 `passes` 改为 `true`：

```python
python3 -c "
import json
with open('task.json') as f:
    data = json.load(f)
for t in data['tasks']:
    if t['id'] == <当前任务ID>:
        t['passes'] = True
        break
with open('task.json', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
"
```

**改完立刻停止，不要再做任何操作。** 不读文件、不检查 git、不验证状态。

---

## 阻塞处理

以下情况 **停止工作，不提交代码**：

- 缺少需要人工填写的配置（API 密钥、数据库连接等）
- 外部服务不可用或需要人工授权
- 测试所依赖的外部系统尚未部署

在 `progress.txt` 记录当前进度和阻塞原因，然后输出：

```
🚫 任务阻塞 - 需要人工介入

**当前任务**: [任务名称]
**已完成**: [已完成的代码/配置]
**阻塞原因**: [具体原因]
**需要人工**: [具体步骤]
```
