# EasyMint 配置文件与路径

## 全局目录 `~/.easymint/`

所有 EasyMint 和 SDK 的全局数据都存放在此目录，无子目录嵌套。

```
~/.easymint/
├── em-settings.json          EasyMint 应用设置
├── projects.json             项目列表与记录
├── settings.json             SDK 配置（API key / 模型 / 权限 / 插件）
├── .claude.json              SDK 内部元数据（迁移状态 / 用户 ID）
├── .last-cleanup             SDK 维护时间戳
├── pinned-sessions.json      置顶会话记录
├── projects/                 SDK session 数据（按项目路径编码隔离）
│   └── <编码路径>/             例如 -Users-amon-EasyMintProject-helloworld
│       ├── <sessionId>.jsonl 会话完整对话记录
│       ├── <sessionId>/       会话产物（子代理 / 工具结果 / 工作流）
│       └── memory/            项目持久化记忆
├── sessions/                 SDK 运行时活跃会话（以进程 PID 命名）
├── session-env/              SDK 会话运行时环境数据
├── tasks/                    SDK 后台任务输出
├── history.jsonl             SDK 全局提示词历史
├── telemetry/                SDK 遥测
├── plugins/                  SDK 插件
│   ├── data/                 插件数据
│   ├── installed_plugins.json
│   ├── known_marketplaces.json
│   └── marketplaces/          插件市场
├── shell-snapshots/          SDK Shell 快照
└── backups/                  SDK 备份
```

---

## `em-settings.json`

EasyMint 专属设置，不与 SDK 混淆。

| 字段 | 说明 |
|------|------|
| `defaultProjectDir` | 新建项目的默认父目录 |
| `claudePath` | Claude CLI 路径（预留） |
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

> **注意**：`apiKey` 和 `apiBaseUrl` 属于 SDK 的 `settings.json`（`env.ANTHROPIC_AUTH_TOKEN` / `env.ANTHROPIC_BASE_URL`）。EasyMint 通过 `saveSettings()` 在 `writeSdkSettings()` 中自动同步激活的供应商配置到 SDK 文件。

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

## `settings.json`（SDK）

SDK 自行管理的配置文件。EasyMint 仅通过接口写入以下字段：

| 路径 | 说明 |
|------|------|
| `env.ANTHROPIC_AUTH_TOKEN` | API Key |
| `env.ANTHROPIC_BASE_URL` | API 地址 |
| `env.ANTHROPIC_MODEL` | 默认模型 |

其余所有字段（`permissions`、`plugins`、`enabledPlugins` 等）由 SDK 自行管理，EasyMint 不干涉。

---

## 项目专属目录 `<项目根>/.easymint/`

每个项目可拥有自己的 EasyMint 配置，跟随项目文件夹。

```
<项目>/.easymint/
├── state.json    项目开发阶段状态
└── ...            预留扩展
```

### `state.json`

`project-status-store` 的持久化文件。

```json
{
  "initPhase": "pending | running | done",
  "allocPhase": "pending | running | done",
  "execPhase": "pending | ready | done"
}
```

| 阶段 | 含义 |
|------|------|
| `initPhase` | 环境初始化是否完成 |
| `allocPhase` | 开发任务是否已分配 |
| `execPhase` | 执行阶段（预留） |

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

与 Claude Code 共享，EasyMint 的 `seedDefaultSkills` 会在启动时补全内置 Skill。

```
~/.claude/skills/              ← 全局 Skill（所有项目可用）
  <skill-name>/
    SKILL.md                   ← YAML frontmatter + Markdown body
    references/                ← 可选，按需加载的文档

<project>/.claude/skills/      ← 项目级 Skill（仅当前项目）
```

## MCP 配置

与 Claude Code 共享 `.claude.json` 中的 `mcpServers` 字段。EasyMint 扫描该文件 + `em-settings.json` 的 `hiddenMcpServers` 来决定注入哪些 MCP 服务器到 SDK 会话。

`.claude.json` 位置：`~/.claude/.claude.json`（Claude Code 主配置）或 `~/.easymint/.claude.json`（SDK 配置，由 CLAUDE_CONFIG_DIR 决定）。

## SDK session 项目隔离机制

SDK 以**项目绝对路径**作为项目身份。路径中的 `/` 替换为 `-` 后作为 `~/.easymint/projects/` 下的子目录名。

```
项目路径:  /Users/amon/EasyMintProject/helloworld
编码结果:  -Users-amon-EasyMintProject-helloworld
存储目录:  ~/.easymint/projects/-Users-amon-EasyMintProject-helloworld/
```

**关键特性**：
- 没有项目 UUID，路径即身份
- 删除后在同路径重建项目 → 旧会话自动可见
- 移动项目到新路径 → 旧会话不再可见（编码路径变了）
- 删除项目时 EasyMint 同步清理对应 SDK 目录
- 启动时 EasyMint 清理对应项目的 SDK 孤儿目录
