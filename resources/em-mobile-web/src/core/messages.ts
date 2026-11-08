import type { SessionSnapshot } from '../protocol/types';
import type { AttachmentKind } from './attachments';

/**
 * 正文块的响应阶段。桌面端只在 text 块上带 `phase`（`event-bridge.ts:114` 由
 * `textSignature` 解出，见 `app/shared/response-phase.ts`），用来区分「过程叙述」与「最终结论」：
 * 只有结论用 agent 气泡，过程叙述折进执行过程。缺省（老会话）按「非结论」处理。
 */
export type ResponsePhase = 'commentary' | 'final_answer';

/**
 * 工具结果的展示形态。与桌面端 `app/shared/tool-presentation.ts` 的 `ToolPresentation` 同形：
 *  - `edit_diff`：结果正文其实是 diff，按 diff 渲染而不是原始文本
 *  - `permission_denied`：被共同底线拦截，结果不当红色报错铺出来
 */
export type DisplayPresentation =
  | { kind: 'edit_diff'; diff: string }
  | { kind: 'permission_denied'; rule: string; mode: string; operation: string; target: string; detail: string };

/** 子 Agent 内部的一次工具调用（`nestedCalls.calls[n]`，桌面端 `app/shared/nested-calls.ts`） */
export type DisplayNestedCall = {
  id: string;
  name: string;
  status: 'ok' | 'error' | 'unfinished';
  arguments?: Record<string, unknown>;
  argumentsBytes?: number;
  durationMs?: number;
  error?: string;
};

/** 气泡内的一块内容：正文 / 思考 / 工具调用 */
export type DisplayBlock =
  | { kind: 'text'; text: string; phase?: ResponsePhase }
  | { kind: 'thinking'; text: string }
  | {
    kind: 'tool'; id: string; name: string; input?: Record<string, unknown>; output: string; state: 'running' | 'done' | 'error';
    /** 工具执行耗时（桌面端 `durationMs`），工具卡标题行右侧的 `1.2s` */
    durationMs?: number;
    presentation?: DisplayPresentation;
    /** 子 Agent 展开后的内部调用；`complete === false` 表示还有调用没落盘 */
    nested?: { calls: DisplayNestedCall[]; complete: boolean };
    /** `generate_image` 的成品图路径（只在 PC 本机，手机端只显示文件名） */
    imagePath?: string;
  };

export type DisplayToolBlock = Extract<DisplayBlock, { kind: 'tool' }>;
export type DisplayTextBlock = Extract<DisplayBlock, { kind: 'text' }>;

/** 展示用附件。本地刚发的带 base64；历史消息可能只有文件名（占位卡），没有像素数据。 */
export type DisplayAttachment = {
  id: string;
  name: string;
  kind: AttachmentKind;
  mimeType?: string;
  data?: string;
};

/** 桌面端 session-coordinator.ts:80-87 已把 usage 归一化成这四个字段后随快照下发。 */
export type DisplayUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

/** 消息流里的一条消息（快照重建与流式事件共用同一模型） */
export type DisplayMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text?: string;
  blocks?: DisplayBlock[];
  streaming?: boolean;
  systemKind?: string;
  /** 系统卡建议行（错误卡的第二行，桌面端 FlowErrorCard 的 hint） */
  systemHint?: string;
  /** 系统卡视觉档位：warn = 暂时性可自愈（限流/超时），error = 需用户处理 */
  systemTone?: 'warn' | 'error';
  attachments?: DisplayAttachment[];
  /** 落盘时间（快照 created_at / 事件 timestamp），用于按时间有序插入，见 insertMessageByTime */
  createdAt?: number;
  /**
   * 本机时钟的发送时间。只给「本地回显、还没拿到 PC 时间戳」的用户消息当走秒锚点用，
   * **不参与** insertMessageByTime 的排序——跨机器比时间戳会把通知插错位置。
   */
  sentAt?: number;
  usage?: DisplayUsage;
  /** 桌面端轻档：条目还在历史里，但已被移出模型上下文 / 图片已从上下文剥离 */
  outOfContext?: boolean;
  imageStripped?: boolean;
  /** 本次图片只传了路径（正文里带 `IMAGE_PATH_ONLY_NOTE`），气泡下方「图片仅传路径」标记 */
  imagesPathOnly?: boolean;
  /** 该条回复自身的执行时长，桌面端 `msg.durationMs`（回合用时优先用它累加） */
  durationMs?: number;
  /** Pi 的回合终态：`stop` / `toolUse` / `error` / `aborted`。`toolUse` 表示后面还有同类消息 */
  stopReason?: string;
};

