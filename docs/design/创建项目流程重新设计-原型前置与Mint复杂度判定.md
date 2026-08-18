# 创建项目流程重新设计 — 原型前置 & Mint 复杂度判定

> **状态：✅ 已定稿（2026-08-18，用户确认 3 点）**
> **背景**：用户发现创建项目的流程被某次更新错误修改——复杂度由前端硬编码、打开新窗口后 Mint 直接初始化而非先问原型、文档时机过早。本文为重新设计定稿方案。

---

## 一、现状问题（用户观察 + 代码实证）

用户报告创建流程被错误修改，观察到的现象与代码对照：

| # | 现象 | 代码根因 |
|---|------|---------|
| 1 | 初始化等待时间久 | 非根因——翻译用 workspace 会话逻辑正确，慢的是 `handleCreate` 的 project-created 初始化 + 10s 轮询落盘 |
| 2 | 项目形式下拉最后一行超出屏幕 | `StepComponents.tsx` 的 `Select` 菜单 fixed 定位只向下展开（`top: pos.top`），弹窗底部行的下拉超出视口底部 |
| 3 | 系统消息只显示 1 条（功能推荐/项目创建完毕未显示） | 待加日志排查（见 §六） |
| 4 | Mint 复杂度判定错误 | **前端 `handleCreate` 硬编码 `sceneComplexity`（场景→复杂度映射）**，Mint 只能被动接受，无法按实际项目规模纠正 |
| 5 | 表单路径 Gate 误读 | `creation_flow` 的「两条入口行为差异」与七道 Gate 表述存在歧义，Mint 对表单路径是否走 Gate 理解不一 |

### 核心架构问题：流程决策权错位

当前「打开新窗口后做什么」由**前端硬编码 + profile.initSteps 写死**决定，而非 Mint 判断：

```
handleCreate 硬编码 sceneComplexity（场景→复杂度）
  → composeProfile → initSteps（内置"极简跳过文档/简单写需求+task/中等完整流程"）
  → buildInitTriggerPrompt 注入 init 指令
  → 打开新窗口后 Mint 按写死的复杂度直接初始化
```

结果：场景选错 → 复杂度错 → 流程错，Mint 无纠正权。这与用户期望「Mint 自己判断复杂度、在 skill 中严格规划流程」直接冲突。

---

## 二、目标流程（用户确认版）

> 用户确认的 3 个设计点：
> 1. **Mint 自己判断复杂度**，在 skill（creation-guide）中严格规划好流程
> 2. **打开新窗口后 Mint 的第一句话**：「是否根据当前的功能需求先产出UI原型？」——根据原型调整需求和预览效果，确认后再完整开发
> 3. **简单项目跳过**（原型）

### 表单路径

```
① 填表（名称/目录/描述/场景/功能/UI风格/交付）
   ↓
② 点「下一步」：翻译目录名（workspace 会话，保持现有逻辑）
   + 创建项目目录 + 创建项目专属会话
   + 发「用户点击了新建项目」系统消息
   → Mint 只回复「已确认」（不引导、不初始化）
   ↓
③ 功能共创（可点「Mint 推荐」，保持现有逻辑）
   ↓
④ 点「创建项目」：保存 profile + 发 project-created init 指令
   + 轮询落盘 → 打开新窗口
   ↓
⑤ 新窗口会话页面：Mint 第一句话 = 判断复杂度后：
   - 有 UI 且中等以上 →「是否根据当前功能需求先产出 UI 原型？」
     · 用户确认 → 出原型 → 预览 → 迭代确认（G3/G4）
     · **原型确认后**才写完整文档（需求文档+技术架构+task.json）
     · 再问是否开始开发（G6）
   - 简单/极简 / 纯后端/CLI（无 UI）→ 跳过原型
     · 直接写相应文档（或极简直接编码）→ 问是否开始开发
```

### 直接创建路径

```
点「直接创建」：创建项目 + 发 direct-create 消息
  → Mint 对话引导补全信息（现有 creation_flow 引导逻辑）
  → 后续进入与表单路径相同的「复杂度判定 → 原型前置/跳过 → 文档 → 开发」
```

---

## 三、新流程设计

### 3.1 复杂度判定下沉到 skill

**判定主体**：Mint（不再由前端硬编码）。前端只传原始采集信息，不传映射后的复杂度。

**判定标准**（写入 creation-guide skill，Mint 收到 project-created 后据此判定）：

| 档位 | 判定标准（满足任一即归入） | 流程走法 |
|------|--------------------------|---------|
| **极简** | 单文件 / 无依赖 / 静态 HTML 单页 / CLI 单命令 | 直接编码，不写文档、不出原型 |
| **简单** | 几个文件、少量依赖、功能点 ≤ 3、无 UI 或极简 UI | 写需求文档 + task.json，**跳过原型** |
| **中等及以上** | 有 UI（多页面/多路由）、多模块、有后端/数据库、功能点 > 3 | **原型前置**（有 UI 时）→ 原型确认 → 完整文档 → 开发 |

补充规则：
- **无 UI 项目**（纯后端 / CLI / API / 库）无论规模都不强制原型——「原型」专指 UI 项目
- 前端现有 `sceneComplexity` 硬编码**移除**；`composeProfile` 的 complexity 用中性默认值（仅服务技术规范 platformSpec，不注入流程指令）

### 3.2 打开新窗口后首句问原型

