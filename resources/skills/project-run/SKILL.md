---
name: project-run
description: >-
  运行面板配置。用户问「怎么启动项目」「加个运行方式」「新增/修改运行命令」、
  写常用脚本（运行/构建/打包/安装/发版部署等），或项目完成需要生成运行配置时使用。
  提供 .easymint/run.json 的完整格式规范。
---

# Project Run — 运行面板配置

`.easymint/run.json` 由左侧「运行」面板读取，每条 commands 显示为一个可一键启动/停止的按钮（含端口状态）。文件变化时面板自动刷新。

## 格式

```json
{
  "commands": [
    { "platform": "nodejs", "label": "前端", "cwd": "./client", "run_command": "npm run dev", "url": "http://localhost:5173" },
    { "platform": "java", "label": "后端", "cwd": "./server", "run_command": "mvn spring-boot:run", "url": "http://localhost:8080" }
  ]
}
```

## 字段

- **platform**：显示分类，**按 run_command 的解释器、脚本扩展名或首个命令词判断，不按项目技术栈硬标**。常见分类如 nodejs/java/python/shell/git/flutter/rust/go/dotnet；npm/pnpm/yarn/node→nodejs、mvn/gradle/java→java、python→python、bash/sh/zsh→shell、git→git。面板会按命令推断，未知命令回退到首词，不把分类当作严格枚举或执行环境配置。
- **label**：显示名，如"前端"、"后端"、"Android"（命名规则见下方「脚本标题命名」）
- **cwd**：工作目录（相对项目根），默认 "."
- **run_command**：运行命令，如 npm run dev、python main.py、flutter run、flutter build apk、bash deploy.sh
- **install_command**（可选）：依赖安装命令，如 flutter pub get、npm install。读写时保留，当前面板没有该字段的独立展示、编辑或执行入口；需要一键安装时将真实安装命令作为单独的 commands 项
- **url**（可选）：启动后访问地址，如 http://localhost:3000（仅运行类脚本需要，构建/打包/安装类不填）

## 规则

- 多入口（前后端分离、跨平台）写多条
- **静态 HTML 页面（纯 HTML/CSS/JS，无构建工具、无 npm 依赖）**：交付预览用 show_prototype 指定真实页面（例如 `{ "path": "app/index.html" }），将返回的本地 HTTP 地址写成可点击链接；EasyMint 自带静态托管，无需用户安装 Python 或手动起服务。该地址随应用退出失效，不把临时端口写入 run.json。仅当用户需要独立于 EasyMint 的长期运行脚本时，按实际可用环境配置静态服务器与对应 url；不要为静态页面引入框架构建。
- 用户提出相关需求、项目交付确需可复用入口或已有运行方式变化时，读现有 run.json 追加/更新；已有正确配置不重写，不因某条任务进入 done 重复生成

## 脚本管理（不只限于启动项目）

- **脚本形式分工**：
  - **简单单行命令**（构建/打包/运行等一步到位）→ 直接写在 run_command：`flutter build apk`、`npm run build`
  - **复杂多步脚本**（条件/循环/多命令串联，如发版部署）→ 先写脚本文件到 `scripts/` 下（如 `scripts/release.sh`，加执行说明注释），run_command 写 `bash scripts/release.sh` 引用路径——脚本可版本管理、可独立测试、可复用
  - 面板编辑弹窗内 run_command 可直接改，简单命令无需单独建文件
- **脚本内不要手动重定向输出**（如 `> file 2>&1`、`| tee`）：面板运行时会自动收集 stdout/stderr（日志面板实时显示 + 落盘），重定向会绕过收集导致面板无输出（与 bash 工具规则一致）

run.json 不只放「启动项目」命令——**用户日常反复使用的脚本都加入管理**：运行、构建、打包、安装依赖、git 发版部署、数据备份、测试等。用户说「帮我写个 xx 脚本」时：

- 写完后**询问用户**「是否添加到运行面板？」；若判断脚本属于**长期反复使用**（如打包/构建/部署），**默认添加**并在回复中告知「已添加到运行面板」
- 用户没有明确要求写脚本但场景需要（如「我要打包发给朋友」）时，主动写对应脚本并加入面板
- 面板内脚本可被用户编辑（点击标题）或删除（删除需确认）——不要擅自删除用户面板里的脚本

### 预设脚本（项目交付需要时）

按项目实际能力与交付需要选择预设脚本，已有正确项则跳过，不为凑齐类别生成不存在的命令：

- **运行**：本地开发启动（如 flutter run / npm run dev）
- **构建/打包**：对应平台的构建产物命令（如 flutter build apk / flutter build macos / npm run build）
- **安装**：产物安装命令（如 mac 的 open/安装到 Applications）
- **发版部署**：仅项目已有适用发布流程且需要复用入口时配置，按实际流程组织命令；项目使用 Git 本身不构成生成发版命令链的理由

配置运行入口不等于执行授权；安装、覆盖产物、打 tag、推送或部署仍按用户要求和项目规则执行，不在生成配置时顺带执行。

### 脚本标题命名

**标题必须简单准确、一目了然**——用户看标题就知道脚本干什么。规则：

- 用「动作 + 对象」式短名称，避免口语化，避免技术黑话
- 平台环境差异写进标题（同一动作多平台时）
- 示例：
  - flutter 项目 mac 环境打包安卓 → `安卓端打包`
  - 构建 iOS 并安装到真机 → `安装iOS Release版本`
  - 运行 mac 桌面端 → `本地dev运行`
  - 构建 macOS 产物并安装到 Applications → `安装到本地`
  - 前端项目启动 dev server → `前端dev运行`
- 同一动作只有一个平台时不需要写平台名（如 `打包` 即可）；多平台才加平台区分
