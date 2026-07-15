# EM HTML Editor — 详细设计文档

**日期**: 2026-07-14
**状态**: 设计阶段
**参考项目**: ClickDeck（样式编辑/撤销重做）、html-deck-editor（画布式编辑/拖动 resize）

---

## 1. 概述

EM HTML Editor 是一个独立部署的 WYSIWYG HTML 页面编辑器，用于产品原型设计。用户可以：
- 加载任意 HTML 页面
- 在画布上选中、拖动、resize 元素
- 修改样式（字号、颜色、字体、间距等）
- 撤销/重做所有操作
- 导出完整的自包含 HTML 文件

编辑完成后，作为独立窗口集成进 EM。

### 核心设计原则

- **全量画布转换**：输入 HTML 的所有顶层可见元素转为绝对定位，形成独立于 CSS 文档流的画布
- **Patch 式历史**：借鉴 ClickDeck，每个操作只记录属性变化，不保存整页快照
- **始终可见的面板**：借鉴两者，面板不随选中状态显隐
- **纯前端**：单 HTML + 单 runtime JS，不依赖任何框架或构建工具

---

## 2. 文件结构

```
resources/em-html-editor/
├── index.html          # 编辑器外壳：工具栏 + iframe 预览 + 加载逻辑
├── runtime.js          # 注入 iframe 的编辑运行时（核心）
├── test-page.html      # 测试用页面
└── examples/           # 示例 HTML 页面
    ├── landing.html
    └── dashboard.html
```

### 文件职责

**index.html（编辑器外壳 ~200 行）**
- 顶部工具栏：撤销/重做、添加元素、导出
- iframe 预览区
- 文件拖入/选择
- 加载 runtime.js 并注入 iframe

**runtime.js（编辑运行时 ~800-1000 行）**
- 注入到 iframe 中运行
- 所有编辑逻辑：转换、选中、拖动、样式、历史、导出

---

## 3. runtime.js 模块划分

```
runtime.js
├── 1. 常量（颜色预设、字体列表）
├── 2. DOM 工具（isEditorUI、isSelectable、getElementLocator）
├── 3. HTML 转换引擎（convertToCanvas）
├── 4. 选中系统（hover 高亮、click 选中、resolver、outline）
├── 5. 选中框（拖动把手、resize 手柄、删除按钮）
├── 6. 样式操作（30+ 原子操作，每个返回 {prop, before, apply}）
├── 7. 历史系统（undoStack/redoStack，patch 式）
├── 8. 面板 UI（常驻底部，上下文感知按钮组）
├── 9. 形状/媒体添加（文字框、图片、形状）
├── 10. 导出引擎
└── 11. 主类 EMEditor（start/stop/undo/redo/export/load）
```

每个模块是独立函数或对象，通过主类协调。不建类继承，不搞 DI，保持 direct-style。

---

## 4. HTML 转换引擎（convertToCanvas）

### 输入
任意 HTML 页面的 `<body>` 内容。

### 处理流程

```
1. 深克隆 body 内容
2. 遍历所有直接子元素（顶层元素）
3. 为每个元素调用 getBoundingClientRect() 获取当前视口坐标
4. 将坐标转为相对于 body 左上角的文档坐标（考虑 scrollX/scrollY）
5. 设置 position: absolute; left: Xpx; top: Ypx; width: Wpx; height: Hpx
6. 如果元素当前是 position: static/relative:
   - 保留原始 margin 作为偏移
   - 保留原始 padding
7. 将转换后的元素放入 .em-canvas 容器
8. 设置 .em-canvas 为 position: relative + 固定宽高（= body 原始内容区大小）
9. 替换 body 内容为 .em-canvas
```

### 特殊处理

| 场景 | 处理方式 |
|------|------|
| `position: fixed` 元素 | 保持 fixed，不转换坐标（本来就是相对视口） |
| `position: sticky` 元素 | 转为 absolute，坐标取当前粘连位置 |
| `<img>` 无尺寸 | 取 naturalWidth/naturalHeight，无则设 300×200 默认 |
| `<a>` 链接 | 保留 href 属性，编辑时拦截 click |
| `<form>` / `<input>` | 保留原始元素，编辑时 disabled（防误触） |
| 空文本节点 / 仅空白 | 跳过，不创建独立元素 |