project-created init 指令改为引导 Mint：
1. 先按 creation-guide skill 判定复杂度
2. 有 UI 且中等以上 → **第一条消息就问**「是否根据当前功能需求先产出 UI 原型？」
3. 简单/极简/无 UI → 跳过原型，说明将采用的流程（写文档/直接编码），进入对应分支

### 3.3 文档书写时机后移

- **现在**：initSteps 里的「完整流程/跳过文档」指令在 project-created 时随 init 注入，Mint 打开窗口即按此初始化
- **改为**：profile.initSteps 中的**流程决策类指令移除**（「跳过文档/写需求+task/完整流程」不再是前端写死的 initSteps 内容），改由 Mint 在 skill 中判断；完整文档（需求文档+技术架构+task.json）在**原型确认后（G4 通过）**才写
- profile 保留的只有**技术规范类** initSteps（产品类型/部署/AI/存储的技术要求，如「Web 应用的技术架构需包含前端架构说明」）

### 3.4 与现有 Gate 体系的关系

七道 Gate（G1-G7）保留，仅调整：
- G3（原型 Gate）触发条件：从「中等以上必经」明确为「**有 UI 且中等以上必经**」；简单/极简/无 UI 跳过
- G4（用户确认原型）→ 通过后才进入文档书写（文档不再是 init 时写）

---

## 四、改动清单

| 文件 | 改动 |
|------|------|
| `resources/skills/creation-guide/SKILL.md` | **新增「复杂度判定」章节**（判定标准表 + 流程分支）；更新「打开新窗口后首句问原型」指引 |
| `resources/skills/creation-flow-prototype/SKILL.md` | 原型 Gate 触发条件改为「有 UI 且中等以上」；明确简单/无 UI 跳过 |
| `app/shared/prompts.ts` | ① `creation_flow`：两条入口行为差异澄清（表单路径收到 init 后首句问原型而非直接初始化）；复杂度判定指向 skill；② `buildInitTriggerPrompt`：改为引导「判复杂度 → 首句问原型/跳过」，不再注入写死的复杂度流程指令；③ `COMPLEXITY_OVERRIDES`：initSteps 移除流程决策类文案（或标注「由 Mint 判断」），只保留技术规范 |
| `app/renderer/src/components/NewProjectDialog.tsx` | `handleCreate`：移除 sceneComplexity 硬编码映射；composeProfile 用中性复杂度；init 指令走新版 `buildInitTriggerPrompt` |
| `app/renderer/src/components/new-project/StepComponents.tsx` | **问题 2 修复**：Select 菜单视口内自适应（底部放不下时向上展开） |
| `app/renderer/src/components/ChatPanel.tsx` | **问题 3 排查**：加日志定位系统消息只显示 1 条（见 §六） |

---

## 五、问题 2 修复方案（下拉越界）

`StepComponents.tsx` 的 `Select` 组件：菜单 fixed 定位仅向下展开（`top: pos.top = btn.bottom + 4`）。当触发按钮位于弹窗底部时，菜单高度超出视口底部，最后几项被裁剪/看不到。

**修复**：打开菜单时测量菜单高度，若 `pos.top + 菜单高 > window.innerHeight`，则改为向上展开（`top = btn.top - 菜单高 - 4`）；同时保留 `max-h` 滚动。用一个 `useLayoutEffect` 在 open 后测量一次即可。

---

## 六、问题 3 排查方案（系统消息只显示 1 条）

现象：创建流程中「功能推荐」「项目创建完毕」系统消息未显示，只显示「用户点击了新建项目」。

**待加日志验证的假设链**（按项目规范「优先加日志，不要猜」）：
1. `handleRecommendFeatures` / `handleCreate` 的 `ask` 是否真的发出并落盘？——在 `postToAgent` 与主进程 `sendCustomMessage` 加日志，确认 3 条系统消息都写入 JSONL
2. `conv.messages` 返回后 `mapSessionMessages` 是否正确映射 system_message？——在 `mapSessionMessages` 加日志，确认 customType/details 是否保留
3. ChatPanel 加载时系统消息插入/渲染是否有过滤？——检查 `SYSTEM_KIND_LABELS` 覆盖的 kind 与 `customType` 过滤条件

定位后按根因修复（预计在 mapSessionMessages 或加载渲染过滤处）。

---

## 七、待验证项

1. 表单路径全链路：填表 → 下一步 → 功能推荐 → 创建项目 → 新窗口首句问原型
2. 三种复杂度分支：极简（静态页/CLI）、简单（几个文件无 UI）、中等（有 UI 多模块）
3. 直接创建路径 → 对话引导 → 复杂度判定 → 原型前置
4. 原型确认后文档时机：确认前不写完整文档，确认后才写需求文档+技术架构+task.json
5. 下拉越界修复：弹窗底部行下拉向上展开不裁切
6. 系统消息 3 条全部显示

---

## 八、实施顺序

1. skill 层：creation-guide 复杂度判定章节 + creation-flow-prototype 触发条件（先定 Mint 侧规则）
2. prompts.ts：creation_flow 澄清 + buildInitTriggerPrompt 改版 + COMPLEXITY_OVERRIDES 精简
3. 前端：NewProjectDialog.handleCreate 去硬编码
4. 问题 2 修复（Select 视口自适应）
5. 问题 3 排查（加日志定位根因）
6. lint + build + 冒烟验证
