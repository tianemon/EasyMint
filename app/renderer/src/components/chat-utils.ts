import type { StreamEntry, TextEntry } from "./StreamPanel";

/** 附件项（图片或文档） */
export interface AttachItem {
  name: string;
  path: string;
  dataUrl?: string;
  kind: "image" | "doc";
}

export interface ChatMessage {
  id: number;
  role: "user" | "ai";
  /** 磁盘 uuid(若有):SubagentProcessView 用它做稳定 React key(重载不重复) */
  keyId?: string;
  /**
   * 该气泡对应的 Pi 会话条目 id(磁盘 uuid)——编辑/重新生成按它定位节点。
   * 历史气泡加载磁盘时即有;本轮新产生的气泡由 entry_appended 事件回填(见 ChatPanel)。
   * 两者都没有时留空:入口置灰并说明原因,不做猜测性撤回。
   */
  entryId?: string;
  text?: string;
  attaches?: AttachItem[];
  entries?: StreamEntry[];
  timestamp: number;
  /** 系统消息类型(customType: system_message)——按 details.kind 分支渲染 */
  customType?: string;
  details?: Record<string, unknown>;
  /** Pi 落盘时间戳(系统消息去重用:多 ChatPanel 实例重复 append 时幂等) */
  sysTs?: number;
  /** Pi 落盘时间戳——实时渲染按此有序插入,保证 UI 顺序 = jsonl 落盘顺序(广播顺序 ≠ 落盘顺序) */
  piTs?: number;
  /** 回合完整后的 usage（message_end 携带）——气泡下方显示 token 与缓存命中率 */
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  /** 流式标记:实时渲染临时消息(重载/加载磁盘时被替代或合并) */
  streaming?: boolean;
  /** 已退出上下文:撤回（编辑重发 / 重新生成）后本地列表不裁剪，这条气泡的条目已不在当前分支上——
   *  界面据此显式标出（重开会话后它随磁盘分支一起消失，标记只活在本面板内）。
   *  气泡重新拿到内容（流式写入 / 编辑重发）时清掉：那一刻它又回到上下文里。 */
  outOfContext?: boolean;
  /** 群聊消息的 Agent 角色(群聊视图标注来源;无 = 普通会话) */
  agentRole?: string;
  /** 群聊转发消息标记(该回合由其他 Agent 转发触发,显示来源标签) */
  forwarded?: boolean;
  /** 群聊转发来源 Agent 角色(转发标记下显示 [A → B]) */
  forwardedFrom?: string;
}

/** Pi 事件中的 blocks → StreamEntry 格式（兼容现有渲染） */
export function piBlocksToEntries(blocks: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; content?: unknown; thinking?: string }>): StreamEntry[] {
  const ts = Date.now();
  const result: StreamEntry[] = [];
  for (const b of blocks) {
    if (b.type === "text" && b.text) {
      result.push({ kind: "text", text: b.text, timestamp: ts });
    } else if (b.type === "thinking" && (b.thinking || b.text)) {
      result.push({ kind: "thinking", text: (b.thinking || b.text)!, timestamp: ts });
    } else if (b.type === "tool_use") {
      result.push({ kind: "tool_use", id: b.id || "", name: b.name || "?", input: b.input || {}, timestamp: ts, collapsed: false, source: "chat" });
    } else if (b.type === "tool_result") {
      result.push({ kind: "tool_result", toolUseId: b.id || "", name: (b as { name?: string }).name, content: String(b.content ?? ""), isError: false, timestamp: ts, source: "chat" });
    }
  }
  return result;
}

/** 合并连续 text entry（Pi 偶发拆成多 block） */
export function mergeConsecutiveText(entries: StreamEntry[]): StreamEntry[] {
  const result: StreamEntry[] = [];
  for (const e of entries) {
    if (e.kind === "text" && result.length > 0 && result[result.length - 1]!.kind === "text") {
      const last = result[result.length - 1] as TextEntry;
      last.text = (last.text || "") + (e.text || "");
    } else {
      result.push({ ...e });
    }
  }
  return result;
}

/** PiChatEvent → StreamEntry[] */
export function piEventToEntries(ev: { type: string; blocks?: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> }> }): StreamEntry[] {
  if (ev.type === "message" && Array.isArray(ev.blocks)) {
    return piBlocksToEntries(ev.blocks);
  }
  return [];
}


