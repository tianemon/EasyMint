# UI 元素库设计（素材库）

> 目的：统一 UI 风格，消除「每次手写样式导致的不一致」。
> **做新的页面/组件时，先查本素材库找需要的元素 token——已有元素直接复用，禁止随意设计。**
>
> 2026-08-29 建立：先录入现有元素与设计 token，搭好框架，后续按批次补充调整（按钮/卡片/标签/弹窗待统一）。

## 使用规则（强制）

1. **新页面/组件先查素材库**：需要输入框/按钮/卡片/标签/面板标题等元素时，先在本库找对应 token/语义类——找到直接用，找不到先补（见规则 2），**禁止随手拼 Tailwind 类新造样式**
2. **缺 token 先补后建**：新元素需要新样式时，先在 `index.css` 补语义变量/语义类 + 本库登记规格，再用于组件
3. **风格统一是硬性要求**：提交前检查新 UI 与既有元素的一致性（圆角/高度/间距/悬停态/聚焦态）
4. **主题色禁止透明度语法**（`bg-accent/15` 等），走 `--color-*` 语义层（见 CLAUDE.md 2.4）

## 设计 token（变量体系）

### 色彩 `--color-*`

- **主题语义层**（accent/danger/success/warning/info）：基础色 + 分层 `soft`(~12%) / `bg`(~10%) / `subtle`(~5%) / `high`(~20%) / `border`(~20%)
- **中性层**：`--color-surface` / `surface-alt` / `surface-elevated` / `sidebar` / `content` / `input-card` / `border` / `text-primary` / `text-secondary` / `text-muted` 等
- 亮暗两套在 `:root` / `[data-theme="dark"]` 分别定义，组件只用变量名

### 字号 `--text-*`

| 组 | 变量 | 控制源 |
|---|---|---|
| UI 档 | `--text-3xs(9)` / `4xs(8)` / `2xs(10)` / `11(11)` / `xs(12)` / `sm(13)` / `base(15)` / `lg(18)` / `xl(24)` / `2xl(24)` | `--ui-scale`（界面字体滑杆） |
| 阅读档 | `--text-body(14)` / `detail(13)` / `caption(12)` / `code(11)` / `meta(10)` | `--chat-scale`（阅读字体滑杆） |

- 禁止 `text-[Npx]` / `fontSize: Npx` 裸值（详见 RULES.md 字号规范）

### 圆角

| 变量 | 值 | 用途 |
|---|---|---|
| `--radius-sm` | 6px | 小控件/标签/徽章 |
| `--radius-md` | 10px（亮）/ 14px（暗） | 默认卡片/按钮 |
| `--radius-lg` | 16px | 大容器/弹窗 |
| `--radius-full` | 9999px | 胶囊 |
| 输入框固定值 | **12px** | `.em-input` 统一圆角（独立值，未入变量表——后续并入 `--radius` 体系） |

### 间距 `--s1~s16`

`--s1: 4px / s2: 8px / s3: 12px / s4: 16px / s6: 24px / s8: 32px / s12: 48px / s16: 64px`

### 阴影 `--shadow-xs/sm/md/lg`

`xs: 0 1px 2px rgba(0,0,0,.04)` → `lg: 0 8px 28px rgba(0,0,0,.10)`（亮暗同值）

### 动效

- 默认过渡：`transition: all 120ms var(--ease-smooth)`（`--ease-smooth: cubic-bezier(0.4,0,0.2,1)`）
- 弹窗/抽屉入场：`drawer-in`（微滑淡入）/ `card-in`（淡入微缩放）keyframes

## 元素规格（现有 ✅）

### 输入框 `.em-input` ✅

- **规格**：圆角 12px、`1px solid var(--color-border)`、背景 `var(--color-surface)`、`outline: none`、**聚焦时外观完全不变**（无高亮边框/光环，见 `:focus/:focus-visible { box-shadow: none }`）
- **使用**：`className="em-input <尺寸类>"`——**padding 由组件 className 的 `px-*/py-*` 控制**（em-input 不定义 padding，避免覆盖 `pr-*` 图标留白）
- **覆盖范围**：设置页、Issue/脚本编辑弹窗、新建项目（`.input` 旧类同规格）、设备迁移等全部表单输入框
- **例外**：ChatInput 输入卡片（`.chat-input`，自有规格，不动）
- 历史输入搜索框（QuestionHistory）：同规格变体（绝对定位 input 铺满圆角容器）

### 面板标题栏 ✅（任务/运行/问题记录统一模式）

- **规格**：`flex items-center gap-2 h-9 px-3` + 标题文字 `text-[length:var(--text-11)] font-semibold tracking-[0.04em] uppercase text-text-secondary`
- **无底部横线**（2026-08-29 统一去除）；标题栏与内容区间距 = 内容区顶部 padding 3px
- 使用：三个抽屉面板（TaskPanel/RunPanel/IssuePanel）已统一，新面板沿用

### 窗口拖拽豁免 `.no-drag` ✅

- `-webkit-app-region: no-drag`——浮层/按钮位于窗口拖拽区（TabBar/侧边栏）坐标上方时使用，保证点击不被拖窗口拦截

## 元素规格（待统一 TODO）

### 按钮

- **现状**：各组件内联拼装（`rounded-lg px-3 py-1.5 text-xs bg-* hover:bg-*`），细节不一
- **目标**：`.em-btn`（主）/ `.em-btn-ghost`（次）/ `.em-btn-danger`（危险）三档，统一圆角/高度/内边距/悬停态
- 状态：待实施

### 卡片 / 标签徽章 / 弹窗容器 / 下拉触发器 / 滑杆

- 现状：内联拼装，规格不一
- 目标：`.em-card` / `.em-tag` / `.em-dialog`（容器+头+尾）/ `.em-select` / 滑杆统一
- 状态：待补充

## 演进记录

- 2026-08-29 建立：录入设计 token（色彩/字号/圆角/间距/阴影/动效）、输入框 `.em-input`、面板标题栏、`.no-drag`；按钮/卡片/标签/弹窗列为 TODO