/**
 * 消息合并已交给 `session/turns.ts` 的回合分组：桌面端一条回合可能跨多条 assistant 消息，
 * 只按「相邻 assistant 就合并」会把「上一条已终态、后面自动续跑」的两轮并成一个气泡。
 * 这里保留单条消息的操作（插入 / 替换 / 标记工具完成），不再承担回合边界判断。
 */

/** 新消息插到列表头部（inverted 列表：最新在前） */
export function prependMessage(list: DisplayMessage[], message: DisplayMessage): DisplayMessage[] {
  return [message, ...list];
}

/**
 * 按 id 就地替换消息，未命中的消息保持原对象引用。
 * 「未变化的消息引用不变」是渲染隔离的前提——MessageRow 的 memo 靠它跳过非流式行，
 * 流式帧只换来流式的那一条。
 */
export function upsertMessage(list: DisplayMessage[], message: DisplayMessage): DisplayMessage[] {
  const index = list.findIndex((item) => item.id === message.id);
  if (index < 0) return prependMessage(list, message);
  return list.map((item, i) => i === index ? message : item);
}

/**
 * 把指定工具块标为完成。只有包含该工具块的消息才换新对象，其余消息保持原引用
 * （流式期间 tool_done 很密集，整列表换代会让所有行都重渲染）。
 */
export function markToolDone(list: DisplayMessage[], toolId: string): DisplayMessage[] {
  let touched = false;
  const next = list.map((item) => {
    const blocks = item.blocks;
    if (!blocks?.some((block) => block.kind === 'tool' && block.id === toolId && block.state !== 'done')) return item;
    touched = true;
    return { ...item, blocks: blocks.map((block) => block.kind === 'tool' && block.id === toolId ? { ...block, state: 'done' as const } : block) };
  });
  return touched ? next : list;
}

/** 把未知值收窄成可索引对象（协议字段全是 unknown） */
export function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

export function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const row = object(item);
      return typeof row.text === 'string' ? row.text : contentText(row.content);
    }).filter(Boolean).join('\n');
  }
  const row = object(value);
  if ('content' in row) return contentText(row.content);
  return typeof row.text === 'string' ? row.text : '';
}

/**
 * 正文块的响应阶段。与桌面端 `app/shared/response-phase.ts:4-10` 逐字同口径：
 * `textSignature` 是 JSON 字符串，`{v:1, phase:'commentary'|'final_answer'}` 才认，其余一律 undefined。
 */
export function responsePhase(signature: unknown): ResponsePhase | undefined {
  if (typeof signature !== 'string' || !signature.startsWith('{')) return undefined;
  try {
    const value = JSON.parse(signature) as { v?: unknown; phase?: unknown };
    return value?.v === 1 && (value.phase === 'commentary' || value.phase === 'final_answer') ? value.phase : undefined;
  } catch {
    return undefined;
  }
}

export const PERMISSION_MARKER = '[EASYMINT_PERMISSION]';

function permissionBlock(value: unknown): DisplayPresentation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const block = value as Record<string, unknown>;
  if (block.kind !== 'permission_denied') return undefined;
  if (!['rule', 'mode', 'operation', 'target', 'detail'].every((key) => typeof block[key] === 'string')) return undefined;
  return block as unknown as DisplayPresentation;
}

/**
 * 已经是结构体形态的 `presentation`（流式帧里由桌面端解好，或快照 `details.presentation`）。
 * 这里只做形状收窄，不再从正文里猜——猜的部分在 `toolPresentation`。
 */
