import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { RemoteClientLike as RemoteClient } from '../transport/client-types';
import type {
  BackgroundAgent, BackgroundShell, OpenProject, PendingAsk, RemoteEvent, SessionListItem,
} from '../protocol/types';
import type { Page } from './types';
import { contentBlocks, contentText, eventTimestamp, insertMessageByTime, markToolDone, nestedCalls, object, PERMISSION_MARKER, prependMessage, presentationFrom, toolPresentation, upsertMessage } from './messages';
import type { DisplayAttachment, DisplayUsage } from './messages';
import { classifyApiError } from './api-errors';
import { beginCompacting, clearAllCompacting, endCompacting } from './compacting';
import type { PatchRuntime } from './runtime';
import { createStreamFrameQueue, scheduleOnNextFrame } from './stream-frames';
import { resolveSettingsRevision } from './settings-revision';
import { COMPACTING_HINT, droppedSteerText, resolveStatusHint, streamStatusHint, streamSystemNotice, streamingHint } from './status-hints';
import { THINKING_ORDER } from './thinking';
import { toolActivityIcon, toolStatusTargeted } from './tools';

/**
 * 事件归并要写入的状态。
 *
 * 会话级状态**一律按事件自己的会话 id 落格**（`patchRuntime`），不做「按当前会话过滤」——
 * 过滤依赖可变的「当前会话」，而事件回调、异步快照、用户动作时序交错，任何一条路径的时序差
 * 都会把状态写进别的会话（切换会话时发送按钮/状态文案串会话就是这么来的）。
 */
export type RemoteEventsStore = {
  patchRuntime: PatchRuntime;
  /** 状态文案带按会话去重 */
  setMintStatus: (sessionId: string, value: string, icon?: string) => void;
  /** 后台任务清单是全量的，按会话分组写回 */
  syncBackground: (kind: 'shell' | 'delegation', items: { sessionId?: string }[]) => void;
  /** 后台命令的实时输出块：除了累进会话运行态，再转发给「输出查看页」（它自己维护追加式内容） */
  emitShellChunk: (shellId: string, chunk: string) => void;
};

export type RemoteEventsOptions = {
  client: RemoteClient | null;
  /** 本机设备 id，用于过滤自己发出的 user_message 回显 */
  deviceId: string | undefined;
  page: Page;
  project: OpenProject | null;
  /** 当前显示的会话：重活（正文帧/工具帧）只给它做 */
  session: SessionListItem | null;
  streamMessageIds: RefObject<Record<string, string | null>>;
  /** 回合是否仍在跑（与 App.tsx 的 applySnapshot 共享）：状态栏清空时据此回落，见 status-hints.ts */
  activeTurn: RefObject<Record<string, boolean>>;
  refreshHome: () => void;
  refreshProjects: () => void;
  refreshSessions: (project: OpenProject) => void;
  store: RemoteEventsStore;
};

/**
 * 把电脑端推送的远程事件归并进**对应会话**的状态格。
 * 流式消息按 runId 复用同一条消息（每个会话各自记 id），避免每个增量帧都新建气泡；
 * 中间帧先按下一帧边界合并，见 stream-frames.ts。
 */
