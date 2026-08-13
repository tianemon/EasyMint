# 创建项目工作流——EM 设计框架（v2 定稿）

> **状态**：定稿 2026-08-13。整合三个来源：
> 1. EM 自有设计资产（`docs/design/创建项目对话引导设计.md` 定稿 + `<creation_flow>` 现行实现）
> 2. 6 个开源项目方法论（`temp/drafts/创建项目工作流-6开源项目参考库.md`）
> 3. 本会话决策：**skill vs 内嵌**（混合）、**留/借/写**、**触发机制**（事件驱动）、**skill 内部架构**（两级拆分）
>
> **关系**：`创建项目对话引导设计.md` 保留为历史定稿（v0.7.4 方向），本文件是其升级版。`创建项目界面重构设计.md` 的 UI 部分不变，本文件专注引导流程。
>
> **v2 变更**：把"三层架构"明确为**两个独立设计维度**——架构 A（EM 怎么调 skill，触发机制）+ 架构 B（工作流 skill 内部怎么组织，参考开源标准化）。

---

## 〇、两个设计维度（本文件主线）

| 维度 | 问题 | 决策 |
|------|------|------|
| **架构 A**：EM 系统提示词 + skills | EM 如何调用创建项目的 skill、何时调用 | **事件驱动**（创建完就触发），关键词 description 匹配仅兜底 |
| **架构 B**：工作流 skill 内部架构 | 参考开源标准化结构，场景/流程怎么组织 | **两级拆分**：1 编排主 skill + 5 流程子 skill，场景差异作为判定数据内嵌 |

---

# 架构 A：EM 系统提示词 + skills（触发机制）

## A1. 触发决策：事件驱动为主，关键词兜底

创建项目引导是**必经路径**，且创建项目是有明确 UI 入口的事件（用户点按钮），不是模糊意图——所以**事件驱动**，不靠 Mint 猜。

| 触发方式 | 触发源 | 可靠性 | 用途 |
|---------|--------|--------|------|
| **事件驱动（主）** | UI 点「新建项目/直接创建」→ 系统消息 → Mint 开回合 | 100%（事件到达必触发） | 创建引导主流程 |
| **关键词匹配（兜底）** | 用户输入内容匹配 skill description（`buildSkillsPrompt` "When description matches, Read SKILL.md"） | 靠模型自觉 | 创建后的自然需求（"加个功能"→ ui-sync 等） |

## A2. 事件驱动链路

```
用户点「新建项目」/「直接创建」
  → 系统消息(project-created / direct-create) 触发 Mint 开回合   [层 3]
  → <creation_flow> 总纲指示："创建引导时先 Read creation-guide skill"  [层 1 强指令]
  → Mint Read creation-guide（编排 skill）→ 按场景/流程调子 skill → 开始引导  [层 2]
```

**关键机制——双层保险**：
- **强指令**：总纲内嵌"先 Read creation-guide skill"——系统提示词模型侧可见（用户看不到系统提示词），不靠 description 碰运气
- **骨架兜底**：即使 skill 没被 Read，总纲里的 7 Gate / 分工 / 两入口骨架仍在，流程不崩

## A3. 层 1：系统提示词总纲（creation_flow 精简版）

> **位置**：`app/shared/prompts.ts` 现有 `<creation_flow>`（83-132 行，50 行）替换为下述精简版。
> **原则**：只留"每次都要用、丢了就崩"的骨架；具体话术/映射表下沉 skill。

