# Privacy & Data Handling / 隐私与数据处理

[English](#english) · [简体中文](#简体中文)

---

## English

EasyMint is a local-first desktop application. It has no account system, no telemetry, and no cloud
service operated by the project. However, EasyMint is an AI coding agent: to answer your request it
must send content to an AI provider **that you configure yourself**. This document states exactly
what leaves your machine, what stays local, what the agent is allowed to do, and how credentials are
stored.

### 1. What stays on your machine

| Location | Contents |
| --- | --- |
| `~/.easymint/` | App settings, project list, provider/model configuration, sessions, skills, logs, per-project runtimes |
| `<project>/.easymint/` | Project configuration, rule files, accumulated experience notes, task list |
| `<project>/` (your own files) | All project source code and assets |

There is no server-side storage, no cloud sync, and no account. Sessions and project data are never
uploaded to the project's own infrastructure — the project operates none.

### 2. What leaves your machine

#### 2.1 AI provider (required — configured by you)

Every model call goes directly from your machine to the endpoint of the provider you selected
(Anthropic, OpenAI, DeepSeek, Google Gemini, OpenRouter, or a custom OpenAI/Anthropic-compatible
endpoint you enter). The project never proxies or relays these requests, and never receives a copy.

A request may include:

- your messages and the system prompts / agent templates in effect;
- **tool results** — this includes files the agent read, command output, search results and web pages it fetched;
- project context injected into the conversation, such as rule files, accumulated experience notes and skill text;
- **images** you attach or that are read through the image channel, encoded as base64;
- ordinary request metadata (model name, token limits, etc.).

In other words: **whatever the agent reads in order to work may be transmitted to the provider.**
Which files and commands it may touch is governed by the permission mode (§4). Some providers offer
an "account login" (browser OAuth) flow; in that case the authorization happens in your browser with
that provider directly.

Images may also go to a second destination: if you enable the image-description channel by filling
in a vision API key, the images it reads are sent to the **image endpoint you configure — Alibaba
Cloud DashScope (`https://dashscope.aliyuncs.com`) by default** — not to the provider above.
Clearing that key disables the channel.

#### 2.2 Web search & page fetching (optional)

If you configure a Tavily API key, web search queries and the URLs to be fetched are sent to
`api.tavily.com`, and fetched page contents are returned to the model context. Without a key, both
abilities are simply unavailable.

If Tavily is reachable it does the fetching; when that request fails, the app fetches the page
**directly from your machine** instead — in that case the target site sees your IP address rather
than Tavily.

#### 2.3 MCP servers (optional — configured by you)

If you add Model Context Protocol servers, tool calls are sent to those servers, and their results
enter the model context. Their parameters come from the conversation and may contain file contents.

#### 2.4 Update check & downloads (automatic)

The packaged application periodically contacts GitHub Releases (via `electron-updater`) to check for
a new version and, when one exists, downloads it. This is the only recurring outbound request that
does not originate from the conversation. Installing a skill from a URL also fetches that repository
from GitHub/GitLab/Gitee.

When the agent's built-in file-search tools run on a machine without `ripgrep`/`fd`, those binaries
are downloaded from GitHub Releases.

#### 2.5 Local-network connections (optional)

The mobile client and the cross-device project transfer discover each other over the local network
and communicate directly, peer to peer — no relay server. Payloads are encrypted with
P-256 ECDH + AES-256-GCM; the desktop side does not send project absolute paths or API keys to the
phone.

#### 2.6 Sandboxed commands

Commands run in the sandbox use your real toolchain (npm, pip, cargo, git, …) and therefore reach
whatever package registries your project needs. Outbound network access is restricted by a
domain allow-list in the standard permission mode.

### 3. What EasyMint does NOT do

- No telemetry, analytics or crash reporting is sent anywhere.
- No account, no sign-in to the project, no cloud sync of projects or sessions.
- No advertising or data sale — the project has no server that could do so.

### 4. Agent capabilities and permission modes

The agent can **read and modify files in your project** and **execute shell commands** — that is what
makes it a coding agent. Scope is controlled by a three-tier permission mode, switchable per session
in the chat input:

| Mode | File access | Command execution | Network |
| --- | --- | --- | --- |
| **Read-only** | Read most project content; highly sensitive credentials are refused even to read | Not allowed | Not allowed |
| **Standard** (default) | Writes confined to the project workspace, its dedicated runtime area and the system temp dir; OS-level kernel sandbox (macOS Seatbelt / Linux bubblewrap / Windows sandbox account) | Allowed, inside the kernel sandbox, with environment redirection | Domain allow-list |
| **Full access** | No restriction | Allowed, unsandboxed, in your real environment | Unrestricted |

System-critical locations, privilege escalation (`sudo`/`doas`), system-service changes and
persistence mechanisms that execute code automatically are refused in all three modes. Full access
relies on pre-execution checks only and is not a hard isolation boundary; switching to it requires a
one-time risk confirmation. See the "Permissions & security" section of the README for details.

### 5. Credential storage

- **AI provider API keys and account (OAuth) tokens** — stored in plain text under `~/.easymint/`
  (`em-settings.json`, `agent/auth.json`). This is a deliberate choice, consistent with most
  comparable developer tools (`.npmrc`, `git-credentials`, `~/.aws/credentials`,
  VS Code `settings.json`): OS keychain encryption primarily protects a file that has *left* the
  machine, while any local process running as your user can decrypt it anyway.
- **MCP OAuth credentials** — encrypted with Electron `safeStorage` (Windows DPAPI / macOS Keychain /
  Linux libsecret) in `~/.easymint/mcp-oauth.json`. On the rare Linux setups without an available
  keyring, storage falls back to plain text and a warning is logged.

Practical implication: **keep `~/.easymint/` private.** Anyone who can read that directory can read
your provider credentials, and agent-read credentials end up in the model context — which is why the
read-only and standard modes refuse to read well-known credential files at all.

### 6. Your controls

- Choose the provider, endpoint and model — or use a local/self-hosted OpenAI-compatible endpoint so
  that no data leaves your machine.
- Clear an API key to disable the corresponding ability (web search, vision) entirely.
- Switch to read-only mode to keep the agent from writing, executing or reaching the network.
- Delete `~/.easymint/` and `<project>/.easymint/` to remove all local application data.
- EasyMint is MIT-licensed — the network behaviour described here can be verified in the source.

### 7. Contact

Questions or corrections: open an issue at
<https://github.com/tianemon/EasyMint/issues>.

---

## 简体中文

EasyMint 是**本地优先**的桌面应用：没有账号体系、没有遥测、没有项目方运营的云服务。但它是一个 AI
编程 Agent——为了回答你的请求，**它必须把你配置的 AI 供应商能读懂的内容发给那家供应商**。本文说明
哪些数据会离开本机、哪些留在本机、Agent 被允许做什么，以及凭据是怎么存的。

### 1. 留在本机的数据

| 位置 | 内容 |
| --- | --- |
| `~/.easymint/` | 应用设置、项目列表、供应商与模型配置、会话、skill、日志、项目专属运行区 |
| `<项目>/.easymint/` | 项目配置、规则文件、经验沉淀、任务清单 |
| `<项目>/`（你自己的文件） | 全部项目源码与资源 |

没有服务端存储、没有云同步、没有账号；会话与项目数据不会上传到项目方的任何设施——项目方没有这类设施。

### 2. 会离开本机的数据

#### 2.1 AI 供应商（必需，由你配置）

每次模型调用都由本机**直连**你选定的供应商端点（Anthropic、OpenAI、DeepSeek、Google Gemini、
OpenRouter，或你自己填的 OpenAI / Anthropic 兼容接口）。项目方不代理、不中转、也拿不到副本。

一次请求可能包含：

- 你发的消息，以及生效中的系统提示词 / Agent 模板；
- **工具的执行结果**——包括 Agent 读到的文件内容、命令输出、检索到的资料与抓回的网页正文；
- 注入会话的项目上下文，如规则文件、经验沉淀与 skill 文本；
- 你附加的图片、或经图片通道读取的图片（以 base64 编码）；
- 常规请求元数据（模型名、token 上限等）。

换言之：**Agent 为了干活而读到的内容，都可能被发送给供应商。** 它能碰哪些文件、能不能执行命令，
由权限模式约束（见 §4）。部分供应商提供「账号登录」（浏览器 OAuth），授权过程在你的浏览器与该
供应商之间直接完成。

图片还可能有第二个去处：若你填入视觉 API Key 启用「图片识别」通道，它读取的图片会发往**你配置的图片
识别端点——默认是阿里云 DashScope（`https://dashscope.aliyuncs.com`）**，而不是上面这家模型供应商；
清空该 Key 即停用这条通道。

#### 2.2 联网搜索与网页抓取（可选）

若你配置了 Tavily API Key，搜索词与待抓取的 URL 会发送到 `api.tavily.com`，抓回的正文进入模型
上下文。不填 Key 则两项能力都不可用。

Tavily 可达时由它抓取；该请求失败时改为**由本机直接抓取目标网页**——此时看到你的是目标站点（含你的
IP），而不是 Tavily。

#### 2.3 MCP 服务器（可选，由你配置）

若你添加了 MCP 服务器，工具调用会发往这些服务器，其结果进入模型上下文；调用参数来自对话内容，
可能包含文件正文。

#### 2.4 版本更新检查与下载（自动）

安装版会周期性访问 GitHub Releases（`electron-updater`）检查新版本并在有更新时下载——这是唯一
**不来自对话**的周期性外部请求。从 URL 安装 skill 时，也会从 GitHub / GitLab / Gitee 拉取该仓库。

内置的文件搜索工具在缺少 `ripgrep`/`fd` 的机器上，会从 GitHub Releases 下载对应二进制。

#### 2.5 局域网连接（可选）

手机端与跨设备迁移通过局域网互相发现、点对点直连，不经任何中转服务器；载荷用 P-256 ECDH +
AES-256-GCM 加密，电脑不会把项目绝对路径或 API 密钥发给手机。

#### 2.6 沙盒内执行的命令

沙盒里的命令用的是你真实的工具链（npm、pip、cargo、git……），因而会访问项目所需的软件源；
标准模式下的出网按**域名白名单**放行。

### 3. EasyMint 不做的事

- 不上报遥测、统计或崩溃信息；
- 没有账号、不需要登录项目方、不做项目与会话的云同步；
- 不做广告、不卖数据——项目方没有能这么做的服务器。

### 4. Agent 能力与权限模式

Agent 能**读写你项目里的文件**、能**执行 shell 命令**——这是它作为编程 Agent 的基本能力。范围由
**三档权限模式**约束，可在聊天输入区按会话切换：

| 模式 | 文件访问 | 命令执行 | 网络 |
| --- | --- | --- | --- |
| **只读** | 可读普通项目内容；高敏凭据连读都被拒 | 不允许 | 不允许 |
| **标准**（默认） | 写入限定在项目工作区、项目专属运行区与系统临时目录；叠加内核沙盒（macOS Seatbelt / Linux bubblewrap / Windows 沙盒账户） | 允许，在沙盒内执行，环境被重定向 | 域名白名单 |
| **完全访问** | 不限定 | 允许，不套沙盒，用你的真实环境 | 不限定 |

系统核心位置、提权（`sudo`/`doas`）、系统服务变更，以及会自动执行代码的持久化配置，**三档一律拒绝**。
完全访问只靠执行前判定兜底、不是强隔离边界，切换前有一次风险确认。细节见 README「权限与安全」一节。

### 5. 凭据存储

- **AI 供应商的 API Key 与账号（OAuth）凭据**——以**明文**存放在 `~/.easymint/`
  （`em-settings.json`、`agent/auth.json`）。这是有意选择，与多数同类开发工具一致
  （`.npmrc`、`git-credentials`、`~/.aws/credentials`、VS Code `settings.json`）：系统钥匙串加密
  主要防的是「文件离开本机」，而本机同用户下的进程本来就能解密它。
- **MCP 的 OAuth 凭据**——用 Electron `safeStorage`（Windows DPAPI / macOS 钥匙串 / Linux libsecret）
  加密后存于 `~/.easymint/mcp-oauth.json`；极少数没有可用钥匙串的 Linux 环境会降级为明文并打印告警。

实际含义：**请把 `~/.easymint/` 当成私密目录。** 能读该目录的人就能读走你的供应商凭据；而 Agent 读到的
凭据会进入模型上下文——这正是只读与标准模式**直接拒绝读取**已知凭据文件的原因。

### 6. 你可以怎么控制

- 自选供应商、端点与模型；也可以填本地 / 自建 OpenAI 兼容端点，让数据不出本机。
- 清空某个 Key 即彻底停用对应能力（联网搜索、视觉识图）。
- 切到只读模式，Agent 就无法写文件、执行命令或联网。
- 删除 `~/.easymint/` 与 `<项目>/.easymint/` 即清除全部本地应用数据。
- 本项目以 MIT 开源——上面描述的联网行为都可以在源码里核对。

### 7. 联系方式

问题或更正：到 <https://github.com/tianemon/EasyMint/issues> 提 issue。