/**
 * 工具名 → 状态栏精简动作文案（只显示「在做什么」,不显示具体文件名/命令/URL——
 * 状态栏是实时提示,用户只需知道动作类别;细节在消息内工具卡可见）。
 * 统一带「正在」前缀(与「正在思考/正在处理」等状态文案风格一致)。
 * 详细版工具标签在 ChatBlocks 的 TOOL_LABELS（弹层/卡片用），本函数只服务状态栏。
 */
export function displayToolAction(name: string, args?: Record<string, unknown>): string {
  const n = name.toLowerCase();
  if (n === "use_skill" || n.startsWith("skill__") || args?.skill) return "正在加载技能";
  if (n === "learn") return "正在沉淀经验";
  if (n === "manage_skill") return "正在管理技能";
  if (n === "search_experiences") return "正在搜索经验库";
  if (n === "retire_experiences") return "正在退役经验";
  if (n.startsWith("mcp__")) return "正在调用外部工具";
  if (n === "read" || n === "glob") return "正在读取文件";
  if (n === "write") return "正在写入文件";
  if (n === "edit") return "正在编辑文件";
  if (n === "grep") return "正在搜索内容";
  if (n === "bash") return "正在执行命令";
  if (n === "task") return "正在派遣 Agent";
  if (n === "webfetch") return "正在获取网页";
  if (n === "websearch") return "正在联网搜索";
  return "正在处理";
}

/** 解析消息文本中的附件标记 [Image #1: path] / [File #1: path] */
function parseAttachMarkers(text: string): { attaches: AttachItem[]; cleanText: string } {
  const attaches: AttachItem[] = [];
  const re = /\[(Image|File)\s+#(\d+):\s*([^\]]+)\]/g;
  let clean = text;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1] === "Image" ? "image" : "doc";
    const p = m[3]!;
    attaches.push({ kind, name: p.split("/").pop() || p, path: p, dataUrl: kind === "image" ? "" : undefined });
    clean = clean.replace(m[0], "");
  }
  return { attaches, cleanText: clean.trim() };
}

