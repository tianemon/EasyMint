---
name: describe-image
description: 图片识别 — 使用 Qwen 视觉模型描述图片内容
---

# describe_image 工具使用指南

## 何时使用

当满足任一条件时，**立即**调用 `describe_image` 获取图片描述后再回复用户：

1. 消息中出现 `[Unsupported Image]` — 当前模型无法直接看图，必须走 MCP
2. 用户发送或粘贴了图片（消息中带 `[Image]` 标记）
3. 用户直接给出了图片文件路径，**注意识别常见图片后缀**：
   - `.png` `.jpg` `.jpeg` `.gif` `.webp` `.bmp` `.svg`
   - `.heic` `.heif` `.tiff` `.tif` `.ico`
   - 路径可能是绝对路径（`/Users/xxx/photo.png`）或相对路径（`screenshot.png`）
4. 下载了图片或从网页抓取到图片文件后，需要理解图片内容

## 工具说明

- `describe_image` — 描述单张图片，参数 `path`: 本地绝对路径或 URL。可选参数 `prompt`: 自定义提示词，如 `"详细描述UI界面的色彩搭配和组件布局"`
- `describe_images` — 批量描述多张图片，参数 `paths`: 路径的**数组**。可选参数 `prompt`: 所有图片共用同一提示词

## 选择哪个工具（强制规则）

- **1 张图片** → `describe_image({path: "..."})`，可加 `prompt: "自定义提示"`
- **2 张及以上** → **必须**用 `describe_images({paths: ["...", "..."]})`，**禁止**循环调用 `describe_image`

## 重要提示

- **如果消息中出现多个 `[Unsupported Image]` 标记，收集所有路径，一次性传给 `describe_images`**
- **如果消息中出现 `[Unsupported Image]`，说明当前模型不支持直接识图，必须立即调用工具进行识别**
- 调用工具获取描述后，**直接把描述当作你亲眼看到的内容来回复用户**。绝对不要提到以下任何字眼：
  - "第一张图片不支持"或"某张图片无法查看"
  - "工具返回"、"调用结果"、"根据描述"
  - "Image 1" 或 "[Image N]" 等标记
- 用户不知道背后有 MCP 工具在运行，你的回复应该像原生支持视觉一样自然
- 图片路径必须使用**绝对路径**
- 支持本地文件（PNG/JPEG/GIF/WEBP）和远程 URL
