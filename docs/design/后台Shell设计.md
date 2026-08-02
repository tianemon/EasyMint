# 后台 Shell 设计

> 对齐 Claude Code 的 `run_in_background`:Mint 可发起不阻塞对话的长驻命令
> (dev server、watcher、后台任务),命令退出后结果自动注入主会话。

## 背景

Pi SDK 的 bash 工具**不支持 background 参数**(输入仅 `command` + `timeout`,同步阻塞执行)。
要让 Mint 拥有 cc 同款的后台执行能力,需在 EM 侧扩展工具层。

## 关键决策

| 决策点 | 结论 | 原因 |
|--------|------|------|
| 前台行为 | 委托 Pi 原生实现,零改动 | 原生同步执行 + `tool_execution_update` 实时流式输出是现成能力 |
| 后台实现 | 自定义 bash 工具加 `background?: boolean`,spawn 子进程立即返回 | 对齐 cc `run_in_background` |
| 完成通知 | 复用 `injectSystemMessage` 链路自动注入主会话 | 与 task 委派同构,cc JSONL 实证的模式 |
| 输出截断 | 尾部 ~4KB,超长丢弃中间 | 防内存膨胀与消息体过大 |
| 实时滚动输出 | 本期不做 | 完成时一次性快照;后续如需再加流式通道 |
| 停止 | 杀进程树(`detached` + `kill(-pid)` / Windows `taskkill /T`) | 防止孙进程(如 dev server 的子进程)残留 |

## 架构分层

```
┌─ 工具层  background-shell/tool.ts
│    增强 bash:前台委托 Pi 原生;background: true → registry.start → 立即返回
│
├─ 进程层  background-shell/registry.ts
│    BackgroundShellRegistry 单例:spawn/停止/输出收集(尾部截断)/退出广播
│
├─ 通知层  agent-service.ts
│    PiSessionOptions.onShellExit → resolveParentSessionId(临时ID) → injectSystemMessage
│    shutdown() 时 stopAll() 清理全部进程
│
└─ UI 层   ShellBar.tsx + delegation-store
     shell·N = 后台命令数;点击展开命令列表 + 单条停止(与 AgentBar 同款交互)
```

## 事件流

```
Mint: bash(command="npm run dev", background=true)
  → 工具立即返回「已后台启动, ID: xxx」(回合不阻塞)
  → registry spawn 子进程,广播 agent:shell-count(ShellBar 显示 shell·1)
  → 命令退出(自然/失败/被停止)
  → broadcast agent:shell-count(列表移除)
  → onExit → injectSystemMessage([系统消息]-[Agent执行结果] ● 后台命令 — 完成/中止/失败 · Ns + 输出)
  → Mint 自动开新回合汇报
```

## 完成通知格式

以 Pi `sendCustomMessage` 结构化发送(custom 消息角色迁移后):

```
customType: "system_message"
details: { kind: "shell" }        ← 前端按 kind 渲染(委派为 delegation)
content: "[系统消息]-[Agent执行结果]
● 后台命令 — 完成 · 12s      ← 前端按状态着色(红绿灯三色:完成绿/中止黄/失败红)
命令: npm run dev
退出码: 0
输出:
Ready on http://localhost:3000"
```

content 保留 `[系统消息]` 前缀(convertToLlm 映射 custom→user,模型侧规则识别);
结构身份(customType/kind)走 JSONL/事件/前端,不再依赖文本前缀。
迁移背景与全量清单见 `docs/开发进度.md` 第 12 章。

## 文件清单

| 文件 | 职责 |
|------|------|
| `app/main/services/background-shell/registry.ts` | 进程注册表(spawn/stop/stopAll/输出收集/广播) |
| `app/main/services/background-shell/tool.ts` | 增强 bash 工具 + `formatShellResult` |
| `app/main/services/pi-session.ts` | codingTools 过滤原生 bash,末尾追加增强版(同名覆盖) |
| `app/main/services/agent-service.ts` | `onShellExit` → 注入主会话;shutdown 清理 |
| `app/main/ipc-handlers.ts` | `agent:stop-shell` IPC |
| `app/renderer/src/components/ShellBar.tsx` | shell 胶囊 + 命令列表浮层 + 停止 |
| `app/renderer/src/stores/delegation-store.ts` | `shellTasks` 数组 + order 动态排列 |

## 后续可选

- 实时输出滚动:后台命令输出流式转发前端(前台 bash 已有 `tool_execution_update` 链路可参考)
- 后台命令输出详情查看(点击查看完整输出,registry 目前只保留尾部 4KB)
- 子 Agent 会话内的后台命令通知(当前仅主会话注入)