```text
<creation_flow>

创建项目（用户点「新建项目」后）遵循**对话引导**而非表单采集。表单假设用户知道要什么，
但多数人只有模糊想法；人最擅长修改现成的东西。引导要**智能严谨、能繁能简**。

**进入引导时**：先 Read creation-guide skill 获取采集清单细节（五步话术/场景判定表/
成本映射/原型分级），按其引导用户。下面只列骨架，细节以 skill 为准。

**表单与对话的分工**：
- 表单采集结构化信息（平台/部署/AI 集成/完成度/预算）——用户点选即可
- 你（Mint）在对话中采集开放信息（功能细节/UI 风格/原型/技术取舍）——边聊边定
- 表单已采集的结构化信息随消息传给你，不要重复问，除非用户要改；你只补缺的开放信息

**双因子规则**（同时跟踪，不显式询问）：
- 因子一「项目场景」决定流程深度：商业交付/实际使用/兴趣创作/想法验证/学习实践/技术实验
- 因子二「用户认知」决定表达颗粒度：从措辞感知，不询问"你懂不懂技术"
- 规则：**场景定流程，认知定表达**。认知 ≠ 项目深度（大牛也能做验证原型，新手也能要商用产品）

**五步旅程**（阶段切换时用文字展示流程地图，标出当前步）：
① 意图采集 → ② 功能共创 → ③ 设备+成本 → ④ 快速原型 → ⑤ 实现
细节（每步话术/动作）见 creation-guide skill 及各流程子 skill。

**两条入口的行为差异**：
- 表单路径：收到表单采集的结构化信息后，只回复"已确认"，不重复引导，走项目初始化
- 直接创建路径：按五步旅程主动引导补全信息；开场先说明流程地图，再问第一个问题，
  并告知"想跳过引导可直接自由描述，我会自己理解推进"

**七道 Gate 硬约束**（未通过不得进入下一步；HARD-GATE——批准门槛不因流程轻而消失）：
G1 需求意图 → G2 范围（过大先切 MVP）→ G3 原型（中等以上必经）→ G4 用户确认原型
→ G5 技术方案（能力/实时检索/成本三重验证）→ G6 正式开发（原型+产品定义进开发上下文）
→ G7 最终验证（成品对照已确认原型验证，仅验代码不算完）
</creation_flow>
```

**对比现状**：50 行 → ~20 行。下沉的部分 = 场景差异化要点、成本映射表、原型分级明细、白话风格选项、取舍三选话术——全部移入 skill。

## A4. 层 3：系统消息设计

> **原则**（用户定）：消息只传**动态信息**，固定流程内置到系统提示词/skill；不暴露内置专用名称给用户可见。

### buildProjectCreatedPrompt（表单路径，保持现行为）
```text
[系统消息] 用户点击了新建项目。请了解以下需求信息：
<已采集结构化快照>
```
- 行为（"回复已确认"）已内置 creation_flow 两入口差异，不重复塞进消息

### buildDirectCreatePrompt（直接创建路径）
```text
[系统消息] 用户点击了「直接创建」项目，跳过表单。请按内置流程引导用户。

项目名：<name>
已采集的结构化信息：<快照 或 "无（用户未填写表单，全部信息需在对话中收集）">
```
- "请按内置流程引导" → 触发层 1 总纲 → 总纲指令 Read creation-guide skill
- 不写 "Read creation-guide skill" 字样（系统消息 display:true 用户可见）

---

# 架构 B：工作流 skill 内部架构（两级拆分）

## B1. 参考开源标准化结构（核验 4 家）

| 项目 | 组织方式 | 编排 |
|------|---------|------|
| mattpocock | `skills/engineering/` 分类 + 每 skill 一目录（grill-with-docs/to-spec/to-tickets）+ README 导航 | `ask-matt`（流程总览） |
| superpowers | `skills/` 平铺独立 skill（brainstorming/writing-plans/executing-plans） | `using-superpowers`（bootstrap） |
| BMAD | `src/bmm-skills/{ship,plan}/` 两级命名空间 + `bmad-` 前缀 | `bmad-build`（入口编排）+ `module.yaml`/`module-help.csv`（依赖元数据） |
| gstack | 顶层每角色一目录（office-hours/plan-ceo-review…） | SKILL.md 内部决策树 |

**共性规律**：一个编排主 skill + 多个按阶段/场景拆分的子 skill，按需加载，不搞全组合。BMAD 最标准：`bmad-build` 识别场景路由 → 按阶段调 `bmad-prd`/`bmad-ux`/`bmad-spec`。

## B2. 目录结构（两级拆分，用户确认）