export function presentationFrom(value: unknown): DisplayPresentation | undefined {
  const block = permissionBlock(value);
  if (block) return block;
  const row = object(value);
  if (row.kind === 'edit_diff' && typeof row.diff === 'string') return { kind: 'edit_diff', diff: row.diff };
  return undefined;
}

/**
 * 工具结果的展示形态。镜像桌面端 `app/shared/tool-presentation.ts:26-62`：
 * ① `details.presentation`（新会话，`toolMessageForUi` 写入）→ ② `details.diff`
 * → ③ 正文里的 `[EASYMINT_PERMISSION]` 信封（流式事件与子 Agent 结果）→ ④ legacy「操作被阻止：」
 * → ⑤ 正文里的 `变更内容:` 分隔符（edit 工具的老形状）。
 * 全部取不到时返回 undefined，按普通文本渲染。
 */
export function toolPresentation(content: string | undefined, details?: unknown, isError = true): DisplayPresentation | undefined {
  if (details && typeof details === 'object') {
    const data = details as Record<string, unknown>;
    const declared = presentationFrom(data.presentation);
    if (declared) return declared;
    if (typeof data.diff === 'string') return { kind: 'edit_diff', diff: data.diff };
  }
  if (!content) return undefined;
  if (content.startsWith(PERMISSION_MARKER)) {
    const line = content.slice(PERMISSION_MARKER.length).split('\n', 1)[0] ?? '';
    try {
      const block = permissionBlock(JSON.parse(line));
      if (block) return block;
    } catch { /* 畸形结果当普通输出显示，不能因此吞掉内容 */ }
  }
  if (isError && content.includes('操作被阻止：')) {
    const legacy = content.slice(content.indexOf('操作被阻止：'));
    const rule = /^规则：(.*)$/m.exec(legacy)?.[1];
    if (rule) {
      const modes: Record<string, string> = {
        '只读': 'readonly', '标准': 'standard', '完全访问': 'full', '自动': 'standard', '受限': 'readonly',
      };
      const storedMode = /^模式：(.*)$/m.exec(legacy)?.[1] ?? '';
      return {
        kind: 'permission_denied', rule, mode: modes[storedMode] ?? storedMode,
        operation: /^操作：(.*)$/m.exec(legacy)?.[1] ?? '',
        target: /^目标：(.*)$/m.exec(legacy)?.[1] ?? '',
        detail: legacy.split('\n', 1)[0]?.slice('操作被阻止：'.length) ?? '',
      };
    }
  }
  const marker = '\n\n变更内容:\n';
  const index = content.indexOf(marker);
  if (index >= 0) return { kind: 'edit_diff', diff: content.slice(index + marker.length) };
  return undefined;
}

/** `nestedCalls` 载荷 → 展示用子调用清单；形状不对时返回 undefined（老版本桌面端不带这个字段） */
export function nestedCalls(value: unknown): { calls: DisplayNestedCall[]; complete: boolean } | undefined {
  const source = object(value);
  if (!Array.isArray(source.calls)) return undefined;
  const calls = source.calls.map((item, index) => {
    const row = object(item);
    const status = row.status === 'ok' || row.status === 'error' ? row.status : 'unfinished';
    return {
      id: String(row.id ?? `nested-${index}`),
      name: String(row.name ?? '工具'),
      status,
      ...(row.arguments && typeof row.arguments === 'object' ? { arguments: row.arguments as Record<string, unknown> } : {}),
      ...(typeof row.argumentsBytes === 'number' ? { argumentsBytes: row.argumentsBytes } : {}),
      ...(typeof row.durationMs === 'number' ? { durationMs: row.durationMs } : {}),
      ...(typeof row.error === 'string' ? { error: row.error } : {}),
    } satisfies DisplayNestedCall;
  });
  return { calls, complete: source.complete !== false };
}

/** 桌面端写进用户正文的「图片只传了路径」提示句，见 `app/shared/image-context.ts:2-3` */
const IMAGE_PATH_ONLY_NOTE = '本次图片只提供文件路径；如需查看原图，请读取上述文件。';
const IMAGE_PARTIAL_PATH_NOTE = '本次有图片只提供文件路径；如需查看原图，请读取上述文件。';