/** 历史会话消息（conv.messages）→ ChatMessage[] */
export function mapSessionMessages(msgs: Array<{ type: string; message: unknown }>): ChatMessage[] {
  let nextId = 0;
  const mapped: ChatMessage[] = [];
  for (const m of msgs) {
    // 磁盘消息对象时间字段是 timestamp(毫秒),无 created_at(磁盘实证)
    const ts = (m.message as { timestamp?: number })?.timestamp ?? Date.now();
    // Pi entry id 是 uuidv7 后 8 位(仅实例内查重,跨实例可能碰撞)→ keyId 在 push 时用 ++nextId 序号,
    // 与 id 完全同步,保证 keyId 唯一(即使 uuid 碰撞,序号也区分)
    const uuid = (m as { uuid?: string }).uuid;
    if (m.type === "user") {
      const content = (m.message as { content?: string | unknown[] })?.content;
      const text = typeof content === "string" ? content : Array.isArray(content)
        ? content.map((b: unknown) => (b as { text?: string })?.text ?? "").join("")
        : "";
      if (text) {
        const { attaches, cleanText } = parseAttachMarkers(text);
        const msgObj = m.message as { customType?: string; details?: Record<string, unknown> };
        const id = ++nextId;
        mapped.push({
          id, role: "user", text: cleanText, keyId: uuid ? `d-${uuid}-${id}` : undefined, entryId: uuid,
          attaches: attaches.length > 0 ? attaches : undefined, timestamp: ts,
          // 系统消息结构身份(custom_message 条目):前端按 customType/kind 渲染
          customType: msgObj.customType, details: msgObj.details,
        });
      }
    } else if (m.type === "assistant") {
      const content = (m.message as { content?: unknown[] })?.content;
      if (Array.isArray(content)) {
        const entries: StreamEntry[] = [];
        for (const block of content) {
          const b = block as { type?: string; text?: string; thinking?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };
          if (b.type === "text" && b.text) {
            entries.push({ kind: "text", text: b.text, timestamp: ts });
          } else if (b.type === "thinking" && b.thinking) {
            entries.push({ kind: "thinking", text: b.thinking, timestamp: ts });
          } else if (b.type === "tool_use") {
            // 主进程出口已统一归一化(toolCall→tool_use、arguments→input),这里只认一种格式
            entries.push({ kind: "tool_use", id: (b as { id?: string }).id || "", name: b.name || "?", input: b.input || {}, timestamp: ts, collapsed: false, source: "chat" });
          } else if (b.type === "tool_result") {
            entries.push({ kind: "tool_result", toolUseId: b.tool_use_id || "", name: (b as { name?: string }).name, content: String(b.content ?? ""), isError: !!b.is_error, timestamp: ts, source: "chat" });
          }
        }
        if (entries.length === 0) continue;
        // 每条 assistant 消息独立成气泡——对齐 SDK 落盘粒度(相邻消息不合并,与实时渲染一致)
        const id = ++nextId;
        // 磁盘消息携带 Pi 归一化 usage（input 未缓存输入/cacheRead 缓存读）——历史会话也显示 token 行（显示层持久化）
        const u = (m.message as { usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }).usage;
        mapped.push({
          id, role: "ai", entries, timestamp: ts, keyId: uuid ? `d-${uuid}-${id}` : undefined, entryId: uuid,
          usage: u ? { inputTokens: u.input ?? 0, outputTokens: u.output ?? 0, cacheReadTokens: u.cacheRead ?? 0, cacheWriteTokens: u.cacheWrite ?? 0 } : undefined,
        });
      }
    } else if (m.type === "toolResult") {
      // 独立 toolResult 消息(磁盘):按 toolCallId 关联到 AI 消息的 tool_use;无匹配则追加到最近 AI 消息(独立结果)
      const tm = m.message as { toolCallId?: string; toolName?: string; content?: unknown; isError?: boolean };
      const content = Array.isArray(tm.content)
        ? tm.content.map((b: unknown) => (b as { text?: string })?.text ?? "").join("")
        : String(tm.content ?? "");
      const resultEntry: StreamEntry = {
        kind: "tool_result", toolUseId: tm.toolCallId || "", name: tm.toolName, content, isError: !!tm.isError, timestamp: ts, source: "chat",
      };
      // 先找含匹配 tool_use 的 AI 消息;无匹配则追加到最近 AI 消息
      let matched = false;
      for (let i = mapped.length - 1; i >= 0; i--) {
        const msg = mapped[i]!;
        if (msg.role !== "ai" || !msg.entries) continue;
        const hasMatch = msg.entries.some((e) => e.kind === "tool_use" && e.id === tm.toolCallId);
        if (hasMatch) {
          msg.entries!.push(resultEntry);
          matched = true;
          break;
        }
      }
      if (!matched) {
        // 无匹配:追加到最近 AI 消息(独立显示),没有 AI 消息则新建
        for (let i = mapped.length - 1; i >= 0; i--) {
          const msg = mapped[i]!;
          if (msg.role === "ai" && msg.entries) {
            msg.entries.push(resultEntry);
            matched = true;
            break;
          }
        }
        if (!matched) {
          const id = ++nextId;
          mapped.push({ id, role: "ai", entries: [resultEntry], timestamp: ts, keyId: uuid ? `d-${uuid}-${id}` : undefined, entryId: uuid });
        }
      }
    }
  }
  return mapped;
}

/** 本窗口发出去、还在等条目 id 回填的用户气泡（发送顺序 = 条目落盘顺序） */
export interface PendingUserBubble {
  /** 气泡 id（useChatStore 里的消息 id） */
  id: number;
  /** 入队时刻（本地点击时间）——超时清理与时间窗判定都用它 */
  ts: number;
}

/** 入队后超过这个时长还没等到自己的条目 id 就丢弃。纯内存清理：该气泡永久留空（降级），不影响别人。 */
export const PENDING_BUBBLE_TTL_MS = 10 * 60_000;

/**
 * 认领时，条目时间戳与气泡入队时刻允许的最大差值。
 *
 * 两者同源同量级但不等：气泡时间戳是点击时刻，条目时间戳由 SDK 收到 prompt 时生成
 * （差一个 IPC + 预处理/建会话抖动，正常 < 1s）。而「自己那次发送的事件被门卫丢掉 / 认不出」
 * 的陈旧气泡，与后来的事件差着整轮对话的时间。这个窗口就是把两者分开：
 * 宁可让陈旧气泡留空（入口置灰降级），也绝不把新条目的 id 写到旧气泡上——
 * 认错气泡 = 编辑/重新生成撤回到错误节点。
 */
export const CLAIM_WINDOW_MS = 15_000;

