# UI 字号统一管理方案

> 2026-08-28 定稿，同日实施完成。最终实现：新增「界面字体」滑杆（百分比 90%~130%）与「阅读字体」百分比滑杆，两套控制源划清界限，硬编码全量替换。
>
> 2026-08-28 后续扩展（用户反馈「编辑器/Shell 输出等经常阅读的动态内容应跟聊天字体一起控制」）：「聊天字体」滑杆更名**「阅读字体」**，覆盖范围由聊天消息扩展到代码编辑器、Shell 输出与运行日志、子 Agent 过程输出、脚本/提示词编辑区、便签正文；静态 UI 骨架继续归「界面字体」。详见文末「实施演进记录」第 6 条。

## 背景与问题

设置中「聊天字体」滑杆（原 `chatFontLevel` 1-6 级）只覆写 3 个 CSS 变量：`--chat-list-size` / `--text-body` / `--text-detail`，作用于会话列表与聊天区。应用 UI 骨架（文件列表、侧边栏、Tab、状态栏、输入卡片、设置页、弹窗）走另一套固定 `--text-*` 层 + 170+ 处硬编码 `text-[Npx]` / 内联 `fontSize`，完全不受字号设置控制。

**根因**：`FileTreePanel.tsx:60` 内联 `fontSize: '12px'` 为代表——UI 骨架字号与设置无任何关联。

**统计**（2026-08-28）：
- index.css 内 30 处裸 `font-size` + 26 处 `var(--text-*)`
- 37 个组件文件、170+ 处 `text-[9px] ~ text-[15px]`（硬编码值集中在 9/10/11/12/13/15px）
- 内联 `fontSize` 11 处，仅 `FileTreePanel` 1 处裸数字，其余 10 处已是语义变量

**既有缺陷**：`loadFromElectron()` 只恢复设置值不写 CSS 变量——用户改过字号后重启，CSS 变量回落到 `index.css` 默认值，直到再拖一次滑杆才生效。

## 最终目标（实施后）

- 「界面字体」滑杆（90%~130%）统一控制**全部 UI 骨架文字**
- 「阅读字体」滑杆（90%~130%，由 1-6 级迁移）控制**所有需持续阅读的动态内容**字号
- 两套控制源界限清晰：UI 骨架（含会话列表）/ 动态阅读内容，互不影响
- 硬编码字号全部替换为语义变量，消除散落硬编码
- 修复「重启后字号设置不生效」缺陷

## 分类界限（两套控制源）

| 控制源 | CSS 变量 | 覆盖范围 |
|---|---|---|
| **UI 缩放** `--ui-scale`（界面字体滑杆） | 通用档 `--text-4xs~2xl`、`--chat-list-size`（会话列表）、Font 段 `--font-size-*` | 文件列表/侧边栏/状态栏/会话列表/输入栏/设置页/弹窗/标签/按钮等全部界面文字 |
| **阅读缩放** `--chat-scale`（阅读字体滑杆） | `--text-body(14)`/`--text-detail(13)`/`--text-caption(12)`/`--text-code(11)`/`--text-meta(10)` | 动态内容：聊天消息（正文/折叠块/代码块/语言标签/工具名/折叠箭头）、代码编辑器（Monaco）、Shell 输出与运行日志、子 Agent 过程输出、脚本/提示词编辑区、便签正文 |

**划界三问**（新增内容区时判定归哪一组）：① 内容由运行时产生？② 需阅读理解语义？③ 放大有收益？三问全 YES → 阅读组（`--chat-scale`）；否则 → UI 组（`--ui-scale`）。

该边界与项目既有的「内容型区域」白名单同源——`index.css` 的 `user-select: text` 清单（`.msg-bubble-*` / `.diff-view` / `.shell-output` / `.subagent-output` / `.log-overlay-output` / `.selectable`）与 `ChatPanel.tsx` 的 `CONTENT_SELECTOR` 常量，**新增内容型区域时两边同步**。内容区内极小的结构徽章（如子 Agent 输出的「思考」「工具」角标）维持 UI 档，不随阅读字号放大。