export function contentBlocks(value: unknown): DisplayBlock[] {
  const content = Array.isArray(value) ? value : Array.isArray(object(value).content) ? object(value).content as unknown[] : [];
  const blocks: DisplayBlock[] = [];
  content.forEach((item) => {
    const row = object(item);
    if (row.type === 'text' && typeof row.text === 'string' && row.text) {
      // 流式帧直接带 `phase`（桌面端 messageToBlocks 已解好）；快照块带的是 textSignature，需要在手机端解一次
      const phase = row.phase === 'commentary' || row.phase === 'final_answer' ? row.phase : responsePhase(row.textSignature);
      blocks.push({ kind: 'text', text: row.text, ...(phase ? { phase } : {}) });
    } else if (row.type === 'thinking' && (typeof row.thinking === 'string' || typeof row.text === 'string')) {
      blocks.push({ kind: 'thinking', text: String(row.thinking ?? row.text) });
    } else if (row.type === 'tool_use') {
      blocks.push({ kind: 'tool', id: String(row.id ?? ''), name: String(row.name ?? '工具'), input: object(row.input), output: '', state: 'running' });
    } else if (row.type === 'tool_result') {
      blocks.push({ kind: 'tool', id: String(row.tool_use_id ?? row.id ?? ''), name: String(row.name ?? '工具'), output: contentText(row.content), state: row.is_error ? 'error' : 'done' });
    }
  });
  return blocks;
}

/**
 * 事件的时间锚：优先 Pi 落盘时间戳（PC 时钟毫秒），其次事件信封 `sentAt`（同一 PC 时钟、每个事件都有），
 * 最后才用本机 Date.now()。
 *
 * `compacted` / `queue_dropped` 这类帧的载荷不带 `timestamp`（桌面端 event-bridge.ts:421、
 * agent-service.ts:1200），若直接回退手机时钟，就会与快照 `created_at`（PC 时钟）跨时钟比较，
 * 把刚到达的通知插进历史消息的任意位置。
 */
export function eventTimestamp(data: Record<string, unknown>, sentAt: number | undefined): number {
  const value = data.timestamp;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof sentAt === 'number' && Number.isFinite(sentAt)) return sentAt;
  return Date.now();
}

/**
 * 按落盘时间把消息插进 inverted 列表（最新在前）。
 * 桌面端 `chat-store.ts:247-258` 按 piTs 升序插入，因为「广播到达顺序 ≠ 落盘顺序」；
 * 手机端顺序相反，所以找第一条比自己更旧的位置、插在它前面。
 * 列表里完全没有时间戳（纯流式消息）时退化为头插，别把新通知甩到最底下。
 */
export function insertMessageByTime(list: DisplayMessage[], message: DisplayMessage): DisplayMessage[] {
  if (typeof message.createdAt !== 'number' || !Number.isFinite(message.createdAt)) return prependMessage(list, message);
  let hasTimed = false;
  const index = list.findIndex((item) => {
    if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)) return false;
    hasTimed = true;
    return item.createdAt < message.createdAt!;
  });
  if (!hasTimed || index < 0) return hasTimed ? [...list, message] : prependMessage(list, message);
  return [...list.slice(0, index), message, ...list.slice(index)];
}

/**
 * 剥掉桌面端写进落盘正文的附件标记 `[Image #n: /abs/path]` / `[File #n: /abs/path]`。
 * 与桌面端 `app/renderer/src/components/chat-utils.ts:155-172` 的 parseAttachMarkers 同源：
 * 只把 basename 交给 UI，**绝不让桌面端的本机绝对路径出现在手机气泡里**。
 */