/**
 * entry_appended 事件 → 承接这个条目 id 的气泡（气泡 ↔ 会话条目 id 贯通的认领规则）。
 *
 * 两条路径：
 * - assistant：气泡的 `piTs` 与落盘消息时间戳同源（message_end 帧携带的就是该消息对象的时间戳）
 *   → 按时间戳精确匹配；同一毫秒可能有多条条目（时间戳相同），取最近一条并记日志。
 * - user：本地气泡的时间戳是点击时刻，与 SDK 生成、落盘的时间戳不等 → 无法按时间戳精确匹配，
 *   改按本窗口的发送队列认领（本窗口每次发送必然先建/复用一个气泡，发送顺序 = 落盘顺序）。
 *   候选集 =「队列里的气泡」∩「未认领的 user 气泡」——**只有本窗口发出去的气泡才有资格**：
 *   系统通知（custom_event）与其它终端（手机/另一窗口）的 user_message 插入的气泡不在队列里，
 *   抢不走 id（此前按「最近一条未认领气泡」找，会被它们顶掉，本窗口那条永远拿不到 id）。
 *   时间戳只用来排除陈旧项（见 CLAIM_WINDOW_MS），不参与精确定位。
 *
 * 认不出就返回 undefined（旧数据 / 事件丢失 / 其它终端发的消息）：留空降级，由编辑入口置灰，
 * **不猜**——认错气泡会让编辑/重新生成撤回到错误的节点。**未命中不消费队列**（否则那条真事件
 * 回来时已经没有可配对的气泡了），只清理已死项（气泡已不在 / 已有 id / 超时）。
 */
export function claimEntryBubble(
  msgs: ChatMessage[],
  ev: { entryRole?: string; entryId?: string; timestamp?: number },
  pending: PendingUserBubble[],
  now: number = Date.now(),
): ChatMessage | undefined {
  if (!ev.entryId) return undefined;
  if (ev.entryRole === "assistant") {
    const hits = msgs.filter((m) => m.role === "ai" && m.piTs === ev.timestamp && !m.entryId);
    if (hits.length > 1) console.warn(`[chat] entry_appended 同一时间戳 ${ev.timestamp} 匹配到 ${hits.length} 条 ai 气泡，取最近一条`);
    return hits[hits.length - 1];
  }
  if (ev.entryRole !== "user") return undefined;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (now - pending[i]!.ts > PENDING_BUBBLE_TTL_MS) pending.splice(i, 1);
  }
  // 取「最早那次发送」且还活着的气泡（落盘顺序 = 发送顺序，最早的那条最可能是本条事件的主人）
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i]!;
    const bubble = msgs.find((m) => m.id === p.id);
    // 气泡已不在（会话切换/重载）或已从别的途径拿到 id（磁盘重载）→ 这一项出局，不要挡在队首
    if (!bubble || bubble.role !== "user" || bubble.entryId) { pending.splice(i, 1); i--; continue; }
    // 时间戳差出窗口 = 这条事件不是它的（早得多的陈旧项，或时钟异常的异常项）→ 跳过它看下一条，
    // 不认领也不消费：它自己那条事件若还会来，仍能配对
    if (ev.timestamp != null && Math.abs(ev.timestamp - p.ts) > CLAIM_WINDOW_MS) {
      console.warn(`[chat] entry_appended: 气泡 #${p.id} 入队时刻与条目时间戳差 ${Math.abs(ev.timestamp - p.ts)}ms（> ${CLAIM_WINDOW_MS}ms），不是它的条目 → 跳过（该气泡若一直等不到自己的事件则永久留空）`);
      continue;
    }
    pending.splice(i, 1);
    return bubble;
  }
  return undefined;
}

/**
 * 编辑某条用户消息前是否需要确认「这条之后的对话会重来」。
 *
 * 编辑=级联撤回（见 ChatPanel.handleEditSubmit）：目标之后的**全部**内容都退出上下文且不可恢复，
 * 所以之后还有内容时先确认；它就是最后一条时没有可丢的东西，多一次确认只是噪音。
 * 判据只看它在当前消息列表里的位置——之后任何一条**还在上下文里**的消息（Mint 回答、系统通知卡片）
 * 都会被撤回；已退出上下文的旧气泡（outOfContext，撤回后留在列表里那种）不算——它们早就不在上下文里了，
 * 拿它们当「会被丢掉的内容」只会让第二次编辑多弹一次确认。
 * 重新生成（ChatPanel.handleRegenerate）用同一条判据，锚点是那条回答：撤回点是它的提问，
 * 回答之后还有内容时同样会被一并丢掉。
 */
export function needsEditConfirm(msgs: ChatMessage[], msgId: number): boolean {
  const idx = msgs.findIndex((m) => m.id === msgId);
  return idx >= 0 && msgs.some((m, i) => i > idx && !m.outOfContext);
}