### 输出
一个 `.em-canvas` 容器，内含所有顶层元素的 absolute 定位版本。

---

## 5. 选中系统

### 5.1 Hover 高亮

```
mousemove → (非编辑UI) → resolveTarget(e.target) → 虚线框跟随
```

- 虚线样式：`border: 1px dashed rgba(22,163,74,0.40)`，圆角 2px
- 位置：`position: fixed`，每帧通过 rAF 更新 `left/top/width/height`
- 遇到 editor UI 元素时隐藏

### 5.2 Click 选中

```
mousedown (捕获) → (非编辑UI) → resolveTarget(e.target) → selectElement(target)
```

- `resolveTarget`：如果 e.target 是编辑 UI 则返回 null；如果是大容器（>40% 画布面积）且不可 selectable → 钻入第一个可选中子元素；否则直接返回
- 选中后：显示绿色实线选中框 + resize 手柄 + 拖动把手 + 删除按钮
- 同一个元素再次点击：不做任何事（不取消、不 double-select）
- 点击其他元素：切换选中
- 点击画布空白处 / 背景：取消选中

### 5.3 选中框（EditorFrame）

```
┌─────────────┬──┐
│   拖动      │× │  ← 删除按钮
├─────────────┴──┤
│                │
│    被选中元素      │
│                │
│           ┌──┐│
│           │  ││  ← resize 手柄（右下角）
│           └──┘│
└────────────────┘
```

- 选中框：`position: fixed; border: 2px solid #16a34a; box-shadow: 0 0 0 1px rgba(255,255,255,0.85), 0 0 0 3px rgba(22,163,74,0.35)`
- 拖动把手：选中框顶部条，`cursor: grab`，拖时变 `grabbing`
- Resize 手柄：四角 8×8 方块，`cursor: nwse-resize` 等
- 删除按钮：选中框右上角 × 按钮
- 所有子元素：`pointer-events: auto`（覆盖 outline 的 `pointer-events: none`）

### 5.4 选中框同步

```
rAF 循环（每帧）
+ scroll 事件（window true）
+ resize 事件（window true）
+ MutationObserver（仅监控 style/class 变化）
→ updateOutline(selectedElement)
```

---

## 6. 编辑操作

### 6.1 拖动移位（Move）

```
mousedown on .frame-move → 
  mousemove: 计算 deltaX/deltaY → 更新 left/top → 
  mouseup: 释放，记录 MovePatch
```

- 按住时 element.style 实时更新
- mouseup 后记录到历史
- 拖到画布外自动吸附回边界内
- 按住 Ctrl 时以 10px 为步长对齐

### 6.2 Resize（Resize）

```
mousedown on .frame-resize-handle → 
  mousemove: 根据手柄方向计算新 width/height/left/top → 
  mouseup: 释放，记录 ResizePatch
```

- 四角手柄可同时改宽高+坐标
- 四边手柄只改对应方向
- 最小尺寸 10×10px
- 按住 Shift 保持原始宽高比

### 6.3 样式操作

借鉴 ClickDeck 的原子操作模式，每个操作返回 `{prop, before, apply}`：

| 操作 | 属性 | 步长 | 范围 |
|------|------|------|------|
| 字号+ / 字号- | fontSize | ±2px | [8, 220] |
| 字重+ / 字重- | fontWeight | ±100 | [100, 900] |
| 粗体切换 | fontWeight | toggle 400/700 | — |
| 斜体切换 | fontStyle | toggle normal/italic | — |
| 左/中/右对齐 | textAlign | set left/center/right | — |
| 行高+ / 行高- | lineHeight | ±0.1 | [1.0, 3.0] |
| 字间距+ / 字间距- | letterSpacing | ±0.02em | [-0.1, 0.3] |
| 边距+ / 边距- | margin(marginTop) | ±4px | [0, 96] |
| 内边距+ / 内边距- | padding(paddingTop) | ±4px | [0, 96] |
| 圆角+ / 圆角- | borderRadius | ±2px | [0, 48] |
| 透明度+ / 透明度- | opacity | ±0.1 | [0, 1] |

