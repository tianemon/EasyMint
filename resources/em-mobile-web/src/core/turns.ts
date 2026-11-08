import type { DisplayBlock, DisplayMessage, DisplayTextBlock, DisplayToolBlock, DisplayUsage } from './messages';

/**
 * 回合结构：把「一条条 Pi 消息」还原成桌面端那样的「一次执行」。
 *
 * 桌面端的口径在 `app/renderer/src/components/chat-turn-presentation.ts`：
 *  - 一条 user 开启一次执行，其后的连续 assistant 都属于它；
 *  - 前一条 assistant 已终态（`stopReason` 不是 `toolUse`）时又冒出 assistant，
 *    说明是自动续跑，另起一次执行；
 *  - 终态回合把「思考 / 工具 / 中间叙述」折进一行「用时 X」，只有最终结论留在气泡里；
 *  - 抽不出结论（被打断、只有中间叙述）时保留原始交错顺序，不折叠（桌面端 preserveSegments）。
 *
 * 手机端没有 StreamEntry，块直接挂在消息上，所以这里按 **块** 而不是按 entry 切片。
 * 纯函数、不引 react-native，便于 node:test 直接验（见 tests/turn-layout.test.mjs）。
 */

export type ProcessItem =
  | { kind: 'thinking'; key: string; text: string; running: boolean }
  /** 中间叙述：结束回合里会被折进过程，展开后仍按 markdown 渲染 */
  | { kind: 'commentary'; key: string; text: string }
  | { kind: 'tool'; key: string; tool: DisplayToolBlock; running: boolean };

export type TurnPiece =
  /** 过程片段：运行中折成一行摘要，展开按顺序回放 */
  | { kind: 'process'; key: string; items: ProcessItem[]; running: boolean }
  /** 正文片段：运行中直接流式渲染（桌面端 RunningAssistantContent 的「无 key」切片） */
  | { kind: 'text'; key: string; text: string; messageId: string; tail: boolean };

export type TurnConclusion = { key: string; text: string; messageId: string };

export type TurnView = {
  key: string;
  /** 升序索引（对应传入的 messages 数组） */
  indices: number[];
  active: boolean;
  interrupted: boolean;
  /** 结束时的总用时；运行中或时间戳缺失时为 undefined */
  durationMs?: number;
  /** 实时走秒的锚点（本轮提问的落盘时间） */
  startedAt?: number;
  /** 运行中：按原顺序的片段；已结束：只剩过程片段（结论已抽到 conclusion） */
  pieces: TurnPiece[];
  conclusion: TurnConclusion[];
  /** 过程条目总数，0 表示没有可折叠的内容（纯文字回复） */
  processCount: number;
  /** 折叠行摘要：单条用带目标的活动文案，多条用动作词去重后顿号连接 */
  summary: string;
  /** 折叠行的工具图标来源（取第一个过程条目的工具名） */
  iconName: string;
  usage?: DisplayUsage;
  lastMessageId: string;
};

/** 渲染行：用户/系统消息各自成行，assistant 归并成回合行 */
export type DisplayRow =
  | { kind: 'message'; key: string; message: DisplayMessage }
  | { kind: 'turn'; key: string; turn: TurnView };

/**
 * 一次执行怎么画 —— 三种形态由**两个独立事实**决定（运行态、有没有抽出结论），
 * 不能压成一个标志位：压过一版就踩了坑——运行中若模型先跑工具、还没吐正文，
 * 既没有正文片段可平铺、又因为「运行中」被折叠标题挡掉，整行只剩一个计时器。
 *
 *  - `running`：过程折一行摘要 + 正文流式（工具先行时也至少有这一行在动）
 *  - `folded`：已结束且抽出了结论 → 一行「用时 X ⌄」，展开回放过程（桌面端 CompletedExecution）
 *  - `flat`：抽不出结论（被打断 / 非终态 / 只有过程）→ 过程直接摊开（桌面端 preserveSegments）
 */
export type TurnMode = 'running' | 'folded' | 'flat';

export function turnMode(turn: TurnView): TurnMode {
  if (turn.active) return 'running';
  return turn.conclusion.length > 0 && turn.processCount > 0 ? 'folded' : 'flat';
}

const THINKING_SUMMARY = '思考过程';
const PROGRESS_SUMMARY = '中间结论';

/** Pi 用 `toolUse` 表示「后面还有同类消息」；其余 stopReason 都是本轮终态。 */
function isTerminal(message: DisplayMessage): boolean {
  const reason = message.stopReason;
  return !!reason && reason !== 'toolUse';
}