/**
 * 撤回类入口（编辑消息 / 重新生成回答）不可用的原因（undefined = 可用）。
 *
 * 两个前提都是撤回能力本身的硬约束：回合进行中 SDK 拒绝撤回；气泡没认领到条目 id 就定位不出撤回目标
 * （见 claimEntryBubble）。**永久性原因排在前面**——先报「拿不到 id」再报「回合进行中」，
 * 否则用户等回合结束会发现入口仍是灰的。
 */
export function rewindUnavailableReason(msg: ChatMessage, busy: boolean, action: "修改" | "重新生成"): string | undefined {
  // 文案只陈述事实、不归因：没 id 的两种成因（还没认领到条目 / 被撤回后清掉了）用户分不出来，
  // 写成「无法定位到会话记录」会让人以为出了故障（实测里它其实常常是主动清掉的那种）
  if (!msg.entryId) return `这条消息不在会话记录中，暂不支持${action}`;
  if (busy) return `本轮回复进行中，结束后可${action}`;
  return undefined;
}

/** 消息可复制全文：user 取 text，ai 取全部 text entries 合并 */
export function getMsgCopyText(msg: ChatMessage): string {
  if (msg.role === "user") return msg.text || "";
  if (!msg.entries) return "";
  return msg.entries.filter((e) => e.kind === "text").map((e) => e.text).join("\n");
}

/**
 * 流式贴底跟随的统一判定（子 Agent 输出窗、思考块内滚动区共用）——**对齐聊天页 ChatPanel 的滚动状态机**。
 *
 * 规则只有一条：**用户输入（滚轮/触摸/按下）后 500ms 内的 scroll 变化才算用户滚动意图**，
 * 其余（程序性贴底、内容变高引起的滚动、夹紧）一律不参与判定 —— 因此不需要任何
 * 「保护窗口」，也不会把自己的滚动误判成「用户滚离底部」而把跟随锁死。
 *
 * 反例（踩过）：曾额外加过「本组件贴底后 120ms 内的 scroll 不参与判定」。流式输出时
 * 每帧都在贴底，这道窗口几乎永远命中 → **用户自己的滚动也被吞掉** → 跟随关不掉，
 * 表现为「强制锁底、往上滚不动」。聊天页没有这道守卫，所以能贴底也能自由滚。
 *
 * @returns true=恢复跟随 / false=停止跟随 / undefined=不改变当前状态
 */
export const USER_INPUT_WINDOW_MS = 500;
export const AT_BOTTOM_PX = 8;

export function followDecision(input: {
  /** 距容器底部的距离（scrollHeight - scrollTop - clientHeight） */
  distFromBottom: number;
  /** 距最近一次用户输入（滚轮/触摸/按下）的毫秒数 */
  msSinceUserInput: number;
}): boolean | undefined {
  if (input.msSinceUserInput > USER_INPUT_WINDOW_MS) return undefined;
  return input.distFromBottom < AT_BOTTOM_PX;
}

/** 流事件门卫：这个事件是否属于本面板的会话。
 *
 * 值必须传**实时值**（`currentChatRef.current` / 会话 id 的实时镜像），不能传订阅时的闭包变量——
 * ChatPanel 的 onStream 订阅 effect 依赖数组是 `[]`（只订阅一次），闭包里捕获的 props 会永久停在
 * 首次渲染：新建项目流程里消息是弹窗发的，本面板没有 sendMessage 结果可绑 currentChatRef，
 * 若门卫读的是首次渲染时的 `existingSid`（undefined），属于它的流事件会被全部丢弃 → 聊天区永久空白。
 */
export function acceptStreamEvent(input: {
  /** 本面板已绑定的 chatId（流事件带 chatId/runId，绑上后按它精确过滤） */
  currentChatId: string | null;
  /** 本面板绑定的会话 id（实时值；临时 `__new_*`/未绑定时为 undefined） */
  ownSessionId: string | undefined;
  eventRunId?: string;
  eventChatId?: string;
  eventSessionId?: string;
}): boolean {
  const { currentChatId, ownSessionId, eventRunId, eventChatId, eventSessionId } = input;
  if (currentChatId) {
    // 已绑定 chat → 无归属信息的裸事件一律丢（防跨窗口污染）
    if (!eventRunId && !eventChatId) return false;
    if (eventRunId && eventRunId !== currentChatId) return false;
    if (eventChatId && eventChatId !== currentChatId) return false;
    return true;
  }
  // 未绑定 chat → 只能按会话 id 认领；会话也未知时拒绝一切（宁可丢也不跨窗口串流）
  if (ownSessionId) return !!eventSessionId && eventSessionId === ownSessionId;
  return false;
}