```
resources/skills/
├── creation-guide/                   ← 一级：编排主 skill（事件触发入口）
│   ├── SKILL.md                        识别场景 + 流程地图 + 按需调流程子 skill
│   ├── scenarios.md                   【数据】6 场景判定表（被 SKILL.md Read）
│   └── cost-map.md                    【数据】功能→成本映射表
├── creation-flow-intent/             ← 二级：流程子 skill ① 意图采集
├── creation-flow-features/           ← 二级：流程子 skill ② 功能共创
├── creation-flow-cost/               ← 二级：流程子 skill ③ 设备+成本
├── creation-flow-prototype/          ← 二级：流程子 skill ④ 快速原型
└── creation-flow-techspec/           ← 二级：流程子 skill ⑤ 技术方案+落盘
```

**为什么场景不单独建 6 个 skill**：6 场景 × 5 流程 = 30 组合，全建会碎片化。参考 BMAD——场景作为**判定数据**（scenarios.md）内嵌，触发时路由到对应流程深度。流程 skill 可复用，场景差异只改数据。

**为什么拆数据文件**：场景判定表（scenarios.md）和成本映射（cost-map.md）被编排 skill Read 时按需加载；流程子 skill 不重复携带全局数据，各自专注自己环节的话术与动作——对应 BMAD 的 module-help.csv 元数据分离思路。

## B3. 各 skill 职责边界

### 一级：creation-guide（编排）

```markdown
---
name: creation-guide
description: >-
  创建项目引导（新建项目/直接创建时使用）。收到创建类系统消息时 Read 本 skill，
  按清单引导：识别场景 → 展示流程地图 → 按阶段调用 creation-flow-* 子 skill。
---

# 创建项目引导编排

你（Mint）收到创建项目系统消息后，按本清单引导。总原则：智能严谨、能繁能简。

## 触发说明
本 skill 是创建引导的入口。系统提示词 <creation_flow> 已给骨架（分工/双因子/7 Gate），
本 skill 补细节：场景识别 + 阶段路由。各阶段详细话术在其对应子 skill。

## 一、进入引导
- 先用一两句话说明流程地图（想法→产品定义→原型→技术方案→开发→验证→完成，标当前步）
- 告知用户"想跳过引导可直接自由描述，我会自己理解推进"
- 表单路径：收到结构化信息后只回复"已确认"，走项目初始化，不进本引导
- 直接创建路径：进入本引导

## 二、识别场景（Read scenarios.md 判定表）
- 从对话信号匹配场景：商业交付/实际使用/兴趣创作/想法验证/学习实践/技术实验
- 场景定流程深度、自动化档位；用户认知定表达颗粒度（从措辞感知）
- 认知 ≠ 项目深度：大牛也能做验证原型，新手也能要商用产品

## 三、按阶段路由（按需 Read 对应子 skill，不一次全读）
- ① 意图采集 → creation-flow-intent
- ② 功能共创 → creation-flow-features
- ③ 设备+成本 → creation-flow-cost（含 cost-map.md 成本映射）
- ④ 快速原型 → creation-flow-prototype
- ⑤ 技术方案+落盘 → creation-flow-techspec
- 每阶段结束过对应 Gate（G1~G6），未过不进入下一步

## 四、七道 Gate 复核
G1 需求意图 → G2 范围（过大切 MVP）→ G3 原型（中等以上必经）→ G4 用户确认原型
→ G5 技术方案（三重验证）→ G6 正式开发 → G7 对照原型验证（G7 在开发后，不在本 skill）
```

### 二级：五个流程子 skill（骨架）

**creation-flow-intent（① 意图采集）**——借 mattpocock 前沿轮次
```markdown
---
name: creation-flow-intent
description: 创建项目引导·意图采集。用户刚创建项目、还不知道想做什么时使用。
---
- 开场一句白话："想做个什么？随便说，一句话也行"
- 用户说想法 → 先形成理解草案呈现让用户改（人最擅长编辑，不擅长创作）
- 没想法 → 灵感清单（产品方向而非技术选项）：记账/二手交易/兴趣社区/学习打卡/宠物助手…
- 前沿轮次制：每轮只问前提已定的问题，每题附推荐选项，事实自查（web_fetch/describe_image），
  前沿清空 = 完工判据（不是"问了 N 个问题"）
- 识别场景（Read creation-guide/scenarios.md）→ 展示流程地图
```