/** 带最终结论标记的正文块（Pi 的 `textSignature.phase === 'final_answer'`） */
function isTaggedConclusion(block: DisplayBlock): block is DisplayTextBlock {
  return block.kind === 'text' && block.phase === 'final_answer';
}

/** 一次执行的成员：被 user 切开，遇终态后再来的 assistant 另起一组 */
export function groupByExecution(messages: DisplayMessage[]): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  let previous: DisplayMessage | undefined;
  const close = (): void => {
    if (current.length) groups.push(current);
    current = [];
    previous = undefined;
  };
  messages.forEach((message, index) => {
    // 用户消息与系统消息都是边界：系统卡必须原位置可见（`error` / `human-action` 这类还要用户响应），
    // 折进回合里会被默认收起——宁可把一次执行拆成两段，也不能让卡片消失或跑到回合前面去。
    if (message.role !== 'assistant') { close(); return; }
    if (previous && isTerminal(previous)) close();
    current.push(index);
    previous = message;
  });
  close();
  return groups;
}

/** 起点时间：落盘时间（PC 时钟）优先；本地刚发的回显只有本机 `sentAt`，也能当走秒锚点 */
function timeOf(message: DisplayMessage | undefined): number | undefined {
  for (const candidate of [message?.createdAt, message?.sentAt]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

function firstTimestamp(messages: DisplayMessage[], indices: number[], start: DisplayMessage | undefined): number | undefined {
  for (const candidate of [timeOf(start), timeOf(messages[indices[0] ?? -1])]) {
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

/**
 * 回合用时。桌面端 `turnDuration`（chat-turn-presentation.ts:134-141）：
 * 末条消息的 `createdAt + durationMs` 减去本轮起点；末条自己带 durationMs 但没有可靠时间戳时，
 * 退化成「只有最后一步的耗时」——宁可比实际短，也不要编一个数字出来。
 */
export function turnDuration(
  start: number | undefined, end: number | undefined, lastDuration: number | undefined, interrupted: boolean,
): number | undefined {
  if (start !== undefined && end !== undefined) {
    const total = end + (lastDuration ?? 0) - start;
    if (total >= 0) return total;
    // 时间戳乱序（时钟回拨/跨机拼接）不能算出负数：打断的回合退回末条自身时间，其它情况放弃
    if (interrupted) return Math.max(0, end - start);
    return undefined;
  }
  return lastDuration !== undefined ? lastDuration : undefined;
}

/** 「用时 1分钟 23秒」/「已执行 0分钟 12秒」/「执行了 8 秒被打断」，与桌面端 executionLabel 同词序 */
export function formatTurnDuration(durationMs: number | undefined, options: { active?: boolean; interrupted?: boolean } = {}): string {
  if (options.interrupted) {
    if (durationMs === undefined) return '执行过程（已打断）';
    return `执行了 ${Math.max(0, Math.floor(durationMs / 1000))} 秒被打断`;
  }
  if (durationMs === undefined) return '用时未知';
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${options.active ? '已执行' : '用时'} ${minutes}分钟 ${seconds % 60}秒`;
}

/**
 * 折叠行摘要。桌面端（`ExecutionProcess.tsx:47-51`）按**动作**去重后顿号连接、不带次数
 * （`读取文件、运行命令`），目标放在 title 悬浮提示里；手机没有悬浮提示，所以**只有一条**时
 * 直接给带目标的文案（「已读取 app.ts」）补回那部分信息，多条才退回动作词。
 */
export function summarizeProcess(items: ProcessItem[], describe: (item: ProcessItem) => { text: string; label: string }): string {
  if (!items.length) return '';
  if (items.length === 1) {
    const first = items[0]!;
    if (first.kind === 'thinking') return THINKING_SUMMARY;
    if (first.kind === 'commentary') return PROGRESS_SUMMARY;
    return describe(first).text;
  }
  // 去重的键就是 label（每个动作一个），顺序按首次出现——与桌面端 Map 的插入序一致
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const item of items) {
    const label = item.kind === 'thinking' ? THINKING_SUMMARY : item.kind === 'commentary' ? PROGRESS_SUMMARY : describe(item).label;
    if (seen.has(label)) continue;
    seen.add(label);
    parts.push(label);
  }
  return parts.join('、');
}

/**
 * 回合视图缓存。
 *
 * 流式期间每一帧都会重算所有回合；如果不复用，每个 TurnView 对象都是新的，
 * 下游 memo 全部失效 → 整屏历史每帧重渲染（长会话直接卡顿）。
 * store 的写入只替换正在流式的那一条消息对象（`upsertMessage`），所以「组内消息引用全等
 * + running 相同 + 起点消息相同」就说明这一回合没变，可以复用上一帧的对象。
 */
const viewCache = new Map<string, { refs: DisplayMessage[]; start: DisplayMessage | undefined; running: boolean; view: TurnView }>();
const VIEW_CACHE_LIMIT = 400;

function cachedTurnView(
  key: string,
  inTurn: DisplayMessage[],
  start: DisplayMessage | undefined,
  running: boolean,
  build: () => TurnView,
): TurnView {
  const hit = viewCache.get(key);
  if (hit && hit.running === running && hit.start === start
    && hit.refs.length === inTurn.length && hit.refs.every((message, index) => message === inTurn[index])) {
    return hit.view;
  }
  const view = build();
  viewCache.set(key, { refs: inTurn, start, running, view });
  if (viewCache.size > VIEW_CACHE_LIMIT) {
    const oldest = viewCache.keys().next().value;
    if (oldest !== undefined) viewCache.delete(oldest);
  }
  return view;
}

/**
 * 主入口：接收**最新在前**的消息数组（与 store/FlatList 同序），返回同样最新在前的渲染行。
 *
 * running 来自会话运行态；它决定最后一组是不是「还在跑」。若状态落后一帧（turn_end 还没到），
 * 以 stopReason 为准——已经终态的消息不会因为 running 残留而重新展开成流式。
 */
export function buildRows(
  messages: DisplayMessage[],
  running: boolean,
  describe: (item: ProcessItem) => { text: string; label: string },
): DisplayRow[] {
  const ascending = [...messages].reverse();
  const groups = groupByExecution(ascending);
  const groupOf = new Map<number, number[]>();
  groups.forEach((indices) => indices.forEach((index) => groupOf.set(index, indices)));

  const rows: DisplayRow[] = [];
  const emitted = new Set<number>();
  const lastGroup = groups.at(-1);

  ascending.forEach((message, index) => {
    const group = groupOf.get(index);
    if (!group) { rows.push({ kind: 'message', key: message.id, message }); return; }
    if (emitted.has(group[0]!)) return;
    emitted.add(group[0]!);
    const inTurn = group.map((i) => ascending[i]!);
    const isLastGroup = group === lastGroup;
    // 起点消息（提问那条）决定实时走秒的锚点，缓存比对时也要一起看
    const startMessage = ascending[group[0]! - 1];
    const key = `turn-${inTurn[0]!.id}`;
    rows.push({ kind: 'turn', key, turn: cachedTurnView(key, inTurn, startMessage, isLastGroup && running,
      () => buildTurnView(ascending, group, inTurn, isLastGroup && running, describe)) });
  });

  return rows.reverse();
}

function buildTurnView(
  messages: DisplayMessage[],
  indices: number[],
  inTurn: DisplayMessage[],
  running: boolean,
  describe: (item: ProcessItem) => { text: string; label: string },
): TurnView {
  const last = inTurn[inTurn.length - 1]!;
  // 已收到终态就不再当运行中：running 是会话级开关，可能比最后一帧晚一拍
  const active = running && !isTerminal(last);
  const interrupted = last.stopReason === 'aborted' || last.stopReason === 'error';
  const startMessage = indices[0] !== undefined ? messages[indices[0]! - 1] : undefined;
  const startedAt = firstTimestamp(messages, indices, startMessage?.role === 'user' ? startMessage : undefined);
  const durationMs = active ? undefined : turnDuration(startedAt, timeOf(last), last.durationMs, interrupted);

  // 先定「哪些块是结论」：口径见 conclusionKeys（被打断 / 非终态 / 只有中间叙述时一个都不选）。
  // 一个都没有时保留原始交错顺序、不做折叠（桌面端 preserveSegments）。
  const conclusions = conclusionKeys(inTurn, { active, interrupted, terminal: isTerminal(last) });
  const preserveSegments = !active && conclusions.size === 0;

  const pieces: TurnPiece[] = [];
  const conclusion: TurnConclusion[] = [];
  let processCount = 0;
  let pending: ProcessItem[] = [];
  let pendingKey = '';

  const flush = (): void => {
    if (!pending.length) return;
    pieces.push({ kind: 'process', key: pendingKey, items: pending, running: active && pending.some(isItemRunning) });
    pending = [];
  };
  const pushProcess = (item: ProcessItem, key: string): void => {
    if (!pending.length) pendingKey = `process-${key}`;
    pending.push(item);
    processCount += 1;
  };

  indices.forEach((messageIndex, position) => {
    const message = messages[messageIndex]!;
    const blocks = message.blocks ?? [];
    const isLastMessage = position === indices.length - 1;
    blocks.forEach((block, blockIndex) => {
      const key = `${message.id}:${blockIndex}`;
      const tail = isLastMessage && blockIndex === blocks.length - 1;
      if (block.kind === 'text') {
        if (conclusions.has(key)) { conclusion.push({ key, text: block.text, messageId: message.id }); return; }
        if (active || preserveSegments) {
          flush();
          pieces.push({ kind: 'text', key, text: block.text, messageId: message.id, tail: tail && active });
          return;
        }
        pushProcess({ kind: 'commentary', key, text: block.text }, key);
        return;
      }
      const item: ProcessItem = block.kind === 'thinking'
        ? { kind: 'thinking', key, text: block.text, running: active && !!message.streaming && tail }
        // 回合已结束却还是 running 的工具：不是「正在跑」，是「没等到结果」（中断/失败）——
        // 交给工具卡显示「未完成」，别让历史里永远转着圈（桌面端 ActivityState.unfinished 同义）
        : { kind: 'tool', key, tool: block, running: active && block.state === 'running' };
      // 在 preserveSegments 下过程也要单独成段，才能保持与正文的原始先后
      if (preserveSegments) { flush(); pendingKey = `process-${key}`; pending.push(item); processCount += 1; flush(); return; }
      pushProcess(item, key);
    });
  });
  flush();

  const items = pieces.flatMap((piece) => piece.kind === 'process' ? piece.items : []);
  const summary = summarizeProcess(items, describe);
  const firstItem = items.find((item) => item.kind === 'tool');

  return {
    key: `turn-${inTurn[0]!.id}`,
    indices,
    active,
    interrupted,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    pieces,
    conclusion,
    processCount,
    summary: summary || PROGRESS_SUMMARY,
    iconName: firstItem?.kind === 'tool' ? firstItem.tool.name : 'read',
    ...(last.usage ? { usage: last.usage } : {}),
    lastMessageId: last.id,
  };
}

/** 中间叙述没有运行态（永远是已完成的文本段），只有思考与工具可能还在跑 */
function isItemRunning(item: ProcessItem): boolean {
  return item.kind !== 'commentary' && item.running;
}

/**
 * 哪些正文块算「最终结论」——镜像桌面端 `selectFinalEntries`（chat-turn-presentation.ts:88-108）：
 *
 *  - 运行中 → 不选（正文都在流式渲染）；
 *  - 非终态（`stopReason` 缺失或还是 `toolUse`）→ 不选，桌面端 `!interrupted && !terminal` 直接返回空；
 *  - 被打断（`aborted` / `error`）→ **只认带 `final_answer` 标记的块**；没有标记就一个都不选，
 *    宁可把过程摊开（preserveSegments），也不把半截话当成结论；
 *  - 正常终态 → 优先取**最后一条带 `final_answer` 的消息**里的标记块（桌面端 taggedIndex 从后往前找）；
 *    老会话没有标记，退回最后一条消息里所有非 commentary 正文。
 *
 * 差别只在「被打断 + 无标记」这一格：上一版不看 interrupted，会把打断时的半截回答抽成结论并折叠。
 */
function conclusionKeys(
  inTurn: DisplayMessage[], options: { active: boolean; interrupted: boolean; terminal: boolean },
): Set<string> {
  const keys = new Set<string>();
  if (options.active) return keys;
  if (!options.interrupted && !options.terminal) return keys;
  let tagged: DisplayMessage | undefined;
  for (let index = inTurn.length - 1; index >= 0 && !tagged; index -= 1) {
    const message = inTurn[index]!;
    if ((message.blocks ?? []).some(isTaggedConclusion)) tagged = message;
  }
  const target = tagged ?? (options.interrupted ? undefined : inTurn[inTurn.length - 1]);
  if (!target) return keys;
  (target.blocks ?? []).forEach((block, index) => {
    if (block.kind !== 'text') return;
    const keep = tagged ? isTaggedConclusion(block) : block.phase !== 'commentary';
    if (keep) keys.add(`${target.id}:${index}`);
  });
  return keys;
}
