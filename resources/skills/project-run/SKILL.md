---
name: project-run
description: >-
  运行面板配置。用户问「怎么启动项目」「加个运行方式」「新增/修改运行命令」，
  或项目完成需要生成运行配置时使用。提供 .easymint/run.json 的完整格式规范。
---

# Project Run — 运行面板配置

`.easymint/run.json` 由左侧「运行」面板读取，每条 commands 显示为一个可一键启动/停止的按钮（含端口状态）。文件变化时面板自动刷新。

## 格式

```json
{
  "commands": [
    { "platform": "react", "label": "前端", "cwd": "./client", "run_command": "npm run dev", "url": "http://localhost:5173" },
    { "platform": "spring", "label": "后端", "cwd": "./server", "run_command": "mvn spring-boot:run", "url": "http://localhost:8080" }
  ]
}
```

## 字段

- **platform**：技术栈。合法值：react/vue/nextjs/nuxt/angular/svelte/spring/django/flask/fastapi/nodejs/rails/laravel/go/rust/dotnet/react-native/expo/flutter/electron/tauri/python/shell。mac 桌面脚本用 shell，桌面应用用 electron。
- **label**：显示名，如"前端"、"后端"、"Android"
- **cwd**：工作目录（相对项目根），默认 "."
- **run_command**：启动命令，如 npm run dev、python main.py、flutter run
- **url**：启动后访问地址，如 http://localhost:3000

## 规则

- 多入口（前后端分离、跨平台）写多条
- **静态 HTML 页面（纯 HTML/CSS/JS，无构建工具、无 npm 依赖）不需要开发服务器**：run_command 用 open index.html（mac 直接打开）或 python3 -m http.server 8000（本地静态托管），url 对应 file:// 路径或 http://localhost:8000。不要为静态页面无谓创建 dev server 或引入框架构建
- 用户提出相关需求时，直接读现有 run.json 追加/更新——不必等任务全部完成，项目可运行即可生成；项目完成时生成（每次回到 done 更新）