const ATTACH_MARKER = /\[(Image|File)\s+#(\d+):\s*([^\]]+)\]/g;
export function parseAttachMarkers(text: string): { attaches: DisplayAttachment[]; cleanText: string } {
  const attaches: DisplayAttachment[] = [];
  let clean = text;
  for (const match of text.matchAll(ATTACH_MARKER)) {
    const kind: AttachmentKind = match[1] === 'Image' ? 'image' : 'doc';
    const path = match[3] ?? '';
    attaches.push({ id: `marker-${match[2]}`, name: path.split('/').pop() || path, kind });
    clean = clean.replace(match[0], '');
  }
  return { attaches, cleanText: clean.trim() };
}

/**
 * 还原一条历史 user 消息的附件：
 * ① 磁盘 `image` 块的 base64（桌面端 `session-service.ts:273-275` 对 user 消息原样透传，
 *    `image_stripped` 只影响发给模型的投影，原始记录仍留着 data）；
 * ② 消息 `details.attachments`（桌面端 `remote-command-router.ts:59` 的 name/kind）；
 * ③ 正文里的 `[Image #n]` / `[File #n]` 标记补 basename 占位卡。
 * 三者按名字去重：有像素数据的优先，不再叠一张占位卡。
 */
export function snapshotAttachments(
  message: Record<string, unknown>, details: Record<string, unknown>, marked: DisplayAttachment[],
): DisplayAttachment[] {
  const result: DisplayAttachment[] = [];
  const content = message.content;
  const imageMarkers = marked.filter((entry) => entry.kind === 'image');
  let imageIndex = 0;
  if (Array.isArray(content)) {
    content.forEach((item, index) => {
      const row = object(item);
      if (row.type !== 'image' || typeof row.data !== 'string') return;
      // 第 n 个 image 块对应第 n 个 [Image #n] 标记；不能全部取第一张的名字（多图会重名、丢卡）
      const name = imageMarkers[imageIndex]?.name ?? `图片 ${index + 1}`;
      imageIndex += 1;
      result.push({ id: `image-${index}`, name, kind: 'image',
        mimeType: typeof row.mimeType === 'string' ? row.mimeType : 'image/jpeg', data: row.data });
    });
  }
  const declared = Array.isArray(details.attachments) ? details.attachments : [];
  declared.forEach((item, index) => {
    const row = object(item);
    const kind: AttachmentKind = row.kind === 'image' ? 'image' : 'doc';
    const name = String(row.name ?? `附件 ${index + 1}`);
    if (result.some((existing) => existing.name === name)) return;
    result.push({ id: `declared-${index}`, name, kind });
  });
  marked.forEach((item) => {
    if (result.some((existing) => existing.name === item.name)) return;
    result.push(item);
  });
  return result;
}

/** 桌面端 `app/renderer/src/lib/token-format.ts:19-24` 同口径。 */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '—';
  const count = Math.round(tokens);
  if (count < 1000) return String(count);
  const thousands = Number((count / 1000).toFixed(1));
  return thousands < 1000 ? `${thousands}K` : `${Number((count / 1_000_000).toFixed(1))}M`;
}

/**
 * usage 行，对齐桌面端 `ChatPanel.tsx:3553-3562` 与 zh-CN 的「输入 / 输出 / 缓存命中」。
 * total 含 cacheRead + cacheWrite；命中率 0% 也要显示——用户靠这一行找「哪一轮没命中缓存」。
 */
export function formatUsage(usage: DisplayUsage | undefined): string {
  if (!usage) return '';
  const total = (usage.inputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
  const read = usage.cacheReadTokens || 0;
  const hit = total > 0 ? ` · 缓存命中 ${((read / total) * 100).toFixed(2)}%` : '';
  return `输入 ${formatTokenCount(total)} · 输出${formatTokenCount(usage.outputTokens || 0)}${hit}`;
}

/** 桌面端 `ChatBlocks.tsx:848` truncateResult(maxLines=30, keep=20)：超长输出只留尾部，别把首屏撑爆。 */
export function truncateToolOutput(text: string, maxLines = 30, keep = 20): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return `${lines.slice(-keep).join('\n')}\n[输出过长，仅显示尾部 ${keep} 行。完整输出见日志]`;
}

