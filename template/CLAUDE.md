# {{PROJECT_NAME}}

## 项目背景

> 项目创建后，Mint 会在此处写入实际项目描述。

## 文件组织

- **`app/`** — 所有项目源码（前后端代码、配置文件、构建产物、运行时环境）。app/ 内部结构由项目决定，不要在 app/ 以外创建代码目录
- **`docs/`** — 项目文档（APP_SPEC.md、ARCHITECTURE.md、SETUP.md、USER_GUIDE.md）
- **`temp/`** — 开发过程中产生的临时文件（调试日志、截图、草稿、中间产物等）
- **根目录** — harness 文件：
  - `CLAUDE.md` — 项目通用上下文
  - `task.json` — 任务定义（唯一真相源，含 `passes` 和 `evaluated` 字段）
  - `init.sh` — 环境初始化脚本
  - `README.md`、`.gitignore`

## 常用命令

```bash
# 在这里定义项目专属命令
# 示例:
# npm run dev      # 启动开发服务器
# npm run build    # 生产构建
# npm run lint     # 运行代码检查
```

## 交互约定

- **必须用中文与用户对话。**

---

## 安全约束

- **严格禁止删除项目目录以外的任何用户文件和代码**
- **严格禁止运行 `rm -rf /`、`chmod 777`、`curl | bash` 等危险命令**
- **禁止修改 `.git/config`、系统配置、环境变量文件（除 `.env` 外）**
- 用户可能开启了 bypass 模式跳过权限确认，你必须自行遵守以上约束

---

## 编码约定

- 写代码时要严格判断代码逻辑是否符合需求，而不是单纯根据概率生成代码就觉得自己完成任务了
- 为新功能编写测试
- 遵循现有的代码模式和约定
- 前端改动需通过 Evaluator Agent 验证，Evaluator 使用 Playwright 实测页面效果