## 方案

### 1. 缩放机制：`--ui-scale` / `--chat-scale` 双系数

`:root` 新增 `--ui-scale: 1` 与 `--chat-scale: 1`。所有字号变量改为 `calc(基准px * var(--ui-scale|--chat-scale))`。设置变化时 JS 只改对应系数一个变量，单一真源。默认 100% 时数值与改动前完全一致，视觉零变化。

**Tailwind 4 变量接管机制**（构建产物已验证）：`.text-xs` 等标准类生成 `font-size: var(--text-xs)`，`index.css` 中 `:root` 后定义 `calc(...)` 覆盖 Tailwind 默认值；任意值类 `text-[length:var(--text-11)]` 同样正确生成。因此标准 `text-xs/sm/base/2xl` 类与自定义任意值类全部纳入缩放。

### 2. 字号变量表（默认 100% = 现值）

**UI 档位**（乘 `--ui-scale`）：

| 变量 | 默认值 | 说明 / 承接的硬编码 |
|---|---|---|
| `--text-4xs` | calc(8px × s) | **新增**：极微型（环形圈内百分比等极密空间） |
| `--text-3xs` | calc(9px × s) | **新增**：微型角标（思考/工具角标、平台标签） |
| `--text-2xs` | calc(10px × s) | 承接 `text-[10px]`、`sb-label`、`inp-lbl` |
| `--text-11` | calc(11px × s) | **新增**：承接 `text-[11px]`（最大硬编码群体）、tooltip |
| `--text-xs` | calc(12px × s) | 承接 `text-[12px]`、FileTreePanel 内联 12px |
| `--text-sm` | calc(13px × s) | 承接 `text-[13px]`（Monaco 编辑器已归阅读档 `--text-detail`） |
| `--text-base` | calc(15px × s) | 正文/列表主文本 |
| `--text-lg` | calc(18px × s) | 大标题 |
| `--text-xl` / `--text-2xl` | calc(24px × s) | 大/特大标题 |
| `--chat-list-size` | calc(14px × s) | **会话列表（归 UI）** |

**阅读档位**（乘 `--chat-scale`，覆盖全部动态内容区）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `--text-body` | calc(14px × s) | markdown 正文基准（聊天消息/便签/子 Agent 输出容器） |
| `--text-detail` | calc(13px × s) | 折叠块正文/摘要/代码块/代码编辑器（Monaco）/提示词编辑区 |
| `--text-caption` | calc(12px × s) | 内容区标题栏/标签/工具名/Shell 输出与运行日志/脚本编辑区 |
| `--text-code` | calc(11px × s) | diff / 紧凑代码视图 / 输出区截断提示 |
| `--text-meta` | calc(10px × s) | 箭头/状态/图标 |

Font 段 `--font-size-xs/sm/base/lg` 同样套 `--ui-scale`（输入框等）。

### 3. 替换映射

- 组件 `text-[Npx]` → `text-[length:var(--text-XX)]`（Tailwind 任意值，保留 className 风格）
- `FileTreePanel` 内联 `fontSize: '12px'` → `fontSize: 'var(--text-xs)'`
- SVG 内 `<text fontSize="N">`（Sidebar 头像字母、ChatBubbleActions 文档图标）→ 必须改 `style={{ fontSize: 'var(...)' }}`（SVG presentation attribute 不解析 `var()`）
- `Monaco` 编辑器 `fontSize: 13` → 实测 `--text-detail` 计算像素（`readPx` helper，同为 13px 基准、默认视觉不变），并订阅 `chatFontScale` 变化 `updateOptions`（编辑器属阅读型内容，归阅读档）
- 环形圈百分比：`clamp(8px, var(--text-4xs), 10px)` 限幅防溢出（20px 圆环内三位数）

### 4. 设置 UI