/**
 * 把电脑端下发的会话快照还原成消息流（最新在前），toolResult 回填到上一条 assistant 的对应工具块。
 * 输出顺序与 MessageList 一致，App 不再每帧 reverse。
 */
export function snapshotMessages(snapshot: SessionSnapshot): DisplayMessage[] {
  const messages: DisplayMessage[] = [];
  snapshot.messages.forEach((entry) => {
    const message = object(entry.message);
    const timestamp = typeof entry.created_at === 'number' ? { createdAt: entry.created_at } : {};
    if (entry.type === 'user') {
      const rawText = contentText(message.content ?? entry.message);
      const { attaches, cleanText } = parseAttachMarkers(rawText);
      // 桌面端 chat-utils.ts:191-195 同口径：正文里那句「图片只传路径」的说明是给模型的，
      // 不从气泡正文里剥掉会显得像模型自己说的话；剥掉后单独挂「图片仅传路径」标记。
      const imagesPathOnly = cleanText.includes(IMAGE_PATH_ONLY_NOTE);
      const text = cleanText.replace(IMAGE_PATH_ONLY_NOTE, '').replace(IMAGE_PARTIAL_PATH_NOTE, '').trim();
      const details = object(message.details);
      const attachments = snapshotAttachments(message, details, attaches);
      // 不能因为「没有正文」就丢整条：只发附件 / 只发图片是合法消息
      // （桌面端 remote-command-router.ts:129 只在 text 与 markers 都为空时才拒绝）。
      if (!text && !attachments.length) return;
      const isSystem = message.customType === 'system_message';
      messages.push({
        id: entry.uuid, role: isSystem ? 'system' : 'user', text,
        ...(isSystem ? { systemKind: String(details.kind ?? 'system') } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(entry.out_of_context ? { outOfContext: true } : {}),
        ...(entry.image_stripped ? { imageStripped: true } : {}),
        ...(imagesPathOnly ? { imagesPathOnly: true } : {}),
        ...timestamp,
      });
      return;
    }
    if (entry.type === 'assistant') {
      const blocks = contentBlocks(message.content);
      if (!blocks.length) return;
      const rawUsage = object(message.usage);
      // 两种形状都要认：流式帧带的是桌面端归一化后的 `inputTokens…`（event-bridge.ts:100-110），
      // 快照里 `message` 是 Pi 原样消息、usage 仍是磁盘上的 `input/output/cacheRead/cacheWrite`
      // （session-service.ts:273-275 只归一化 content）。只认前者会让重开会话的元信息行恒为 0。
      const usage: DisplayUsage | undefined = Object.keys(rawUsage).length ? {
        inputTokens: Number(rawUsage.inputTokens ?? rawUsage.input ?? 0),
        outputTokens: Number(rawUsage.outputTokens ?? rawUsage.output ?? 0),
        cacheReadTokens: Number(rawUsage.cacheReadTokens ?? rawUsage.cacheRead ?? 0),
        cacheWriteTokens: Number(rawUsage.cacheWriteTokens ?? rawUsage.cacheWrite ?? 0),
      } : undefined;
      messages.push({
        id: entry.uuid, role: 'assistant', blocks, streaming: false,
        ...(usage ? { usage } : {}),
        // 回合终态与单条耗时：快照原样透传 Pi 的 stopReason / durationMs，回合分组与「用时」都靠它们
        ...(typeof message.stopReason === 'string' ? { stopReason: message.stopReason } : {}),
        ...(typeof message.durationMs === 'number' && Number.isFinite(message.durationMs) ? { durationMs: message.durationMs } : {}),
        ...timestamp,
      });
      return;
    }
    if (entry.type === 'toolResult') {
      const toolId = String(message.toolCallId ?? '');
      const rawContent = contentText(message.content);
      const details = object(message.details);
      const presentation = toolPresentation(rawContent, details, message.isError === true);
      // 剥掉权限信封那行：正文给用户看的是原因，不是 `[EASYMINT_PERMISSION]{...}` 这串内部标记
      const result = rawContent.startsWith(PERMISSION_MARKER) && presentation?.kind === 'permission_denied'
        ? rawContent.slice(rawContent.indexOf('\n') + 1) : rawContent;
      const nested = nestedCalls(message.nestedCalls);
      const imagePath = typeof details.generatedImagePath === 'string' ? details.generatedImagePath : undefined;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const target = messages[i];
        if (target?.role !== 'assistant') continue;
        const tool = target.blocks?.find((block) => block.kind === 'tool' && (!toolId || block.id === toolId));
        if (tool?.kind === 'tool') {
          tool.output = result;
          tool.state = message.isError ? 'error' : 'done';
          if (presentation) tool.presentation = presentation;
          if (nested) tool.nested = nested;
          if (typeof message.durationMs === 'number' && Number.isFinite(message.durationMs)) tool.durationMs = message.durationMs;
          if (imagePath) tool.imagePath = imagePath;
          break;
        }
      }
    }
  });
  return messages.reverse();
}

