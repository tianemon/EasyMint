# EasyMint 配置文件与路径

## 全局目录 `~/.easymint/`

所有 EasyMint 和 Pi SDK 的全局数据都存放在此目录。

```
~/.easymint/
├── agent/                    Pi SDK agentDir（对应 Pi 默认的 ~/.pi/agent，经 PI_CODING_AGENT_DIR 重定向至此）
│   ├── auth.json             Pi 认证凭据（API key 由 EM 内存注入，磁盘为占位）
│   ├── models-store.json     Pi 模型目录缓存（路径跟随 agentDir 自动落位）
│   ├── settings.json         Pi 全局设置（磁盘模式，Pi 默认）
│   └── sessions/             Pi SDK 会话数据（Pi 默认布局 agentDir/sessions，按项目路径编码隔离）
│       └── <编码路径>/         例如 -Users-amon-EasyMintProject-helloworld
│           └── <sessionId>.jsonl 会话完整对话记录
├── em-settings.json          EasyMint 应用设置
├── projects.json             项目列表与记录
├── pinned-sessions.json      置顶会话记录
├── agent-templates.json      用户自定义 Agent 模板
├── system-prompts.json       系统提示词 CRUD（首次编辑时生成）
├── mcp.json                  MCP 服务器配置（与 Claude Code 解耦）
├── session-cache/            前端 per-session 缓存
├── skills/                   全局 Skill
├── migration-cache/          迁移去重标记
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

> **注意**：API Key 等认证信息由 Pi SDK 的 `ModelRuntime` 管理，存储于 `~/.easymint/agent/auth.json`（磁盘占位，实际 key 通过 `setRuntimeApiKey` 内存注入）。EasyMint 通过 `store.getActiveApiKey()` 读取，`pi-init.ts` 中的 `ModelRuntime` 负责配置注入。

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

## Pi SDK 目录映射（v0.7.2 起统一）

EM 把 Pi SDK 的全局目录从默认的 `~/.pi/agent` 重定向到 `~/.easymint/agent`，映射关系：

| Pi 默认 | EM 实际 | 覆盖手段 |
|---|---|---|
| `~/.pi/agent`（全局目录） | `~/.easymint/agent` | `PI_CODING_AGENT_DIR` env（`index.ts`） |
| `agentDir`（资源加载参数） | `~/.easymint/agent` | `agent-service.ts` `getAgentDir()` |
| `agentDir/sessions` | 同左（Pi 默认布局） | `getPiSessionDir()` 指向 `~/.easymint/agent/sessions/<编码>` |
| settings 落盘 | 磁盘模式（Pi 默认） | `SM.create(cwd, agentDir)`（`pi-init.ts`，每会话新建） |
| 项目级 `<cwd>/.pi/` | 同左（Pi 默认，patch 后为 `<cwd>/.easymint/`） | 见下方「项目级目录定制」 |

**保持 Pi SDK 默认行为**：资源发现（AGENTS.md/CLAUDE.md 上下文文件、项目 `<cwd>/.pi/` 的 skills/extensions/prompts/themes、SYSTEM.md/APPEND_SYSTEM.md）**不做任何限制**——Pi 怎么读就怎么读，EM 只在之上扩展（systemPromptOverride 注入 Mint 提示词 + EM skills + env/profile 动态 section）。`settings.json` 恢复磁盘模式（全局 `agentDir/settings.json` + 项目 `<cwd>/.pi/settings.json`，trusted 时），与 `em-settings.json`（EM GUI 设置）字段无重叠、不冲突。

**注意**：项目级配置目录名 `CONFIG_DIR_NAME` 是 Pi SDK 包级常量（读 SDK 自身 package.json 的 `piConfig.configDir`）——EM 作为分发方在**启动时幂等定制**（见下）。

### 项目级目录定制（v0.7.2）

`index.ts` 启动时检查本地安装的 SDK 包 `package.json` 的 `piConfig.configDir`（开发 = 项目 `node_modules`；打包 = `.asar.unpacked`），非 `.easymint` 则补写——**每次启动自检，npm install/升级覆盖后自动恢复**；写失败（mac 签名权限）降级保持 `.pi`。

效果：
- EM Mint 项目级目录 = `<cwd>/.easymint/`（与 EM 的 state.json/run.json 同目录共存，文件名不冲突）
- **pi CLI/TUI 用自己全局安装的独立 SDK 包 → 仍 `.pi`**——两边彻底隔离，互不干扰（Pi TUI 在项目级写的 compaction/settings 不再影响 Mint）
- 已验证：patch 后 Pi 运行时 `CONFIG_DIR_NAME = ".easymint"`、默认 `getAgentDir() = ~/.easymint/agent`

### 会话目录（v0.7.2 起归默认）

会话目录走 Pi 默认布局 `agentDir/sessions/<编码cwd>/` = `~/.easymint/agent/sessions/`（`getPiSessionDir` 指向该路径，9 个调用点统一）。启动时一次性迁移旧布局 `~/.easymint/sessions/` → `agent/sessions/`（幂等，跨盘降级复制）。

旧布局 `~/.easymint/pi/`、`pi-agent/` 与 `~/.pi/` 已清理，启动时含一次性迁移（`pi-agent/models-store.json` → `agent/`）。

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
