# Cognitive Workspace Engine — 需求规格

Version 0.1

---

## 用户目标

Builder 接任务后不再盲目 grep + Read。在动手之前，由引擎预先构建一个精准的认知工作区，告诉 Builder：当前任务关注哪些代码、它们之间什么关系、改这里会影响哪里。

核心指标：

- Builder 上下文长度下降 >50%
- 文件读取次数下降 >60%
- 影响范围分析准确率 >80%

---

## 用户工作流

```
接收任务
    ↓
Task Parser 解析意图
    ↓
CodeGraph 定位相关代码
    ↓
扩散发现关联节点
    ↓
分层构建 Workspace Graph
    ↓
Context Builder 打包上下文
    ↓
注入 Builder System Prompt
    ↓
Builder 开始编码
```

---

## 功能树

```
1. Task Parser
   ├─ 1.1 接收自然语言任务描述
   ├─ 1.2 提取 domain、intent、keywords
   └─ 1.3 判断任务复杂度

2. Graph Locator
   ├─ 2.1 根据 domain 在 CodeGraph 中定位入口节点
   └─ 2.2 调 codegraph_search 查找匹配符号

3. Graph Expander
   ├─ 3.1 从入口节点向外扩散 1 层
   ├─ 3.2 调 codegraph_callers / codegraph_callees / codegraph_impact
   └─ 3.3 调 codegraph_impact 获取影响范围

4. Workspace Builder
   ├─ 4.1 按规则将节点分配到 Primary / Secondary / Dependency / Background 四层
   └─ 4.2 生成每个 FocusGroup 的 summary

5. Context Builder
   ├─ 5.1 组装 Workspace Graph + Impact + Constraints
   └─ 5.2 输出 System Prompt 上下文文本

6. MCP Server
   ├─ 6.1 focus_build — 返回 Workspace Graph JSON
   ├─ 6.2 focus_context — 返回 System Prompt 文本
   └─ 6.3 focus_summarize — 返回节点 LLM 摘要
```

---

## 数据结构

```typescript
// ── Task Parser 输出 ──

interface TaskIntent {
  domains: string[];       // ["Organization", "Permission"]
  intent: "create" | "modify" | "fix" | "understand";
  keywords: string[];      // ["组织", "权限", "角色"]
  complexity: "simple" | "medium" | "complex";
}

// ── Workspace Graph ──

interface WorkspaceGraph {
  primary: FocusGroup[];    // P0, 60%  主工作区
  secondary: FocusGroup[];  // P1, 25%  关联工作区
  dependency: FocusGroup[]; // P2, 10%  依赖工作区
  background: FocusGroup[]; // P3, 5%   项目全局
}

interface FocusGroup {
  domain: string;
  weight: number;
  nodes: FocusNode[];
  summary: string;
}

interface FocusNode {
  id: string;           // CodeGraph node id
  name: string;         // 符号名
  kind: string;         // function / class / module / file
  filePath: string;
  summary: string;      // LLM 生成，缓存到 CodeGraph nodes.summary
  relation: string;     // "direct" | "calls" | "imports" | "depends_on"
}

// ── Context Builder 输出 ──

interface ContextPackage {
  task: string;                    // 原始任务描述
  workspace: WorkspaceGraph;       // 认知工作区
  impact: ImpactResult;            // 影响范围
  constraints: string[];           // 约束列表
  prompt: string;                  // 可直接注入 System Prompt 的文本
}
```

---

## 输入/输出定义

| 节点 | 输入 | 处理 | 输出 | 异常 |
|------|------|------|------|------|
| Task Parser | 任务描述（自然语言） | LLM 解析 | TaskIntent | 描述过于模糊→要求用户补充 |
| Graph Locator | domain 列表 + project_path | codegraph_search | 入口节点列表 | 无匹配节点→返回空，降低扩散范围 |
| Graph Expander | 入口节点 + 扩散深度 | codegraph_callers / callees / impact | 关联节点列表 | 扩散深度过大→限制 depth≤2 |
| Workspace Builder | 入口节点 + 关联节点 | 按规则分层 + LLM 生成 summary | WorkspaceGraph | LLM 摘要失败→复用 name 作为 fallback |
| Context Builder | WorkspaceGraph + Impact | 组装文本 | ContextPackage | - |
| MCP Server | tool 调用参数 | 委托上述模块 | JSON 或文本 | CodeGraph 不可用→返回错误提示 |

---

## 异常流程

| 场景 | 处理 |
|------|------|
| CodeGraph 未安装或索引为空 | 返回提示：`项目尚未建立 CodeGraph 索引，请运行 codegraph init -i` |
| 任务描述无法解析出 domain | 降级为全文搜索模式，返回相关文件列表 |
| 扩散后节点数 >50 | 按 relevance 排序，取前 50 |
| LLM 摘要超时 | 跳过摘要，用节点 name 作为 fallback |
| 同一个任务重复调用 | 检查缓存，命中则直接返回 |

---

## 分层分配规则

| 条件 | 分配到 |
|------|--------|
| 节点名或路径命中 keywords / domain | Primary |
| 与 Primary 节点有 imports / calls 关系的 1 层邻居 | Secondary |
| 与 Secondary 有 depends_on / calls 关系，或被 impact 波及 | Dependency |
| 项目根模块、主入口、架构摘要 | Background |

---

## 验收标准

### V0.1

- [ ] Task Parser 能从任务描述中正确提取 domain 和 keywords
- [ ] 对于 CodeGraph 已索引的项目，能定位到入口节点
- [ ] 能生成 Primary Focus（secondary/dependency/background 为空）
- [ ] Context Builder 能输出可注入 System Prompt 的文本
- [ ] 作为 MCP Server 运行，focus_build 和 focus_context 可调
- [ ] 对于 10-20 文件的项目，Builder 上下文长度下降 >30%

### V0.2

- [ ] 支持 Secondary + Dependency 生成
- [ ] 支持节点摘要缓存到 CodeGraph
- [ ] 对于 30-50 文件的项目，文件读取次数下降 >50%

### V0.3

- [ ] 支持 Parallel Workspace（多 Agent 每人一个 Workspace）
- [ ] 支持 Supervisor 汇总

---

## 不做的

- 不自己实现 AST 索引（用 CodeGraph）
- 不自己建 SQLite 图谱（用 CodeGraph）
- V0.1 不做 Memory Engine
- V0.1 不做 Decision Graph
- V0.1 不做多 Agent