/** 快照生成期间漏过的实时帧按应用事件序号补齐；同一应用事件序号只保留先到的那一份。 */
export function snapshotMessagesWithBuffer(snapshot: SessionSnapshot, duringRequest: unknown[]): { messages: DisplayMessage[]; running: boolean } {
  const messages = snapshotMessages(snapshot);
  const cursor = snapshot.eventSequence ?? -1;
  // bufferedEvents 兜底成数组：对端老版本可能不带这个字段，直接展开 undefined 会抛 TypeError（整页白屏）。
  // 同函数里 eventSequence 已用 ?? -1 兜底，这里保持同等防护。
  const buffered = Array.isArray(snapshot.bufferedEvents) ? snapshot.bufferedEvents : [];
  const events = [
    ...(snapshot.status !== 'idle' && snapshot.status !== 'stopped' ? buffered : []),
    ...duringRequest.filter((value) => Number(object(value).eventSequence) > cursor),
  ].map(object).filter((event) => Number.isSafeInteger(event.eventSequence));
  events.sort((a, b) => Number(a.eventSequence) - Number(b.eventSequence));
  // 同一 eventSequence 只保留**先出现的那一份**：它代表同一个应用事件（缓冲与实时流各送了一次），内容相同；
  // 序号本身已决定新旧，不存在「同序号但更新」的帧。保留首份只是为了避免重复计算同一帧。
  const unique = events.filter((event, index) => index === 0 || event.eventSequence !== events[index - 1]?.eventSequence);
  const lastTurnStart = unique.findLastIndex((event) => event.type === 'turn_start');
  const currentTurn = lastTurnStart >= 0 ? unique.slice(lastTurnStart) : unique;
  const lastFrame = [...currentTurn].reverse().find((event) => (event.type === 'message' || event.type === 'message_start') && Array.isArray(event.blocks));
  const terminalIndex = currentTurn.findLastIndex((event) => event.type === 'turn_end' || event.type === 'error');
  const frameIndex = currentTurn.findLastIndex((event) => event === lastFrame);
  const ended = terminalIndex >= 0 && terminalIndex > frameIndex;
  const running = !ended && (snapshot.status !== 'idle' && snapshot.status !== 'stopped' || currentTurn.some((event) => event.type === 'turn_start'));
  if (lastFrame) {
    const blocks = contentBlocks(lastFrame.blocks);
    // 只与本轮提问之后已落盘的回答比较；更早回合恰好说了同一句话也应显示本轮气泡。
    const latestUserIndex = messages.findIndex((message) => message.role === 'user');
    const currentRunHistory = latestUserIndex < 0 ? messages : messages.slice(0, latestUserIndex);
    const alreadyInHistory = currentRunHistory.some((message) => message.role === 'assistant' && JSON.stringify(message.blocks) === JSON.stringify(blocks));
    if (blocks.length && !alreadyInHistory) {
      messages.unshift({ id: `stream-recovered-${String(lastFrame.chatId ?? 'run')}-${String(lastFrame.eventSequence)}`,
        role: 'assistant', blocks, streaming: running && lastFrame.partial !== false });
    }
  }
  return { messages, running };
}
