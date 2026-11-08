/**
 * 桌面端 `agent:stream` 里的「状态类帧」→ 手机端状态栏文案。
 *
 * 手机端没有独立状态栏组件，统一落到 `mintStatus`。返回 `null` 表示这帧不走状态栏，
 * 必须交给后面的消息/工具分支——别误吞业务帧。
 *
 * **例外：`compacted` 不是纯状态帧**。桌面端 `app/main/services/agent-service.ts:2835-2839`
 * 给这一帧带上 `summary` 与 `compactionCardFields()` 的 `text` / `details.kind: "summary"`，
 * `app/renderer/src/components/ChatPanel.tsx:1822` 把它和 `custom_event` 走同一条系统消息插入
 * 路径（摘要卡）。这里必须返回 `null` 让它落到 `streamSystemNotice`，否则摘要卡永远看不到。
 *
 * 字段口径来自桌面端 `ChatPanel.tsx`（retry_state / waiting_user）与
 * `agent-service.ts`（compacting / compaction_finished）。
 */
/**
 * 自动压缩进行中的文案。桌面端有两条：手动 `ui.ChatPanel.compactingSession`（'正在整理会话...'）、
 * 自动 `ui.ChatPanel.contextNeedsCompactionCompacting`（下面这句）。手机端没有手动压缩入口，
 * 所以统一用自动那条——由 PC 侧手动触发的压缩在手机上还会走这里，措辞也说得通。
 */
export const COMPACTING_HINT = '检测到上下文需整理，正在整理…';

/**
 * 流式块类型 → 状态栏文案，镜像桌面端 ChatPanel.tsx:1624-1632：
 * 正文 →「正在回复」（pi.responding）、思考 →「正在思考...」、工具块 →「正在处理...」。
 *
 * 正文流式期间**必须有字**：这是「模型正在生成」的唯一指示，清空状态栏会让用户
 * 只看到回合头在走秒（桌面端的 request 信号要等到回合结束才 pop，不会中途消失）。
 */
export function streamingHint(kind: 'text' | 'thinking' | 'tool' | undefined): string {
  if (kind === 'thinking') return '正在思考...';
  if (kind === 'text') return '正在回复';
  return '正在处理...';
}

export function streamStatusHint(type: string, data: Record<string, unknown>): string | null {
  switch (type) {
    case 'compacting':
      return COMPACTING_HINT;
    case 'compaction_finished':
      return '';
    case 'waiting_user':
      // 桌面端 pi.waitingUser 就是「等待你的回复」，不带省略号
      return data.waiting === false ? '' : '等待你的回复';
    case 'retry_state': {
      if (data.retryPhase !== 'start') {
        // 桌面端 end 阶段：成功回「正在处理...」，失败/取消只清态（错误卡由 agent_end 出，不重复）
        return data.retrySuccess ? '正在处理...' : '';
      }
      const attempt = Number(data.retryAttempt ?? 1);
      const maxAttempts = Number(data.retryMaxAttempts ?? 1);
      const seconds = Math.round(Number(data.retryDelayMs ?? 0) / 1000);
      // 与桌面端 chat-utils.ts:410-414 的 retryStatusText 逐字一致
      const head = `正在重试 ${attempt}/${maxAttempts}`;
      return seconds > 0 ? `${head}（约 ${seconds} 秒后）` : head;
    }
    default:
      return null;
  }
}

/**
 * 打断时被丢弃的插话 → 一条系统提示文案；没有可提示的内容返回 `null`（别插空气泡）。
 *
 * 桌面端是输入卡上沿 10 秒提示条（DroppedSteerNotice）；手机端没有那个位置，
 * 改成落一条持久的系统消息——「已丢弃且不可恢复」这条信息漏看的代价更高。
 * 载荷 `queueDropped: string[]`，见桌面端 `agent-service.ts` 的 abort()。
 */
export function droppedSteerText(queueDropped: unknown): string | null {
  if (!Array.isArray(queueDropped)) return null;
  const items = queueDropped.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (!items.length) return null;
  const preview = items.map((text) => text.trim().replace(/\s+/g, ' ').slice(0, 40)).join('、');
  const clipped = preview.length > 120 ? `${preview.slice(0, 120)}…` : preview;
  return `打断时已丢弃 ${items.length} 条未送达的插话：${clipped}`;
}

/**
 * 系统通知帧 → 一条系统消息。桌面端 `app/renderer/src/components/ChatPanel.tsx:1822`
 * 把 `custom_event` 与 `compacted` 合并到同一条插入路径：后者是压缩摘要卡，正文在 `text`，
 * `details.kind` 为 `"summary"`（`app/shared/prompts.ts:634-643` 的 compactionCardFields）。
 *
 * 手机端是单视图，不需要桌面端那种「多 tab 按 customType + text + sysTs 去重」；
 * `systemKind` 交给 `SystemCard` 选摘要卡（16 行 markdown）还是普通系统卡。
 */
export function streamSystemNotice(
  type: string, data: Record<string, unknown>,
): { text: string; systemKind: string } | null {
  if (type !== 'custom_event' && type !== 'compacted') return null;
  const text = data.text;
  if (typeof text !== 'string' || !text.trim()) return null;
  const details = data.details;
  const kind = details && typeof details === 'object' && 'kind' in details
    ? String((details as Record<string, unknown>).kind ?? 'system') : 'system';
  return { text, systemKind: kind };
}

/**
 * 状态栏是单字符串，桌面端 `app/renderer/src/stores/status-store.ts` 则是 signals[] 栈
 * （pop 会回落到次新活跃信号）。清空时若回合仍在跑，回落到「正在处理...」——否则
 * 重试结束 / 等待结束 / 压缩结束会把状态栏抹成空白，用户会以为已经停了。
 * 桌面端 `app/renderer/src/lib/pi-run-status.ts` 的 `request` 信号是同款语义。
 */
export function resolveStatusHint(running: boolean, hint: string): string {
  return hint === '' && running ? '正在处理...' : hint;
}