**颜色系统**：
- 30 色文字色盘 + 自定义取色器 + 吸管取色
- 27 色背景色盘 + 自定义取色器 + 吸管取色

**字体系统**：
- 本地常用字体（苹方/雅黑/宋体/楷体/仿宋/Inter/Arial 等 ~12 种）
- 可选：4 种在线字体

### 6.4 内容编辑

**文字编辑**：选中文字类元素后双击 → contentEditable=true → 原地编辑 → 失焦/blur 后记录 ContentPatch

**图片替换**：选中 img → 面板提供「替换图片」按钮 → 文件选择器 → data URL 替换 → 记录 AttributePatch

### 6.5 结构操作

**添加元素**：
- 添加文字框：创建 `<div contenteditable style="position:absolute;...">` 在画布中央，带默认样式
- 添加图片：文件选择 → data URL → 创建 `<img style="position:absolute;...">`
- 添加形状：同 html-deck-editor 的 6 种形状

**删除元素**：选中后 Delete 键或 × 按钮 → 从 DOM 移除 → 记录 DeletePatch（特殊 patch 类型，undo 时恢复元素）

**层级调整**：
- 上移层级：`el.style.zIndex += 1`
- 下移层级：`el.style.zIndex -= 1`
- （在面板 Layout 区域提供按钮）

---

## 7. 历史系统（Patch 式）

### 数据结构

```js
{
  undoStack: Patch[],    // 普通编辑操作栈
  redoStack: Patch[]     // 被撤销的操作栈
}

Patch = {
  type: "style" | "content" | "attribute" | "move" | "resize" | "delete" | "add",
  el: Element,           // 目标元素引用
  prop: string,          // 属性名（style 类）
  before: any,           // 修改前的值
  after: any,            // 修改后的值
  // delete 类型额外字段：
  parent: Element,       // 被删元素的父节点
  nextSibling: Element,  // 被删元素的下一个兄弟（恢复位置用）
  html: string           // 被删元素的 outerHTML
}
```

### 操作

```
record(patch):
  undoStack.push(patch)
  redoStack.length = 0  // 新操作清空重做栈
  if undoStack.length > 100: undoStack.shift()

undo():
  patch = undoStack.pop()
  apply(patch, patch.before)  // 恢复旧值
  redoStack.push(patch)

redo():
  patch = redoStack.pop()
  apply(patch, patch.after)   // 应用新值
  undoStack.push(patch)
```

### apply 分发

```js
apply(patch, value):
  switch patch.type:
    "style"      → el.style[prop] = value
    "content"    → el.textContent = value
    "attribute"  → el.setAttribute(prop, value)
    "move"       → el.style.left = value.left; el.style.top = value.top
    "resize"     → el.style.width = value.w; el.style.height = value.h; el.style.left = value.l; el.style.top = value.t
    "delete"     → parent.insertBefore(createElementFromHTML(html), nextSibling)
    "add"        → el.remove()
```

### 关键设计决策

- **不保存全量 HTML 快照**：避免 DOM 替换的副作用
- **Patch 直接引用元素**：不需要 CSS selector 回找（只在内存中，不持久化）
- **分组**：同一时刻的同目标多个 style 属性变化用 batchId 分组，undo 时一起回退
- **100 条上限**：足够用，防止内存问题

---

## 8. 面板 UI

### 布局

```
┌─────────────────────────────────────────────────────────────┐
│  [↩] [↪] | A- A+ | ⬅ ⬌ ➡ | B I | ↕- ↕+ | ⬜- ⬜+ | ◯- ◯+ │
│  [字色: ●●●●●●...] | [底色: ●●●●●●...] | [字体: ▾] | [导出]  │
└─────────────────────────────────────────────────────────────┘
```

