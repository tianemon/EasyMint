# 聊天区 diff 语法高亮方案

> **状态：✅ 已实现（v0.6.4）**。
> 2026-08-06 定稿并实现。目标：给聊天区工具结果里的 diff（edit 的 `变更内容:`）加 token 级语法高亮，
> 对齐 cc 的 diff 渲染质感（关键词/字符串/注释/数字各有着色），零新增依赖。
> 复用 monaco-editor 现成的 Monarch tokenizer（已随 EditorPanel 进入依赖树）。

## 现状

- `ChatBlocks.tsx` 的 `DiffLine` 只做行级红绿（`+` 绿 / `-` 红 / `@@` 中性），无行内高亮
- 聊天代码块（`CodeBlock`）用 `marked.parse` 纯渲染，无高亮
- monaco-editor 已在依赖树（EditorPanel 在用），自带 84 种语言 Monarch 定义 + `colorize()`/`tokenize()` API

## 技术验证（已实测）

在 vite dev server + Playwright 实测 monaco 0.56：

1. **同步 `monaco.editor.tokenize()` 需先异步 warmup**：`TokenizationRegistry.getOrCreate` 是 async，语言未加载时返回空 token；用 `colorize("", lang)` 预热后，同步 `tokenize()` 能拿到**语义 token 类型**（`keyword.ts`/`number.ts`/`comment.ts` 等，主题无关）
2. **语言注册**：monaco 懒加载，需手动 import 对应 `register.js`（如 `definitions/typescript/register.js`）；json 在 `features/json/register.js`（注册链是异步 onLanguage，实测 tokenize 仍返回空——json 走 fallback 纯红绿）
3. **monaco 0.56 已移除内置 diff 语言**（`definitions/` 下无 diff 目录）——不需要，我们对变更行按目标语言 tokenize
4. **mtkX 是 colorMap 索引不是语义 token**：不可直接映射——所以用 `tokenize()` 的语义类型而非 `colorize()` 的 HTML

## 实现

### 文件

- **新增 `app/renderer/src/lib/diff-highlight.ts`**：语言推断 + warmup + tokenize + token→色映射（纯逻辑，独立封装）
- **`ChatBlocks.tsx`**：`DiffView`（批量 tokenize + 渲染）/ `DiffLine`（红绿行）/ `HighlightedCode`（行内 span）
- **`ChatPanel.tsx`**：构建 `toolInputs` 查找表（toolUseId → input），关闭工具调用时独立块也能取到 file_path
- **`vite-env.d.ts`**：monaco register 模块类型声明

### diff-highlight.ts

```ts
inferLang(filePath)       // 扩展名 → monaco languageId(17 种语言)
warmupLanguage(lang)      // import register 模块 + colorize 预热,幂等
tokenizeLine(code, lang)  // 单行 → [{text, color}] 或 null
tokenizeLines(codes, lang)// 批量(一次 warmup),diff 渲染用
```

- token 类型前缀映射：comment/string/number/keyword/type/function → `--color-code-*`（复用 EditorPanel 已用的语义色变量，亮暗两套自动适配）
- css 补充映射：`tag`→type、`attribute.name`→fn、`attribute.value`→string/number

### ChatBlocks.tsx 渲染

```
DiffView(变更内容文本, filePath)
  → parseDiff 分段(Pi 格式整体一段,... 行保留为内容行)
  → 批量 tokenize 全部变更行(一次 warmup,消除逐行闪烁)
  → DiffLine 渲染:+ / - 行红绿底 + HighlightedCode 行内上色;上下文行中性色
```

- **显示格式**：`+ code` / `- code`（加减号 + 空格 + 代码），无行号列
- **行号不显示**：Pi 的 `generateDiffString` 用两套计数器（old/new 各自推进），行号在删增后错位且非真实文件行号，前端无法修复——干脆去掉
- **编辑卡片**：edit/write/read 工具 input 只显示 path（edits/content 与结果重复）；标题行右侧显示 `+N · -N` 变更统计
- **工具名统一**：独立块和工具卡片都显示工具原名（edit），不叫「编辑」

### 语言推断来源

Pi 格式 diff 无 `--- a/`/`+++ b/` 头，路径从**工具 input 的 `path` 字段**取（Pi edit 参数是 `path` 不是 `file_path`，兼容两者）；`+++ b/` 解析保留为兜底。

## 已知限制

- **json 不高亮**（monaco 注册链问题，fallback 纯红绿）
- **无缓存**：edit 结果非流式一次性返回，`codesKey` 依赖已避免重复 tokenize；若后续流式 edit 卡顿，加模块级 Map（key=`lang|code`）即可

## 语义色变量

`--color-code-kw/-str/-fn/-cm/-num/-type`（index.css 亮暗两套已有）：
- keyword → `--color-code-kw`、string → `--color-code-str`、comment → `--color-code-cm`
- number → `--color-code-num`、type → `--color-code-type`、function → `--color-code-fn`