**creation-flow-features（② 功能共创）**——借 spec-kit 用户故事切片
```markdown
---
name: creation-flow-features
description: 创建项目引导·功能共创。需求意图已明确、需要细化功能范围时使用。
---
- 用户能补充细节就聊，不能就代填草案让用户挑
- 想法过大 → 切 MVP：完整愿景 → 核心价值 → 最小可验证功能 → MVP
- 需求清单按用户故事 P1/P2/P3 排序（= MVP 切片，借 spec-kit）
- 呈现确认 → 写 docs/需求文档.md（含"未被采纳的方案"，借 gstack Supersedes 溯源）
```

**creation-flow-cost（③ 设备+成本）**——EM 成本智能引导 + spec-kit 选项表
```markdown
---
name: creation-flow-cost
description: 创建项目引导·成本决策。功能清单明确、需要推导成本做取舍时使用。
---
- 主动推导功能→成本（Read creation-guide/cost-map.md 映射表），指出必然产生的成本
- 发现矛盾组合（如"AI 对话 + 倾向免费"）主动指出，给取舍选项表（A/B/C + 每项影响一句话）
- 禁止无脑抛"免费/付费"空洞选择；商业场景附成本核算+合规+维护提示
- 用户确认的是"取舍"，不是技术选择
```

**creation-flow-prototype（④ 快速原型）**——借 anthropic 视觉四件套，载体 HTML
```markdown
---
name: creation-flow-prototype
description: 创建项目引导·快速原型。中等以上项目、需求确认后需要出原型时使用。
---
- 中等及以上项目必经原型（G3）；按场景分级：商业高保真完整/实际核心页+流程/
  兴趣强调视觉/验证核心路径/学习可选/技术实验可跳过
- Mint-D 出 HTML 原型 → show_prototype 打开 → 用户在原型上敲定（G4 确认后才进技术方案）
- 白话风格选项：现代简约/活力彩色/商务专业/科技感 + 品牌库参考图，不问设计术语
- 写码前定视觉四件套（借 anthropic，载体是 HTML 原型）：
  色板 / 字体角色 / 布局线框 / 签名元素（大胆只花一处，其余克制，抵消 AI 生成感）
```

**creation-flow-techspec（⑤ 技术方案+落盘）**——EM 技术引导 + 落盘
```markdown
---
name: creation-flow-techspec
description: 创建项目引导·技术方案。原型已确认、需要定技术方案并落盘时使用。
---
- 技术方案：实时检索热门方案 + 验证能力边界 + 成本确认，Mint 代选 + 人话理由
- 2-3 候选方案可对比，但必须给明确推荐；用户确认的是"方案符合目标和预算"
- 确认后落 task.json（首任务 = 按已确认原型实现 UI）→ show_confirm_dev
- 之后走 Builder/Evaluator 循环（EM 调度，不用固定流水线限死）
```

## B4. 与既有 skill 的分工

| skill | 职责 | 与创建引导的关系 |
|-------|------|-----------------|
| creation-guide + creation-flow-*（新增） | 创建期：从模糊想法引导到完整需求+原型+方案 | 本框架主体 |
| requirement-breakdown（既有） | 开发期：把已有需求拆成可验证清单 | 创建完成、进开发后用，不重叠 |
| ui-sync（既有） | 新需求 UI 状态同步 | 创建后自然提需求时按 description 触发 |
| easymint-guide（既有） | 产品使用手册 | 用户问"怎么用"时，与创建引导互补 |

---

# 借鉴映射表（EM 环节 ← 开源项目）

