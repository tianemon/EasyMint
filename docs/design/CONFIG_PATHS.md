# EasyMint 配置文件与路径

## 全局目录 `~/.easymint/`

所有 EasyMint 和 Pi SDK 的全局数据都存放在此目录。

```
~/.easymint/
├── em-settings.json          EasyMint 应用设置
├── projects.json             项目列表与记录
├── settings.json             Pi SDK 配置（API key / 模型 / 权限）
├── pinned-sessions.json      置顶会话记录
├── agent-templates.json      用户自定义 Agent 模板
├── system-prompts.json       系统提示词 CRUD
├── sessions/                 Pi SDK 会话数据（按项目路径编码隔离）
│   └── <编码路径>/             例如 -Users-amon-EasyMintProject-helloworld
│       └── <sessionId>.jsonl 会话完整对话记录
├── session-cache/            前端 per-session 缓存
├── skills/                   全局 Skill
├── pi/                       Pi SDK agent 运行时数据
│   ├── auth.json
│   └── models.json
└── uploads/                  上传文件缓存
```

---

## `em-settings.json`

EasyMint 专属设置，不与 SDK 混淆。

| 字段 | 说明 |
|------|------|
| `defaultProjectDir` | 新建项目的默认父目录 |
| `terminalFontSize` | 内置终端字号 |
| `evaluateMode` | 是否开启评估模式 |
| `tddMode` | 是否开启 TDD 模式 |
| `screenshotVerification` | 是否开启截图验证 |
| `lastProjectId` | 上次打开的项目 ID（启动恢复用） |
| `setupComplete` | Onboarding 是否完成 |
| `apiKeys` | `Record<string, string>`，MCP 服务器所需的第三方 API Key（如 VISION_API_KEY） |
| `hiddenSkills` | `string[]`，EasyMint 内隐藏（不显示/不注入）的 Skill 名称列表 |
| `hiddenMcpServers` | `string[]`，EasyMint 内禁用注入的 MCP 服务器名称列表 |
| `disabledSkills` | `string[]`（已弃用，迁移至 `hiddenSkills`） |
| `disabledMcpServers` | `string[]`（已弃用，迁移至 `hiddenMcpServers`） |
| `model` | 默认模型（旧字段，新配置优先用 `apiProviders`） |
| `availableModels` | `string[]`，可选模型列表（旧字段） |
| `context1M` | 是否启用 1M 上下文（旧字段，新配置优先用 `apiProviders`） |
| `apiProviders` | 多平台 API 供应商配置（见下方说明） |

> **注意**：API Key 等认证信息由 Pi SDK 的 `ModelRuntime` 管理，存储于 `~/.easymint/pi/auth.json`。EasyMint 通过 `store.getActiveApiKey()` 读取，`pi-init.ts` 中的 `ModelRuntime` 负责配置注入。

### `apiProviders` 结构

```json
{
  "current": "deepseek-main",
  "configs": {
    "deepseek-main": {
      "id": "deepseek-main",
      "presetId": "deepseek",
      "name": "我的DeepSeek",
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.deepseek.com/anthropic",
      "model": "deepseek-v4-pro",
      "models": ["deepseek-v4-pro", "deepseek-v4-pro[1M]", "deepseek-v4-flash"],
      "context1M": false,
      "createdAt": 1718000000000
    }
  }
}
```

| 字段 | 说明 |
|------|------|
| `current` | 当前激活的供应商配置 ID |
| `configs` | 所有用户保存的供应商配置，key 为配置 ID |
| `configs.<id>.presetId` | 引用的平台预设 ID（见 `app/shared/platform-presets.ts`） |
| `configs.<id>.name` | 用户自定义名称 |
| `configs.<id>.apiKey` | API Key |
| `configs.<id>.baseUrl` | 可选的 Base URL 覆盖 |
| `configs.<id>.model` | 当前选中的默认模型 |
| `configs.<id>.models` | 可选模型列表 |
| `configs.<id>.context1M` | 是否启用 1M 上下文（仅 DeepSeek 等支持平台显示此开关） |

**读取优先级**：`buildQueryOptions()` → `apiProviders.current` → `apiProviders.configs[activeId]` → 预设 env → 旧 `apiBaseUrl`/`apiKey` 字段

---

## `projects.json`

EasyMint 维护的项目记录。

```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "项目名",
      "path": "/绝对路径",
      "createdAt": "ISO 时间",
      "lastOpenedAt": "ISO 时间",
      "status": "setup | development | completed",
      "description": ""
    }
  ]
}
```

---

## `settings.json`（Pi SDK）

Pi SDK 自行管理的配置文件（`~/.easymint/settings.json`）。EasyMint 通过 `SettingsManager` 接口读写，不直接操作文件。

---

## 项目专属目录 `<项目根>/.easymint/`

每个项目可拥有自己的 EasyMint 配置，跟随项目文件夹。

```
<项目>/.easymint/
├── state.json    项目开发阶段状态（Mint 通过 set_project_stage 写入）
├── run.json      项目运行命令配置（Mint 开发完成时生成）
├── issues.json   项目 Issue 记录（Mint 通过 list_issues 读取）
└── escalation.json  Builder/Evaluator 阻塞时写入的升级报告
```

### `state.json`

```json
{
  "stage": "requirements | tech-selection | planning | init | developing | done",
  "stageTimes": {}
}
```

### `run.json`

Mint 在项目完成时生成，`process-service.ts` 读取并展示可执行命令：

```json
{
  "commands": [
    { "platform": "react", "label": "前端", "cwd": "./client", "run_command": "npm run dev", "url": "http://localhost:5173" }
  ]
}
```

---

## 项目模板目录 `<EasyMint>/template/`

新建项目时，从此目录复制模板文件到目标项目。

```
template/
├── .gitignore
├── CLAUDE.md         (Mint 初始化时更新)
├── README.md         (Mint 初始化时填充)
├── WORKER.md
├── EVALUATOR.md
├── evaluate.sh
├── run-automation.sh
├── init.sh           (Mint 初始化时填充并执行)
├── task.json         (Mint 分配任务时覆盖)
├── progress.txt
├── docs/
└── temp/
```

---

## Skill 目录

EasyMint 内置 Skill 存放在 `resources/skills/`，启动时 seed 到 `~/.easymint/skills/` 全局目录。Pi SDK 通过 `resourceLoader` 加载并注入 system prompt。

```
~/.easymint/skills/    ← 全局 Skill（所有项目可用）
  <skill-name>/
    SKILL.md                   ← YAML frontmatter + Markdown body
    references/                ← 可选，按需加载的文档
```

## MCP 配置

EM 独立 MCP 配置：`~/.easymint/mcp.json`（与 Claude Code 解耦，不再读写 `~/.claude/.claude.json`）。
首次启动时一次性迁移旧共享配置；Pi SDK 的 MCP 服务器通过 `mcp-service.ts`（`scanMcpServers`/`buildMcpServersOption`）读取该文件注入。

## SDK session 项目隔离机制

Pi SDK 以**项目绝对路径**作为项目身份。路径编码后作为 `~/.easymint/sessions/` 下的子目录名。

```
项目路径:  /Users/amon/EasyMintProject/helloworld
编码结果:  -Users-amon-EasyMintProject-helloworld
存储目录:  ~/.easymint/sessions/-Users-amon-EasyMintProject-helloworld/
```

**关键特性**：
- 没有项目 UUID，路径即身份
- 删除后在同路径重建项目 → 旧会话自动可见
- 移动项目到新路径 → 旧会话不再可见（编码路径变了）