export function useRemoteEvents(options: RemoteEventsOptions): void {
  const { client, deviceId, page, project, session, streamMessageIds, activeTurn, refreshHome, refreshProjects, refreshSessions, store } = options;

  /**
   * 当前显示什么（会话 / 页面 / 项目）。
   * 一用于列表刷新类事件的页面判断（它们会调 setPage，用旧闭包会把用户从聊天页拽回列表页）；
   * 二用于「重活只给显示的会话做」——PC 端对**项目订阅**也会推 `agent:stream`（见 AGENTS.md），
   * 手机没打开该会话时仍然会收到每帧几千字的全量快照，不拦掉会把 JS 线程吃死（表现为能滑动但点不动）。
   * layout effect 在本帧提交时同步执行，早于任何事件回调。
   */
  const viewRef = useRef<{ sessionId: string | null; page: Page; projectId: string | null }>({
    sessionId: session?.sessionId ?? null, page, projectId: project?.id ?? null,
  });

  /** 设置回写的 revision 游标（口径与边界见 settings-revision.ts）。按会话记住已应用的最大值。 */
  const settingsRevision = useRef<Record<string, number>>({});

  useLayoutEffect(() => {
    viewRef.current = { sessionId: session?.sessionId ?? null, page, projectId: project?.id ?? null };
  });

  useEffect(() => {
    if (!client) return;

    /**
     * 压缩开始：置位 + 挂 120s 兜底（桌面端 ChatPanel.tsx:2053-2067 同款）。
     * SDK 挂起时 `done` 不会到达，没有兜底输入卡片会一直蒙着，用户以为卡死。
     */
    const startCompacting = (sessionId: string): void => {
      store.patchRuntime(sessionId, { compacting: true });
      beginCompacting(sessionId, () => {
        store.patchRuntime(sessionId, (current) => ({
          compacting: false,
          // 与桌面端同口径：只恢复界面，不中断后台压缩；这条提示是为了让「刚才为什么打不了字」有交代
          messages: insertMessageByTime(current.messages, {
            id: `compact-timeout-${Date.now()}`, role: 'system', systemKind: 'system',
            text: '压缩状态异常，已恢复界面（压缩可能仍在后台）',
          }),
        }));
      });
    };
    const stopCompacting = (sessionId: string): void => {
      endCompacting(sessionId);
      store.patchRuntime(sessionId, { compacting: false });
    };

    /** 应用一帧流式快照：message_start 与 message 共用（streaming 决定「还在流式」标记） */
    const applyStreamMessage = (sessionId: string, data: Record<string, unknown>, streaming: boolean): void => {
      if (!Array.isArray(data.blocks)) return;
      const blocks = contentBlocks(data.blocks);
      if (!blocks.length) return;
      const id = streamMessageIds.current[sessionId] ?? `stream-${String(data.runId ?? 'run')}-${Date.now()}`;
      streamMessageIds.current[sessionId] = id;
      // 状态栏跟着**正在产出什么**走，与桌面端 ChatPanel.tsx:1624-1632 同口径：
      // 正文流式 →「正在回复」；思考流式 →「正在思考...」；工具块 →「正在处理...」。
      // 关键是**正文流式时不能把状态栏清空**（正文一出现就整行消失，用户就只剩计时器可看）。
      // 终帧（partial === false）不改状态：状态的生命周期交给 turn_end / agent:exit，
      // 与桌面端「信号栈到回合结束才 pop」一致，也避免终帧与 turn_end 之间闪一下空白。
      if (streaming) {
        const tail = blocks[blocks.length - 1]?.kind;
        store.setMintStatus(sessionId, streamingHint(tail === 'thinking' || tail === 'text' ? tail : 'tool'));
      }
      // 终帧（partial === false）带 usage / durationMs / stopReason（桌面端 event-bridge.ts:352-353）：
      // 缺了它们，实时会话里既没有「用时」也判不出回合边界，只有重开会话走快照才补齐。
      const rawUsage = object(data.usage);
      const usage: DisplayUsage | undefined = Object.keys(rawUsage).length ? {
        inputTokens: Number(rawUsage.inputTokens ?? 0),
        outputTokens: Number(rawUsage.outputTokens ?? 0),
        cacheReadTokens: Number(rawUsage.cacheReadTokens ?? 0),
        cacheWriteTokens: Number(rawUsage.cacheWriteTokens ?? 0),
      } : undefined;
      store.patchRuntime(sessionId, (current) => ({
        messages: upsertMessage(current.messages, {
          id, role: 'assistant', blocks, streaming,
          ...(usage ? { usage } : {}),
          ...(typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) ? { durationMs: data.durationMs } : {}),
          ...(typeof data.stopReason === 'string' ? { stopReason: data.stopReason } : {}),
          ...(typeof data.timestamp === 'number' ? { createdAt: data.timestamp } : {}),
        }),
      }));
    };

    // 中间帧只在下一帧边界应用最后一帧（累计全文快照语义，中间态必被覆盖）。
    // 帧里带上投递时刻的会话 id：即使队列里还压着旧帧，也只会落进它自己的会话格。
    const frames = createStreamFrameQueue<{ sessionId: string; frame: Record<string, unknown> }>((pending) => {
      applyStreamMessage(pending.sessionId, pending.frame, true);
    }, scheduleOnNextFrame);

    const off = client.onEvent((event: RemoteEvent, envelope) => {
      const data = object(event.data);
      if (event.channel === 'project:open-windows-changed') {
        if (viewRef.current.page === 'home') refreshHome();
        else if (viewRef.current.page === 'projects') refreshProjects();
      }
      if (event.channel === 'session:list-changed' && viewRef.current.projectId && envelope.projectId === viewRef.current.projectId) {
        // 只有停在列表页才跟着刷新：正看聊天时刷新会把 setPage 拽回列表页
        if (viewRef.current.page === 'home') refreshHome();
        else if (viewRef.current.page === 'sessions' && project) refreshSessions(project);
      }
      // 后台任务清单：载荷是**所有订阅会话**的全量清单，按会话分组写回（只看当前会话会串）
      if (event.channel === 'agent:shell-count' && Array.isArray(event.data)) {
        store.syncBackground('shell', event.data as BackgroundShell[]);
        return;
      }
      if (event.channel === 'agent:delegation-count') {
        store.syncBackground('delegation', Array.isArray(data.tasks) ? data.tasks as BackgroundAgent[] : []);
        return;
      }

      // 以下都是会话级事件：没有会话 id 就无法归属，直接丢弃（宁可不动，也不写错会话）
      const sessionId = envelope.sessionId;
      if (!sessionId) return;

      if (event.channel === 'agent:exit') {
        frames.flush();
        activeTurn.current[sessionId] = false;
        store.setMintStatus(sessionId, '');
        streamMessageIds.current[sessionId] = null;
        store.patchRuntime(sessionId, (current) => ({
          running: false,
          messages: current.messages.map((item) => item.streaming ? { ...item, streaming: false } : item),
        }));
        return;
      }
      if (event.channel === 'agent:shell-output') {
        // 长命令的输出是高频大块：只给当前显示的会话追加，隐藏会话切回时靠快照补齐
        if (sessionId !== viewRef.current.sessionId) return;
        const id = String(data.id ?? '');
        const chunk = typeof data.chunk === 'string' ? data.chunk : '';
        // 输出查看页自己维护追加式内容：先转发实时块（它打开时会先拉日志尾部，直接拼不会重复）
        if (chunk) store.emitShellChunk(id, chunk);
        store.patchRuntime(sessionId, (current) => ({
          backgroundShells: current.backgroundShells.map((item) => item.id === id ? { ...item, output: `${item.output ?? ''}${chunk}`.slice(-12_000) } : item),
        }));
        return;
      }
      if (event.channel === 'agent:delegation-init') {
        const delegationId = String(data.delegationId ?? '');
        const tasks = Array.isArray(data.tasks) ? data.tasks : [];
        store.patchRuntime(sessionId, (current) => ({
          backgroundAgents: [
            ...current.backgroundAgents.filter((item) => item.delegationId !== delegationId),
            ...tasks.map((item) => {
              const task = object(item);
              return { delegationId, index: Number(task.index ?? 0), title: String(task.title ?? task.task ?? 'Agent 任务'), status: 'pending' as const };
            }),
          ],
        }));
        return;
      }
      if (event.channel === 'agent:delegation-progress') {
        const delegationId = String(data.delegationId ?? '');
        const progress = object(data.progress);
        const index = Number(progress.index ?? 0);
        const status = String(progress.status ?? 'running') as BackgroundAgent['status'];
        store.patchRuntime(sessionId, (current) => {
          const found = current.backgroundAgents.some((item) => item.delegationId === delegationId && item.index === index);
          const updated = current.backgroundAgents.map((item) => item.delegationId === delegationId && item.index === index
            ? { ...item, status, currentTool: typeof progress.currentTool === 'string' ? progress.currentTool : item.currentTool } : item);
          if (status === 'completed' || status === 'failed' || status === 'aborted') {
            return { backgroundAgents: updated.filter((item) => item.delegationId !== delegationId || item.index !== index) };
          }
          return {
            backgroundAgents: found ? updated : [...updated, { delegationId, index, title: String(progress.description ?? progress.task ?? 'Agent 任务'), status,
              currentTool: typeof progress.currentTool === 'string' ? progress.currentTool : undefined }],
          };
        });
        return;
      }
      if (event.channel === 'agent:context-usage') {
        const percentage = typeof data.percentage === 'number' ? data.percentage : null;
        store.patchRuntime(sessionId, { contextUsage: { percent: percentage, maxTokens: typeof data.maxTokens === 'number' ? data.maxTokens : undefined } });
        return;
      }
      if (event.channel === 'agent:ask-request') {
        store.patchRuntime(sessionId, { pendingAsk: data as unknown as PendingAsk });
        return;
      }
      if (event.channel === 'agent:ask-closed') {
        store.patchRuntime(sessionId, { pendingAsk: null });
        return;
      }
      if (event.channel === 'agent:remote-settings-changed') {
        const decision = resolveSettingsRevision(settingsRevision.current[sessionId], Number(data.revision));
        if (decision.stale) return;
        settingsRevision.current[sessionId] = decision.cursor;
        // 供应商恒为桌面端的全局当前供应商（2026-10-29 起协议不再下发 provider），这里只跟随模型
        store.patchRuntime(sessionId, {
          ...(typeof data.model === 'string' ? { model: data.model } : {}),
          ...(typeof data.thinkingLevel === 'string' ? { thinking: data.thinkingLevel } : {}),
          ...(data.permissionMode === 'readonly' || data.permissionMode === 'standard' || data.permissionMode === 'full' ? { permission: data.permissionMode } : {}),
        });
        return;
      }
      if (event.channel === 'agent:model-changed') {
        // 会话内切模型 / 恢复会话时桌面端单独广播（agent-service.ts:2058/2185/2917），
        // 载荷只有 model/provider/sessionId，**没有 revision**，所以不进上面的版本门
        // （纳进去会被全部丢弃）。同一条 WebSocket 有序投递，按到达顺序覆盖即可；
        // 版本门只拦同通道的近距重放，不会反过来把这里的新值改回旧值。
        // 与 remote-settings-changed 可能重复，按 model 幂等覆盖即可。
        if (typeof data.model === 'string') store.patchRuntime(sessionId, { model: data.model });
        return;
      }
      if (event.channel === 'agent:context-summarizing') {
        // type 只有两种：'compact' = 开始压缩，'done' = 结束（agent-service.ts:2825 / 2902）。
        // 状态栏 + 输入卡片的蒙版都跟着走（PC 同口径）。结束时要按运行态回落：
        // 回合还在跑就回「正在处理...」，否则清空——直接置空会把状态栏抹掉，
        // 用户会以为已经停了（桌面端是 pop 信号后回落到次新信号）。
        //
        // 只认 'compact' 而不是「非 done」：桌面端曾有第三种 'summary'（轮转总结并开新会话），
        // 该链路已于 2026-08-15 取消（提交 46a111b1 删除 rotation.ts），主进程不再广播；
        // 万一老版本桌面端还发，也不该把手机端输入卡片蒙成「正在整理上下文」。
        const compacting = data.type === 'compact';
        if (compacting) startCompacting(sessionId); else stopCompacting(sessionId);
        store.setMintStatus(sessionId, compacting
          ? COMPACTING_HINT : resolveStatusHint(activeTurn.current[sessionId] ?? false, ''));
        return;
      }
      // chat-session / chat-closed 是桌面端 Pi 内部 chat 的生命周期（chatId / tabId），
      // 手机端状态格按 sessionId 组织、不维护 chatId；且 chat-session 的本机 projectPath 已被 PC 剔除。
      // 明确忽略：不要据此清 running（关 chat ≠ 停会话），也别让后来人以为漏了白名单事件。
      if (event.channel === 'agent:chat-session' || event.channel === 'agent:chat-closed') return;
      if (event.channel === 'agent:thinking-level-changed') {
        const available = Array.isArray(data.available) ? data.available.filter((level): level is string => typeof level === 'string') : null;
        store.patchRuntime(sessionId, {
          ...(typeof data.level === 'string' ? { thinking: data.level } : {}),
          ...(available ? { thinkingOptions: THINKING_ORDER.filter((level) => available.includes(level)) } : {}),
        });
        return;
      }
      if (event.channel !== 'agent:stream') return;
      const type = data.type;
      // 正文字帧/工具帧是高频重活（载荷是全量累计正文）：只给当前显示的会话做。
      // 隐藏会话不是丢数据——切回它时 openSession 会重取快照，内容会收敛。
      if (sessionId !== viewRef.current.sessionId
        && (type === 'message_start' || type === 'message' || type === 'tool_progress' || type === 'tool_done' || type === 'tool_result')) return;
      // 唯一的可合并帧：同一条消息的流式中间帧（partial !== false）
      if (type === 'message' && data.partial !== false) {
        frames.defer(String(data.runId ?? 'run'), { sessionId, frame: data });
        return;
      }
      // 其余流式事件都是边界/终态信号，不可被窗口吞掉：先把待应用帧落地，保证应用顺序 = 到达顺序
      frames.flush();
      // 状态类帧（压缩 / 重试 / 等待输入）：只改状态栏。compacted 不在其中——它带摘要正文，
      // 由下面的 streamSystemNotice 落成系统消息；返回 null 的帧一律继续往下走，不吞业务帧。
      // 压缩的开始/结束还要切换**输入卡片**的蒙版（桌面端 inputDisabled = compacting）：
      // 这一段不走流式正文，光靠状态栏文案不够——输入框仍可打字发送，等 PC 拒绝才知道不行。
      if (type === 'compacting') startCompacting(sessionId);
      else if (type === 'compaction_finished') stopCompacting(sessionId);
      const hint = streamStatusHint(String(type), data);
      if (hint !== null) {
        store.setMintStatus(sessionId, resolveStatusHint(activeTurn.current[sessionId] ?? false, hint));
        return;
      }
      // 压缩摘要卡 / custom 系统消息：桌面端 ChatPanel.tsx:1822 走同一条插入路径。
      // 手机端单视图，不做桌面端那种多 tab 去重；无 text 的帧在此返回 null，不插空气泡。
      const notice = streamSystemNotice(String(type), data);
      if (notice) {
        // 桌面端按 Pi 落盘时间戳有序插入（chat-store.ts:247-258：广播顺序 ≠ 落盘顺序），
        // 手机端同样带上时间戳交给 insertMessageByTime，不再一律头插。
        const createdAt = eventTimestamp(data, envelope.sentAt);
        // id 在 updater 外算好：React 可能重复调用 updater，在里面取时间戳会得到不同 id
        const id = `system-${createdAt}-${Math.random().toString(36).slice(2)}`;
        store.patchRuntime(sessionId, (current) => ({
          messages: insertMessageByTime(current.messages, {
            id, role: 'system', text: notice.text, systemKind: notice.systemKind, createdAt,
          }),
        }));
        return;
      }
      if (type === 'queue_dropped') {
        const text = droppedSteerText(data.queueDropped);
        const createdAt = eventTimestamp(data, envelope.sentAt);
        if (text) store.patchRuntime(sessionId, (current) => ({
          // id 在 updater 外算好：React 可能重复调用 updater，在里面取时间戳会得到不同 id
          messages: insertMessageByTime(current.messages, {
            id: `dropped-${createdAt}-${Math.random().toString(36).slice(2)}`,
            role: 'system', text, systemKind: 'system', createdAt,
          }),
        }));
        return;
      }
      if (type === 'turn_start') {
        activeTurn.current[sessionId] = true;
        streamMessageIds.current[sessionId] = null;
        store.patchRuntime(sessionId, { running: true });
        store.setMintStatus(sessionId, '等待模型响应...');
      } else if (type === 'turn_end' || type === 'error') {
        activeTurn.current[sessionId] = false;
        streamMessageIds.current[sessionId] = null;
        store.setMintStatus(sessionId, '');
        // 错误归一化与桌面端同表（app/shared/api-errors.ts）：上游原文 → 面向用户的中文 + 建议，
        // warn/error 两档决定卡片配色。「已停止」不出卡——那是用户主动打断的正常副作用，
        // 桌面端 ChatPanel.tsx:1785 同样是 `if (info.code !== 'stopped')` 才提示。
        const failure = type === 'error' ? classifyApiError(data.message) : null;
        const card = failure && failure.code !== 'stopped' ? failure : null;
        store.patchRuntime(sessionId, (current) => ({
          running: false,
          messages: card
            ? prependMessage(current.messages.map((item) => item.streaming ? { ...item, streaming: false } : item), {
              id: `error-${Date.now()}`, role: 'system', text: card.message, systemKind: 'error',
              systemTone: card.tone, ...(card.hint ? { systemHint: card.hint } : {}),
            })
            : current.messages.map((item) => item.streaming ? { ...item, streaming: false } : item),
        }));
      } else if (type === 'user_message' && typeof data.text === 'string') {
        const details = object(data.details);
        if (details.sourceDeviceId === deviceId) return;
        const id = String(details.messageId ?? `user-${Date.now()}`);
        // 桌面端广播带 details.attachments（remote-command-router.ts:151 的 name/kind），
        // 之前只插 text → 别的终端发的附件在手机上一片空白。历史事件没有像素数据，退成占位卡。
        const declared = Array.isArray(details.attachments) ? details.attachments : [];
        const attachments: DisplayAttachment[] = declared.map((item, index) => {
          const row = object(item);
          return { id: `${id}-${index}`, name: String(row.name ?? `附件 ${index + 1}`),
            kind: row.kind === 'image' ? 'image' : 'doc' };
        });
        const createdAt = eventTimestamp(data, envelope.sentAt);
        store.patchRuntime(sessionId, (current) => ({
          messages: current.messages.some((item) => item.id === id)
            ? current.messages : insertMessageByTime(current.messages, {
              id, role: 'user', text: data.text as string, createdAt,
              ...(attachments.length ? { attachments } : {}),
            }),
        }));
      } else if (type === 'message_start') {
        streamMessageIds.current[sessionId] = null;
        applyStreamMessage(sessionId, data, true);
      } else if (type === 'message') {
        // partial === false 的结束帧：立即应用，这就是最终内容
        applyStreamMessage(sessionId, data, false);
      } else if (type === 'tool_progress') {
        const name = String(data.toolName ?? '工具调用');
        const toolArgs = object(data.toolArgs);
        // 状态栏带目标（「正在读取 app.ts」）——桌面端 StatusBar 的 toolActivity 文案同源；
        // 同时把图标换成该工具的图标（桌面端工具进行中就是工具图标，不是 Mint 图标）
        store.setMintStatus(sessionId,
          toolStatusTargeted(name, Object.keys(toolArgs).length ? toolArgs : undefined), toolActivityIcon(name));
        const toolId = String(data.toolCallId ?? name);
        // id 在 updater 外算好：updater 可能被 React 重复调用，在里面取 Date.now() 会得到不同的 id
        const messageId = streamMessageIds.current[sessionId] ?? `stream-${String(data.runId ?? 'run')}-${Date.now()}`;
        streamMessageIds.current[sessionId] = messageId;
        store.patchRuntime(sessionId, (current) => {
          const delta = typeof data.deltaText === 'string' ? data.deltaText : '';
          const index = current.messages.findIndex((item) => item.id === messageId);
          if (index < 0) {
            return { messages: prependMessage(current.messages, { id: messageId, role: 'assistant', streaming: true,
              blocks: [{ kind: 'tool', id: toolId, name, input: toolArgs, output: delta, state: 'running' }] }) };
          }
          return { messages: current.messages.map((item, i) => {
            if (i !== index) return item;
            const blocks = [...(item.blocks ?? [])];
            const toolIndex = blocks.findIndex((block) => block.kind === 'tool' && block.id === toolId);
            if (toolIndex < 0) blocks.push({ kind: 'tool', id: toolId, name, input: toolArgs, output: delta, state: 'running' });
            else {
              const tool = blocks[toolIndex];
              // input 只增不改：tool_progress 是增量帧，某些工具首个增量里才带全参数
              if (tool?.kind === 'tool') blocks[toolIndex] = { ...tool, input: Object.keys(toolArgs).length ? toolArgs : tool.input, output: `${tool.output}${delta}`.slice(-12_000), state: 'running' };
            }
            return { ...item, blocks, streaming: true };
          }) };
        });
      } else if (type === 'tool_done') {
        store.setMintStatus(sessionId, '正在处理...');
        const toolId = String(data.toolCallId ?? data.toolName ?? 'running');
        store.patchRuntime(sessionId, (current) => ({ messages: markToolDone(current.messages, toolId) }));
      } else if (type === 'tool_result') {
        store.setMintStatus(sessionId, '正在处理...');
        const name = String(data.toolName ?? '工具调用');
        const toolId = String(data.toolCallId ?? name);
        const rawOutput = contentText(data.content);
        // 桌面端 event-bridge.ts:288-306 的载荷：presentation 已在 PC 侧解好（edit_diff / permission_denied），
        // 拿不到时按正文标记再解一次（老版本桌面端只带 content）。
        const presentation = presentationFrom(data.presentation)
          ?? toolPresentation(rawOutput, undefined, data.isError === true);
        // 权限信封那行是给 PC 解析用的内部标记，剥掉再进正文（桌面端 toolResultForUi 同款）
        const output = presentation?.kind === 'permission_denied' && rawOutput.startsWith(PERMISSION_MARKER)
          ? rawOutput.slice(rawOutput.indexOf('\n') + 1) : rawOutput;
        const nested = nestedCalls(data.nestedCalls);
        const durationMs = typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) ? data.durationMs : undefined;
        const imagePath = typeof data.imagePath === 'string' ? data.imagePath : undefined;
        // 同 tool_progress：id 在 updater 外算好
        const messageId = streamMessageIds.current[sessionId] ?? `stream-${String(data.runId ?? 'run')}-${Date.now()}`;
        streamMessageIds.current[sessionId] = messageId;
        store.patchRuntime(sessionId, (current) => {
          const index = current.messages.findIndex((item) => item.id === messageId);
          const state = data.isError ? 'error' as const : 'done' as const;
          const extras = {
            ...(presentation ? { presentation } : {}),
            ...(nested ? { nested } : {}),
            ...(durationMs !== undefined ? { durationMs } : {}),
            ...(imagePath ? { imagePath } : {}),
          };
          if (index < 0) {
            return { messages: prependMessage(current.messages, { id: messageId, role: 'assistant', streaming: true,
              blocks: [{ kind: 'tool', id: toolId, name, output, state, ...extras }] }) };
          }
          return { messages: current.messages.map((item, i) => {
            if (i !== index) return item;
            const blocks = [...(item.blocks ?? [])];
            const toolIndex = blocks.findIndex((block) => block.kind === 'tool' && block.id === toolId);
            if (toolIndex < 0) blocks.push({ kind: 'tool', id: toolId, name, output, state, ...extras });
            else {
              const tool = blocks[toolIndex];
              if (tool?.kind === 'tool') blocks[toolIndex] = { ...tool, name, output: output || tool.output, state, ...extras };
            }
            return { ...item, blocks, streaming: true };
          }) };
        });
      }
    });

    return () => {
      off();
      // 订阅重建/卸载时丢弃待应用帧，避免把上一个会话的帧写进新会话（后续帧仍是全量快照，内容会收敛）
      frames.clear();
      // 压缩超时兜底定时器一并撤掉，别在组件消失后还回调（否则会往已卸载的会话格写消息）
      clearAllCompacting();
    };
    // setter 由 useState 提供、标识稳定，无需进依赖；store 对象每次渲染都是新引用，故按字段解构传递。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, deviceId, page, project, session, refreshHome, refreshProjects, refreshSessions]);
}