| EM 环节 | 借自 | 怎么借 |
|---------|------|--------|
| 采集问答方式 | mattpocock 前沿轮次 | "一次一问"升级为"一轮问前沿"：每轮只问前提已定问题、附推荐选项、事实自查、前沿清空=完工 |
| 双因子操作化 | BMAD stakes 校准 | 场景识别后用判定表（scenarios.md）：信号→场景→流程深度→自动化档位 |
| 确认 Gate 强化 | superpowers HARD-GATE | 批准门槛不因流程轻而消失；7 Gate 是原则不是流程 |
| 成本取舍 | spec-kit 选项表 | 取舍三选升级为选项表（A/B/C+影响），用户拍板不猜 |
| 需求→规格 | spec-kit What/Why 分层 + 用户故事切片 | 采集期只问做什么/为什么，How 留给 techspec；需求按 P1/P2/P3 = MVP 切片 |
| 原型视觉资产 | anthropic token 四件套 | 写码前定视觉四件套，载体换成 HTML 原型（EM show_prototype），非 ASCII |
| 需求审视 | gstack 多角色 + 证据门槛 | 需求确认前快速过 2-3 角色视角，每条需用户确认；反谄媚（interest is not demand） |
| 细节落盘 | spec-kit/superpowers 规格化 | 需求清单落 docs/需求文档.md（含未被采纳方案），防实现漂移 |

**不留的**：superpowers 的 subagent 执行（EM 有 Builder/Evaluator）、spec-kit 的 slash command（EM 靠消息）、gstack 的跨模型评审（成本高）、mattpocock 的 ADR 强制（EM 场景太重）。

---

# 落地清单

| # | 改动 | 文件 | 优先级 |
|---|------|------|--------|
| 1 | `<creation_flow>` 精简为层 1 版本（~20 行） | `app/shared/prompts.ts` | 高 |
| 2 | 新建 creation-guide（编排）+ 5 个 creation-flow-* 子 skill + 2 数据文件 | `resources/skills/` | 高 |
| 3 | EM_SKILLS 注册 6 个新 skill | `app/main/services/skill-service.ts` | 高 |
| 4 | 系统消息保持现状（层 3 已满足，无需改） | — | — |
| 5 | 验证：新会话实测两条入口 + 3 个代表场景（商业/验证/学习） | — | 高 |
| 6 | 文档同步：CHANGELOG [Unreleased]、开发记录 | — | 低 |

**验证方式**：新建项目 → 观察 Mint 是否 Read creation-guide → 按场景路由到对应流程子 skill → 五步引导 + Gate 通过；直接创建路径确认开场引导 + 可跳过提示。

---

# 已定决策（2026-08-13 确认）

1. **creation-guide 与 requirement-breakdown 分工**：不重叠——requirement-breakdown 是"把已有需求拆可验证清单"（开发期），creation-guide 是"从模糊想法引导到完整需求"（创建期）。两者独立，B4 表已明确分工。
2. **skill 注册位置**：**builtin**（EM 专属核心流程，用户不可见）。6 个新 skill 全部加入 `EM_SKILLS`。
3. **数据文件加载方式**：**按需 Read**。scenarios.md / cost-map.md 由 creation-guide 的 SKILL.md 指示 Read，不内嵌正文；验证时观察 Read 是否稳定。
4. **Mint-D 与视觉四件套配合**（已查证 `DESIGNER_AGENT_PROMPT`，prompts.ts:647）：
   - 色板 → 品牌库（74 品牌 DESIGN.md，colors.primary→--accent 等 token 映射）✅ 已有
   - 字体角色 → `:root` typography.display-*/body-* 变量 ✅ 已有
   - 布局线框 → 4 个种子模板（landing/dashboard/form/detail）✅ 已有
   - 签名元素（signature，借 anthropic"大胆只花一处抵消 AI 生成感"）→ ❌ 缺失，**需补**：
     - `DESIGNER_AGENT_PROMPT` 加一条："产出一个签名元素——大胆只花一处，其余克制，抵消 AI 生成感"
     - `creation-flow-prototype` 调 Mint-D 时同步要求"有签名元素、非模板化"