- 位置：底部居中浮动
- 样式：白底圆角卡片，`box-shadow`
- 始终可见：从编辑启动到停止一直显示
- 上下文感知：选中文字元素时所有按钮可用；选中图片时只显示图片相关按钮；无选中时所有样式按钮 disabled
- 撤销/重做按钮：栈空时 disabled

### 按钮状态

- `disabled`：灰色文字 + 50% 透明度
- `active/toggled`：绿色背景（粗体激活、对齐选中状态）
- `hover`：浅灰背景

### 颜色色盘

- 小圆点排列，每个 18×18px
- hover 放大到 22px + 阴影
- 选中态加白边 2px

---

## 9. 导出引擎

### 导出流程

```
1. 深克隆 document 的 <html> 元素
2. 移除所有 [data-em-editor] 元素（outline、panel、hoverOutline、editorFrame）
3. 移除所有 .em-canvas 内部编辑标记类名
4. 保留所有 absolute 定位坐标
5. 保留所有行内 style 属性
6. 在 <head> 中添加：
   - body { margin: 0; overflow: auto; }
   以确保导出的页面在浏览器中正常显示
7. 序列化为 HTML 字符串（带 <!DOCTYPE html>）
8. 通过 Blob + URL.createObjectURL 触发下载
```

### 导出结果

标准的、独立的、完整的 HTML 文件。任何浏览器打开都能正常显示，不需要编辑器运行时。

---

## 10. 键盘快捷键

| 快捷键 | 操作 |
|--------|------|
| `Ctrl+Z` / `Cmd+Z` | 撤销 |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | 重做 |
| `Delete` / `Backspace` | 删除选中元素 |
| `Escape` | 取消选中 |
| `Ctrl` + 拖动 | 10px 网格吸附 |
| `Shift` + resize | 保持宽高比 |
| 方向键 | 微移选中元素 1px |
| `Shift` + 方向键 | 微移选中元素 10px |

---

## 11. 测试用页面

`test-page.html` 增加以下场景覆盖：

- 文本元素（h1-h6, p, span, a）
- 按钮元素
- 图片
- flex 布局容器
- grid 布局容器
- 大容器（>40% 视口）
- 空元素

---

## 12. 开发阶段

### 第一阶段：核心引擎（runtime.js）
- HTML 转换引擎
- 选中系统（hover + click + outline）
- 选中框（frame + 拖动 + resize + 删除）
- Patch 式历史系统（undo/redo）
- 基础样式操作（字号 ±、颜色、对齐、粗体）
- 导出引擎

### 第二阶段：面板 + 交互完善
- 面板 UI（始终可见 + 上下文感知）
- 完整样式操作（行高、边距、圆角、透明度、字体）
- 颜色系统（色盘 + 取色器 + 吸管）
- 键盘快捷键

### 第三阶段：添加元素 + 高级功能
- 添加文字框/图片/形状
- 层级管理
- 格式刷
- 对齐辅助线

---

## 13. 不做的（YAGNI）

- 动画/动效系统（html-deck-editor 有，EM 原型阶段不需要）
- AI 批注（EM 本身有对话，不需要批注）
- 演示模式（Keynote/浏览器自带）
- 导出 PDF/长图（原型阶段 HTML 足够）
- 编辑持久化 localStorage（原型一次性使用）
- 多页面/slide 管理（单页面原型场景）
- 协作/多人编辑
- 响应式编辑/断点

---

## 14. 与 EM 集成（后续）

集成方式：EM 项目内右键 HTML 文件 →「可视化编辑」→ 弹出新窗口

```ts
// app/main 侧
ipcMain.handle('editor:open-html', async (event, htmlPath) => {
  const editorWin = new BrowserWindow({ width: 1400, height: 900 });
  // 启动本地 HTTP 服务或直接加载
  editorWin.loadURL(`http://localhost:${port}/em-html-editor/index.html?file=${encodeURIComponent(htmlPath)}`);
});
```

但集成是**第三阶段之后**的事，当前先完善独立工具。