`AppearanceTab` 两个 section 并列：
- **界面字体**：滑杆 `0.9 ~ 1.3`（step 0.05），显示百分比，写 `--ui-scale`
- **阅读字体**：同款滑杆（由 1-6 级改为百分比），写 `--chat-scale`；覆盖聊天消息 + 代码编辑器 + Shell 输出/运行日志 + 子 Agent 输出 + 脚本/提示词编辑区 + 便签

### 5. settings-store / 持久化

- 新增 `uiFontScale`（默认 1）、`chatFontScale`（默认 1）+ 对应 setter（写 store + 持久化 + `setProperty`）
- 公共应用函数 `applyUiScale(scale)` / `applyChatScale(scale)`，`loadFromElectron()` 后调用——**修复重启不同步缺陷**
- 旧 `chatFontLevel`(1-6) 自动迁移：`LEGACY_CHAT_FONT_SCALE` 映射（3级→1.0、4级→1.07…），首启落盘新字段；主进程 `store.ts` 保留旧字段兼容读取，新增 `chatFontScale` 读写

### 6. 涉及文件

- `app/renderer/src/index.css`（变量体系 + 全部字号语义化）
- `app/renderer/src/stores/settings-store.ts`（双系数 + 迁移）
- `app/renderer/src/components/settings/AppearanceTab.tsx`（双滑杆）
- `app/main/services/store.ts`、`app/renderer/vite-env.d.ts`（chatFontScale 持久化类型）
- 38 个含 `text-[Npx]` 的组件文件 + `FileTreePanel`/`EditorPanel`/`Sidebar`/`ChatBubbleActions`/`GlowGroupManager`

## 验证

- 默认 100% 时 UI 与改动前一致（`--ui-scale`/`--chat-scale` 默认 1）
- 拖「界面字体」：文件列表/侧边栏/状态栏/会话列表/输入卡片/设置页/弹窗全部缩放，阅读内容不动
- 拖「阅读字体」：聊天消息（正文/代码/diff/思考/工具）+ 代码编辑器 + Shell 输出/运行日志 + 子 Agent 输出 + 脚本/提示词编辑区 + 便签正文全部缩放，UI 骨架不动
- 重启应用后两项字号设置直接生效（loadFromElectron 同步应用）
- 构建产物验证：标准类 `.text-xs{font-size:var(--text-xs)}`、任意值类、`calc` 定义均正确输出；typecheck / eslint 通过

## 实施演进记录

1. 首批按原方案（聊天滑杆管会话列表+聊天）实施；用户回访「会话列表属于 UI」→ `--chat-list-size` 改乘 `--ui-scale`
2. 原聊天 1-6 级映射覆写裸 px 的方式废弃，改为静态 `calc(px * var(--chat-scale))`，JS 只写系数
3. `--text-caption/code/meta` 原挂 `--ui-scale`，随界限划分纠正为 `--chat-scale`（属消息内容辅助文字）
4. `ctx-ring-pct` 8px 原方案「不纳入缩放」，最终纳入（新增 `--text-4xs`）+ `clamp` 保护
5. Monaco 编辑器字号纳入 UI 缩放（原方案未涉及）
6. **阅读字体范围扩展**（用户后续需求「经常阅读的动态内容都跟聊天字体走」）：滑杆更名「阅读字体」；Monaco 由 `--text-sm`/`uiFontScale` 改 `--text-detail`/`chatFontScale`；`OutputWindow`（Shell 输出/运行日志）、`SubagentProcessView`（子 Agent 输出）、`ScriptEditDialog`、`PromptSettings`、`PinLayer`（便签）由 UI 档改阅读档——各档均取等值变量，默认 100% 视觉零变化。`prose` 正文规则由 `.chat-messages .prose` 扩展到 `.subagent-output .prose` / `.selectable .prose`（此前便签等非聊天区的 prose 用 `prose-sm` 固定值，不受任何缩放控制）；同步清理残留设置项 `terminalFontSize`（xterm 时代遗留，渲染进程零引用）
