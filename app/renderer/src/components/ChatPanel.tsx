import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildBlocks, ChatBlockView } from "./ChatBlocks";
import { AttachItem, ChatMessage, PendingUserBubble, piBlocksToEntries, mergeConsecutiveText, piEventToEntries, displayToolAction, mapSessionMessages, getMsgCopyText, acceptStreamEvent, claimEntryBubble, needsEditConfirm, rewindUnavailableReason, contextEditAction, retryStatusText, BUSY_PROBE_INTERVAL_MS, BUSY_PROBE_CLEAR_STREAK, stepBusyProbe, stopTarget, needsDeferredStop, shouldSteerSend, resolveSendSessionId } from "./chat-utils";
import { confirmDialog } from "./ui/ConfirmDialog";
import { chatActions } from "../stores/chat-actions";
import { confirmFullAccess } from "./permission-confirmation";
import { resolveThinkingLevel } from "@shared/thinking-levels";
import { sessionOverrides } from "@shared/session-resume-policy";
import { useSettingsStore } from "../stores/settings-store";
import { useTabStore } from "../stores/tab-store";
import { useChatStore, type FlowErrorCard } from "../stores/chat-store";
import { CONFIRM_DEVELOPMENT_PROMPT } from "../../../shared/prompts";
import { MARKDOWN_PROSE_CLASS, renderMarkdownToHtml } from "../lib/markdown";

import { useStatusStore } from "../stores/status-store";
import { StatusBar } from "./StatusBar";
import { useDelegationStore } from "../stores/delegation-store";
import { classifyApiError, type ErrorTone } from "../../../shared/api-errors";
import { ChatInput, AttachPreview, type PermissionMode } from "./ChatInput";
import { TodoStrip } from "./TodoStrip";
import { DroppedSteerNotice } from "./DroppedSteerNotice";
import { SessionStatsPopup } from "./SessionStatsPopup";
import { CompactionDialog } from "./CompactionDialog";
import { getWorkspaceDir } from "../lib/getWorkspaceDir";
import { blocksToMarkdown, selectionToBlocks } from "../lib/selection-to-markdown";
import { PinLayer } from "./PinLayer";
import { usePinStore } from "../stores/pin-store";
import { useViewerStore } from "../stores/viewer-store";
import { DelegationProgress, type DelegationUiState, type DelegationTaskUi } from "./DelegationProgress";
import { ContextMenu, type ContextMenuData, type ContextMenuItem } from "./ContextMenu";
import { QuestionHistory } from "./QuestionHistory";
import { BubbleActions, roleColor, DocIcon } from "./ChatBubbleActions";
import { AskUserCard } from "./AskUserCard";
import { useAskStore } from "../stores/ask-store";
import { MintAvatar } from "./MintAvatar";
import { UserMessageText } from "./UserMessageText";
import { ImageRecoveryDialog } from "./ImageRecoveryDialog";
import { IMAGE_PARTIAL_PATH_NOTE, IMAGE_PATH_ONLY_NOTE, encodeAttachedImages, pendingImageBase64Bytes, type ContextImageEntry } from "@shared/image-context";


interface ChatPanelProps {
  projectPath: string;
  sessionId?: string;
  /** 设计会话标记(tab 直传,避免多新 tab 反查错配导致用错 Mint-D/Mint 模板) */
  isDesigner?: boolean;
  /** 所在 tab id(sendMessage 透传,onChatSession 回绑时精确锚定,防发送中切 tab/关 tab 错配) */
  tabId?: string;
  onSessionCreated?: (sessionId: string) => void;
  onActivity?: () => void;
}

/** 命令实时输出累积上限(超出保留尾部):巨型字符串会拖慢渲染,完整输出仍在模型上下文与日志 */
const MAX_LIVE_OUTPUT_CHARS = 50_000;

/** 打断丢弃插话的提示停留时长——足够读完条数与内容，又不至于赖在输入卡上方不走 */
const DROPPED_NOTICE_MS = 10_000;

/** 气泡级动作（都会改模型上下文，失败出口共用一份）：用户看到的动作名 = 日志与错误卡片标题用词 */
type MsgAction = "修改" | "重新生成" | "移出上下文" | "恢复进上下文";

/** 各动作失败时告诉用户「这一步没生效」的后果——不写的话失败卡只有一句错误，用户得自己猜上下文变了没有 */
const MSG_ACTION_HINTS: Record<MsgAction, string> = {
  修改: "这条消息仍在上下文里，未发送新内容。",
  重新生成: "这条回答仍在上下文里，未生成新内容。",
  移出上下文: "这条消息仍在上下文里，未做改动。",
  恢复进上下文: "这条消息仍未回到上下文里。",
};

/** 系统消息 kind → 头部标签(系统卡片统一形态的辨识信息) */
const SYSTEM_KIND_LABELS: Record<string, string> = {
  delegation: "SubAgent",
  shell: "后台命令",
  "project-created": "项目初始化",
  "direct-create": "直接创建",
  flow: "流程指令",
  handoff: "会话交接",
  summary: "上下文摘要",
  learn: "经验沉淀",
};

/** 指令型系统消息（给 Mint 的行为指令，用户无需阅读正文）——默认折叠成标签条，点击展开 */
const COLLAPSIBLE_SYSTEM_KINDS = new Set(["project-created", "direct-create", "flow", "summary", "learn"]);

/** 结果卡（委派/后台命令）正文展开时的限高：约 6 行，超出内部滚动。
 *  与摘要卡同口径（lh 随行高/字号变化自动跟随）。原来写死 calc(var(--text-detail) * 9.75 + 12px)：
 *  既按 13px 算（行文字实际是 14px 的 --text-body），又把行高 1.55 与行内边距 4px 焊进常量，
 *  改行高或字号时 cap 不跟着变、封顶行数静默漂移（失效模式见 UserMessageText 注释），
 *  且 138.75px ≈ 6.4 行——滚动边界会切出半行。
 *  ⚠ 带 ⏺ 的结果行自带 py-0.5（比纯文本行高 4px），同一 cap 下这类行少显约一行；
 *  要精确封 6 行得再加 6×4px 余量，那就把内边距又焊回常量，故意不做。 */
const RESULT_BODY_MAX_HEIGHT = "calc(6lh + 0.5px)";

/** 摘要卡正文展开时的限高：约 16 行，超出内部滚动（与「委派结果」卡同一思路）。
 *  实测一份压缩摘要 7000 字上下，不限高展开会把消息流抻得极长。
 *  用 lh 单位而非写死倍数——lh 解析的是**本元素自己**的 line-height，所以容器必须带上与
 *  正文同值的 leading（prose 是 1.625），否则算出来的是容器的行高而不是正文的行数。 */
const SUMMARY_BODY_MAX_HEIGHT = "calc(16lh + 0.5px)";

/** 摘要卡正文：内容本身就是 markdown（SDK 生成的 ## 段结构），按正文那套渲染而不是纯文本行。
 *  对象 memo 的原因同 ChatBlocks 的 MarkdownHtml——dangerouslySetInnerHTML 比的是对象身份。 */
const SystemMarkdown = memo(function SystemMarkdown({ content }: { content: string }): JSX.Element {
  const html = useMemo(() => renderMarkdownToHtml(content), [content]);
  const inner = useMemo(() => ({ __html: html }), [html]);
  return <div className={MARKDOWN_PROSE_CLASS} dangerouslySetInnerHTML={inner} />;
});

/** 档位 → 语义色。类名必须是完整字面量(Tailwind 扫描不到拼接类名)。 */
const ERROR_TONE_STYLE: Record<ErrorTone, { border: string; icon: string }> = {
  warn: { border: "border-warning-border", icon: "text-warning" },
  error: { border: "border-danger-border", icon: "text-danger" },
};

/** 消息流内持久错误卡片(3.5):中性底 + 语义色描边与图标 + 重试(可重试时)/关闭。
 *  底色不带语义色、按钮不给语义色——整块红底与红按钮是「扎眼」的来源;错误条保留
 *  danger 描边是 UI 元素库的既有约定(语义辨识),故只收掉底色与按钮两处。
 *  悬停显完整文案(长错误信息不撑破气泡)。 */
function FlowErrorCardView({ card, onRetry, onRecoverImages, onDismiss }: {
  card: FlowErrorCard;
  onRetry: (c: FlowErrorCard) => void;
  onRecoverImages: (c: FlowErrorCard) => void;
  onDismiss: (c: FlowErrorCard) => void;
}): JSX.Element {
  const retryable = card.sourceMsgId != null && card.errorKind !== "request_too_large";
  const tone = ERROR_TONE_STYLE[card.tone ?? "error"];
  return (
    <div
      className={`flex items-start gap-2 rounded-[var(--radius-lg)] border ${tone.border} bg-surface-elevated px-3 py-1.5 w-fit max-w-full`}
      title={card.hint ? `${card.message}\n${card.hint}` : card.message}
    >
      {/* 警示三角(三角形路径,16 网格) */}
      <svg className={`mt-[2px] shrink-0 ${tone.icon}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="break-words text-text-primary leading-[1.55]" style={{ fontSize: "var(--text-detail)" }}>{card.message}</div>
        {card.hint && (
          <div className="break-words text-text-muted leading-[1.55]" style={{ fontSize: "var(--text-detail)" }}>{card.hint}</div>
        )}
      </div>
      {retryable && (
        <button
          type="button"
          onClick={() => onRetry(card)}
          className="shrink-0 rounded-[var(--radius-lg)] px-2 py-0.5 font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors cursor-pointer"
          style={{ fontSize: "var(--text-detail)" }}
        >重试</button>
      )}
      {card.errorKind === "request_too_large" && card.sourceMsgId != null && (
        <button type="button" onClick={() => onRecoverImages(card)} className="shrink-0 rounded-[var(--radius-lg)] px-2 py-0.5 font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors cursor-pointer" style={{ fontSize: "var(--text-detail)" }}>整理图片</button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(card)}
        title="关闭"
        aria-label="关闭错误提示"
        className="shrink-0 p-0.5 rounded-[var(--radius-lg)] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors cursor-pointer"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 3l10 10M13 3L3 13" />
        </svg>
      </button>
    </div>
  );
}


/** token 数格式化（显示用：1.2k / 3.4M） */
function fmtTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

/** 压缩弹窗「写交接提示词」:让 Mint 总结当前会话,输出可复制的交接内容(不压缩) */
const HANDOFF_PROMPT = "请总结当前会话的全部内容，并写一份交接提示词（包含项目状态、已完成的工作、当前进度、遇到的问题、下一步计划），以便在新会话中继续工作。请直接输出交接提示词内容，用中文。";

export function ChatPanel({ projectPath, sessionId: existingSid, tabId, isDesigner, onSessionCreated, onActivity }: ChatPanelProps): JSX.Element {
  const tempSidRef = useRef<string | null>(null);
  if (!existingSid && !tempSidRef.current) tempSidRef.current = `__new_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const initialSid = existingSid ?? tempSidRef.current!;
  const [sid, setSid] = useState<string>(initialSid);
  const emptyArr = useRef<ChatMessage[]>([]);
  const rawMsgs = useChatStore((s) => s.messagesBySession[sid]);
  const messages: ChatMessage[] = rawMsgs || (emptyArr.current as ChatMessage[]);
  // 持久错误卡片(3.5):按锚定消息 id 分组,渲染在对应消息行下方
  const emptyErrorsRef = useRef<FlowErrorCard[]>([]);
  const sessionErrors = useChatStore((s) => s.errorsBySession[sid]) || emptyErrorsRef.current;
  const [imageRecovery, setImageRecovery] = useState<({ mode: "retry"; card: FlowErrorCard; candidates: ContextImageEntry[]; currentImageCount: number } | { mode: "manage"; candidates: ContextImageEntry[] }) | null>(null);
  const [contextImageBytes, setContextImageBytes] = useState(0);
  const [contextImageWarnAt, setContextImageWarnAt] = useState(32 * 1024 * 1024);
  const errorsByAnchor = useMemo(() => {
    const m = new Map<number, FlowErrorCard[]>();
    for (const c of sessionErrors) {
      const arr = m.get(c.anchorMsgId);
      if (arr) arr.push(c);
      else m.set(c.anchorMsgId, [c]);
    }
    return m;
  }, [sessionErrors]);

  const [_currentRunId, setCurrentRunId] = useState<string | null>(null);
  const currentChatRef = useRef<string | null>(null);
  // sendMessage IPC 尚未返回 chatId 时，停止动作先记在这次发送上；拿到 id 后立即补发 abort。
  // 复用旧提问气泡的发送（编辑/重新生成/重试）打断时保留提问，不走普通新消息的无输出撤回。
  const pendingSendRef = useRef<{ preservePromptOnStop: boolean; sourceMsgId?: number; stopRequested: boolean; abortIssued: boolean; awaitingChatId: boolean; resolvedSessionId?: string; stopSid?: string; stopVersion?: number; ready: Promise<void>; resolveReady: () => void } | null>(null);
  const stoppedRef = useRef(false);
  const busyRef = useRef(false);
  // 打断时间戳:打断后 1.5s 内的 agent:exit 是旧回合残留(abort 触发),
  // 忽略不清 busy——打断瞬间后台通知开的新回合(turn_start 已设 busy)不被误清
  const interruptAtRef = useRef(0);
  // 被打断的回合是否还没退场（exit 未到）：未退场时到达的 turn_start 一律是它的残留——
  // 不能让界面被打回 busy（SDK 在回合内每个工具批次/续跑都会 emit turn_start）
  const abortedRunPendingRef = useRef(false);
  // 会话消息加载中(打开已有会话的磁盘读取+解析耗时):显示加载提示,避免空态跳变
  const [sessionLoading, setSessionLoading] = useState(false);
  // 缓存恢复的使用率暂存:消息加载完成后再应用(避免加载期间输入卡片显示旧进度误导)
  const pendingCtxRef = useRef<number | null>(null);
  // 回合级错误时间戳:error 后 1s 内残留事件不重新设 busy(错误回合已结束)
  const lastErrorAtRef = useRef(0);
  const ctxThresholdFiredRef = useRef(0); // 已按阈值触发过主动压缩（防止同轮重复触发）
  // 压缩弹窗「下次回复完触发」:回复结束(agent:exit)后重置阈值防重 → 重新弹窗走同样流程
  const rearmAfterExitRef = useRef(false);
  // 待执行的压缩（回合中点了压缩——SDK 压缩需空闲，等 agent:exit 回合结束后执行）
  const pendingCompactRef = useRef<{ instructions?: string } | null>(null);
  // 手动压缩标记(context-summarizing type=compact 已广播):compacting 事件据此区分
  // 手动压缩 vs SDK 自动压缩(阈值/溢出)——自动压缩时给用户原因提示
  const manualCompactingRef = useRef(false);
  // 当前输出段块(assistant 消息)id:Pi 每条输出段消息有独立 message_start/update/end
  // 生命周期(磁盘逐条落盘);块 piTs = 消息对象创建时间戳,通知按 ts 插到块之间
  // → UI 顺序 = jsonl 顺序(不依赖广播到达顺序)
  // 新消息气泡:用户滚离底部时显示(常驻)——busy 中=圆圈箭头图标;输出结束=「新消息」胶囊带箭头;
  // 点击回底或手动滚回底部消失
  const [showNewMsg, setShowNewMsg] = useState(false); // 输出结束且不在底部的"新消息"状态
  const showNewMsgRef = useRef(false); // 与 state 同步(handleScroll 空依赖闭包读 ref)
  // 提问记录跳转高亮:跳转后给目标消息临时 tint 1.5s 渐隐
  const [highlightMsgId, setHighlightMsgId] = useState<number | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false); // 用户是否离开底部(渲染驱动)
  const awayFromBottomRef = useRef(false); // 跨阈值去重(滚动高频时只在边界变化时 setState)

  const imgInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [attaches, setAttaches] = useState<AttachItem[]>([]);
  const pendingImageBytes = useMemo(() => attaches.reduce((total, attachment) => total + pendingImageBase64Bytes(attachment.dataUrl), 0), [attaches]);
  // 点附件缩略图看原图：与聊天文件链接、文件树图片共用同一个查看器（状态在 viewer-store，查看器挂在 ProjectPage）
  const openViewer = useCallback((src: string, name: string) => useViewerStore.getState().openImage(src, name), []);
  // 权限模式:新会话默认取全局持久化值(输入条切换即更新全局——用户不需要每次重选);
  // 只读一次作初始值,不订阅全局变化(会话内以手动切换为准)
  const globalPermissionMode = useSettingsStore((s) => s.chatPermissionMode);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(globalPermissionMode || "standard");
  // 权限模式「已恢复」标记：读会话缓存是异步的，而初始值来自异步加载的全局设置——
  // 两者都未就绪时初始值会落到 fallback "standard"，若不拦一道，写缓存 effect 会把这个
  // 未就绪的值覆盖到磁盘（磁盘上的 full 被抹掉，重启后永远回 standard）
  const permissionHydratedRef = useRef(false);
  const sessionHydrationRef = useRef<Promise<void>>(Promise.resolve());
  // 本会话是否有独立的持久化权限值（来自缓存恢复）——有则不跟随全局默认：
  // 新建会话无缓存，首帧读到的全局值可能还是 store 默认 standard，等真实值到达再同步
  const sessionPermissionOwnedRef = useRef(false);
  // 权限模式最新值（订阅回调里引用 state 会拿到挂载时的旧闭包，用 ref 取最新）
  const permissionModeRef = useRef(permissionMode);
  useEffect(() => { permissionModeRef.current = permissionMode; }, [permissionMode]);
  // 新会话首条消息窗口期：已发送、onChatSession 尚未回绑真实 sid。期间主进程广播已用真实 sid，
  // 而 sidRef 还是 __new_xxx——ask 等按会话过滤的订阅在此窗口放行，避免提问卡片丢失
  const pendingFirstTurnRef = useRef(false);
  const storeModel = useSettingsStore((s) => s.model);
  const setStoreModel = useSettingsStore((s) => s.setModel);
  // 全局聊天思考等级:仅作为新会话的初始默认(方案 B,聊天下拉可临时改)
  const globalThinkingLevel = useSettingsStore((s) => s.chatThinkingLevel);
  const [thinkingLevel, setThinkingLevel] = useState(globalThinkingLevel || "medium");
  // 用户是否手动切过思考等级:手动切过后不再跟随全局变化(方案 B)
  const userChangedThinkingRef = useRef(false);
  // 用户选的等级(用于与模型实际生效值比对——不一致说明被模型能力裁剪)
  const desiredThinkingRef = useRef<string | null>(null);
  // 当前等级(订阅回调在 [] 依赖的 effect 里,闭包拿不到最新值,用 ref 读)
  const thinkingLevelRef = useRef(thinkingLevel);
  useEffect(() => { thinkingLevelRef.current = thinkingLevel; }, [thinkingLevel]);
  // 被裁剪后实际生效的等级(与所选不同时才显示提示)
  const [cappedThinkingLevel, setCappedThinkingLevel] = useState<string | null>(null);
  // 当前模型支持的思考等级(聊天页下拉只展示这些档位;未收到广播前显示全部)
  const [thinkingLevels, setThinkingLevels] = useState<string[] | null>(null);
  // 支持档位的 ref 镜像(applyLevel 在 effect 里用,闭包拿不到最新值)
  const thinkingLevelsRef = useRef<string[] | null>(null);
  useEffect(() => { thinkingLevelsRef.current = thinkingLevels; }, [thinkingLevels]);
  // 新会话创建前用户选过的等级(sid 为空时写不进缓存,等 chat-session 回来补写)
  const pendingThinkingLevelRef = useRef<string | null>(null);
  // 手动切换时所在的会话 id:null = 会话创建前的选择(属"即将创建的新会话",不被新会话重置覆盖)
  const manualThinkingSidRef = useRef<string | null>(null);
  // 新会话角色模板:发送首条消息前可选(Mint 默认 / Mint-D 设计模式),发送后不再显示
  const [chatRole, setChatRole] = useState<"mint" | "mint-d">("mint");
  // 角色滑块几何:宽度跟随选中项(不等分,JS 测量 offsetWidth/offsetLeft)
  const roleSliderRef = useRef<HTMLDivElement>(null);
  const roleBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [sliderBox, setSliderBox] = useState<{ left: number; width: number; trackW: number } | null>(null);
  const syncSlider = useCallback(() => {
    const idx = chatRole === "mint" ? 0 : 1;
    const btn = roleBtnRefs.current[idx];
    const track = roleSliderRef.current;
    if (btn && track) {
      const width = btn.offsetWidth + 3; // 左右外边距 1.5px
      // 轨道无 border——视觉层 inset-0 尺寸 = offsetWidth/offsetHeight 本身;
      // 滑块 offsetLeft 相对轨道 padding box = 同一坐标系,无需偏移
      const trackW = track.offsetWidth;
      // 滑块对准选中项按钮(不做余量约束——贴边时气泡鼓出可能略越轨道,换取位置精确)
      const left = btn.offsetLeft - 1.5;
      setSliderBox({ left, width, trackW });
    }
  }, [chatRole]);
  useEffect(() => { syncSlider(); }, [syncSlider]);
  // 滑块鼠标弹性(参考 liquid-glass logout:elasticity 0.35):鼠标靠近时滑块方向性拉伸,
  // 距离衰减(激活区 200px),滞后过渡出"液体"感
  const [sliderStretch, setSliderStretch] = useState({ x: 1, y: 1 });
  // 滑块拖拽状态机:
  // - dragStartRef:拖拽起点(同步 ref,非 null 即拖拽中——不用异步 state 判定)
  // - dragLeftRef:拖拽中实时位置(同步 ref;dragLeft state 仅渲染镜像,值不变不 set)
  // - 收尾统一走 endDrag(pointerup / window 兜底共用,幂等);
  //   pointercancel / lostpointercapture 只清理不选中(位置不可信)
  const [dragging, setDragging] = useState(false);
  const [dragLeft, setDragLeft] = useState<number | null>(null);
  const [sliderPressed, setSliderPressed] = useState(false);
  const dragStartRef = useRef<{ x: number; left: number } | null>(null);
  const dragLeftRef = useRef<number | null>(null);
  // window 兜底监听引用:unmount 时移除(拖拽中关 tab 会残留监听,累积泄漏)
  const winEndRef = useRef<((ev: PointerEvent) => void) | null>(null);
  useEffect(() => () => {
    dragStartRef.current = null;
    dragLeftRef.current = null;
    if (winEndRef.current) {
      window.removeEventListener("pointerup", winEndRef.current);
      window.removeEventListener("pointercancel", winEndRef.current);
      winEndRef.current = null;
    }
  }, []);

  // 统一收尾:moved<4 视为点击(重置到当前选中项),否则按落点选中最近选项
  const endDrag = useCallback((clientX: number) => {
    const start = dragStartRef.current;
    if (!start) return; // 幂等:已收尾/无拖拽
    const moved = Math.abs(clientX - start.x);
    dragStartRef.current = null;
    dragLeftRef.current = null;
    setDragging(false);
    setDragLeft(null);
    setSliderPressed(false);
    if (moved < 4) { syncSlider(); return; } // 视为点击当前项:重置滑块尺寸/位置到当前选中项
    const track = roleSliderRef.current;
    if (!track) return;
    const pointerX = clientX - track.getBoundingClientRect().left;
    let nearest = 0;
    let minDist = Infinity;
    roleBtnRefs.current.forEach((btn, i) => {
      if (!btn) return;
      const d = Math.abs(pointerX - (btn.offsetLeft + btn.offsetWidth / 2));
      if (d < minDist) { minDist = d; nearest = i; }
    });
    // 用落点选项的几何直接重置滑块(拖拽中 sliderBox.width 被宽度适配改过;
    // setChatRole 同值时无 effect 触发,不重置会残留别处的宽度)
    const btn = roleBtnRefs.current[nearest];
    if (btn) {
      const width = btn.offsetWidth + 3; // 左右外边距 1.5px
      const trackW = track.offsetWidth;
      const left = btn.offsetLeft - 1.5;
      setSliderBox({ left, width, trackW });
    }
    setChatRole(nearest === 0 ? "mint" : "mint-d");
  }, [syncSlider]);

  // 仅清理不选中(pointercancel/lostpointercapture:位置不可信,不触发切换)——
  // 但仍要归位到当前选中项:拖拽中 sliderBox.width 可能被宽度适配改过,不重置会残留
  const abortDrag = useCallback(() => {
    dragStartRef.current = null;
    dragLeftRef.current = null;
    setDragging(false);
    setDragLeft(null);
    setSliderPressed(false);
    syncSlider();
  }, [syncSlider]);

  const handleSliderPointerDown = useCallback((e: React.PointerEvent) => {
    // 重新测量,并直接用按钮几何算起始位置(不依赖异步的 sliderBox state)
    syncSlider();
    const idx = chatRole === "mint" ? 0 : 1;
    const btn = roleBtnRefs.current[idx];
    if (!btn) return;
    const startLeft = btn.offsetLeft - 1.5;
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* capture 失败:window 兜底监听仍能收尾 */ }
    dragStartRef.current = { x: e.clientX, left: startLeft };
    dragLeftRef.current = startLeft;
    setDragging(true);
    setSliderPressed(true);
    // window 级兜底:capture 意外丢失后 up/cancel 不再路由到滑块——补一道监听保证收尾
    const onWinEnd = (ev: PointerEvent) => {
      window.removeEventListener("pointerup", onWinEnd);
      window.removeEventListener("pointercancel", onWinEnd);
      if (winEndRef.current === onWinEnd) winEndRef.current = null;
      endDrag(ev.clientX);
    };
    winEndRef.current = onWinEnd;
    window.addEventListener("pointerup", onWinEnd);
    window.addEventListener("pointercancel", onWinEnd);
  }, [chatRole, syncSlider, endDrag]);

  const handleSliderPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current || !sliderBox || !roleSliderRef.current) return;
    const track = roleSliderRef.current;
    const trackRect = track.getBoundingClientRect();
    // 实时位置从 ref 读(回调不随 dragLeft 重建,闭包永远最新)
    const curLeft = dragLeftRef.current ?? dragStartRef.current.left;
    const sliderRight = curLeft + sliderBox.width;
    const dir = dragStartRef.current.left > curLeft ? -1 : 1; // 拖动方向:向左 -1 / 向右 1
    let targetWidth = sliderBox.width;
    if (dir >= 0) {
      let targetIdx: number | null = null;
      roleBtnRefs.current.forEach((btn, i) => {
        if (!btn) return;
        if (sliderRight >= btn.offsetLeft + btn.offsetWidth - 10 - 1) targetIdx = i;
      });
      if (targetIdx !== null) targetWidth = roleBtnRefs.current[targetIdx]!.offsetWidth + 3; // 左右外边距 1.5px
    } else {
      let targetIdx: number | null = null;
      roleBtnRefs.current.forEach((btn, i) => {
        if (!btn) return;
        if (curLeft <= btn.offsetLeft + 10 + 1 && targetIdx === null) targetIdx = i;
      });
      if (targetIdx !== null) targetWidth = roleBtnRefs.current[targetIdx]!.offsetWidth + 3;
    }
    if (targetWidth !== sliderBox.width) setSliderBox({ ...sliderBox, width: targetWidth });
    // 轨道 p-1=4px 内边距,clamp 滑块不越界(滑块左边缘距轨道边缘 ≥2.5px);值不变不触发渲染
    const raw = dragStartRef.current.left + (e.clientX - dragStartRef.current.x);
    const next = Math.min(Math.max(raw, 2.5), trackRect.width - targetWidth - 2.5);
    if (dragLeftRef.current !== next) {
      dragLeftRef.current = next;
      setDragLeft(next);
    }
  }, [sliderBox]);

  const handleSliderPointerUp = useCallback((e: React.PointerEvent) => {
    endDrag(e.clientX);
  }, [endDrag]);
  const handleTrackMove = useCallback((e: React.MouseEvent) => {
    // 拖拽中跳过弹性(滑块被抓着,弹性无意义且每帧 setState 拖累跟手)
    if (dragStartRef.current) return;
    const track = roleSliderRef.current;
    if (!track || !sliderBox) return;
    const rect = track.getBoundingClientRect();
    // 滑块中心(位置随滑动变化):拉伸方向与强度基于鼠标相对滑块中心的距离
    const cx = rect.left + sliderBox.left + sliderBox.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 8) { setSliderStretch({ x: 1, y: 1 }); return; }
    const fade = Math.max(0, 1 - dist / 200);
    const intensity = Math.min(dist / 300, 1) * 0.35 * fade;
    const nx = dx / dist;
    const ny = dy / dist;
    setSliderStretch({
      x: 1 + Math.abs(nx) * intensity * 0.3 - Math.abs(ny) * intensity * 0.15,
      y: 1 + Math.abs(ny) * intensity * 0.3 - Math.abs(nx) * intensity * 0.15,
    });
  }, [sliderBox]);
  const [leavingStartCard, setLeavingStartCard] = useState(false);
  // 首条消息发送:输入卡片从居中平滑下移到底部(FLIP + WAAPI)。
  // 目标位置可预测:卡片贴 ChatPanel 底部(input-card margin-bottom 16px),
  // 无需等 virtualizer 占位——useLayoutEffect 绘制前设反位移(防首帧闪烁)
  const flipDyRef = useRef<number | null>(null);
  const startCardLeave = useCallback(() => {
    const wrap = inputWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    // 底部间距取卡片实际 margin-bottom（原硬编码 16px 与 CSS 耦合，改间距时容易漏改导致动画落点偏移）
    const card = wrap.querySelector<HTMLElement>(".input-card");
    const bottomGap = card ? parseFloat(getComputedStyle(card).marginBottom) || 0 : 0;
    const targetTop = window.innerHeight - rect.height - bottomGap;
    flipDyRef.current = rect.top - targetTop;
    setLeavingStartCard(false); // 布局切换:容器回底部(shrink-0),消息列表出现
  }, []);

  // FLIP 反位移在 useLayoutEffect 设置(DOM 更新后、浏览器绘制前同步执行):
  // 轮询/rAF 晚 1 帧——新位置已绘制,首帧闪回起点造成"抖动一下"
  useLayoutEffect(() => {
    if (flipDyRef.current === null) return;
    const dy = flipDyRef.current;
    flipDyRef.current = null;
    const el = inputWrapRef.current;
    if (!el || Math.abs(dy) < 1) return;
    // 绘制前设反位移(FLIP 起点),下一帧动画滑到 0
    el.style.willChange = "transform";
    el.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      // fill: forwards 关键——动画结束后保持终点 transform,onfinish 清理时无跳变
      const anim = el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0px)" }],
        { duration: 700, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
      );
      anim.onfinish = () => { el.style.willChange = ""; el.style.transform = ""; };
    });
  });

  // 可选内容容器清单:与 index.css 的 user-select:text 白名单一致,新增内容型区域两边同步。
  // 两处使用:Ctrl+A 全选目标判定 + mousedown 记忆更新
  const CONTENT_SELECTOR = ".msg-bubble-user, .msg-bubble-agent, .msg-bubble-system, .diff-view, .shell-output, .subagent-output, .log-overlay-output, .selectable";
  // 上次全选/点击的内容容器:点击空白处取消全选时 selection 被完全清空(无锚点),
  // 二次 Ctrl+A 无法判定目标——回退到记忆的容器,无需再点击一次容器才恢复
  const lastContainerRef = useRef<Element | null>(null);

  // Ctrl+A:焦点(最近点击/选择锚点)落在任意可选内容容器内时只全选该容器;
  // 锚点被点击空白清空时回退到 lastContainerRef;空白/UI 区域禁止全选页面;
  // 输入框/文本域保持编辑语义(全选输入内容)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "a") return;
      // 输入区编辑语义:焦点在可编辑元素内 → 放行默认(全选输入内容)
      const active = document.activeElement;
      if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || (active as HTMLElement).isContentEditable)) return;
      // 非输入区:一律阻止页面全选(空白区域 selection 为空,必须提前 preventDefault)
      e.preventDefault();
      const sel = window.getSelection();
      let container: Element | null = null;
      if (sel && sel.rangeCount > 0 && sel.anchorNode) {
        const anchor = sel.anchorNode;
        const el = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element);
        container = el?.closest(CONTENT_SELECTOR) || null;
      }
      if (!container) container = lastContainerRef.current; // 锚点被清空 → 回退记忆容器
      if (!container) return; // 空白/UI 区域:不执行选择
      lastContainerRef.current = container;
      const range = document.createRange();
      range.selectNodeContents(container);
      sel?.removeAllRanges();
      sel?.addRange(range);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // mousedown 捕获阶段:清除残留选择锚点,保证拖选从本次点击位置开始。Ctrl+A 编程式
  // 全选后,浏览器点击清除只把选择折叠为 collapsed(anchorNode 残留指向旧文本),下一次
  // 拖选从旧锚点扩展而非点击处新建——表现为必须先点击一次才能选;捕获阶段先于浏览器
  // 默认行为(建立新锚点),清除后由默认行为重建干净起点。同时更新 lastContainerRef。
  // 编辑区(输入框/文本域/可编辑元素)的 selection 由编辑器管理,不干预
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      const container = t.closest(CONTENT_SELECTOR);
      if (container) lastContainerRef.current = container;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (t.closest(".chat-input, textarea, input, [contenteditable]")) return;
      sel.removeAllRanges();
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, []);

  const [chatModel, setChatModel] = useState("");
  // 会话绑定的供应商 piId(需求 5:不同会话不同供应商)
  const [chatProvider, setChatProvider] = useState<string>("");
  // 恢复会话只有在缓存明确记录过选择时才向主进程传覆盖值；否则让 SDK 从 JSONL 恢复。
  const sessionModelOwnedRef = useRef(false);
  const sessionThinkingOwnedRef = useRef(false);
  // 最新值 ref：onChatSession 订阅闭包拿不到最新 state，补写缓存/判断时用 ref
  const chatModelRef = useRef("");
  const chatProviderRef = useRef("");
  useEffect(() => { chatModelRef.current = chatModel; }, [chatModel]);
  useEffect(() => { chatProviderRef.current = chatProvider; }, [chatProvider]);
  // 全局默认模型只初始化新会话；已有会话保持自己的 transcript/cache 状态。
  useEffect(() => {
    if (!existingSid && storeModel) setChatModel(storeModel);
  }, [storeModel, existingSid]);

  const handleModelChange = useCallback(async (m: string) => {
    sessionModelOwnedRef.current = true;
    setChatModel(m); setStoreModel(m);
    const sid = sidRef.current;
    // 带上会话绑定供应商——否则按全局当前供应商解析，绑定供应商不同时模型解析不到、切换静默丢失
    if (sid) { window.electronAPI.agent.setModel(sid, m, chatProvider || undefined).catch(() => {}); }
  }, [setStoreModel, chatProvider]);

  /** 标准/只读 → 完全访问时说明风险并确认；切回或切到只读直接生效。模式会持久化为全局默认。 */
  const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
    if (mode === "full" && permissionMode !== "full") {
      const ok = await confirmFullAccess();
      if (!ok) return;
    }
    setPermissionMode(mode);
    useSettingsStore.getState().setChatPermissionMode(mode);
  }, [permissionMode]);
  const [showStats, setShowStats] = useState(false);
  // 压缩确认弹层：auto=阈值自动触发 / manual=统计弹窗按钮
  const [compactDialog, setCompactDialog] = useState<{ source: "auto" | "manual"; threshold?: number } | null>(null);
  /** 按当前模型支持档位自适应后落到界面（避免选中值不在选项里 → 显示英文原名） */
  /** 按模型支持档位自适应后落到界面（避免选中值不在选项里 → 显示英文原名）。
   *  list 可显式传入本次查询到的档位——不传时用 thinkingLevelsRef（它滞后一帧：
   *  查询刚回来时 ref 还是旧值，必须显式传，否则页面加载时自适应不生效）。 */
  const applyLevel = useCallback((level: string, list?: string[] | null) => {
    const adapted = resolveThinkingLevel(level, list !== undefined ? list : thinkingLevelsRef.current);
    setCappedThinkingLevel(adapted === level ? null : adapted);
    setThinkingLevel(adapted);
  }, []);

  const handleThinkingLevelChange = useCallback((level: string) => {
    sessionThinkingOwnedRef.current = true;
    userChangedThinkingRef.current = true;
    manualThinkingSidRef.current = sidRef.current;
    desiredThinkingRef.current = level;
    // 持久化到会话缓存——改即写（真实会话）；新会话的真实 id 还没创建（当前是 __new_ 临时 id，
    // 写进去不会迁移到真实会话），先暂存，等 chat-session 回来补写到真实会话
    if (sidRef.current && !sidRef.current.startsWith("__new_")) {
      window.electronAPI.sessionCache.write(sidRef.current, { thinkingLevel: level }).catch(() => {});
    } else {
      pendingThinkingLevelRef.current = level;
    }
    applyLevel(level);
    // 等级随发送应用(sendMessage 带 thinkingLevel,主进程 resume 分支应用)——不再立即 IPC,
    // 避免"切等级 IPC 与发送 IPC 并发"的 SDK 竞态窗口
  }, [applyLevel]);

  // 加固(启动竞态):store 异步加载完成前,新会话可能拿到默认 medium。
  // 全局值变化且用户未在本会话选过时,同步本地值(并按模型能力自适应);选过则不再跟随。
  useEffect(() => {
    if (!globalThinkingLevel) return;
    if (userChangedThinkingRef.current) return;
    applyLevel(globalThinkingLevel);
  }, [globalThinkingLevel, applyLevel]);

  const msgIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  /** 输入框变化处理：检测开头 / 触发命令面板（仅在输入框纯命令上下文下，不影响代码片段） */
  const autoScrollRef = useRef(true);
  // 最新回合输出块 id:thinking/tool 块归入目标(不做文本 diff,流式临时内容)
  const latestAiIdRef = useRef(0);
  // 本窗口发出去的用户气泡,按发送顺序排队(带点击时刻,供认领规则做时间窗判定与超时清理)。
  // 不能按 timestamp 精确配对:本地气泡时间戳是点击时刻,条目时间戳由 SDK 收到 prompt 时生成(两者不等);
  // 但两者差一个 IPC + 预处理抖动(同量级),而「本窗口每次发送必然先建/复用一个气泡」是确定性锚点
  // ——两者合用见 chat-utils.claimEntryBubble(只有队列里的气泡有资格被认领:系统通知/远端消息插入的
  // 气泡不在队列里,抢不走 id)。
  const pendingUserBubbleRef = useRef<PendingUserBubble[]>([]);
  // steer 打断标记
  const steeringRef = useRef(false);
  const sidRef = useRef<string>(initialSid);
  // 会话 id 的实时镜像：onStream / onChatSession 的订阅 effect 依赖数组是 []（只订阅一次），
  // 闭包里的 existingSid 会永久停在首次渲染的值。面板「挂载后才拿到 sessionId」时（新建项目流程：
  // 消息由弹窗发送，本面板没有 sendMessage 结果可绑 currentChatRef），门卫若读闭包值就会把
  // 属于它的流事件全部丢弃 → 聊天区永久空白。故门卫一律读这个 ref。
  const existingSidRef = useRef<string | undefined>(existingSid);
  useEffect(() => { existingSidRef.current = existingSid; }, [existingSid]);
  // 当前会话的 pending ask（Mint 提问卡片，聊天区内嵌）
  const pendingAsk = useAskStore((s) => Object.values(s.asks).find((a) => a.sessionId === sid)) || null;
  // 按会话读压缩/摘要状态(须在 sidRef 声明后——useStatusStore selector 渲染期执行)
  const summarizing = useStatusStore((s) => s.bySession[sidRef.current]?.summarizing ?? false);
  const compacting = useStatusStore((s) => s.bySession[sidRef.current]?.compacting ?? false);
  // 防御性兜底:临时 sid → 真实 sessionId 的常规迁移已由 onChatSession(698 行)同步完成,
  // 此处仅防 prop 直变(existingSid 从 undefined 一步到位)的遗漏场景,正常路径恒不命中
  useEffect(() => {
    if (existingSid && sidRef.current !== existingSid) {
      // 新建会话：临时 key → 真实 sessionId，迁移已存入的消息
      const oldKey = sidRef.current;
      const newKey = existingSid;
      sidRef.current = newKey;
      setSid(newKey);
      // 直接迁移（同一个 microtask 内完成，早于下一次渲染）
      const store = useChatStore.getState();
      const oldMsgs = store.messagesBySession[oldKey];
      if (oldMsgs && oldMsgs.length > 0) {
        useChatStore.setState((s) => {
          const next = { ...s.messagesBySession };
          next[newKey] = [...(next[newKey] || []), ...oldMsgs];
          delete next[oldKey];
          const nextId = { ...s.msgIdBySession };
          const maxId = oldMsgs.reduce((max: number, m: { id: number }) => Math.max(max, m.id), 0);
          nextId[newKey] = Math.max(nextId[newKey] || 0, maxId);
          delete nextId[oldKey];
          return { messagesBySession: next, msgIdBySession: nextId };
        });
      }
      usePinStore.getState().migrateSession(oldKey, newKey);
    }
  }, [existingSid]);
  const runningSessions = useTabStore((s) => s.runningSessions);
  const busy = runningSessions.has(sidRef.current);
  const setBusy = (v: boolean) => { useTabStore.getState().setSessionRunning(sidRef.current, v); };

  // 新消息气泡触发(简化):回合输出完全结束(busy true→false)后,用户不在底部 → 「新消息」状态。
  // 流式中(用户滚离底部)由 awayFromBottom 驱动显示圆圈箭头(常驻)
  const prevBusyRef = useRef(false);
  useEffect(() => {
    if (prevBusyRef.current && !busy) {
      if (awayFromBottomRef.current) {
        setShowNewMsg(true);
        showNewMsgRef.current = true;
      }
    }
    prevBusyRef.current = busy;
  }, [busy]);

  // 滚动状态机(最终版:用户意图用"输入时间窗"判定):
  // - 任何用户输入(wheel/touch/mousedown)后 500ms 内的 scroll 变化 = 用户滚动意图——
  //   覆盖滚轮/触摸板/触屏/滚动条拖动;程序性贴底/测量增长(无用户输入)的 scroll 永不误判
  // - autoScrollRef=false:用户滚离底部(dist>8);恢复:滚回底部(dist<8) → 跟随 + 隐藏气泡
  const lastUserInputRef = useRef(0); // 最近一次用户输入时间(判定窗口)
  const markUserInput = useCallback(() => { lastUserInputRef.current = Date.now(); }, []);
  const handleScroll = useCallback(() => {
    // 程序性贴底/测量调整(无用户输入)不参与判定——彻底消除误判,不需要保护窗口
    if (Date.now() - lastUserInputRef.current > 500) return;
    const el = containerRef.current; if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom < 8;
    if (atBottom) {
      autoScrollRef.current = true; // 滚回底部 → 恢复自动跟随
      // 气泡消失(用户已看到新消息);跨阈值时更新渲染 state
      if (showNewMsgRef.current) setShowNewMsg(false);
      if (awayFromBottomRef.current) {
        awayFromBottomRef.current = false;
        setAwayFromBottom(false);
      }
    } else {
      autoScrollRef.current = false; // 用户滚离底部 → 停止跟随(气泡触发条件之一)
      if (!awayFromBottomRef.current) {
        awayFromBottomRef.current = true;
        setAwayFromBottom(true);
      }
    }
  }, []);
  // 用户输入标记(wheel/touch/mousedown——滚动条拖动/触屏都覆盖;判定统一在 handleScroll)
  const handleUserInput = useCallback(() => {
    markUserInput();
  }, [markUserInput]);

  // 按住指针期间暂停贴底（理由见下方 anchorTo）：必须用 state 而非 ref——库在每次渲染时
  // 应用 options，ref 变化不会触发重渲染，anchorTo 就换不过来
  const [holdPointer, setHoldPointer] = useState(false);
  const handlePointerDown = useCallback(() => {
    setHoldPointer(true);
    // 松手可能落在容器外（拖动到窗口边缘），所以挂在 window 上而非容器事件
    const release = (): void => {
      setHoldPointer(false);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  }, []);

  // 消息列表虚拟化：只渲染可视区 ± overscan 的消息，长对话时 DOM 从数千节点降到 ~30
  // HMR 防御：容器元素用 state 驱动（而非 ref）——DOM 重建时 ref 回调触发 setState，
  // 强制重渲染让 virtualizer 的 _willUpdate 检测到 scrollElement 变化并重新绑定 observer
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const attachScrollRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    setScrollEl(el);
  }, []);
  // 眨眼开关落在「最新一条 Mint 消息」所在的行：用户消息和系统通知行没有 Mint 头像，
  // 若只按「最后一行」判，通知行插到末尾时流式中的头像会突然停眨
  const liveIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === "ai" && !m.agentRole) return i;
    }
    return -1;
  }, [messages]);
  // 流式渲染落在「正在增长的那条」上（= 末尾最后一条 ai 消息）。与 liveIndex 的区别：
  //  - liveIndex 供头像眨眼用，跳过 agentRole 行（角色消息不带 Mint 头像）；这条不跳——角色消息也实时收内容
  //  - 末尾是用户真实输入时返回 -1：新一轮还没有输出，不能把上一轮当成正在增长
  //    （否则上一轮的思考块会被自动展开、正文走流式渲染器）。steer 插话也落在这条上——发送处已重置
  //    输出段 id，下一帧会建新消息，窗口期只是短暂没有行处于流式态
  // 回合中插到末尾的系统通知行跳过继续向前找（它们不承载内容）
  const streamIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m) continue;
      if (m.role === "ai") return i;
      if (m.role === "user" && !m.customType) return -1;
    }
    return -1;
  }, [messages]);
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => 100,
    overscan: 8,
    // 正规手段(替代手写贴底链):anchorTo: "end" 是库原生聊天列表机制——
    // 用户在底部时内容测量变化(流式增长)自动保持贴底;用户滚动离开自动停止跟随。
    // scrollToIndex 的 scrollState 在测量变化时持续校正对齐直到稳定(官方处理估算→实测)
    //
    // 按住指针期间暂停贴底：流式时持续贴底会把指针下的内容顶走，按下与松手之间指针下的
    // 元素换掉后浏览器就不再派发 click（气泡里的图片/文件链接、折叠箭头、复制按钮都点不动，
    // 用户 2026-09-23 反馈）。暂停后内容改为在下方增长，指针下的元素不动；松手即恢复。
    anchorTo: holdPointer ? undefined : "end",
    // measureElement 在 React commit 阶段触发 onChange，默认的 flushSync 会
    // 报 "flushSync was called from inside a lifecycle method"——改走普通调度
    useFlushSync: false,
  });
  // 贴底(发送消息/气泡点击):virtualizer.scrollToIndex 官方 API。
  // rAF 延迟:事件处理中 virtualizer 的 count 还是旧值(React 渲染时才 setOptions 更新),
  // scrollToIndex 内部 clamp 到 count-1——发送消息同步插入用户消息后立即调用会滚到
  // 旧最后一条(AI 消息);rAF 时 React 已重渲染,count 更新,定位到用户消息
  const scrollToBottom = useCallback((_force = false) => {
    const msgs = useChatStore.getState().messagesBySession[sidRef.current] || [];
    const target = msgs.length - 1;
    if (target < 0) return;
    autoScrollRef.current = true; // 程序性回底 = 恢复自动跟随
    // 气泡立即消失:handleScroll 只在用户输入后 500ms 内判定,程序性贴底(点击/发送)不触发
    if (awayFromBottomRef.current) {
      awayFromBottomRef.current = false;
      setAwayFromBottom(false);
    }
    if (showNewMsgRef.current) {
      showNewMsgRef.current = false;
      setShowNewMsg(false);
    }
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(target, { align: "end" });
    });
  }, [virtualizer]);

  // 提问记录跳转:滚动到目标消息(顶部对齐) + 临时高亮 1.5s(重复点击重置计时)。
  // 跳转 = 离开底部模式:autoScrollRef 置 false 防止「内容增长跟随」effect 在测量变化时弹回底部
  // (程序性滚动不触发 handleScroll,标记不会被用户滚动逻辑清掉)。
  // 高亮过渡限定 background-color/border-radius:transition-all 会过渡虚拟滚动的 translateY
  // 导致滚动错乱;高亮矩形 mt-[5px] 与上方内容留间距
  // pendingJumpRef:首次打开会话时 [0,idx) 大量项未实测(估算 100px/项),一次定位偏差可达数千 px;
  // 且滚过头后目标不在渲染范围、测量不再推进,库的 reconcileScroll 会带着误差提前稳定——
  // 由下方校正 effect 接管:滚动让途经项被实测(估算区间缩短,2-3 轮收敛),目标入渲染范围后按 DOM 实测对齐
  const pendingJumpRef = useRef<number | null>(null);
  const jumpStartedAtRef = useRef(0);
  const jumpToMessage = useCallback((msgId: number) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    autoScrollRef.current = false;
    if (idx < messages.length - 1) {
      // 非末尾:显示回底按钮(用户可从历史位置一键回底);目标即末尾则保持贴底态
      awayFromBottomRef.current = true;
      setAwayFromBottom(true);
    }
    pendingJumpRef.current = idx;
    jumpStartedAtRef.current = Date.now();
    virtualizer.scrollToIndex(idx, { align: "start" });
    setHighlightMsgId(msgId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightMsgId(null), 1500);
  }, [messages, virtualizer]);

  // 跳转校正:测量推进(totalSize 变化)时重新对齐;目标进入渲染范围后按 DOM 实测位置
  // 精确对齐并结束。1.2s 超时保险(测量不再变化时 effect 不再触发,靠超时清理 pending)
  useEffect(() => {
    const idx = pendingJumpRef.current;
    if (idx == null) return;
    if (Date.now() - jumpStartedAtRef.current > 1200) {
      pendingJumpRef.current = null;
      return;
    }
    const raf = requestAnimationFrame(() => {
      if (pendingJumpRef.current == null) return;
      const items = virtualizer.getVirtualItems();
      const inRange = items.some((v) => v.index === idx);
      const c = containerRef.current;
      if (inRange && c) {
        const el = c.querySelector(`[data-index="${idx}"]`);
        if (el) {
          const delta = el.getBoundingClientRect().top - c.getBoundingClientRect().top;
          if (Math.abs(delta) > 1) c.scrollBy({ top: delta });
          pendingJumpRef.current = null;
          return;
        }
      }
      virtualizer.scrollToIndex(idx, { align: "start" });
    });
    return () => cancelAnimationFrame(raf);
  }, [virtualizer.getTotalSize(), virtualizer]);

  // 内容增长跟随:totalSize 变化(流式输出/打开会话的测量推进)时,若用户没滚离底部 → 贴底。
  // 这是 anchorTo: "end" 的替代——库的 wasAtEnd 用 totalSize-based 距离判定,与 DOM 实际
  // 高度有偏差(估算混合),贴底后内容增长时判定失效(实测 dist 0→125);本方案用
  // autoScrollRef(DOM 判定 + wheel 输入)直接控制,可靠
  useEffect(() => {
    if (autoScrollRef.current && messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
    }
  }, [virtualizer.getTotalSize(), messages.length, virtualizer]);

  // 容器变化时兜底重新测量（HMR 重挂后旧测量数据失效）
  useEffect(() => {
    if (scrollEl) virtualizer.measure();
  }, [scrollEl, virtualizer]);

  // ── Upload helpers ─────────────────────────────────

  const uploadFiles = useCallback(async (files: FileList | File[], kind: "image" | "doc") => {
    const items: AttachItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      try {
        const buf = await file.arrayBuffer();
        const result = await window.electronAPI.file.saveUpload(file.name, new Uint8Array(buf));
        const ext = file.name.split(".").pop()?.toLowerCase();
        const isHeic = ext === "heic" || ext === "heif";
        const isImage = (kind === "image" || file.type.startsWith("image/")) && !isHeic;
        items.push({ name: file.name, path: result.path, dataUrl: isImage ? result.dataUrl : undefined, kind: isImage ? "image" : "doc" });
      } catch (e) { console.error("[upload]", e); }
    }
    if (items.length > 0) setAttaches((prev) => [...prev, ...items]);
  }, []);

  // ── Paste ──────────────────────────────────────────

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    const docs: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const file = item.getAsFile();
      if (!file) continue;
      e.preventDefault();
      if (item.type.startsWith("image/")) {
        images.push(file);
      } else if (file.type || file.name) {
        // 文档粘贴（从 Finder/资源管理器复制）
        docs.push(file);
      }
    }
    if (images.length > 0) uploadFiles(images, "image");
    if (docs.length > 0) uploadFiles(docs, "doc");
  }, [uploadFiles]);

  // 拖放上传：阻止系统默认行为（否则拖入文件会触发系统打开文件），提取文件走 uploadFiles
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    const docs = files.filter((f) => !f.type.startsWith("image/"));
    if (images.length > 0) uploadFiles(images, "image");
    if (docs.length > 0) uploadFiles(docs, "doc");
  }, [uploadFiles]);

  // ── File inputs ────────────────────────────────────

  const handleImgChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) { uploadFiles(e.target.files, "image"); e.target.value = ""; }
  }, [uploadFiles]);

  const handleDocChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) { uploadFiles(e.target.files, "doc"); e.target.value = ""; }
  }, [uploadFiles]);

  // ── History / stream ───────────────────────────────

  // 新挂载时重置本会话残留状态(防止窗口切换/重开后状态栏显示旧文本;按会话隔离,不影响其他 tab)
  useEffect(() => { useStatusStore.getState().reset(sidRef.current); }, []);

  // ── 消息流持久错误卡片(3.5) ────────────────────────────
  // 错误同时写入消息流(不只有状态栏 8s 提示):卡片锚定失败回合所在消息,
  // 用户可重试(重发原消息)/关闭;状态栏提示逻辑不变。
  const showFlowError = useCallback((kind: FlowErrorCard["kind"], message: string, opts?: { sourceMsgId?: number; anchorMsgId?: number; tone?: ErrorTone; hint?: string; afterRewind?: boolean; errorKind?: FlowErrorCard["errorKind"] }) => {
    const msgs = useChatStore.getState().messagesBySession[sidRef.current] || [];
    if (msgs.length === 0) return; // 空会话(无消息可锚)只走状态栏
    // 锚点 = 失败发生时的消息流尾部(最后一条消息行)——错误卡片在视野内,用户立即可见;
    // 显式指定(如发送失败的用户消息)优先
    const anchor = opts?.anchorMsgId ?? msgs[msgs.length - 1]!.id;
    // 可重试性:send/round 错误取最近的真实 user 消息为重发目标;system 类(超时等)不可重试
    let source: number | undefined = opts?.sourceMsgId;
    if (source == null && kind !== "system") {
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]!.role === "user" && !msgs[i]!.customType) { source = msgs[i]!.id; break; }
      }
    }
    useChatStore.getState().addFlowError(sidRef.current, {
      kind, message, anchorMsgId: anchor,
      ...(opts?.tone ? { tone: opts.tone } : {}),
      ...(opts?.hint ? { hint: opts.hint } : {}),
      ...(opts?.errorKind ? { errorKind: opts.errorKind } : {}),
      ...(opts?.afterRewind ? { afterRewind: true } : {}),
      ...(source != null ? { sourceMsgId: source } : {}),
    });
  }, []);

  // ── 子 Agent 委派进度卡片 ─────────────────────────
  // 多委派并存：按 delegationId 索引（此前是单对象 state——新委派直接覆盖旧卡片，
  // 且旧委派的进度事件到达时按「delegationId 变了=新委派」重置任务行，卡片来回跳）
  const [delegations, setDelegations] = useState<Record<string, DelegationUiState>>({});
  // 事件回调内跟踪当前委派状态(副作用必须移出 useState updater——
  // updater 渲染期间执行,调用其他 store 会触发跨组件更新警告)
  const delegationsRef = useRef<Record<string, DelegationUiState>>({});
  // 收到过事件流(init/progress)的委派 id:刷新后对账只清「快照播种后事件流从未接管」的
  // 卡死记录——事件流接管的委派走自身终态/3s 收起,直接删会与终态 progress 事件竞争
  // (count 先于最后一条 progress 到达时误删刚完成的委派,破坏聚合渲染/收起逻辑)
  const liveDelegationIdsRef = useRef<Set<string>>(new Set());
  // 对账待删队列:count/快照信号「主进程已无此委派」后延迟确认再删——count 广播先于同一
  // 终态迁移的 progress 事件发出,直接删会让紧随其后的终态 progress 重建残缺卡片
  const pendingReconcileRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // 聚合渲染锚点:任意时刻最多显示一张委派卡片(含所有委派任务行),
  // 挂在「最新的 triggerMsgId」对应消息下;全部委派缺 triggerMsgId(Mint 主动发起、
  // 消息未落盘捕获不到)时为 undefined,渲染层兜底挂最后一条 AI 消息
  const delegationList = Object.values(delegations);
  const anchorMsgId = delegationList.reduce<number | undefined>(
    (latest, d) => (d.triggerMsgId !== undefined && (latest === undefined || d.triggerMsgId > latest) ? d.triggerMsgId : latest),
    undefined,
  );
  // 委派完成 3s 后收起:每委派一个计时器(delegationId → timer),存在即已开始倒计时,
  // 避免每次 delegations 更新都重建计时器把已完成的委派无限期留在卡上
  const collapseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // 委派任务清单订阅：委派创建即初始化全部任务行(pending,含并发排队未启动的)
  useEffect(() => {
    const unsubInit = window.electronAPI.agent.onDelegationInit((data: {
      chatId?: string;
      delegationId: string;
      tasks: Array<{
        index: number;
        agent: string;
        status: "pending" | "running" | "completed" | "failed" | "aborted";
        task: string;
        title?: string;
        description?: string;
        prompt?: string;
      }>;
    }) => {
      if (!currentChatRef.current) return;
      if (data.chatId && data.chatId !== currentChatRef.current) return;
      // 事件流已接管(刷新后快照播种前的实时委派)——对账不再清除它
      liveDelegationIdsRef.current.add(data.delegationId);
      // 收到实时事件 → 取消该委派的对账待删(事件流接管,终态由自身收尾)
      const pend = pendingReconcileRef.current.get(data.delegationId);
      if (pend) { clearTimeout(pend); pendingReconcileRef.current.delete(data.delegationId); }
      // 初始化:delegationId 对应的全部任务行(pending);后续 progress 事件按 index 更新
      const tasks: DelegationTaskUi[] = data.tasks.map((t) => ({
        index: t.index,
        agent: t.agent,
        task: t.task,
        title: t.description || t.title,
        detail: t.prompt,
        status: "pending",
      }));
      const next: DelegationUiState = {
        delegationId: data.delegationId,
        chatId: data.chatId,
        triggerMsgId: undefined,
        tasks,
        finished: false,
        startedAt: Date.now(),
      };
      delegationsRef.current = { ...delegationsRef.current, [data.delegationId]: next };
      setDelegations(delegationsRef.current);
    });
    return unsubInit;
  }, []);

  // Mint ask_user 提问卡片：接收广播（按会话过滤，其他会话的提问不显示）+ 关闭
  useEffect(() => {
    const offReq = window.electronAPI.agent.onAskRequest((data) => {
      // 首条消息窗口期：广播已用真实 sid 而 sidRef 还是 __new_xxx——放行避免提问卡片丢失
      if (!data || data.sessionId !== sidRef.current) {
        if (!(pendingFirstTurnRef.current && sidRef.current?.startsWith("__new_"))) return;
      }
      useAskStore.getState().setAsk(data);
    });
    const offClosed = window.electronAPI.agent.onAskClosed((data) => {
      useAskStore.getState().clearAsk(data.requestId);
    });
    return () => { offReq(); offClosed(); };
  }, []);

  // 需用户即时确认的弹出（ask 提问卡片）出现时统一贴底：卡片挂在滚动区尾部
  // 文档流、virtualizer 不感知，用户滚离底部时会等一个视口外的卡片——统一走 scrollToBottom
  // （virtualizer.scrollToIndex 原生路径，比 DOM scrollTop 可靠：单次 rAF 会被后续测量重置）
  useEffect(() => {
    if (pendingAsk) scrollToBottom();
  }, [pendingAsk, scrollToBottom]);

  useEffect(() => {
    const unsub = window.electronAPI.agent.onDelegationProgress((data: DelegationProgressEvent) => {
      // 过滤:仅显示当前窗口 chat 的委派;currentChatRef 未初始化(非主会话 tab)→ 拒绝,
      // 否则 A 会话的委派进度穿透到所有打开的会话 tab(后台任务通知跨会话显示)
      if (!currentChatRef.current) return;
      if (data.chatId && data.chatId !== currentChatRef.current) return;
      // 事件流已接管(含快照播种后的实时进度)——对账不再清除它
      liveDelegationIdsRef.current.add(data.delegationId);
      // 收到实时事件 → 取消该委派的对账待删(事件流接管,终态由自身收尾)
      const pend = pendingReconcileRef.current.get(data.delegationId);
      if (pend) { clearTimeout(pend); pendingReconcileRef.current.delete(data.delegationId); }
      // 按 delegationId 取该委派自己的上一条状态（多委派并存时互不干扰）
      const prev = delegationsRef.current[data.delegationId];
      const task: DelegationTaskUi = {
        index: data.progress.index,
        agent: data.progress.agent,
        task: data.progress.task,
        // 折叠行显示原始 description(缺失回退 task 首行),展开显示原始 prompt
        title: data.progress.description || (data.progress.task.split("\n")[0] ?? "").replace(/^##\s*任务[:：]\s*/, "").slice(0, 60),
        detail: data.progress.prompt,
        status: data.progress.status,
      };
      // 新委派(首次或 delegationId 变化):捕获触发委派的消息 id
      // (最后一条 AI 消息,含 task 工具调用),卡片固定附着在该消息下方;
      // 同一委派的进度更新沿用原 triggerMsgId(不随新气泡移动)
      const isNewDelegation = !prev;
      // triggerMsgId 缺失时补捕获(init 预初始化未设,首次 progress 补上附着点)。
      // 委派由 Mint 主动发起时消息可能未落盘——由下方 effect 监听消息流补捕获固定
      const needTriggerMsg = isNewDelegation || !prev?.triggerMsgId;
      let triggerMsgId: number | undefined;
      if (needTriggerMsg) {
        const msgs = useChatStore.getState().messagesBySession[sidRef.current] || [];
        const lastAi = msgs.filter((m) => m.role === "ai").pop();
        triggerMsgId = lastAi?.id;
        if (isNewDelegation) scrollToBottom(true);
      }
      const tasks = prev ? [...prev.tasks] : [];
      const idx = tasks.findIndex((t) => t.index === task.index);
      if (idx >= 0) tasks[idx] = task; else tasks.push(task);
      const finished = tasks.length > 0 && tasks.every((t) =>
        t.status === "completed" || t.status === "failed" || t.status === "aborted");
      const next: DelegationUiState = {
        delegationId: data.delegationId,
        chatId: data.chatId,
        triggerMsgId: isNewDelegation ? triggerMsgId : prev?.triggerMsgId,
        tasks,
        finished,
        // 委派开始时间:首次事件记录,卡片计时用(同一委派沿用)
        startedAt: isNewDelegation ? Date.now() : prev?.startedAt ?? Date.now(),
      };
      // 信号按「是否还有任何进行中的委派」判断而非单个委派——多委派并存时
      // 不能因某一个结束就清掉状态栏常驻提示;按 running 的转换边沿 push/pop
      // (不是按「记录里有没有委派」——上一个委派刚完成、尚在 3s 收起窗口内时
      // 又来新委派,按记录判断会漏推常驻提示)
      const hadRunning = Object.values(delegationsRef.current).some((d) => !d.finished);
      delegationsRef.current = { ...delegationsRef.current, [data.delegationId]: next };
      const anyRunning = Object.values(delegationsRef.current).some((d) => !d.finished);
      // 副作用(事件回调内,合法):首个进行中的委派出现 → 常驻「调用 Agent」;
      // 最后一个进行中的委派结束 → 清除
      if (!hadRunning && anyRunning) {
        useStatusStore.getState().pushSignal(sidRef.current, "agent", "调用 Agent");
      } else if (hadRunning && !anyRunning) {
        useStatusStore.getState().popSignal(sidRef.current, "agent");
      }
      // taskId 关联:委派实时状态写 delegation-store(TaskPanel 行实时视图)
      if (data.progress.taskId) {
        useDelegationStore.getState().setTaskExecution(data.progress.taskId, {
          status: data.progress.status,
          durationMs: data.progress.durationMs,
        });
      }
      // 子会话 jsonl 路径回填(AgentBar 查看过程弹层定位;onDelegationCount 广播不含此字段)
      if (data.progress.sessionFile) {
        useDelegationStore.getState().setSessionFile(data.delegationId, data.progress.index, data.progress.sessionFile);
      }
      setDelegations(delegationsRef.current);
    });
    return unsub;
  }, []);

  // 委派/shell 状态订阅已移至 App.tsx 全局常驻(所有 tab 关闭时也要保持 store 新鲜);
  // 此处组件直接读 useDelegationStore 按会话过滤显示

  // 委派触发消息落盘后固定附着点：Mint 主动发起时回合未结束消息未落盘,
  // progress 事件捕获不到 triggerMsgId——消息流更新后补捕获并固定;
  // 委派完成/打断时 Mint 会追加新消息,但各委派 triggerMsgId 一旦固定不再漂移,
  // 合并卡的锚点仅在出现 triggerMsgId 更新的委派时才移动到其消息下
  useEffect(() => {
    const pending = Object.values(delegations).filter((d) => !d.triggerMsgId && !d.finished);
    if (pending.length === 0) return;
    const aiMsgs = messages.filter((m) => m.role === "ai");
    const lastAi = aiMsgs[aiMsgs.length - 1];
    if (!lastAi?.id) return;
    const next = { ...delegationsRef.current };
    for (const d of pending) next[d.delegationId] = { ...d, triggerMsgId: lastAi.id };
    delegationsRef.current = next;
    setDelegations(next);
  }, [messages, delegations]);

  // 每个委派完成后各自计时 3 秒收起（多委派并存时互不影响）：
  // 增量调度——只对「刚转 finished 且尚未开始倒计时」的委派建 timer,已有 timer 的不重置;
  // 未完成委派若带出已建的 timer(状态回跳)则取消;记录中已消失的委派清掉残留 timer
  useEffect(() => {
    const alive = new Set(Object.keys(delegations));
    const timers = collapseTimersRef.current;
    for (const [id, t] of timers) {
      if (!alive.has(id)) { clearTimeout(t); timers.delete(id); }
    }
    for (const d of Object.values(delegations)) {
      if (!d.finished) {
        const t = timers.get(d.delegationId);
        if (t) { clearTimeout(t); timers.delete(d.delegationId); }
        continue;
      }
      if (timers.has(d.delegationId)) continue;
      timers.set(d.delegationId, setTimeout(() => {
        timers.delete(d.delegationId);
        // 触发时委派可能已被其它路径清理——幂等跳过
        if (!(d.delegationId in delegationsRef.current)) return;
        const next = { ...delegationsRef.current };
        delete next[d.delegationId];
        delegationsRef.current = next;
        setDelegations(next);
      }, 3000));
    }
  }, [delegations]);

  // 组件卸载时清理未触发的收起计时器
  useEffect(() => {
    return () => {
      collapseTimersRef.current.forEach((t) => clearTimeout(t));
      collapseTimersRef.current.clear();
      pendingReconcileRef.current.forEach((t) => clearTimeout(t));
      pendingReconcileRef.current.clear();
    };
  }, []);

  // 快照播种:只补本地缺失的 delegationId(已存在的 key 以事件流为准——覆盖会把已完成
  // 委派打回 running,触发收起计时回跳/复活)。无 chatId 的委派无法按门卫过滤归属,不播种。
  // 返回快照中任一 chatId(供门卫绑定;全部已存在时也要返回以作绑定/一致性判断)
  const seedDelegationSnapshot = useCallback((snap: DelegationSnapshotItem[]): string | undefined => {
    const prevRunning = Object.values(delegationsRef.current).some((d) => !d.finished);
    const merged = { ...delegationsRef.current };
    let changed = false;
    let chatIdToBind: string | undefined;
    for (const d of snap) {
      if (!chatIdToBind && d.chatId) chatIdToBind = d.chatId;
      if (merged[d.delegationId]) continue;
      if (!d.chatId) continue;
      merged[d.delegationId] = {
        delegationId: d.delegationId,
        chatId: d.chatId,
        // 播种的委派缺 triggerMsgId:补捕获 effect 会锚到最后一条 AI 消息(非原触发消息),
        // 卡片可能漂移到历史尾部——可接受(1591e53 兜底挂载)
        triggerMsgId: undefined,
        tasks: d.tasks.map((t) => ({
          index: t.index,
          agent: t.agent,
          task: t.task,
          title: t.description || t.title,
          detail: t.prompt,
          status: t.status,
        })),
        finished: false,
        startedAt: d.startedAt || Date.now(),
      };
      changed = true;
    }
    if (changed) {
      delegationsRef.current = merged;
      setDelegations(merged);
      // 快照播种的委派未走 progress 事件,状态栏「调用 Agent」信号自行补推
      const nowRunning = Object.values(merged).some((d) => !d.finished);
      if (!prevRunning && nowRunning) useStatusStore.getState().pushSignal(sidRef.current, "agent", "调用 Agent");
    }
    return chatIdToBind;
  }, []);

  // 对账:清除本地已不存在于主进程的卡死委派记录。只清「快照播种后事件流从未接管」的
  // 委派(盲窗期完成,终态事件被丢弃)→ 事件流接管的委派走自身终态/3s 收起路径,不被删。
  // 延迟确认再删(见 pendingReconcileRef):count 广播先于同一终态迁移的 progress 事件,
  // 紧随其后的终态 progress 会标记 finished/接管事件流——待删到期复查跳过即可,
  // 不破坏 1591e53 的逐委派 3s 收起展示
  const dropReconciledDelegations = useCallback((alive: Set<string>) => {
    const local = delegationsRef.current;
    const live = liveDelegationIdsRef.current;
    const pending = pendingReconcileRef.current;
    // 委派重新出现在 count/快照(仍运行)→ 取消待删,避免误清存活委派
    for (const id of [...pending.keys()]) {
      if (!alive.has(id)) continue;
      const t = pending.get(id);
      if (t) clearTimeout(t);
      pending.delete(id);
    }
    for (const d of Object.values(local)) {
      if (d.finished) continue;
      if (alive.has(d.delegationId)) continue;
      if (live.has(d.delegationId)) continue;
      if (pending.has(d.delegationId)) continue; // 已在待删队列
      pending.set(d.delegationId, setTimeout(() => {
        pending.delete(d.delegationId);
        const cur = delegationsRef.current[d.delegationId];
        // 到期复查:期间收到终态 progress(finished/事件流接管)或卡片已被其它路径移除 → 跳过
        if (!cur || cur.finished) return;
        if (liveDelegationIdsRef.current.has(d.delegationId)) return;
        const prevRunning = Object.values(delegationsRef.current).some((x) => !x.finished);
        const next = { ...delegationsRef.current };
        delete next[d.delegationId];
        delegationsRef.current = next;
        setDelegations(next);
        // 卡死委派被清后若已无运行中委派,补弹状态栏常驻信号(与 progress 事件路径对齐)
        const nowRunning = Object.values(next).some((x) => !x.finished);
        if (prevRunning && !nowRunning) useStatusStore.getState().popSignal(sidRef.current, "agent");
      }, 1500));
    }
  }, []);

  // ── 刷新后委派恢复(#18) ─────────────────────────
  // 委派卡片状态只靠流式事件(onDelegationInit/Progress)实时构建,Cmd+R 后事件流断开即
  // 丢失(主进程任务仍在跑)——先订阅事件(上面已注册)、再拉主进程快照播种缺失卡片。
  // resume 不重播 agent:chat-session → 刷新后 currentChatRef 恒 null,委派事件全被 chatId
  // 门卫丢弃(只拉快照会得到永不更新的静态卡片)——快照 join 回 chatId,播种后回填绑定
  // 门卫,事件流恢复实时更新。2.5s 后复拉一次:兜住「拉取与绑定之间完成」的委派
  // (终态事件被门卫丢弃 → 卡死常驻),对账清除
  useEffect(() => {
    if (!existingSid) return;
    let cancelled = false;
    const pull = async (allowDrop: boolean) => {
      const s = sidRef.current;
      if (!s || cancelled) return;
      let snap: DelegationSnapshotItem[] = [];
      try {
        snap = await window.electronAPI.agent.getDelegations(s);
      } catch (e) {
        console.error("[ChatPanel] 拉取运行中委派快照失败:", e);
        return;
      }
      if (cancelled) return;
      const chatIdToBind = seedDelegationSnapshot(snap);
      if (chatIdToBind && !currentChatRef.current) {
        currentChatRef.current = chatIdToBind;
        setCurrentRunId(chatIdToBind);
      }
      if (allowDrop) dropReconciledDelegations(new Set(snap.map((d) => d.delegationId)));
    };
    void pull(true);
    const verify = setTimeout(() => { void pull(true); }, 2500);
    return () => { cancelled = true; clearTimeout(verify); };
  }, [existingSid, seedDelegationSnapshot, dropReconciledDelegations]);

  // 对账兜底(agent:delegation-count 全局常驻、不受 chatId 门卫限制):主进程每个委派
  // 状态迁移都广播——快照播种的卡死委派从计数中消失(主进程已无它)即清掉
  useEffect(() => {
    const unsub = window.electronAPI.agent.onDelegationCount((data: { count: number; tasks: Array<{ delegationId: string; index: number; title: string }> }) => {
      dropReconciledDelegations(new Set(data.tasks.map((t) => t.delegationId)));
    });
    return unsub;
  }, [dropReconciledDelegations]);

  useEffect(() => {
    if (!existingSid) return; let cancelled = false;
    setSessionLoading(true);
    const projectDir = projectPath || getWorkspaceDir();
    (async () => {
        const buffered = await window.electronAPI.agent.getBufferedStream(existingSid);
        if (!cancelled && buffered.length > 0) {
          // 缓冲事件：仅全量替换临时显示（streaming 标记）；缓冲内容随后被 conv.messages 覆盖
          for (const raw of buffered) {
            const ev = raw as StreamEvent;
            const entries = mergeConsecutiveText(piEventToEntries(ev));
            if (entries.length > 0) {
              useChatStore.getState().replaceAiEntries(sidRef.current, entries);
            }
          }
        }
      if (cancelled) return; const snapshot = msgIdRef.current;
        let msgs = await window.electronAPI.conv.messages(existingSid, projectDir);
        // 历史为空 → 最多补 3 次（退避 400/800/1200ms）。新建项目/新建会话刚落盘时
        // 会话列表可能还没看到该会话，一次 500ms 重试不够就永久空白（本 effect 不会自行重跑）
        for (let attempt = 0; !cancelled && msgs.length === 0 && attempt < 3; attempt++) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          if (cancelled) return;
          msgs = await window.electronAPI.conv.messages(existingSid, projectDir);
        }
        if (!cancelled && msgs.length > 0 && msgIdRef.current <= snapshot) {
          const mapped = mapSessionMessages(msgs);
          // Restore image dataUrls from disk for history display (parallel)
          const loads: Promise<void>[] = [];
          for (const m of mapped) {
            if (m.attaches) {
              for (const a of m.attaches) {
                if (a.kind === "image" && !a.dataUrl && a.path) {
                  loads.push(
                    window.electronAPI.file.readUpload(a.path).then((url) => { a.dataUrl = url || ""; }).catch(() => {})
                  );
                }
              }
            }
          }
          if (loads.length > 0) await Promise.all(loads);
          // 写入 key 用 existingSid（本 effect 的入参，恒为真值），**不能用 `sid` 状态**：
          // 面板挂载后才拿到 sessionId 时（新建项目流程），effect 601 的 setSid 还没重渲染，
          // 此刻 `sid` 仍是临时 `__new_*` key —— 历史会被写进一个随后没人读的 key，
          // 聊天区永久空白（tab 有会话、有标题，却是空态）
          if (!cancelled && mapped.length > 0) { useChatStore.getState().loadSession(existingSid, mapped); msgIdRef.current = Math.max(...mapped.map((m) => m.id)); }
          // 加载完成 → 恢复会话缓存的使用率（延迟到此时：避免加载期间输入卡片显示旧进度误导）
          if (!cancelled && pendingCtxRef.current) {
            useStatusStore.getState().setCtxPct(existingSid, pendingCtxRef.current);
            pendingCtxRef.current = null;
          }
        }
        if (!cancelled) setSessionLoading(false);
    })();
    return () => { cancelled = true; };
  }, [existingSid, projectPath]);

  // 打断丢弃插话的提示（queue_dropped 事件）——输入卡片上沿，10s 自动消失。
  // 为什么需要它：插话气泡已乐观留在界面上，不提示的话用户会以为那几句还在队列里等着投递（实际已丢）。
  const [droppedQueue, setDroppedQueue] = useState<string[] | null>(null);
  const droppedQueueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (droppedQueueTimerRef.current) clearTimeout(droppedQueueTimerRef.current); }, []);

  useEffect(() => {
    const unsub = window.electronAPI.agent.onStream((event: StreamEvent) => {
      if (event.source === "worker") return;
      // 用户消息由主进程确认后广播给其它终端。发送它的 tab 已做乐观追加，按 sourceTabId 跳过；
      // 其它窗口/手机发来的消息在这里补入，保证同一会话多终端一致。
      if (event.type === "user_message" && event.sessionId === sidRef.current) {
        if (event.details?.sourceTabId === tabId) return;
        const messageId = typeof event.details?.messageId === "string" ? event.details.messageId : undefined;
        const existing = useChatStore.getState().messagesBySession[sidRef.current] || [];
        if (messageId && existing.some((message) => message.sourceMessageId === messageId)) return;
        useChatStore.getState().insertUserMsgAt(sidRef.current, {
          role: "user",
          text: event.text ?? "",
          timestamp: event.timestamp ?? Date.now(),
          streaming: true,
          sourceMessageId: messageId,
        }, event.timestamp ?? Date.now());
        latestAiIdRef.current = 0;
        busyRef.current = true;
        setBusy(true);
        useStatusStore.getState().pushSignal(sidRef.current, "request", "等待模型响应...");
        onActivity?.();
        return;
      }
      // 门卫读实时值（见 existingSidRef 声明处的说明），不看订阅时捕获的 existingSid
      if (!acceptStreamEvent({
        currentChatId: currentChatRef.current,
        ownSessionId: existingSidRef.current,
        eventRunId: event.runId,
        eventChatId: event.chatId,
        eventSessionId: event.sessionId,
      })) return;
      // 打断后:只丢弃被打断回合的残留帧;通知(新注入)正常渲染,新回合(turn_start)开始 → 恢复渲染。
      // (原实现 return 丢弃一切——打断通知/总结回合全被吞,磁盘有而 UI 无)
      // 但打断后 1.5s 内到的 turn_start 是**被打断回合自己的残留**(SDK 在回合内每个工具批次/续跑
      // 都会 emit turn_start)——不能让它把界面打回 busy「等待模型响应」
      if (stoppedRef.current) {
        if (event.type === "turn_start") {
          if (abortedRunPendingRef.current || Date.now() - interruptAtRef.current < 1500) return;
          stoppedRef.current = false;
        } else if (event.type !== "custom_event" && event.type !== "queue_dropped" && event.type !== "entry_appended") {
          // queue_dropped 放行:打断就是丢弃的触发者(session.abort 里先 clearQueue 再 abort),
          // 这条事件紧跟打断到达——被门卫丢掉就等于「丢弃提示永远不出现」
          // entry_appended 放行:重新生成后的提问即使立即打断也已落盘，气泡必须认领新条目 id。
          return;
        }
      }
      if (!currentChatRef.current) {
        const cid = event.chatId || event.runId;
        if (cid) { currentChatRef.current = cid; setCurrentRunId(cid); }
      }
      // error 后 1s 内的残留事件(tool_result/message_end 等)不重新设 busy——
      // error 分支已清 busy(回合结束),残留事件会把按钮打回打断态;新回合 turn_start 除外。
      // custom_event(系统消息通知)不设 busy:通知无回合,置 busy 后无 turn_end 可清(残留"等待模型响应")
      // session_info_changed(会话改名回执)同理:自动命名发生在 agent:exit 之后,
      // 回合已清 busy 才收到它——置 busy 就再无人清
      // retry_state(自动重试态)同理:它只是状态显示事件，不携带回合边界——重试期间 busy 由 turn_start 置着，
      // 本事件只负责换状态栏文本;走通用分支则打断取消后 SDK 补发的那条 auto_retry_end（那时回合已收尾）
      // 会把 busy 打回去且无人再清
      // queue_dropped(打断丢弃提示)同理:只描述队列，不携带回合边界——丢弃发生在打断之后(那时回合已收尾),
      // 走通用分支会把 busy 打回去且无人再清(卡在「等待模型响应…」)
      // entry_appended 也是落盘后的异步认领通知，可能晚于 agent_end/exit；不得重新置 busy。
      if (event.type === "custom_event" || event.type === "session_info_changed" || event.type === "retry_state"
        || event.type === "queue_dropped" || event.type === "entry_appended") {
        // 通知/状态类事件仅改显示,不触碰 busy
      } else if (event.type === "turn_start" || Date.now() - lastErrorAtRef.current > 1000) {
        setBusy(true);
      }
      // 输出段块(assistant 消息)内容帧处理:无当前块 → 按消息对象创建时间戳插入新块,
      // 有当前块 → 全量替换内容(帧是累计全文快照)。块 piTs 固定于创建时刻,通知按
      // 各自 ts 插到块之间,UI 顺序 = jsonl 落盘顺序(不依赖广播到达顺序)
      const handleBlocks = (blocks: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; content?: unknown; thinking?: string }>, frameTs: number) => {
        const rawEntries = piBlocksToEntries(blocks);
        if (rawEntries.length === 0) return;
        const hasText = rawEntries.some((e) => e.kind === "text");
        const hasThinking = rawEntries.some((e) => e.kind === "thinking");
        // 仅实际文本输出时结束「思考中」;thinking 流式帧保持「思考中」活跃——
        // 思考块还在增长说明 Mint 仍在思考,若信号曾被 tool 等路径 pop,这里恢复
        if (hasText) {
          useStatusStore.getState().popSignal(sidRef.current, "request");
        } else if (hasThinking && busyRef.current) {
          useStatusStore.getState().pushSignal(sidRef.current, "request", "正在思考...");
        }
        const entries = mergeConsecutiveText(rawEntries);
        if (latestAiIdRef.current) {
          useChatStore.getState().replaceAiEntriesById(sidRef.current, latestAiIdRef.current, entries);
        } else {
          latestAiIdRef.current = useChatStore.getState().insertUserMsgAt(sidRef.current, {
            role: "ai" as const, entries, timestamp: Date.now(), streaming: true,
            agentRole: event.agentRole, forwarded: event.forwarded, forwardedFrom: event.forwardedFrom,
          }, frameTs);
        }
        // 贴底跟随由 virtualizer anchorTo: "end" 原生处理(在底部时测量变化自动保持)
      };
      // Pi 新 assistant turn 开始 → 重置输出段块状态
      // (turn_start 不创建消息——磁盘上无空消息;首个内容帧才创建块)
      if (event.type === "turn_start") {
        // 重试退避等待结束(新一次尝试真跑起来了) → 清重试态:退避窗口已过,
        // 留着会让「正在重试 1/3（约 2 秒后）」挂到本次尝试结束(甚至重试成功后)
        useStatusStore.getState().popSignal(sidRef.current, "retry");
        // 回合开始 → 保持「等待模型响应」(同 id 更新)——turn_start 在 SDK 发起 API 请求前 emit,
        // 至首个响应块到达前状态栏语义 = 等待 API 返回;收到 thinking 块才转「正在思考」
        useStatusStore.getState().pushSignal(sidRef.current, "request", "等待模型响应...");
        latestAiIdRef.current = 0;
        steeringRef.current = false;
        // 不在此关闭压缩弹窗:turn_start 在回合内每个工具批次都会发,Mint 输出中触发弹窗会被
        // 下一批次秒关(一闪即逝)。关闭逻辑在 sendText(用户真实发起新消息)处
      }
      // message_start = 新输出段消息(磁盘逐条 assistant)开始:下个内容帧创建新块;
      // 非流式消息(message_start 携带完整内容)直接渲染
      if (event.type === "message_start") {
        latestAiIdRef.current = 0;
        if (Array.isArray(event.blocks) && event.blocks.length > 0) {
          handleBlocks(event.blocks, event.timestamp ?? Date.now());
        }
      }
      // Pi SDK message_update/end:帧 = 当前输出段消息的累计全文快照(替换不拼接)。
      // 块 piTs = 消息对象创建时间戳 → 通知按 ts 插到块之间,UI 顺序 = jsonl 顺序
      if (event.type === "message" && Array.isArray(event.blocks)) {
        handleBlocks(event.blocks, event.timestamp ?? Date.now());
        // 回合完整消息（message_end，partial=false）携带 usage → 挂到本回合 AI 消息
        if (!event.partial && event.usage && latestAiIdRef.current) {
          useChatStore.getState().setMessageUsage(sidRef.current, latestAiIdRef.current, event.usage);
        }
      }
      // entry_appended — 条目 id 回填(气泡 ↔ 会话条目 id 贯通):
      // 主进程在条目落盘后发出(SDK 不对普通 message 条目 emit entry_appended,见 event-bridge)。
      // assistant 气泡的 piTs 与落盘消息时间戳同源 → 精确匹配;
      // 本窗口发出去的 user 气泡时间戳是点击时刻(与落盘不等)→ 按发送队列认领(见 claimEntryBubble)。
      // 匹配不到就是正常降级(旧数据/其它终端发的消息/事件丢失):留空即可,由编辑入口置灰,
      // 不报错也不猜(猜错会让编辑撤回到错误的节点)
      if (event.type === "entry_appended" && event.entryId) {
        const store = useChatStore.getState();
        const msgs: ChatMessage[] = store.messagesBySession[sidRef.current] || [];
        const target = claimEntryBubble(msgs, event, pendingUserBubbleRef.current);
        if (target) store.setMessageEntryId(sidRef.current, target.id, event.entryId);
        else console.warn(`[chat] entry_appended 未认领到气泡(entry=${event.entryId} role=${event.entryRole} ts=${event.timestamp})——本窗口没发过这条消息(远端终端/旧数据)时属正常降级,该气泡入口置灰`);
      }
      // tool progress — 状态栏工具信号;shell 计数由后台命令事件驱动(agent:shell-count),
      // 不再按工具事件累加(前台瞬时工具不计入 shell•N)
      if (event.type === "tool_progress" && event.toolName) {
        const label = displayToolAction(event.toolName, event.toolArgs);
        // 开始执行工具 → 思考信号结束(否则 tool pop 后回退显示「正在思考」);
        // 按 toolCallId 区分信号——连续工具互不干扰(前一个 tool_done 不误 pop 后一个)
        useStatusStore.getState().popSignal(sidRef.current, "request");
        useStatusStore.getState().pushSignal(sidRef.current, `tool:${event.toolCallId ?? "?"}`, label);
        // 命令实时输出(bash 增量):按 toolCallId 累积成 tool_output 条目,展开区显示
        if (event.toolCallId && event.deltaText) {
          const msgs = useChatStore.getState().messagesBySession[sidRef.current] || [];
          const target = msgs.find((m) => m.id === latestAiIdRef.current);
          if (target && target.role === "ai") {
            const idx = target.entries.findIndex((e: { kind: string; toolUseId?: string }) => e.kind === "tool_output" && e.toolUseId === event.toolCallId);
            const prev = idx >= 0 ? String((target.entries[idx] as { text?: string }).text ?? "") : "";
            // 超长输出只留尾部:避免巨型字符串拖慢渲染(完整输出仍在模型上下文与日志)
            const text = (prev + event.deltaText).slice(-MAX_LIVE_OUTPUT_CHARS);
            const entry = { kind: "tool_output" as const, toolUseId: event.toolCallId, text, timestamp: event.timestamp ?? Date.now(), source: "chat" as const };
            const merged = idx >= 0
              ? target.entries.map((e: { kind: string; toolUseId?: string }, i: number) => (i === idx ? entry : e))
              : [...target.entries, entry];
            useChatStore.getState().replaceAiEntriesById(sidRef.current, target.id, merged);
          }
        }
      }
      // tool done — 工具执行结束,pop 自己的工具信号;
      // 回合仍在 → 显示「正在处理」(中性等待态,消除状态栏空档;
      // 下一步 turn_start 转「等待模型响应」/ thinking 帧转「正在思考」/ 文本帧 pop)
      if (event.type === "tool_done") {
        useStatusStore.getState().popSignal(sidRef.current, `tool:${event.toolCallId ?? "?"}`);
        if (busyRef.current) useStatusStore.getState().pushSignal(sidRef.current, "request", "正在处理...");
      }
      // tool_result — 工具执行结果(主进程 event-bridge 转发 toolResult 消息):
      // 按 toolCallId 追加 tool_result entry,渲染时关联到对应工具块显示结果
      if (event.type === "tool_result" && event.toolCallId) {
        const resultEntry = {
          kind: "tool_result" as const,
          toolUseId: event.toolCallId,
          name: event.toolName,
          content: event.content ?? "",          isError: event.isError ?? false,
          timestamp: event.timestamp ?? Date.now(),
          source: "chat" as const,
        };
        const msgs = useChatStore.getState().messagesBySession[sidRef.current] || [];
        const target = msgs.find((m) => m.id === latestAiIdRef.current);
        if (target && target.role === "ai") {
          // 幂等:同 toolUseId 已存在则替换(防重复到达导致重复追加)
          const existingIdx = target.entries.findIndex((e: { kind: string; toolUseId?: string }) => e.kind === "tool_result" && e.toolUseId === event.toolCallId);
          const merged = existingIdx >= 0
            ? target.entries.map((e: { kind: string; toolUseId?: string }, i: number) => i === existingIdx ? resultEntry : e)
            : [...target.entries, resultEntry];
          useChatStore.getState().replaceAiEntriesById(sidRef.current, target.id, merged);
        }
      }
      // compaction UI — compacting 事件 = SDK compaction_start = 压缩真实开始（显示蒙版）
      // 手动/自动统一在此显示：手动路径的 type=compact 只标记来源,不预显示
      if (event.type === "compacting") {
        useTabStore.getState().setSessionRunning(sidRef.current, true);
        busyRef.current = true; // 同步 busyRef(doCompact/steer 按它判断;压缩期间再点压缩应拦截)
        useStatusStore.getState().setCompacting(sidRef.current, true);
        useStatusStore.getState().pushSignal(sidRef.current, "compact",
          manualCompactingRef.current ? "正在整理会话..." : "检测到上下文需整理，正在整理…");
      }
      // compacted = 压缩完成：清除 compacting（蒙版消失）、
      // 并兜底清除 summarizing（防御轮转总结路径的残留）。压缩开始置 busy(compacting 事件
      // setSessionRunning(true))——此处必须恢复,否则空闲压缩后按钮卡"停止"态直到下条消息
      if (event.type === "compacted") {
        useStatusStore.getState().setCompacting(sidRef.current, false);
        useStatusStore.getState().setSummarizing(sidRef.current, false);
        useTabStore.getState().setSessionRunning(sidRef.current, false);
        busyRef.current = false;
        manualCompactingRef.current = false;
        // 压缩后 Pi 重发的帧是摘要内容 → 作为新输出段块处理
        latestAiIdRef.current = 0;
      }
      // error — 回合级错误(agent_error / stopReason=error):回合已结束 → 清 busy
      // (否则 SDK 错误回合 turn_start 设的 busy 残留,如打断抛 AbortError 后 Mint 无输出、按钮卡打断态);
      // 后续新回合 turn_start 会重新设 busy。插播错误信号 8s 后自动消失
      if (event.type === "error") {
        lastErrorAtRef.current = Date.now();
        busyRef.current = false; setBusy(false);
        useStatusStore.getState().popSignal(sidRef.current, "request");
        // 清重试态:重试耗尽的最终失败会同时带来 error(错误卡)与 auto_retry_end(SDK 源码里
        // agent_end 先于 auto_retry_end),两条都清一遍,别让"正在重试"留在信号栈里等到下一回合冒出来
        useStatusStore.getState().popSignal(sidRef.current, "retry");
        // 清工具信号:打断时 bash 工具执行信号("sleep 90" 等)残留栈里,
        // 不清理则提示消失后回退显示残留的工具信号
        useStatusStore.getState().popSignalsByPrefix(sidRef.current, "tool:");
        // 打断(abort)是主动操作,按钮状态变化即反馈——不显示提示;
        // 真实错误(503/429/超时)归一化后停留 8s(状态栏);同时写入消息流持久卡片可重试
        // 主进程有的路径已把 AbortError 归一化为「已停止」；按分类结果判定，
        // 否则英文原文被改写后反而会出现一张「已停止」错误卡。
        const info = classifyApiError(event.message);
        if (info.message !== "已停止") {
          useStatusStore.getState().pushSignal(sidRef.current, "error", info.message, 8000);
          showFlowError(event.operation === "compaction" ? "system" : "round", info.message, { tone: info.tone, ...(info.hint ? { hint: info.hint } : {}), ...(event.operation !== "compaction" && info.kind ? { errorKind: info.kind } : {}) });
        }
      }
      // retry_state — SDK 自动重试(退避等待)的状态显示:
      // 重试期间**不出失败卡**(那不是最终失败),状态栏显「正在重试 N/M（约 X 秒后）」;
      //   start → 入栈重试信号(同一 id 反复 push 只换文本,不堆叠);
      //   end → 出栈:成功回「正在处理…」(回合仍在,后续 turn_start 会接上「等待模型响应」);
      //         重试耗尽失败时 agent_end 已出错误卡(带错误原文),此处只清态不重复出卡;
      //         被用户打断取消(Retry cancelled)只清态——打断是主动操作,不出卡
      if (event.type === "retry_state") {
        if (event.retryPhase === "start") {
          useStatusStore.getState().pushSignal(sidRef.current, "retry",
            retryStatusText(event.retryAttempt ?? 1, event.retryMaxAttempts ?? 1, event.retryDelayMs ?? 0));
        } else {
          useStatusStore.getState().popSignal(sidRef.current, "retry");
          if (event.retrySuccess && busyRef.current) {
            useStatusStore.getState().pushSignal(sidRef.current, "request", "正在处理...");
          }
        }
      }
      // queue_dropped — 打断丢弃未投递插话：此前只有主进程日志，用户看到气泡还在界面上，
      // 会以为那些话还在队列里等着投递（实际已丢）→ 在这里出可见提示，说清几条、内容是什么
      if (event.type === "queue_dropped") {
        const dropped = event.queueDropped ?? [];
        setDroppedQueue(dropped.length > 0 ? dropped : null);
        if (droppedQueueTimerRef.current) clearTimeout(droppedQueueTimerRef.current);
        if (dropped.length > 0) {
          droppedQueueTimerRef.current = setTimeout(() => setDroppedQueue(null), DROPPED_NOTICE_MS);
        }
      }
      // custom 系统消息(委派完成/后台 shell/流程指令)→ 独立即时显示:
      // triggerTurn: false 注入,立即落盘 + 立即事件(带 streaming 标记,
      // loadSession 时被磁盘版本替代,不重复)
      // compacted 带 text（摘要卡）走同一条插入路径：实时显示这一张，重开会话时由磁盘的 compaction
      // 条目重建（见主进程 session-service）——摘要卡不再注入进模型上下文，两处显示同一份摘要
      if ((event.type === "custom_event" || event.type === "compacted") && event.text) {
        // 幂等:多 tab 的 ChatPanel 同时挂载都处理此事件——同一条通知
        // (同 Pi 落盘时间戳 + 同文本)只插入一次,防重复渲染
        const sysTs = event.timestamp ?? Date.now();
        const msgs = useChatStore.getState().messagesBySession[sidRef.current] || [];
        const dup = msgs.some((m) => m.customType === event.customType && m.text === event.text && m.sysTs === sysTs);
        if (!dup) {
          // 通知不开回合:仅当没有进行中的回合(无输出块)时恢复 idle——
          // 回合内到达的通知(用户消息触发的回合)保持 busy 不打断
          if (!latestAiIdRef.current) setBusy(false);
          // 按 Pi 落盘时间戳有序插入:通知插到其时间点之后的第一条消息前,
          // 与 jsonl 落盘顺序一致(广播到达顺序 ≠ 落盘顺序,不能 append)
          useChatStore.getState().insertUserMsgAt(sidRef.current, {
            role: "user" as const, text: event.text, timestamp: Date.now(), streaming: true,
            customType: event.customType, details: event.details, sysTs,
          }, sysTs);
        }
        // 贴底跟随由 virtualizer anchorTo: "end" 原生处理
      }
      // context usage update
      if (event.type === "context_usage") {
        useStatusStore.getState().setCtxPct(sidRef.current, event.percentage || 0);
      }
    });
    const unsubExit = window.electronAPI.agent.onExit(({ runId }: { runId: string }) => {
      if (pendingSendRef.current?.awaitingChatId) {
        // 同一会话不同回合会复用 chatId；回包前的 exit 可能属于旧回合，不能据此取消待补发的停止。
        return;
      }
      if (!currentChatRef.current) {
        return;
      }
      if (runId !== currentChatRef.current) return;
      // 被打断的回合已退场 → 后续事件按新回合对待（防 stoppedRef 卡住把真正的
      // 后续回合全吞掉）；下面的 1.5s 过滤只管「不重复清理界面状态」
      abortedRunPendingRef.current = false;
      stoppedRef.current = false;
      if (pendingSendRef.current && !pendingSendRef.current.awaitingChatId) pendingSendRef.current = null;
      if (Date.now() - interruptAtRef.current < 1500) return;
      latestAiIdRef.current = 0;
      busyRef.current = false; setBusy(false);
      useStatusStore.getState().popSignal(sidRef.current, "request");
      // 重试信号同样不能留给下一回合:回合异常收尾(如 launchPrompt 的兜底 error/exit)时
      // auto_retry_end 可能不再到达,残留文本会在下次 busy 时冒出来
      useStatusStore.getState().popSignal(sidRef.current, "retry");
      useStatusStore.getState().popSignalsByPrefix(sidRef.current, "tool:");
      onActivity?.();
      if (rearmAfterExitRef.current) { rearmAfterExitRef.current = false; ctxThresholdFiredRef.current = 0; }
      // 回合中点了压缩 → 回合已结束（空闲），现在执行待压压缩
      const pend = pendingCompactRef.current;
      if (pend) {
        pendingCompactRef.current = null;
        useStatusStore.getState().pushSignal(sidRef.current, "compact", "回合已结束，正在压缩上下文...");
        window.electronAPI.agent.compact(sidRef.current, pend.instructions || undefined).catch(() => {});
      }
    });
    const unsubSid = window.electronAPI.agent.onChatSession(({ sessionId: realSid, chatId: eventChatId }) => {
      if (currentChatRef.current && eventChatId !== currentChatRef.current) return;
      if (!currentChatRef.current && (!existingSid || realSid !== existingSid)) return;
      if (sidRef.current && sidRef.current !== realSid) {
        // Migrate messages from temp ID to real session ID, then evict temp
        const tempMsgs = useChatStore.getState().messagesBySession[sidRef.current];
        if (tempMsgs) {
          useChatStore.getState().loadSession(realSid, tempMsgs);
          useChatStore.getState().evictSession(sidRef.current);
        }
        // 便签跟随迁移（临时 sid → 真实 sid）；须在 sidRef.current 更新前调用
        usePinStore.getState().migrateSession(sidRef.current, realSid);
        // 清掉临时 sid 的 busy 标记(发送时按 temp 设置),再挂到真实 sid
        useTabStore.getState().setSessionRunning(sidRef.current, false);
        setSid(realSid);
        sidRef.current = realSid;
        useTabStore.getState().setSessionRunning(realSid, true);
        // 会话切换重置阈值防重标记(组件实例复用,不重置会残留上个会话的 threshold → 新会话不弹窗)
        ctxThresholdFiredRef.current = 0;
        // 新会话创建前的等级选择(sid 为空时写不进缓存)→ 现在补写持久化
        if (pendingThinkingLevelRef.current) {
          window.electronAPI.sessionCache.write(realSid, { thinkingLevel: pendingThinkingLevelRef.current }).catch(() => {});
          pendingThinkingLevelRef.current = null;
        }
        // 权限模式同样补写真实 sid（临时 sid 阶段切换只进了 state/临时缓存，主进程 canUseTool
        // 按真实 sid 读——不补写则重启后恢复不到、会话内切换也读不到）
        window.electronAPI.sessionCache.write(realSid, { permissionMode: permissionModeRef.current }).catch(() => {});
        // 会话级模型/供应商补写（同类缺口）：首条消息前选的模型只写进了 __new_xxx 临时 key，
        // 不补写则重启恢复会话时缓存读不到 → 回落全局默认模型，会话级模型绑定丢失
        if (chatModelRef.current || chatProviderRef.current) {
          const m: Record<string, unknown> = {};
          if (chatModelRef.current) m.model = chatModelRef.current;
          if (chatProviderRef.current) m.provider = chatProviderRef.current;
          window.electronAPI.sessionCache.write(realSid, m).catch(() => {});
        }
        // 新会话重新跟随全局默认思考等级:"手动切过不再跟随"只限本会话生命周期,
        // 否则长驻 tab 实例一旦手动改过,设置里更新全局默认永远不生效。
        // 会话创建前的选择(manualThinkingSidRef=null)属本会话,不覆盖。
        if (userChangedThinkingRef.current && manualThinkingSidRef.current !== null && manualThinkingSidRef.current !== realSid) {
          userChangedThinkingRef.current = false;
          const g = useSettingsStore.getState().chatThinkingLevel;
          if (g) applyLevel(g);
        }
        onSessionCreated?.(realSid);
      } else if (!sidRef.current) {
        sidRef.current = realSid;
        setSid(realSid);
        useTabStore.getState().setSessionRunning(realSid, true);
        if (pendingThinkingLevelRef.current) {
          window.electronAPI.sessionCache.write(realSid, { thinkingLevel: pendingThinkingLevelRef.current }).catch(() => {});
          pendingThinkingLevelRef.current = null;
        }
        // 补写权限模式与会话级模型/供应商（与分支 1 对齐，防 sidRef 为空路径的同类缺口）
        window.electronAPI.sessionCache.write(realSid, { permissionMode: permissionModeRef.current }).catch(() => {});
        if (chatModelRef.current || chatProviderRef.current) {
          const m2: Record<string, unknown> = {};
          if (chatModelRef.current) m2.model = chatModelRef.current;
          if (chatProviderRef.current) m2.provider = chatProviderRef.current;
          window.electronAPI.sessionCache.write(realSid, m2).catch(() => {});
        }
        if (userChangedThinkingRef.current && manualThinkingSidRef.current !== null && manualThinkingSidRef.current !== realSid) {
          userChangedThinkingRef.current = false;
          const g2 = useSettingsStore.getState().chatThinkingLevel;
          if (g2) applyLevel(g2);
        }
        onSessionCreated?.(realSid);
      }
      // 首条消息会话已建立 → 关闭首轮窗口（ask 广播按真实 sid 过滤即可，见订阅处）
      pendingFirstTurnRef.current = false;
    });
    // 主进程侧模型切换（skill frontmatter model 字段触发）→ 会话级显示跟随；
    // 只更新本会话 chatModel（触发既有 effect 写 session-cache 持久化），不动全局默认模型
    const unsubModel = window.electronAPI.agent.onModelChanged(({ sessionId: modelSid, model }) => {
      if (sidRef.current && sidRef.current !== modelSid) return;
      if (!sidRef.current && existingSid && modelSid !== existingSid) return;
      if (model) setChatModel((prev) => (model !== prev ? model : prev));
    });
    // 主进程回传实际生效的思考等级（切模型后 SDK 会按模型能力推导/clamp）→
    // 界面按真实值显示，避免"下拉显示最高、实际 off"
    const unsubLevel = window.electronAPI.agent.onThinkingLevelChanged(({ sessionId: lvlSid, level, available }) => {
      if (sidRef.current && sidRef.current !== lvlSid) return;
      if (!sidRef.current && existingSid && lvlSid !== existingSid) return;
      if (!level) return;
      if (available && available.length > 0) setThinkingLevels(available);
      // 与用户所选不同 = 被模型能力裁剪(或按模型设置覆盖),记录实际值供界面说明
      const desired = desiredThinkingRef.current ?? thinkingLevelRef.current;
      setCappedThinkingLevel(level === desired ? null : level);
      setThinkingLevel((prev) => (prev === level ? prev : level));
    });
    const unsubPermission = window.electronAPI.agent.onPermissionModeChanged(({ sessionId: permissionSid, mode }) => {
      if (sidRef.current && sidRef.current !== permissionSid) return;
      if (!sidRef.current && existingSid && permissionSid !== existingSid) return;
      setPermissionMode(mode);
    });
    // Context rotation events — filter by chatId
    const unsubCtxSum = window.electronAPI.agent.onContextSummarizing(({ chatId: ctxChatId, type }: { chatId: string; type?: string }) => {
      if (!currentChatRef.current) return;
      if (ctxChatId !== currentChatRef.current) return;
      if (type === "done") {
        // 压缩/总结结束兜底:清除压缩蒙版与总结状态(compacted 可能因中止不广播),
        // 并恢复 busy(压缩置位后此处兜底清——防 compacted 未达时残留)
        useStatusStore.getState().setCompacting(sidRef.current, false);
        useStatusStore.getState().setSummarizing(sidRef.current, false);
        useStatusStore.getState().popSignal(sidRef.current, "summary");
        useStatusStore.getState().popSignal(sidRef.current, "compact");
        useTabStore.getState().setSessionRunning(sidRef.current, false);
        busyRef.current = false;
        manualCompactingRef.current = false;
        // 压缩完成 = 新周期,重置阈值防重标记——不依赖 pct<55 兜底
        // (压缩失败/跳过/弹窗关闭等残留都会导致 ref 卡在 threshold,75% 后不再弹窗)
        ctxThresholdFiredRef.current = 0;
        return;
      }
      if (type === "compact") {
        // 手动压缩:仅标记手动来源(compacting 事件据此区分文案);
        // 不预显示蒙版——显示跟随 SDK compaction_start(compacting 事件),
        // SDK 未真正开始压缩(如 abort 挂起)则不显示,避免误导用户
        manualCompactingRef.current = true;
        return;
      }
      // summary 路径(轮转总结)
      useStatusStore.getState().pushSignal(sidRef.current, "summary", "正在整理并开启新会话...");
      useStatusStore.getState().setSummarizing(sidRef.current, true);
    });
    const unsubCtxUsage = window.electronAPI.agent.onContextUsage(({ chatId: ctxChatId, percentage, maxTokens }) => {
      if (!currentChatRef.current) return;
      if (ctxChatId !== currentChatRef.current) return;
      // percentage: null = 压缩后尚无新回复(显示"—");undefined = 仅更新窗口,百分比保持原值
      const pct = percentage === undefined ? undefined : percentage === null ? null : Math.round(percentage);
      // maxTokens = 当前模型的上下文窗口(改模型参数后随之变化,hover 显示)
      useStatusStore.getState().setCtxPct(sidRef.current, pct, maxTokens ?? undefined);
      if (sidRef.current && !sidRef.current.startsWith("__new_")) {
        window.electronAPI.sessionCache.write(sidRef.current, { contextUsage: pct }).catch(() => {});
      }
      // 主动压缩：使用率达到设置阈值就弹窗询问（不直接压缩——用户可跳过或带命令压缩）。
      // 回合中(busy)不弹——SDK 压缩需会话空闲,输出中点击会导致 abort 后压缩竞态失败;
      // 回合结束的强制上报(成功/错误路径)会再次触发此判断,届时空闲自然弹窗
      const threshold = useSettingsStore.getState().contextThreshold || 75;
      const sid = sidRef.current;
      const st = useStatusStore.getState().bySession[sid];
      const runningNow = useTabStore.getState().runningSessions.has(sid);
      if (
        pct != null &&
        pct >= threshold &&
        !runningNow &&
        !st?.compacting && !st?.summarizing &&
        ctxThresholdFiredRef.current !== threshold &&
        currentChatRef.current
      ) {
        ctxThresholdFiredRef.current = threshold;
        console.log(`[ChatPanel] ctx ${pct}% ≥ ${threshold}% → 弹窗询问压缩`);
        setCompactDialog({ source: "auto", threshold });
      }
      // 使用率显著回落（压缩完成）后允许再次触发
      if (pct != null && pct < threshold - 20) ctxThresholdFiredRef.current = 0;
    });
    return () => { unsub(); unsubExit(); unsubSid(); unsubModel(); unsubLevel(); unsubPermission(); unsubCtxSum(); unsubCtxUsage(); if (sidRef.current) { useTabStore.getState().setSessionRunning(sidRef.current, false); if (!sidRef.current.startsWith("__new_")) { window.electronAPI.agent.scheduleIdleTimeout(sidRef.current, 10 * 60 * 1000); } } useStatusStore.getState().reset(sidRef.current); };
  }, []);

  // Summarizing timeout — 120s safety net
  useEffect(() => {
    if (!summarizing) return;
    const timer = setTimeout(() => {
      useStatusStore.getState().setSummarizing(sidRef.current, false);
      useStatusStore.getState().popSignal(sidRef.current, "summary");
      const msg = "摘要超时，将开新会话继续";
      useStatusStore.getState().pushSignal(sidRef.current, "error", msg, 8000);
      showFlowError("system", msg);
      console.error("[ChatPanel] summarization timed out after 120s");
    }, 120_000);
    return () => clearTimeout(timer);
  }, [summarizing]);

  // Compacting timeout — 120s safety net:压缩状态异常(summarization 调用挂起)时恢复界面。
  // 只恢复显示,不中断 SDK 压缩(压缩可能仍在后台,完成后 compacted 事件会清状态)
  useEffect(() => {
    if (!compacting) return;
    const timer = setTimeout(() => {
      useStatusStore.getState().setCompacting(sidRef.current, false);
      useStatusStore.getState().popSignal(sidRef.current, "compact");
      const msg = "压缩状态异常，已恢复界面（压缩可能仍在后台）";
      useStatusStore.getState().pushSignal(sidRef.current, "error", msg, 8000);
      showFlowError("system", msg);
      console.error("[ChatPanel] compaction timed out after 120s");
    }, 120_000);
    return () => clearTimeout(timer);
  }, [compacting]);

  // 忙碌态兜底（O3）：busy 为真时每 5s 问一次主进程「这个会话还在占着吗」，连续 2 次报空闲才清
  //（≈10s 宽限，见 chat-utils.stepBusyProbe）。为什么需要它：界面 busy 全靠事件推演，丢一条
  // turn_end / agent_end 就卡在忙碌态（历史多次），而事件是没法补发的——只能拿主进程的登记去对账。
  // 清理动作与打断路径一致（busyRef + store + 回合信号）；**只清忙碌态这一项**，
  // abortedRunPendingRef/stoppedRef 等状态机字段各有主人，不在兜底职责内。
  // 临时 __new_* 会话不探测：主进程查不到这个 id（真实 id 在 SDK 侧生成），探测恒为空闲，
  // 查两次就会把「新会话首条消息正在跑」误清。退出条件是三个：非 busy（依赖变化即清理）、
  // 组件卸载、会话切换（sid 变化 → 依赖变化 → 清理重开，计数从头数）。
  useEffect(() => {
    if (!busy || sid.startsWith("__new_")) return;
    let consecutiveIdle = 0;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { stopped = true; if (timer !== null) clearInterval(timer); };
    // sdkIdle 只用于排查、不参与判定：主进程报忙而 SDK 报空闲的**持续**错配，是「本进程回合登记未清」
    // 那类的签名——本兜底清不了它（判定只看 busy），但至少让它在日志里看得见，而不是无声卡住。
    let mismatchStreak = 0;
    let mismatchLogged = false;
    const probe = async () => {
      let state: { busy: boolean; sdkIdle: boolean };
      try {
        state = await window.electronAPI.agent.busyState(sid);
      } catch (e) {
        // 查询失败不推进计数：IPC 异常不该被当成「主进程说空闲」
        console.error("[ChatPanel] 忙碌态兜底查询失败:", e);
        return;
      }
      if (stopped) return;
      const step = stepBusyProbe(consecutiveIdle, state.busy);
      consecutiveIdle = step.consecutiveIdle;
      // 同一个「连续 2 次」口径：单次错配可能只是状态切换的瞬间（主进程先登记、SDK 后置运行标志）
      mismatchStreak = state.busy && state.sdkIdle ? mismatchStreak + 1 : 0;
      if (!mismatchLogged && mismatchStreak >= BUSY_PROBE_CLEAR_STREAK) {
        mismatchLogged = true;
        console.warn(`[chat] 忙碌态错配：主进程报忙、SDK 报空闲（连续 ${mismatchStreak} 次探测）session=${sid}——回合登记未清那类，本兜底不清它（判定只看 busy），留日志供排查`);
      }
      if (!step.clear) return;
      // 清完立刻停：不等 busy 变假后依赖触发的清理，避免 "清理还没渲染、定时器又探一次" 重复记账
      stop();
      console.warn(`[chat] 忙碌态兜底触发：主进程连续 ${BUSY_PROBE_CLEAR_STREAK} 次报会话空闲，已清理界面忙碌态（session=${sid} sdkIdle=${state.sdkIdle}）——若频繁出现，说明有事件在丢失`);
      busyRef.current = false;
      setBusy(false);
      useStatusStore.getState().popSignal(sid, "request");
      useStatusStore.getState().popSignalsByPrefix(sid, "tool:");
    };
    timer = setInterval(() => { void probe(); }, BUSY_PROBE_INTERVAL_MS);
    return stop;
  }, [busy, sid]);

  // 打开会话（0 → N 条）贴底：virtualizer.scrollToIndex 官方 API——
  // scrollState 在测量变化时持续校正对齐直到稳定(库原生处理估算→实测,正规手段)。
  // 流式跟随由 anchorTo: "end" 自动处理(在底部时内容增长保持贴底),不再手动贴底。
  // 依赖 scrollEl:首次渲染时 scrollEl 为 null,scrollToIndex 会 no-op(找不到滚动元素),
  // 等 attachScrollRef 绑定后(state 更新触发重渲染)再贴
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    if (messages.length > 0 && prevMsgCountRef.current === 0 && scrollEl) {
      // 打开会话:先滚到估算底,后续测量推进由上方 totalSize effect 自动贴底跟进
      // (每次 totalSize 变化都贴,测量多久都最终精确——不再等收敛/多点贴底)
      autoScrollRef.current = true;
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
      prevMsgCountRef.current = messages.length;
    }
    // scrollEl 未就绪时不更新 prevMsgCountRef——等就绪后 effect 重跑再贴底
  }, [messages, virtualizer, scrollEl]);

  // ── Session cache ────────────────────────────────
  useEffect(() => {
    // 切换会话：两个标记都重置——恢复完成前不写缓存（防未就绪值覆盖）、也不跟随全局
    permissionHydratedRef.current = false;
    sessionPermissionOwnedRef.current = false;
    sessionModelOwnedRef.current = !existingSid;
    sessionThinkingOwnedRef.current = !existingSid;
    if (!existingSid) { permissionHydratedRef.current = true; sessionHydrationRef.current = Promise.resolve(); return; }
    const hydration = window.electronAPI.sessionCache.read(existingSid).then((cache) => {
      if (cache) {
        // 恢复权限模式（旧四档值 auto/plan/acceptEdits/bypassPermissions 归一化为两档，
        // 避免开关拿到未知值显示异常——主进程 normalizeMode 同样映射）
        if (cache.permissionMode) {
          sessionPermissionOwnedRef.current = true;
          const m = cache.permissionMode;
          setPermissionMode(
            m === "full" || m === "bypassPermissions" ? "full"
              : m === "readonly" || m === "restricted" || m === "sandbox" ? "readonly"
                : "standard",
          );
        }
        if (cache.model) setChatModel(cache.model);
        if (cache.provider) setChatProvider(cache.provider);
        // 历史缓存曾只写 model、不写 provider；半截身份不能安全覆盖 transcript。
        if (cache.model && cache.provider) sessionModelOwnedRef.current = true;
        if (cache.contextUsage !== null && cache.contextUsage > 0) pendingCtxRef.current = cache.contextUsage; // 暂存,消息加载完成后再应用
        // 会话绑定的供应商(设置中切供应商时写入)→ 活跃会话热切应用;
        // 未活跃时会话由重建分支用 preferredProvider 恢复,无需在此处理
        if (cache.model && cache.provider) {
          window.electronAPI.agent.setModel(existingSid, cache.model, cache.provider).catch(() => {});
        }
        // 恢复本会话持久化的思考等级:标为"已选过",全局设置不再覆盖;并按模型能力自适应显示
        if (cache.thinkingLevel) {
          sessionThinkingOwnedRef.current = true;
          userChangedThinkingRef.current = true;
          desiredThinkingRef.current = cache.thinkingLevel;
          applyLevel(cache.thinkingLevel);
        }
      }
    }).catch(() => {}).finally(() => { permissionHydratedRef.current = true; });
    sessionHydrationRef.current = hydration;
    // 打开会话即同步「该模型支持的思考等级 + 当前生效等级」——广播只在切模型/发消息时触发,
    // 只靠广播的话刚打开会话、还没发消息前下拉仍是完整 7 档
    window.electronAPI.agent.getThinkingLevels(existingSid).then((info) => {
      if (!info) return;
      if (info.available && info.available.length > 0) setThinkingLevels(info.available);
      if (info.level) setThinkingLevel((prev) => (prev === info.level ? prev : info.level!));
    }).catch(() => {});
  }, [existingSid]);

  useEffect(() => {
    permissionModeRef.current = permissionMode;
    // 恢复完成前不写：否则未就绪的初始值会把磁盘上的会话级权限覆盖掉（见 permissionHydratedRef）
    if (!permissionHydratedRef.current) return;
    // 仅真实会话 id 才写缓存：新会话在发首条消息前的 sid 是 __new_xxx 临时 id，
    // 写入临时 key 主进程读不到（真实 id 由 onChatSession 回绑时补写，见下）
    if (sidRef.current && !sidRef.current.startsWith("__new_")) {
      window.electronAPI.sessionCache.write(sidRef.current, { permissionMode }).catch(() => {});
    }
  }, [permissionMode]);

  // 全局默认权限模式异步到达后，若本会话没有自己的持久化值则跟随（新建会话场景：
  // 首帧的 globalPermissionMode 可能还是 store 默认 standard，真实值到达后同步一次）
  useEffect(() => {
    if (!permissionHydratedRef.current) return;
    if (sessionPermissionOwnedRef.current) return;
    if (!globalPermissionMode) return;
    setPermissionMode(globalPermissionMode);
  }, [globalPermissionMode, existingSid]);

  // 按当前模型同步「支持的思考等级」——不依赖会话是否创建(会话要等首条消息才存在),
  // 所以直接按模型 ID 查:新建会话、恢复会话、下拉切模型三种场景都能立即收敛档位列表
  const supportModelId = chatModel || storeModel;
  useEffect(() => {
    if (!supportModelId) return;
    let cancelled = false;
    window.electronAPI.agent.getModelThinkingSupport(supportModelId).then((levels) => {
      if (cancelled) return;
      const supported = levels && levels.length > 0 ? levels : null;
      setThinkingLevels(supported);
      if (!supported) return;
      // 关键：不只收敛选项，选中值也要自适应——否则全局设了模型不支持的档位时，
      // 下拉找不到对应中文名会直接显示英文原名（如 "minimal"）
      // 显式传入 supported：ref 此时还是旧值，传了才能保证页面加载时就完成自适应
      applyLevel(desiredThinkingRef.current ?? thinkingLevelRef.current, supported);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [supportModelId, applyLevel]);

  useEffect(() => {
    if (existingSid && (!permissionHydratedRef.current || !sessionModelOwnedRef.current)) return;
    if (sidRef.current && !sidRef.current.startsWith("__new_") && chatModel) {
      // provider 一并持久化——读取端按 model+provider 恢复会话绑定供应商,此前 provider 从未写入导致恢复热切永不执行
      const data: Record<string, unknown> = { model: chatModel };
      if (chatProvider) data.provider = chatProvider;
      window.electronAPI.sessionCache.write(sidRef.current, data).catch(() => {});
    }
  }, [chatModel, chatProvider]);

  // ── Send ───────────────────────────────────────────

  /** 主进程确认无产出撤回后，把页面同步到该分支；新消息已开始时不覆盖它的乐观气泡。 */
  const applyStopRewind = useCallback(async (
    result: { rewound: boolean; stopTimedOut?: boolean },
    sourceMsgId: number | undefined,
    stoppedSid: string,
    stopVersion: number,
  ) => {
    if (sidRef.current !== stoppedSid) return;
    if (result.stopTimedOut) {
      busyRef.current = true;
      setBusy(true);
      useStatusStore.getState().pushSignal(stoppedSid, "error", "停止尚未完成，当前会话仍在处理，请稍后重试", 10000);
      return;
    }
    if (!result.rewound) return;
    const store = useChatStore.getState();
    if ((store.msgIdBySession[stoppedSid] ?? 0) > stopVersion) return;
    if (sourceMsgId != null) {
      store.truncateFrom(stoppedSid, sourceMsgId);
      pendingUserBubbleRef.current = pendingUserBubbleRef.current.filter((item) => item.id < sourceMsgId);
      return;
    }
    // 本窗口没有发送气泡（例如恢复运行中的会话后按停止）：从磁盘读取真实分支。
    try {
      const history = await window.electronAPI.conv.messages(stoppedSid, projectPath || getWorkspaceDir());
      if (sidRef.current !== stoppedSid || (useChatStore.getState().msgIdBySession[stoppedSid] ?? 0) > stopVersion) return;
      useChatStore.getState().evictSession(stoppedSid);
      useChatStore.getState().loadSession(stoppedSid, mapSessionMessages(history));
    } catch (e) {
      console.error("[chat] 打断撤回后重载页面失败:", e);
    }
  }, [projectPath]);

  const sendText = useCallback(async (text: string, opts?: { skipAppend?: boolean; sourceMsgId?: number; afterRewind?: boolean; forceNewTurn?: boolean; omitImages?: boolean }) => {
    // 上一次发送尚未拿到 chatId（或正补发停止）时先排队；回包后按实时 busyRef 决定插话/新回合。
    // 直接 return 会吞掉用户刚发的消息。
    const previousPending = pendingSendRef.current;
    if (previousPending?.awaitingChatId) await previousPending.ready;
    const sendSessionId = resolveSendSessionId(existingSid, previousPending?.resolvedSessionId, sidRef.current);
    // 错误卡片重试(sourceMsgId):原文与附件以失败消息气泡为准——此时输入框可能已清空/改写,
    // 重发必须还原当时的附件(图片 dataUrl 等)
    let retryMsg: ChatMessage | null = null;
    if (opts?.sourceMsgId != null) {
      const stored = useChatStore.getState().messagesBySession[sidRef.current] || [];
      retryMsg = stored.find((m) => m.id === opts.sourceMsgId && m.role === "user") || null;
      if (!retryMsg) {
        // 气泡已被会话切换/裁剪移除；不能误用当前输入框的内容与附件。
        useStatusStore.getState().pushSignal(sidRef.current, "error", "原提问已变化，无法重新发送，请重新打开会话", 8000);
        return;
      }
    }
    const msg = (retryMsg ? (retryMsg.text ?? "") : text).trim();
    const activeAttaches = retryMsg ? (retryMsg.attaches ?? []) : attaches;
    if (!msg && activeAttaches.length === 0) return;
    // 用户发新消息 → 关闭压缩询问(继续对话 = 弹窗作废;选项 1/4 会 abort 新回合,不能误打断)。
    // 关闭动作放发送入口而非 turn_start——turn_start 回合内每工具批次都发,会误关 Mint 输出中
    // 刚弹出的自动压缩弹窗(一闪即逝)
    setCompactDialog(null);
    // 用户发新消息 → 取消当前会话挂起的 ask_user（对齐 cc：发消息 = 转向，提问等待无意义）
    const asks = useAskStore.getState().asks;
    for (const k in asks) {
      if (asks[k]!.sessionId === sidRef.current) {
        window.electronAPI.agent.respondAsk(k, null);
        useAskStore.getState().clearAsk(k);
      }
    }
    // learn 已改为模型自主入库（无审阅卡片），发新消息不再需要取消挂起
    // 重入保护:新会话首条消息在途(onChatSession 绑定真实 sid 前)时再发送 → 丢弃。
    // 否则会再建第二个会话、首回合回复丢失;已有会话时走下方 steer 插话分支,不受影响
    if (busyRef.current && !sendSessionId) return;

    // 只有成功编码的图片才作为图像传给模型；其余图片保留路径并明确提示模型按需读取。
    // SVG 的 image/svg+xml 不符合当前图像编码格式，不能只显示路径标签却漏掉读取提示。
    const { images, imageCount } = encodeAttachedImages(activeAttaches, opts?.omitImages);
    const hasPathOnlyImage = imageCount > images.length;

    // Build agent message with numbered markers
    const parts: string[] = [];
    activeAttaches.forEach((a, i) => {
      const tag = a.kind === "image" ? "Image" : "File";
      parts.push(`[${tag} #${i + 1}: ${a.path}]`);
    });
    if (hasPathOnlyImage) {
      parts.push(images.length === 0 ? IMAGE_PATH_ONLY_NOTE : IMAGE_PARTIAL_PATH_NOTE);
    }
    if (msg) parts.push(msg);
    const agentText = parts.join("\n");

    const ts = Date.now();
    // 编辑重发/错误重试(skipAppend):气泡已存在,不再 append 新气泡
    let sentMsgId: number | null = null;
    if (!opts?.skipAppend) {
      sentMsgId = useChatStore.getState().appendUserMsg(sidRef.current, { role: "user", text: msg || undefined, attaches: [...activeAttaches], timestamp: ts });
    } else if (retryMsg) {
      sentMsgId = retryMsg.id;
    }
    // 入队 + 清旧 id:复用的气泡(编辑重发/错误重试)身上可能挂着**上一条**条目的 id——
    // 那条条目随重发已失效(被撤回、或重发后不在当前分支上),留着会让第二次编辑撤到旧节点而报
    // 「目标消息不在当前对话分支上」。清空后气泡回到「未认领」,本次新条目落盘后重新认领它
    // (见 chat-utils.claimEntryBubble)。
    if (sentMsgId != null) {
      if (opts?.skipAppend) useChatStore.getState().setMessageEntryId(sidRef.current, sentMsgId, undefined);
      pendingUserBubbleRef.current.push({ id: sentMsgId, ts });
    }
    // 首条消息:输入卡片从居中平滑下移到底部(FLIP)
    if (!messages.length && !sendSessionId) {
      startCardLeave();
    }
    // 新用户消息 → 重置输出段块状态(steer 插话不触发 turn_start 时兜底)
    latestAiIdRef.current = 0;
    if (!opts?.skipAppend) {
      setAttaches([]);
    }
    // 复用旧提问气泡（编辑、重新生成、错误重试）也是真实的新发送：解除上轮停止门卫、
    // 更新会话活动时间并滚到新回答位置，随后走同一套 busy/状态栏/流式事件流程。
    onActivity?.();
    stoppedRef.current = false; autoScrollRef.current = true; scrollToBottom(true);

    if (sentMsgId != null && imageCount > 0) {
      useChatStore.getState().setImagesPathOnly(sidRef.current, sentMsgId, images.length === 0);
    }

    // Mint 输出期间发送消息 → steer 插话，不需新建会话
    if (sendSessionId && shouldSteerSend({ forceNewTurn: opts?.afterRewind || opts?.forceNewTurn, busy: busyRef.current, chatId: currentChatRef.current, existingSession: true })) {
      steeringRef.current = true;
      try {
        await window.electronAPI.agent.steer(sendSessionId, agentText, images.length > 0 ? images : undefined, tabId);
      } catch { /* steer 失败不影响 UI */ }
      return;
    }

    let resolveReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    const pendingSend: NonNullable<typeof pendingSendRef.current> = {
      preservePromptOnStop: opts?.skipAppend === true,
      sourceMsgId: sentMsgId ?? undefined,
      stopRequested: false,
      abortIssued: false,
      awaitingChatId: true,
      ready,
      resolveReady,
    };
    pendingSendRef.current = pendingSend;
    busyRef.current = true; setBusy(true); useStatusStore.getState().pushSignal(sidRef.current, "request", "等待模型响应...");
    // 新会话首条消息窗口开启：onChatSession 回绑真实 sid 后关闭（见订阅处）
    if (!sendSessionId) pendingFirstTurnRef.current = true;

    try {
      currentChatRef.current = null;
      const tab = useTabStore.getState().tabs.find(function(t) { return t.sessionId === sid || (!t.sessionId && !existingSid); });
      const effectivePath = projectPath || getWorkspaceDir();
      // Cache ownership decides whether values may override the transcript. Wait for that small
      // local read so a very fast first send cannot race hydration and discard an explicit choice.
      await sessionHydrationRef.current;
      // 新会话:角色取自空状态选择(chatRole);恢复会话:沿用 tab 的 isDesigner
      const roleDesigner = sendSessionId ? (isDesigner ?? tab?.isDesigner) : chatRole === "mint-d";
      const overrides = sessionOverrides({
        existingSession: !!sendSessionId,
        modelOwned: sessionModelOwnedRef.current,
        thinkingOwned: sessionThinkingOwnedRef.current,
        model: chatModel || undefined,
        provider: chatProvider || undefined,
        thinkingLevel: thinkingLevel ?? "medium",
      });
      const result = await window.electronAPI.agent.sendMessage(effectivePath, agentText, { sessionId: sendSessionId, permissionMode: permissionMode ?? "standard", isDesigner: roleDesigner, images: images.length > 0 ? images : undefined, thinkingLevel: overrides.thinkingLevel, model: overrides.model, preferredProvider: overrides.provider, tabId });
      pendingSend.resolvedSessionId = result.sessionId;
      setCurrentRunId(result.chatId); currentChatRef.current = result.chatId;
      if (needsDeferredStop(pendingSend)) {
        pendingSend.abortIssued = true;
        void window.electronAPI.agent.abort(result.chatId, { clearQueue: true, rewind: !pendingSend.preservePromptOnStop })
          .then((result) => applyStopRewind(result, pendingSend.sourceMsgId, pendingSend.stopSid ?? sidRef.current, pendingSend.stopVersion ?? 0))
          .catch((e) => { console.error("[chat] 延迟打断失败:", e); })
          .finally(() => {
            pendingSend.awaitingChatId = false;
            pendingSend.resolveReady();
            if (pendingSendRef.current !== pendingSend) return;
            pendingSendRef.current = null;
            abortedRunPendingRef.current = false;
            stoppedRef.current = false;
          });
      } else {
        pendingSend.awaitingChatId = false;
        pendingSend.resolveReady();
      }
    } catch {
      pendingSend.awaitingChatId = false;
      pendingSend.resolveReady();
      if (pendingSendRef.current === pendingSend) pendingSendRef.current = null;
      abortedRunPendingRef.current = false;
      pendingFirstTurnRef.current = false; busyRef.current = false; setBusy(false); currentChatRef.current = null;
      const errText = "发送失败，请检查网络后重试";
      useStatusStore.getState().pushSignal(sidRef.current, "error", errText, 8000);
      // 同步写入消息流持久错误卡片(锚定刚追加/重试的用户消息,可点重试重新发送)。
      // afterRewind（编辑重发 / 重新生成）：撤回已经生效——这条（新）消息还没进上下文，重试就是把它发进去；
      // 不说这一句的话用户只看到「发送失败」，不知道上下文已经被截断了
      if (sentMsgId != null) showFlowError("send", errText, { sourceMsgId: sentMsgId, anchorMsgId: sentMsgId, tone: "warn", ...(opts?.afterRewind ? { hint: "这条消息已退出上下文，点重试重新发送。", afterRewind: true } : {}) });
    }
  }, [busy, attaches, projectPath, permissionMode, thinkingLevel, chatModel, chatProvider, chatRole, tabId, applyStopRewind]);

  useEffect(() => { chatActions.register((t: string) => sendText(t)); return () => chatActions.unregister(); }, [sendText]);

  // ── 消息流错误卡片操作(3.5) ──────────────────────────
  const handleDismissError = useCallback((card: FlowErrorCard) => {
    useChatStore.getState().dismissFlowError(sidRef.current, card.id);
  }, []);
  // 重试 = 重发卡片锚定的用户消息(原文本+附件;skipAppend 不新增气泡);
  // 卡片先移除——重发若再次失败,showFlowError 会重新落一张卡
  const handleRetryError = useCallback((card: FlowErrorCard) => {
    useChatStore.getState().dismissFlowError(sidRef.current, card.id);
    if (card.sourceMsgId == null) return;
    sendText("", { skipAppend: true, sourceMsgId: card.sourceMsgId, forceNewTurn: true, afterRewind: card.afterRewind });
  }, [sendText]);

  const handleRecoverImages = useCallback(async (card: FlowErrorCard) => {
    const source = (useChatStore.getState().messagesBySession[sidRef.current] || []).find((msg) => msg.id === card.sourceMsgId && msg.role === "user");
    if (!source?.entryId) {
      showFlowError("system", "无法定位失败的提问，请重新打开会话后重试", { anchorMsgId: card.anchorMsgId });
      return;
    }
    try {
      const result = await window.electronAPI.agent.imageRetryCandidates(sidRef.current, source.entryId, projectPath || getWorkspaceDir());
      if (!result.ok) throw new Error(result.error || "无法读取历史图片");
      const currentImageCount = (source.attaches ?? []).filter((attachment: AttachItem) => attachment.kind === "image").length;
      if (!result.candidates?.length && currentImageCount === 0) {
        showFlowError("system", "没有可整理的历史图片，请减少本次附件后重新发送", { anchorMsgId: card.anchorMsgId });
        return;
      }
      setImageRecovery({ mode: "retry", card, candidates: result.candidates ?? [], currentImageCount });
    } catch (error) {
      showFlowError("system", error instanceof Error ? error.message : "无法读取历史图片", { anchorMsgId: card.anchorMsgId });
    }
  }, [projectPath, showFlowError]);

  const reloadAfterImageMutationFailure = useCallback(async (message: string): Promise<null> => {
    const activeSid = sidRef.current;
    try {
      const history = await window.electronAPI.conv.messages(activeSid, projectPath || getWorkspaceDir());
      if (sidRef.current === activeSid && history.length > 0) {
        useChatStore.getState().evictSession(activeSid);
        useChatStore.getState().loadSession(activeSid, mapSessionMessages(history));
      }
    } catch (error) {
      console.error("[chat] 图片整理失败后重新加载会话也失败:", error);
    }
    setImageRecovery(null);
    useStatusStore.getState().pushSignal(activeSid, "error", `${message}。请重新打开会话后再发送`, 10000);
    return null;
  }, [projectPath]);

  const confirmImageRecovery = useCallback(async (entryIds: string[], omitCurrentImages: boolean): Promise<string | null> => {
    const recovery = imageRecovery;
    if (!recovery) return "整理窗口已关闭";
    if (recovery.mode === "manage") {
      const result = await window.electronAPI.agent.removeContextImages(sidRef.current, entryIds, projectPath || getWorkspaceDir());
      if (!result.ok) return result.reloadRequired ? reloadAfterImageMutationFailure(result.error || "整理失败") : result.error || "整理失败，请重试";
      useChatStore.getState().markImagesStripped(sidRef.current, entryIds);
      setContextImageBytes((previous) => Math.max(0, previous - (result.removedBytes ?? 0)));
      setImageRecovery(null);
      return null;
    }
    const source = (useChatStore.getState().messagesBySession[sidRef.current] || []).find((msg) => msg.id === recovery.card.sourceMsgId && msg.role === "user");
    if (!source?.entryId) return "失败的提问已变化，请重新打开会话";
    const result = await window.electronAPI.agent.prepareImageRetry(sidRef.current, source.entryId, entryIds, omitCurrentImages, projectPath || getWorkspaceDir());
    if (!result.ok) return result.reloadRequired ? reloadAfterImageMutationFailure(result.error || "整理失败") : result.error || "整理失败，请重试";
    useChatStore.getState().markImagesStripped(sidRef.current, entryIds);
    useChatStore.getState().truncateAfter(sidRef.current, source.id);
    useChatStore.getState().dismissFlowError(sidRef.current, recovery.card.id);
    setImageRecovery(null);
    void sendText("", { skipAppend: true, sourceMsgId: source.id, forceNewTurn: true, afterRewind: true, omitImages: omitCurrentImages });
    return null;
  }, [imageRecovery, projectPath, reloadAfterImageMutationFailure, sendText]);

  useEffect(() => {
    if (sid.startsWith("__new_") || busy || sessionLoading) return;
    let cancelled = false;
    void window.electronAPI.agent.contextImageStats(sid, projectPath || getWorkspaceDir()).then((result) => {
      if (!cancelled && result.ok) {
        setContextImageBytes(result.encodedBytes ?? 0);
        setContextImageWarnAt(result.maxRequestBytes ? Math.min(32 * 1024 * 1024, result.maxRequestBytes * 0.75) : 32 * 1024 * 1024);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [sid, busy, sessionLoading, messages.length, projectPath]);

  const manageContextImages = useCallback(async () => {
    const result = await window.electronAPI.agent.contextImageStats(sidRef.current, projectPath || getWorkspaceDir());
    if (!result.ok || !result.candidates?.length) return;
    setImageRecovery({ mode: "manage", candidates: result.candidates });
  }, [projectPath]);

  const hasMessages = messages.length > 0;

  // Tool-call driven UI actions — Mint calls show_* tools, frontend detects tool_use entries
  const lastToolUses = useMemo(() => {
    if (messages.length === 0) return [];
    const lastAi = messages.filter((m) => m.role === "ai" && m.entries).pop();
    if (!lastAi?.entries) return [];
    return lastAi.entries.filter((e) => e.kind === "tool_use");
  }, [messages]);
  // 工具广播直连:Mint 调 show_confirm_dev 时立即显示(不受 busy 影响);
  // 点击按钮消费后从消息中移除 show_* 条目,推断分支不再命中(打断/回合结束不会复活)。
  // 消息推断(lastToolUses)保留作历史恢复兜底。
  const [confirmDevFlag, setConfirmDevFlag] = useState(false);
  useEffect(() => {
    const off1 = window.electronAPI.agent.onConfirmDev(() => setConfirmDevFlag(true));
    return () => { off1(); };
  }, []);
  // 点击消费:清 flag + 从最后一条 AI 消息移除 show_* 工具条目(防止推断复活)
  const consumeShowTools = () => {
    const store = useChatStore.getState();
    const msgs = store.messagesBySession[sidRef.current] || [];
    const lastAi = msgs.filter((m) => m.role === "ai" && m.entries).pop();
    if (lastAi && lastAi.id != null) {
      const kept = (lastAi.entries as Array<{ kind?: string; name?: string }>).filter(
        (e) => !(e.kind === "tool_use" && e.name?.startsWith("show_")),
      );
      store.replaceAiEntriesById(sidRef.current, lastAi.id as number, kept);
    }
  };
  const showConfirmDev = confirmDevFlag || (!busy && lastToolUses.some((e) => (e as { name?: string }).name === "show_confirm_dev"));

  // ── 用户消息编辑重发(任意一条 user 气泡 → 级联撤回后重发) ──────────────
  // 铅笔常驻在每条 user 气泡下(用户已确认);可用性判据见 chat-utils.editUnavailableReason
  // (回合进行中 / 该气泡没认领到条目 id)——不可用时置灰并把原因放进 title
  // 编辑态状态(提升到 ChatPanel:嵌套 UserBubble 无 hooks,避免重挂载丢状态)
  const [editingMsg, setEditingMsg] = useState<{ id: number; draft: string } | null>(null);
  const startEdit = useCallback((msg: ChatMessage) => {
    setEditingMsg({ id: msg.id, draft: msg.text ?? "" });
  }, []);
  const cancelEdit = useCallback(() => setEditingMsg(null), []);
  /** 气泡级动作失败的统一出口（撤回链路与「移出/恢复上下文」共用）：状态栏提示 + 锚在操作位置的错误
   *  卡片，hint 说明「这一步没生效」的后果——四个动作都是「改上下文失败」，失败可见性完全同构。 */
  const reportMsgActionFailure = useCallback((msg: ChatMessage, action: MsgAction, detail: string) => {
    console.error(`[chat] ${action}失败：session=${sidRef.current} entry=${msg.entryId ?? "?"} ${detail}`);
    const errText = detail ? `${action}失败：${detail}` : `${action}失败，请重试`;
    useStatusStore.getState().pushSignal(sidRef.current, "error", errText, 8000);
    showFlowError("system", errText, { anchorMsgId: msg.id, hint: MSG_ACTION_HINTS[action] });
  }, [showFlowError]);
  /**
   * 调 main 侧撤回（编辑 / 重新生成共用）：失败（返回 ok:false 或 IPC 抛错）走同一条可见提示并返回 null。
   *
   * IPC 这一层必须 try/catch——它抛错以前是静默 unhandled rejection（编辑框已关、无任何提示，
   * 用户只看到「点了发送没反应」）。
   */
  const rewindNode = useCallback(async (
    entryId: string,
    msg: ChatMessage,
    action: "修改" | "重新生成",
    target?: "prompt",
  ): Promise<{ promptEntryId?: string } | null> => {
    let res: { ok: boolean; error?: string; promptEntryId?: string };
    try {
      res = await window.electronAPI.agent.rewindToNode(sidRef.current, entryId, target, projectPath || getWorkspaceDir());
    } catch (e) {
      reportMsgActionFailure(msg, action, e instanceof Error ? e.message : String(e));
      return null;
    }
    if (!res.ok) {
      reportMsgActionFailure(msg, action, res.error ?? "");
      return null;
    }
    return res;
  }, [reportMsgActionFailure, projectPath]);
  /**
   * 单条消息移出 / 恢复模型上下文（轻档，消息右键菜单入口）。
   *
   * 与「修改」的差别（菜单文案点明）：轻档只把这一条从模型视野里拿掉，**不重来它之后的对话**——
   * main 侧只追加一条 context_edit（不截断分支、不裁剪本地列表），所以不弹确认框；而「修改」是级联撤回。
   * 两者都常驻同一个右键菜单，靠 contextEditAction 决定给哪个入口（没条目 id / 已被撤回掉就不给）。
   *
   * 失败可见（同撤回链路，不静默）：状态栏提示 + 锚在这条消息下方的错误卡片；IPC 抛错也走同一条。
   * 成功后只改这一个气泡的标记：摘掉→打「已退出上下文」（可恢复），恢复→清掉这组标记。
   */
  const setEntryInContext = useCallback(async (msg: ChatMessage, inContext: boolean) => {
    const entryId = msg.entryId;
    if (!entryId) return; // 没条目 id 时菜单根本不出入口（见 contextEditAction），兜底
    const action: MsgAction = inContext ? "恢复进上下文" : "移出上下文";
    let res: { ok: boolean; error?: string };
    try {
      res = await window.electronAPI.agent.setEntryInContext(sidRef.current, entryId, inContext, projectPath || getWorkspaceDir());
    } catch (e) {
      reportMsgActionFailure(msg, action, e instanceof Error ? e.message : String(e));
      return;
    }
    if (!res.ok) {
      reportMsgActionFailure(msg, action, res.error ?? "");
      return;
    }
    const store = useChatStore.getState();
    if (inContext) store.restoreIntoContext(sidRef.current, msg.id);
    else store.markDroppedFromContext(sidRef.current, msg.id);
  }, [reportMsgActionFailure, projectPath]);
  /**
   * 编辑重发:**级联撤回 → 本地替换气泡文本 → 用新文本重发**。
   *
   * 撤回目标是这条消息**自身**的条目 id——SDK 对 user 目标会把 leaf 落到它的父节点,于是这条消息
   * 及其之后的全部内容都退出上下文。不提供「只改这一条、后面留着」的行为(那是单条移出上下文的轻量档)。
   * 因此它之后还有内容时先确认(判据见 chat-utils.needsEditConfirm)。
   *
   * 顺序:撤回落点用的是**清空前**的条目 id,所以必须「先撤回、后 sendText」——sendText 复用气泡时
   * 会清掉旧 id 并重新入队(见 sendText 内注释),先发就会拿不到撤回目标。
   * 撤回失败:提示且**不发**新文本(否则旧版仍在上下文里、新版又发出去,两版并存);
   * 本地气泡文本也不动——就地改成新文本会让人以为已经生效。
   * 确认框取消:草稿放回编辑态(编辑框重新打开),不静默丢掉用户刚写的字。
   * 注意:原文未修改也照常发送(不改字重发 = 重新触发回复,不静默吞)。
   */
  const handleEditSubmit = useCallback(async (msg: ChatMessage, newText: string) => {
    const entryId = msg.entryId;
    if (!entryId) return; // 入口已置灰,兜底
    setEditingMsg(null);
    const stored = useChatStore.getState().messagesBySession[sidRef.current] || [];
    if (needsEditConfirm(stored, msg.id)) {
      const ok = await confirmDialog({
        title: "重新发送这条消息？",
        message: "这条消息之后的回答、系统卡片与委派结果会一并重来。",
        confirmText: "重新发送",
      });
      // 取消 = 什么都没发生（包括刚才关掉的编辑框）：草稿放回去，用户接着改
      if (!ok) { setEditingMsg({ id: msg.id, draft: newText }); return; }
    }
    const res = await rewindNode(entryId, msg, "修改");
    if (!res) return;
    // 磁盘分支已经截断：同步裁掉页面上的后续旧气泡，仅保留将复用重发的提问。
    useChatStore.getState().truncateAfter(sidRef.current, msg.id);
    // 本地替换该气泡文本(不新增气泡;未修改时文本不变,无副作用)
    useChatStore.getState().updateUserMsgText(sidRef.current, msg.id, newText);
    // 委托 sendText 重发:传 sourceMsgId → 走「复用气泡」路径(跳过 append + 清旧条目 id + 重新入队),
    // 本次新条目落盘后回填新 id。不传则这条消息认领不到新条目(气泡带着已失效的旧 id,
    // 第二次编辑直接报「不在当前分支」)。sendText 有 sourceMsgId 时以 store 里的气泡文本为准,
    // 所以上一步的本地替换必须先做。
    sendText(newText, { skipAppend: true, sourceMsgId: msg.id, afterRewind: true });
  }, [sendText, rewindNode]);

  // ── 重新生成某条回答（撤回它的提问 → 用原文重发） ───────────────
  /**
   * 重新生成：先撤回这条回答**所属的提问**（沿 parentId 向上找的第一条 user 条目），再用原文重发。
   * 会话树只有 main 侧有，所以定位由 main 完成（rewindToNode 的 target:"prompt"），返回 promptEntryId。
   *
   * 语义与编辑同为级联：提问及其之后的全部内容退出上下文（这条回答本身也被新回答替掉）。
   * 因此回答之后还有内容时先确认（判据同编辑），它就是最后一条时无需确认。
   * 顺序同编辑：**先撤回、成功后才发送**——撤回失败就不发（否则新旧两版答案并存），只给可见提示。
   *
   * 重发复用那条提问的气泡（skipAppend + sourceMsgId）：气泡里就是原文与附件，不必再读一次会话
   * 记录；sendText 的复用路径会清掉气泡上已失效的旧条目 id，本次新条目落盘后重新认领（见 chat-utils）。
   * 本窗口找不到那条提问的气泡（提问来自手机/其他窗口，或它没认领到条目 id）时不重发：拿不到原件
   * 就重发等于猜——附件会丢、暂存在输入框里的附件会被错带，只给可见提示。
   */
  const handleRegenerate = useCallback(async (msg: ChatMessage) => {
    const entryId = msg.entryId;
    if (!entryId) return; // 入口已置灰,兜底
    const stored = useChatStore.getState().messagesBySession[sidRef.current] || [];
    if (needsEditConfirm(stored, msg.id)) {
      const ok = await confirmDialog({
        title: "重新生成这条回答？",
        message: "这条回答之后的回答、系统卡片与委派结果会一并重来。",
        confirmText: "重新生成",
      });
      if (!ok) return;
    }
    // 撤回成功后提问本身也不在上下文里了，所以才能用「原文重发」——撤回前发就是两版并存
    const res = await rewindNode(entryId, msg, "重新生成", "prompt");
    if (!res) return;
    const promptBubble = stored.find((m) => m.role === "user" && m.entryId != null && m.entryId === res.promptEntryId);
    if (!promptBubble) {
      console.error(`[chat] 重新生成未重发：本窗口没有这条提问的气泡（session=${sidRef.current} prompt=${res.promptEntryId ?? "?"}）`);
      // 撤回已经落盘，不能继续展示已退出分支的旧回答。此分支没有可复用的提问气泡，
      // 因而不存在发送队列/条目认领竞态；直接从磁盘重建页面与当前分支同步。
      const rewindSid = sidRef.current;
      try {
        const history = await window.electronAPI.conv.messages(rewindSid, projectPath || getWorkspaceDir());
        if (sidRef.current === rewindSid) {
          useChatStore.getState().evictSession(rewindSid);
          useChatStore.getState().loadSession(rewindSid, mapSessionMessages(history));
        }
      } catch (e) {
        console.error("[chat] 撤回后重载会话历史失败:", e);
        if (sidRef.current === rewindSid) useChatStore.getState().evictSession(rewindSid);
      }
      if (sidRef.current !== rewindSid) return;
      const errText = "未能重新发送提问";
      useStatusStore.getState().pushSignal(sidRef.current, "error", errText, 8000);
      showFlowError("system", errText, { hint: "本窗口没有这条提问的记录（可能来自其他终端）。这条回答已退出上下文，请重新输入问题发送。" });
      return;
    }
    // 与磁盘撤回后的当前分支同步；旧回答立即从页面消失，重发进入普通发送状态机。
    useChatStore.getState().truncateAfter(sidRef.current, promptBubble.id);
    // 文本与附件以那条提问气泡为准（sendText 有 sourceMsgId 时以此为准，同编辑路径；附件只在这里能保住）
    sendText(promptBubble.text ?? "", { skipAppend: true, sourceMsgId: promptBubble.id, afterRewind: true });
  }, [sendText, rewindNode, projectPath, showFlowError]);

  // ── Render user bubble ─────────────────────────────

  const userBubble = useCallback((msg: ChatMessage, actions: UserBubbleActionProps) => {
    const isEditingThis = editingMsg?.id === msg.id;
    return (
      <UserBubble
        msg={msg}
        editDisabledReason={rewindUnavailableReason(msg, busy, "修改")}
        editing={isEditingThis}
        draft={isEditingThis ? editingMsg!.draft : undefined}
        onStartEdit={() => startEdit(msg)}
        onDraftChange={(v) => setEditingMsg((cur) => (cur ? { ...cur, draft: v } : cur))}
        onCommit={() => { const d = editingMsg?.draft.trim(); if (d) void handleEditSubmit(msg, d); }}
        onCancel={cancelEdit}
        onViewImage={(src, name) => openViewer(src, name)}
        actions={actions}
      />
    );
  }, [busy, editingMsg, startEdit, cancelEdit, handleEditSubmit, openViewer]);

  const handlePin = useCallback((text: string) => {
    usePinStore.getState().addPin(sidRef.current, text);
  }, []);

  const [ctxMenu, setCtxMenu] = useState<ContextMenuData | null>(null);
  const closeMenu = useCallback(() => setCtxMenu(null), []);
  // 钉住重复提示（2 秒自动消失）
  const [pinToast, setPinToast] = useState<string | null>(null);
  const showPinToast = useCallback((text: string) => {
    setPinToast(text);
    setTimeout(() => setPinToast(null), 2000);
  }, []);

  // 消息右键菜单：有选区时复制/钉住选区（markdown 还原），无选区时复制/钉住全文
  const handleMsgContextMenu = useCallback((msg: ChatMessage, e: React.MouseEvent) => {
    // 只有气泡内的右键才出菜单：容器铺满整行，气泡水平方向的空白此前会一并命中（用户 2026-09-26 反馈）。
    // 判断用 e.target 而非改绑定点——绑定必须留在行容器上，下方「全选」靠 e.currentTarget 找气泡元素。
    if (!(e.target as HTMLElement).closest(".msg-bubble-user, .msg-bubble-agent, .msg-bubble-system")) return;
    e.preventDefault();
    const container = e.currentTarget as HTMLElement;
    const sel = window.getSelection();
    const hasSel = !!sel && !sel.isCollapsed && !!sel.toString().trim();
    const selInMsg = hasSel && sel.rangeCount > 0 && container.contains(sel.getRangeAt(0).commonAncestorContainer);
    const selText = selInMsg ? sel!.toString() : "";
    const copyText = getMsgCopyText(msg);
    // 选区快照：菜单打开期间用户可能改变选区（如 Ctrl+A），钉住用快照而非重读 live Selection
    const pinRange = selInMsg ? sel.getRangeAt(0).cloneRange() : null;

    const items: ContextMenuItem[] = [
      { label: "复制", onClick: () => { navigator.clipboard.writeText(selInMsg ? selText : copyText).catch((err: unknown) => console.error("[copy]", err)); } },
      { label: "全选", onClick: () => {
        const bubbleEl = container.querySelector(".msg-bubble-agent, .msg-bubble-user");
        if (!bubbleEl) return;
        const range = document.createRange();
        range.selectNodeContents(bubbleEl);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(range);
      } },
      { label: "钉住", onClick: () => {
        let ok: boolean;
        if (pinRange) {
          ok = usePinStore.getState().addPin(sidRef.current, blocksToMarkdown(selectionToBlocks(pinRange)));
          window.getSelection()?.removeAllRanges();
        } else {
          ok = usePinStore.getState().addPin(sidRef.current, copyText);
        }
        if (!ok) showPinToast("该内容已钉为便签");
      } },
    ];
    // 轻档入口（与「修改」的级联重推同级不同档）：只把这一条从模型视野里拿掉，它之后的对话照旧——
    // 文案必须点明这条差别，否则与铅笔的「修改」看着是一件事而实际差很多（那个会把后面的对话全部重来）。
    // 已摘掉的给「恢复」：再追加一条带原内容的编辑（见 main 的 setEntryInContext），等于撤销。
    // 两者都不弹确认框：虽然会落盘（重开会话仍生效），但随时可恢复，不构成不可逆操作。
    const ctxAction = contextEditAction(msg);
    if (ctxAction === "drop") {
      items.push({ label: "移出上下文（后续对话不重来）", onClick: () => { void setEntryInContext(msg, false); } });
    } else if (ctxAction === "restore") {
      items.push({ label: "恢复进上下文", onClick: () => { void setEntryInContext(msg, true); } });
    }
    if (msg.imageStripped && msg.entryId && !msg.outOfContext) {
      items.push({ label: "恢复原图进上下文", onClick: () => { void setEntryInContext(msg, true); } });
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [setEntryInContext]);

  // 气泡动态鼓出:与当前宽度反比(窄滑块鼓多、宽滑块鼓少),两边视觉膨胀感一致;
  // 基准=标准按钮宽(首渲染时 ref 未绑,回退 48+3)
  const growX = sliderBox ? (14 * ((roleBtnRefs.current[0]?.offsetWidth ?? 48) + 3)) / sliderBox.width : 14;

  // 输入卡片(空态与非空态共用同一实例,仅外层容器不同)——包裹层做 FLIP 位移测量
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const renderChatInput = (
    <div ref={inputWrapRef}>
      {/* 执行步骤条（Mint 执行追踪，用户只读）——todo_write 广播实时更新 */}
      <TodoStrip sessionId={sidRef.current} />
      {/* 打断丢弃插话的提示——紧贴输入卡：「我刚发出去那条到底发没发出去」与输入动作同一视线区域 */}
      <DroppedSteerNotice dropped={droppedQueue} />
      {contextImageBytes + pendingImageBytes >= contextImageWarnAt && !busy && (
        <div className="mx-[var(--s16)] mb-2 px-3 py-2 rounded-[var(--radius-lg)] border border-warning-border bg-surface-elevated text-xs text-text-secondary flex items-center justify-between gap-3">
          <span>
            图片数据较多{contextImageBytes > 0 ? `：历史约 ${(contextImageBytes / (1024 * 1024)).toFixed(1)} MB` : ""}{pendingImageBytes > 0 ? `，本次原图编码约 ${(pendingImageBytes / (1024 * 1024)).toFixed(1)} MB` : ""}。发送时会缩小新图片，最终请求仍可能超过服务商上限。
          </span>
          {contextImageBytes > 0 && <button type="button" className="shrink-0 text-text-primary underline cursor-pointer" onClick={() => { void manageContextImages(); }}>整理历史图片</button>}
        </div>
      )}
      <ChatInput
        projectPath={projectPath}
        busy={busy}
        attaches={attaches}
        setAttaches={setAttaches}
        onSend={sendText}
        onStop={() => {
          stoppedRef.current = true;
          busyRef.current = false;
          interruptAtRef.current = Date.now();
          const stoppedSid = sidRef.current;
          const stopVersion = useChatStore.getState().msgIdBySession[stoppedSid] ?? 0;
          const pendingSend = pendingSendRef.current;
          const target = stopTarget(currentChatRef.current, pendingSend);
          const rid = target.chatId;
          if (pendingSend) {
            pendingSend.stopRequested = true;
            pendingSend.stopSid = stoppedSid;
            pendingSend.stopVersion = stopVersion;
          }
          if (rid) {
            // 普通新消息无输出时撤回；复用提问的编辑/重新生成则保留提问，只停止回答。
            if (pendingSend) pendingSend.abortIssued = true;
            void window.electronAPI.agent.abort(rid, { clearQueue: true, rewind: target.rewind })
              .then((result) => applyStopRewind(result, pendingSend?.sourceMsgId, stoppedSid, stopVersion))
              .catch((e) => { console.error("[chat] 打断失败:", e); })
              .finally(() => {
                if (pendingSendRef.current !== pendingSend) return;
                pendingSendRef.current = null;
                abortedRunPendingRef.current = false;
                stoppedRef.current = false;
              });
          }
          setBusy(false);
          pendingCompactRef.current = null;
          abortedRunPendingRef.current = !!(rid || pendingSend); // 无 chatId 时回包后补 abort
          useStatusStore.getState().popSignal(stoppedSid, "request");
          useStatusStore.getState().popSignal(stoppedSid, "retry");
          useStatusStore.getState().popSignalsByPrefix(stoppedSid, "tool:");
        }}
        onPaste={handlePaste}
        imgInputRef={imgInputRef}
        docInputRef={docInputRef}
        onImgChange={handleImgChange}
        onDocChange={handleDocChange}
        onPreviewImage={openViewer}
        permissionMode={permissionMode}
        onPermissionModeChange={handlePermissionModeChange}
        chatModel={chatModel || storeModel}
        onModelChange={handleModelChange}
        thinkingLevel={thinkingLevel}
        thinkingCapped={cappedThinkingLevel}
        thinkingLevels={thinkingLevels}
        onThinkingLevelChange={handleThinkingLevelChange}
        sessionId={sidRef.current}
        onStatsClick={() => setShowStats(true)}
      />
    </div>
  );

  // 立即压缩：手动点选项①与 auto 倒计时到点(onExpire)共用同一动作。
  // 不预置 compacting——蒙版显示完全跟随 SDK 真实状态(compacting 事件);
  // SDK 未真正开始压缩(如 abort 挂起)则不显示,避免误导。
  // 回合中(busy)不直接调 SDK——compact() 会先 abort 当前回合,输出中触发存在压缩竞态;
  // 挂到 pendingCompactRef,agent:exit(回合结束空闲)后再执行
  const doCompact = useCallback(async (instructions?: string) => {
    // 压缩进行中(compacting):忽略重复触发——等当前压缩结束(其完成事件清 busy 后用户可再触发)
    if (useStatusStore.getState().bySession[sidRef.current]?.compacting) return;
    if (busyRef.current) {
      pendingCompactRef.current = { instructions };
      useStatusStore.getState().pushSignal(sidRef.current, "compact", "当前回合结束后自动压缩...");
      return;
    }
    // 重启后会话未激活（未发过消息）：主进程 activeChats 里没有它，压缩会直接失败。
    // 先按需激活（加载历史）拿 chatId——后续 compacted/usage 广播也按它匹配
    if (!currentChatRef.current) {
      try {
        const cid = await window.electronAPI.agent.activate(sidRef.current, projectPath);
        if (cid) { currentChatRef.current = cid; setCurrentRunId(cid); }
      } catch (e) { console.error("[ChatPanel] 激活会话失败:", e); }
    }
    window.electronAPI.agent.compact(sidRef.current, instructions).catch(() => {});
  }, [projectPath]);
  const handleImmediateCompact = useCallback(() => {
    doCompact();
    setCompactDialog(null);
  }, [doCompact]);

  return (
    <div className="absolute inset-0 flex flex-col" onDragOver={handleDragOver} onDrop={handleDrop}>
      <div
        ref={attachScrollRef}
        onScroll={handleScroll}
        onWheel={handleUserInput}
        onTouchStart={handleUserInput}
        onTouchMove={handleUserInput}
        onMouseDown={handleUserInput}
        onPointerDown={handlePointerDown}
        className="chat-messages flex-1 overflow-y-auto overflow-x-hidden pb-2"
        style={{ fontSize: "var(--text-body)" }}
      >
        {!hasMessages ? (
          // 空态:消息区留白(角色选择在输入卡片左上角)
          sessionLoading ? (
            <div className="flex items-center justify-center h-full text-xs text-text-muted gap-2">
              <svg className="animate-spin text-text-muted" width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              正在加载会话…
            </div>
          ) : (
            <div />
          )
        ) : (
          <div className="px-8 py-4">
            {/* 虚拟化消息列表：absolute 定位 + translateY，测量高度撑起滚动空间 */}
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const msg = messages[vi.index]!;
                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
                    // mint-live：只给「最新一条 Mint 消息」且会话在跑时加，其内头像眨眼（规则见 index.css）。
                    // 开关做成祖先容器上的 CSS 类而不是逐个头像传 props：内联 SVG 的 SMIL 时间线是文档级的，
                    // 多实例各自调用 pause/unpause 会互相覆盖；CSS 类没有执行顺序问题。
                    className={`pb-8${busy && vi.index === liveIndex ? " mint-live" : ""}`}
                  >
                    {/* 跳转高亮层:常驻 absolute 不占布局(虚拟滚动测量零干扰)、opacity 过渡
                        (圆角始终存在,消失只是淡出,无「圆角变直角」)、仅上边外扩 5px——
                        高亮矩形上边框与消息内容(含头像)留 5px 间距,其余边贴合内容 */}
                    <div
                      className={`absolute -top-[5px] inset-x-[26px] bottom-0 rounded-[var(--radius-lg)] bg-accent-bg transition-opacity duration-500 pointer-events-none ${msg.id === highlightMsgId ? "opacity-100" : "opacity-0"}`}
                    />
                    <MemoChatMessage
                      msg={msg}
                      streaming={busy && vi.index === streamIndex}
                      userBubble={userBubble}
                      onPin={handlePin}
                      onRegenerate={handleRegenerate}
                      busy={busy}
                      onContextMenu={handleMsgContextMenu}
                      sid={sid}
                    />
                    {/* 委派进度卡片：任意时刻最多一张(跨批次合并,含所有委派的任务行),
                        固定在「最新 triggerMsgId」对应消息下方(左对齐气泡)；全部委派缺
                        triggerMsgId(委派由 Mint 主动发起,消息未落盘时捕获不到)时
                        挂在最后一条 AI 消息下兜底 */}
                    {delegationList.length > 0
                      && (anchorMsgId === msg.id
                        || (anchorMsgId === undefined && vi.index === messages.length - 1 && msg.role === "ai")) ? (
                      <div className="flex gap-4 items-start" style={{ padding: "0 var(--s8)" }}>
                        <div style={{ width: 40, flexShrink: 0 }} />
                        <DelegationProgress delegations={delegationList} />
                      </div>
                    ) : null}
                    {/* 持久错误卡片(3.5):锚定消息行下方;可重试(重发原消息)/手动关闭,
                        不随状态栏 8s 提示消失 */}
                    {(() => {
                      const cards = errorsByAnchor.get(msg.id);
                      if (!cards || cards.length === 0) return null;
                      return (
                        <div className="flex gap-4 items-start mt-1" style={{ padding: "0 var(--s8)" }}>
                          <div style={{ width: 40, flexShrink: 0 }} />
                          <div className="min-w-0 space-y-1">
                            {cards.map((card) => (
                              <FlowErrorCardView key={`flow-err-${card.id}`} card={card} onRetry={handleRetryError} onRecoverImages={(item) => { void handleRecoverImages(item); }} onDismiss={handleDismissError} />
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
            {showConfirmDev && (
              <div className="flex justify-center pb-3">
                <button
                  onClick={() => { setConfirmDevFlag(false); consumeShowTools(); sendText(CONFIRM_DEVELOPMENT_PROMPT); }}
                  className="px-6 py-2.5 rounded-[var(--radius-lg)] btn-accent text-sm font-semibold border-none cursor-pointer transition-all duration-200 hover:-translate-y-px active:translate-y-0"
                >
                  确认开发
                </button>
              </div>
            )}

          </div>
        )}
        {/* Mint 提问卡片：独立于消息列表（空态也显示），渲染在滚动区尾部；宽度与输入卡片一致。
            key=requestId：同一时刻可能有多条挂起请求排队（模型一批并行调用），一次只显示第一条；
            前一条被响应后组件若被复用（无 key），后一条会继承前一条的本地 state——已置 true 的
            submitting 让确认/取消永久点不动，编辑中的正文也会串到下一条上。key 保证换请求即重挂载。 */}
        {pendingAsk && (
          <div className="mx-[var(--s16)] pt-1 pb-2">
            <AskUserCard key={pendingAsk.requestId} request={pendingAsk} />
          </div>
        )}
      </div>

      {/* 状态栏:独立于输入区,渲染在输入容器上方 */}
      <StatusBar sessionId={sidRef.current} />

      {/* Attach preview — above thinking when busy;左右边距与输入卡片(var(--s16))一致,条与卡片同宽,内部 px-4 对齐 input-top 的 --s4 内边距;
          复用 ChatInput 胶囊式组件(busy/非 busy 视觉一致,不再有 64px 放大缩略图) */}
      {busy && attaches.length > 0 && (
        <div className="mx-[var(--s16)] px-4 py-2 bg-surface-alt/30 border-t border-border/50 shrink-0"><AttachPreview attaches={attaches} setAttaches={setAttaches} onPreview={openViewer} /></div>
      )}

      {/* 气泡锚点容器:仅用于气泡悬浮定位(独立于输入卡片 DOM,悬浮在卡片上方)。
          空态时 flex-1 垂直居中基础上再上移 195px(视觉重心偏上;补偿输入卡片底部间距 +10px 后内容变高、居中位上移的 5px),有消息后回底部(shrink-0);
          首条消息发送时输入卡片包裹层 FLIP 动画平滑下移 */}
      <div
        className={`relative ${(!hasMessages || leavingStartCard) ? "flex-1 flex flex-col justify-center" : "shrink-0"}`}
        style={!hasMessages && !leavingStartCard ? { transform: "translateY(-195px)" } : undefined}
      >
        {/* 空态模块:角色选择 + 输入卡片作为整体(角色 ml-4 对齐卡片左 margin 16px)。
            existingSid 会话(磁盘消息加载中)不显示角色选择——恢复会话沿用 tab 的 isDesigner */}
        {!hasMessages && !existingSid && !leavingStartCard ? (
          <div className="w-full flex flex-col gap-2">
            <div className="flex items-center gap-2 ml-[66px]">
              <span className="text-sm text-text-muted">Agent能力</span>
              {/* 轨道(背景框):参考 liquid-glass user info card——blur 20px 雾面 + saturate 140,
                  静止无弹性无 hover 光晕(示例 user card 无 onClick 即无 hover 效果);
                  onMouseMove 仅作滑块弹性的鼠标跟踪源 */}
              <div
                ref={roleSliderRef}
                className="group relative flex items-center rounded-full bg-glass-track p-1 backdrop-blur-[20px] backdrop-saturate-[1.4]"
                onMouseMove={handleTrackMove}
                onMouseLeave={() => setSliderStretch({ x: 1, y: 1 })}
              >
                {/* 滑块:常态=扁平半透明椭圆;抓取(sliderPressed)=透明气泡——底色全透明、
                    气泡壁(外亮线+内暗线)+顶弧光,四周鼓出(宽动态 + 上下5px);
                    弹性拉伸跟随鼠标;z-20 在按钮之上,接管拖拽/点击 */}
                <div
                  className={`absolute z-20 rounded-full ${sliderPressed ? "-top-[5px] -bottom-[5px] border border-glass-slider-border shadow-[0_2px_12px_rgba(0,0,0,0.12),inset_0_0_0_1px_rgba(0,0,0,0.18),inset_0_1px_2px_rgba(255,255,255,0.15)]" : "top-[2.5px] bottom-[2.5px] bg-glass-slider"} cursor-grab ${dragging ? "cursor-grabbing" : ""} ${sliderBox ? "opacity-100" : "opacity-0"}`}
                  style={{
                    left: (dragging && dragLeft !== null ? dragLeft : (sliderBox?.left ?? 0)) - (sliderPressed ? growX / 2 : 0),
                    width: (sliderBox?.width ?? 0) + (sliderPressed ? growX + 0.5 : 0),
                    transform: `scaleX(${sliderStretch.x}) scaleY(${sliderStretch.y})`,
                    // 拖拽中:left 无过渡(跟手);width 带回弹缓动(适配选项宽度时弹性质感);结束恢复滑动过渡
                    transition: dragging
                      ? "width 0.3s cubic-bezier(0.34,1.3,0.64,1), transform 0.2s ease-out, opacity 0.2s ease"
                      : "left 0.3s cubic-bezier(0.34,1.3,0.64,1), width 0.3s cubic-bezier(0.34,1.3,0.64,1), opacity 0.2s ease, transform 0.2s ease-out",
                  }}
                  onPointerDown={handleSliderPointerDown}
                  onPointerMove={handleSliderPointerMove}
                  onPointerUp={handleSliderPointerUp}
                  onPointerCancel={abortDrag}
                >
                </div>
                {/* 文字双层:灰层(未选中)全量显示;选中层(黑/白)同布局按滑块区域 clip-path 裁剪——
                    滑块盖住多少文字,选中色实时显示多少(半字级跟随);同字重保证两层像素对齐;
                    pointer-events-none 穿透点击 */}
                <div className="absolute inset-0 z-40 p-1 flex items-center pointer-events-none">
                  {(["mint", "mint-d"] as const).map((r) => (
                    <div key={`lbl-${r}`} className="shrink-0 whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs text-role-idle">
                      {r === "mint" ? "标准" : "增强UI设计"}
                    </div>
                  ))}
                  <div
                    className="absolute inset-0 p-1 flex items-center text-role-selected"
                    style={{
                      clipPath: sliderBox
                        ? `inset(0 ${sliderBox.trackW - (dragging && dragLeft !== null ? dragLeft : sliderBox.left) - sliderBox.width}px 0 ${dragging && dragLeft !== null ? dragLeft : sliderBox.left}px)`
                        : undefined,
                      // 非拖拽(点击切换)时选中色随滑块平滑扫过;拖拽中直接跟随
                      transition: dragging ? undefined : "clip-path 0.3s cubic-bezier(0.34,1.3,0.64,1)",
                    }}
                  >
                    {(["mint", "mint-d"] as const).map((r) => (
                      <div key={`sel-${r}`} className="shrink-0 whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs">
                        {r === "mint" ? "标准" : "增强UI设计"}
                      </div>
                    ))}
                  </div>
                </div>
                {(["mint", "mint-d"] as const).map((r, i) => (
                  <button
                    key={r}
                    type="button"
                    ref={(el) => { roleBtnRefs.current[i] = el; }}
                    onClick={() => setChatRole(r)}
                    className="relative z-10 px-2.5 py-0.5 rounded-full text-xs text-transparent cursor-pointer"
                  >
                    {r === "mint" ? "标准" : "增强UI设计"}
                  </button>
                ))}
              </div>
            </div>
            {renderChatInput}
          </div>
        ) : (
          renderChatInput
        )}
        {/* 回底/新消息气泡:悬浮在输入卡片上方居中,不属于卡片 DOM。
            只要滚离底部就常驻显示(正常浏览历史也显示)——圆圈箭头=回底部;
            输出结束且有新内容时=「新消息」胶囊带箭头 */}
        {awayFromBottom && (
          <button
            className={`new-msg-bubble${showNewMsg ? "" : " new-msg-bubble--icon"}`}
            onClick={() => {
              autoScrollRef.current = true;
              setShowNewMsg(false);
              showNewMsgRef.current = false;
              scrollToBottom();
            }}
            
          >
            {showNewMsg && <span>新消息</span>}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v9M4.5 8.5L8 12l3.5-3.5"/></svg>
          </button>
        )}
      </div>
      {showStats && (
        <SessionStatsPopup
          sessionId={sidRef.current}
          projectPath={projectPath || getWorkspaceDir()}
          onClose={() => setShowStats(false)}
          onCompress={() => { setShowStats(false); setCompactDialog({ source: "manual" }); }}
        />
      )}
      {compactDialog && (
        <CompactionDialog
          title={compactDialog.source === "auto"
            ? `当前会话已达到自动压缩阈值 ${compactDialog.threshold ?? 75}%，如何处理？`
            : "压缩当前会话上下文"}
          countdown={compactDialog.source === "auto"
            ? { total: 60, onExpire: handleImmediateCompact }
            : undefined}
          onImmediate={handleImmediateCompact}
          onWithInstructions={(instructions) => {
            doCompact(instructions || undefined);
            setCompactDialog(null);
          }}
          onWriteHandoff={() => {
            sendText(HANDOFF_PROMPT);
            setCompactDialog(null);
          }}
          onDefer={() => {
            // 下次回复完(agent:exit)重置阈值防重 → 重新弹窗走同样流程
            rearmAfterExitRef.current = true;
            setCompactDialog(null);
          }}
          onClose={() => {
            // 直接关闭同「稍后」:下次回复完重置阈值防重,再涨到阈值会重新询问
            rearmAfterExitRef.current = true;
            setCompactDialog(null);
          }}
        />
      )}
      {imageRecovery && (
        <ImageRecoveryDialog
          key={imageRecovery.mode === "retry" ? imageRecovery.card.id : "manage"}
          mode={imageRecovery.mode}
          candidates={imageRecovery.candidates}
          currentImageCount={imageRecovery.mode === "retry" ? imageRecovery.currentImageCount : 0}
          onCancel={() => setImageRecovery(null)}
          onConfirm={confirmImageRecovery}
        />
      )}
      {/* 内容便签悬浮层：仅当前会话可见，随 tab 显隐 */}
      <PinLayer sessionId={sid} />
      {/* 用户历史提问：右上角按钮 + 右侧抽屉（跳转消息顶部对齐并高亮） */}
      <QuestionHistory sessionId={sid} messages={messages} onJump={jumpToMessage} />
      <ContextMenu menu={ctxMenu} onClose={closeMenu} />
      {/* 钉住提示 */}
      {pinToast && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-[var(--radius-lg)] bg-surface-elevated shadow-lg text-xs text-text-primary pointer-events-none">
          {pinToast}
        </div>
      )}
    </div>
  );
}

/** 「已退出上下文」标记（状态标签徽章·胶囊规格）：单条移出上下文后仍显示历史气泡，用它显式说明
 *  这条已不在模型视野里；重开会话后仍会按磁盘 context_edit 条目显示此标记。
 *  默认样式压住 .msg-from 的继承（大写 + 字间距是那个标题栏的，不是徽章的）。 */
function OutOfContextTag({ className = "" }: { className?: string }): JSX.Element {
  return (
    <span className={`inline-block shrink-0 px-1.5 py-0.5 rounded-full bg-surface-alt text-text-secondary text-[length:var(--text-3xs)] font-normal normal-case tracking-normal align-middle ${className}`}>
      已退出上下文
    </span>
  );
}

function ImageStrippedTag({ className = "" }: { className?: string }): JSX.Element {
  return <span className={`inline-block shrink-0 px-1.5 py-0.5 rounded-full bg-surface-alt text-text-secondary text-[length:var(--text-3xs)] font-normal normal-case tracking-normal align-middle ${className}`}>历史图片已整理</span>;
}

function ImagePathOnlyTag(): JSX.Element {
  return <span className="inline-block shrink-0 px-1.5 py-0.5 rounded-full bg-surface-alt text-text-secondary text-[length:var(--text-3xs)] font-normal normal-case tracking-normal align-middle">图片仅传路径</span>;
}

// ── Memo message item: avoids re-rendering all messages on each stream event ──

interface MemoChatMessageProps {
  msg: ChatMessage;
  /** 本条消息是否正在增长（只有末尾那条为真）——驱动流式 markdown 与思考块的流式态 */
  streaming: boolean;
  /** 本会话是否处于回合中（重新生成入口的临时不可用判据，与编辑入口同一套） */
  busy: boolean;
  userBubble: (msg: ChatMessage, actions: UserBubbleActionProps) => JSX.Element;
  onPin: (text: string) => void;
  /** 重新生成这条回答（撤回它的提问后用原文重发） */
  onRegenerate: (msg: ChatMessage) => void;
  onContextMenu: (msg: ChatMessage, e: React.MouseEvent) => void;
  sid: string;
}

const MemoChatMessage = memo(function MemoChatMessage({ msg, streaming, busy, userBubble, onPin, onRegenerate, onContextMenu, sid }: MemoChatMessageProps) {
  // 指令型系统消息的展开/收起（事件型不折叠——无此 state 参与）
  const [sysExpanded, setSysExpanded] = useState(false);
  // 思考/工具固定显示(无显示开关)——全部 entries 参与建块
  const visible = msg.entries ?? [];

  // 工具 input 查找表(toolUseId → input):隐藏工具调用时,tool-result-only 块仍能取 file_path 做语言高亮
  const toolInputs = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const e of msg.entries ?? []) {
      if (e.kind === "tool_use" && e.id) {
        const input = typeof e.input === "object" && e.input !== null ? e.input as Record<string, unknown> : undefined;
        if (input) m.set(e.id, input);
      }
    }
    return m;
  }, [msg.entries]);

  const blocks = useMemo(() =>
    visible.length > 0 ? buildBlocks(visible, String(msg.id), toolInputs) : [],
    [visible, msg.id, toolInputs],
  );

  // 气泡全文：所有 text entry 合并（不含思考/工具）
  const copyText = useMemo(() => getMsgCopyText(msg), [msg]);

  // 操作条显隐：hover 消息立即显示；离开消息后 1s 缓冲（期间鼠标移到按钮上则继续显示）
  const [actionsVisible, setActionsVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const showActions = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setActionsVisible(true);
  }, []);
  const scheduleHideActions = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setActionsVisible(false), 1000);
  }, []);
  useEffect(() => () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); }, []);

  if (msg.role === "user") {
    // 系统消息:统一左侧系统卡片(系统图标 + kind 标签 + 内容),
    // 区别于 assistant(Mint 头像气泡)与 user(右侧气泡)
    const text = typeof msg.text === "string" ? msg.text : "";
    const kind = msg.customType === "system_message" ? (msg.details as { kind?: string } | undefined)?.kind : undefined;
    if (kind) {
      const body = text
        .replace(/^\[系统消息\](-\[[^\]]*\])?\s*/, "");
      // 委派/后台 shell 结果:状态/时长上标题栏,默认折叠,展开看完整内容(6 行封顶滚动);
      // 摘要:内容是 markdown,展开时走 prose 渲染 + 限高滚动;其他 kind:纯文本
      const isResult = kind === "delegation" || kind === "shell";
      const isSummary = kind === "summary";
      const lines = isResult ? body.split("\n") : [];
      const rows = lines.filter((l) => l.startsWith("⏺ "));
      // 标题栏状态取首个 ⏺ 行(多子任务时各任务状态在展开区看全貌)
      const first = rows[0]?.match(/^⏺ (.+?) [-—] (完成|失败|中止|已由用户中断|已由用户中止|已中止|已随权限切换中止)(?: · (\d+)s)?$/);
      const headStatus = first?.[2];
      const headDur = first?.[3];
      // 首个 ⏺ 行的状态/时长已上标题栏,展开内容里跳过该行避免重复
      const firstDotIdx = lines.findIndex((l) => l.startsWith("⏺ "));
      // 主动中止=黄,失败=意外中断(红),完成=绿
      const statusColor = (s?: string): string =>
        (s === "中止" || s === "已由用户中断" || s === "已由用户中止" || s === "已中止" || s === "已随权限切换中止") ? "text-interrupt" : s === "失败" ? "text-fail" : s ? "text-done" : "";
      // 结果型(委派/后台命令)与指令型一样默认折叠——完整内容展开看
      const collapsible = COLLAPSIBLE_SYSTEM_KINDS.has(kind) || isResult;
      const collapsed = collapsible && !sysExpanded;
      return (
        <div
          className="flex gap-4 items-start"
          style={{ padding: "0 var(--s8)" }}
          onContextMenu={(e) => onContextMenu(msg, e)}
        >
          <div style={{ width: 40, flexShrink: 0 }} />
          <div className="relative w-fit max-w-[75%] min-w-0 my-1" onMouseEnter={showActions} onMouseLeave={scheduleHideActions}>
            {/* 无描边(用户 2026-09-15):本气泡无投影,靠 bg-surface-elevated 与聊天区底色的层差分区 */}
            <div className="msg-bubble-system rounded-[var(--radius-lg)] rounded-bl-[4px] bg-surface-elevated overflow-hidden">
              {/* 头部:系统图标 + kind 标签(区别于 assistant 的 Mint 头像气泡);指令型整行可点展开/收起 */}
              <button
                type="button"
                className={`flex items-center gap-1.5 px-[14px] pt-1.5 pb-2 w-full text-left text-[length:var(--text-11)] text-text-secondary transition-colors ${collapsible ? "group cursor-pointer select-none hover:text-text-primary" : ""}`}
                onClick={collapsible ? () => setSysExpanded((v) => !v) : undefined}
                
              >
                {/* 头部图标按 kind:委派=bot、后台命令=终端,其余保持感叹号;颜色对齐工具标题(中性灰,不用蓝) */}
                {kind === "delegation" ? (
                  <svg className="shrink-0 text-[var(--color-tool-title)]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
                  </svg>
                ) : kind === "shell" ? (
                  <svg className="shrink-0 text-[var(--color-tool-title)]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m7 11 2-2-2-2" /><path d="M11 13h4" /><rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                  </svg>
                ) : (
                  <svg className="shrink-0 text-[var(--color-tool-title)]" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <circle cx="8" cy="8" r="6.5" />
                    <path d="M8 7.5V11" />
                    <path d="M8 5h.01" />
                  </svg>
                )}
                {/* ⏺ 圆点入标题(着状态色,与原生摘要行一致) */}
                {headStatus && (
                  <span className={statusColor(headStatus)} style={{ fontSize: "var(--text-11)" }}>⏺</span>
                )}
                <span>{SYSTEM_KIND_LABELS[kind] ?? "系统消息"}</span>
                {/* 系统卡片（委派结果 / 后台命令 / 摘要）也会随撤回一并退出上下文 */}
                {msg.outOfContext ? <OutOfContextTag /> : null}
                {msg.imageStripped && !msg.outOfContext ? <ImageStrippedTag /> : null}
                {/* 状态 + 时长上标题栏(取首个 ⏺ 行);只有 ⏺ 与状态文字着色,横线/时间保持中性 */}
                {headStatus && (
                  <span className="font-semibold" style={{ fontSize: "var(--text-11)" }}>
                    - <span className={statusColor(headStatus)}>{headStatus}</span>
                    {headDur ? ` · ${headDur}s` : ""}
                  </span>
                )}
                {collapsible && (
                  /* 折叠符号与工具卡一致:右箭头,折叠态 hover 才出现,展开态旋转 90° 常显 */
                  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`w-2.5 h-2.5 shrink-0 transition-all duration-150 ${collapsed ? "opacity-0 group-hover:opacity-100" : "rotate-90 opacity-100"}`}>
                    <path d="M3.5 2l3 3-3 3" />
                  </svg>
                )}
              </button>
              {/* 内容区（折叠时省略;结果型展开后限高滚动,⏺ 行着色、其余行原文;min-h 兜底空内容也有一行高） */}
              {!collapsed && <div className="px-[14px] pb-1.5 leading-[1.55] min-h-[1.625em]">
                {isResult ? (
                  <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: RESULT_BODY_MAX_HEIGHT }}>
                    {lines.map((row, i) => {
                      if (i === firstDotIdx) return null; // 已上标题栏,不重复显示
                      if (!row.startsWith("⏺ ")) {
                        // 后台命令的日志路径行 → 可点击在文件夹中显示(全量输出按需查看)
                        const logMatch = /^完整输出:\s*(\S.*)$/.exec(row);
                        if (logMatch) {
                          const logPath = logMatch[1]!.trim();
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); window.electronAPI.shell.revealInFolder(logPath); }}
                              title="在文件夹中显示"
                              className="flex items-center gap-1 max-w-full text-left text-[var(--color-link)] hover:underline transition-colors"
                            >
                              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>
                              <span className="truncate font-mono">{logPath}</span>
                            </button>
                          );
                        }
                        return row.trim() === "" ? null : (
                          <div key={i} className="text-text-secondary whitespace-pre-wrap [overflow-wrap:anywhere]">{row}</div>
                        );
                      }
                      // 兼容新旧分隔符:新数据用连字符 `-`,存量/旧版主进程仍发 em-dash `—`——两者都解析
                      const m = row.match(/^⏺ (.+?) [-—] (完成|失败|中止|已由用户中断|已由用户中止|已中止)(?: · (\d+)s)?$/);
                      const dotColor = statusColor(m?.[2]);
                      return (
                        // 普通文本流而非 flex:flex 项间的源码换行在选择复制时会作为真实换行保留
                        // (复制结果断行);inline 布局换行折叠为空格,复制文本与视觉一致
                        <div key={i} className="py-0.5 leading-[1.55]">
                          <span className={`${dotColor} text-[length:var(--text-caption)] align-baseline`}>⏺ </span>
                          {m ? (
                            <><span className="text-text-primary">{m[1]}</span><span className="text-[length:var(--text-caption)] font-semibold"> - <span className={dotColor}>{m[2]}</span></span>{m[3] && <span className="text-text-secondary/70 text-[length:var(--text-caption)] tabular-nums"> • {m[3]}s</span>}</>
                          ) : (
                            <span className="text-text-secondary">{row.slice(2)}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : isSummary ? (
                  /* leading-relaxed 必须与 prose 同值：上面 maxHeight 的 lh 以本元素行高为准 */
                  <div className="overflow-y-auto overscroll-contain leading-relaxed" style={{ maxHeight: SUMMARY_BODY_MAX_HEIGHT }}>
                    <SystemMarkdown content={body} />
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap [overflow-wrap:anywhere] text-text-primary">{body}</div>
                )}
              </div>}
            </div>
            {/* 与其他气泡一致:复制完整文本 + 钉住(悬停显示) */}
            <BubbleActions text={body} onPin={onPin} sid={sid} visible={actionsVisible} />
          </div>
        </div>
      );
    }
    return (
      <div className="msg-in" onContextMenu={(e) => onContextMenu(msg, e)}>
        <div className="flex justify-end">
          {/* shrink-0：flex 子项不被压缩（中文 min-content 是单字，压缩会逐字换行）；
             max-w-[60%]：超长文本钳制宽度后由内部 overflow-wrap 换行 */}
          <div className="relative shrink-0 max-w-[60%] min-w-0" onMouseEnter={showActions} onMouseLeave={scheduleHideActions}>
            {userBubble(msg, { text: copyText, onPin, sid, visible: actionsVisible })}
          </div>
        </div>
      </div>
    );
  }

  if (visible.length === 0) return null;

  // 群聊消息:按 agentRole 标注角色(头像首字符 + 角色名 + 转发来源标记)
  const role = msg.agentRole;
  const displayName = role ?? "Mint";

  return (
    <div className="msg-in" onContextMenu={(e) => onContextMenu(msg, e)}>
      <div className="flex gap-4 items-start max-w-[75%]">
        {/* Mint 头像：内联矢量 SVG，有会话在跑时播眨眼（控制值在组件内部取全局态，见 MintAvatar）；角色消息仍用首字母 */}
        {role ? (
          <div className="msg-avatar agent" style={{ backgroundColor: roleColor(role), color: "#fff" }}>{role.charAt(0).toUpperCase()}</div>
        ) : (
          <MintAvatar size={40} className="msg-avatar mint" />
        )}
        <div className="min-w-0 relative" onMouseEnter={showActions} onMouseLeave={scheduleHideActions}>
          <div className="msg-from">
            {displayName}
            {msg.outOfContext ? <OutOfContextTag className="ml-1.5" /> : null}
            {msg.imageStripped && !msg.outOfContext ? <ImageStrippedTag className="ml-1.5" /> : null}
            {role && msg.forwarded && (
              <span className="text-text-secondary/60 ml-1.5 text-[length:var(--text-2xs)] font-normal">· {msg.forwardedFrom ? `来自 ${msg.forwardedFrom}` : "来自转发"}</span>
            )}
          </div>
          <div className="msg-bubble-agent rounded-[var(--radius-lg)] rounded-bl-[4px] px-[14px] py-1.5 overflow-hidden">
            {blocks.map((block, i) => (
              <ChatBlockView key={`blk-${msg.id}-${i}`} block={block} streaming={streaming} isStreamingTail={streaming && i === blocks.length - 1} />
            ))}
            {/* 回合 usage：气泡内容区底部右对齐——贴内容右下，与 hover 复制工具条（气泡外）永不冲突。
                 口径：输入 = 未缓存 + 缓存读 + 缓存写（全部输入成本）；命中率 = 缓存读 / 全部输入 */}
            {msg.usage && (() => {
              const total = (msg.usage.inputTokens || 0) + (msg.usage.cacheReadTokens || 0) + (msg.usage.cacheWriteTokens || 0);
              const read = msg.usage.cacheReadTokens || 0;
              return (
                <div className="mt-1 flex justify-end whitespace-nowrap text-[length:var(--text-2xs)] text-text-muted tabular-nums">
                  输入 {fmtTokenCount(total)}
                  {" · "}输出 {fmtTokenCount(msg.usage.outputTokens || 0)}
                  {read > 0 && total > 0 ? ` · 缓存命中 ${((read / total) * 100).toFixed(2)}%` : ""}
                </div>
              );
            })()}
          </div>
          <BubbleActions
            text={copyText}
            onPin={onPin}
            sid={sid}
            visible={actionsVisible}
            regenerate={{ disabledReason: rewindUnavailableReason(msg, busy, "重新生成"), onClick: () => onRegenerate(msg) }}
          />
        </div>
      </div>
    </div>
  );
});

// 用户消息气泡(模块级稳定组件——嵌套定义每次渲染重建类型会致整棵 remount,输入/按钮事件丢失)
interface UserBubbleActionProps {
  text: string;
  onPin: (text: string) => void;
  sid: string;
  visible: boolean;
}

function UserBubble({ msg, editing, draft, editDisabledReason, onStartEdit, onDraftChange, onCommit, onCancel, onViewImage, actions }: {
  msg: ChatMessage;
  /** 有值 = 编辑入口置灰（原因为 title，如回合进行中 / 气泡未认领到条目 id） */
  editDisabledReason?: string;
  editing?: boolean;
  draft?: string;
  onStartEdit?: () => void;
  onDraftChange?: (v: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  onViewImage?: (src: string, name: string) => void;
  actions: UserBubbleActionProps;
}): JSX.Element {
  const isEditing = !!editing;
  const curDraft = draft ?? "";
  return (
    /* 宽度钳制由外层 relative（shrink-0 max-w-[60%]）负责；
       此处不再设 max-w/w-fit，避免相对 fit-content 层的循环依赖导致短文本被压窄 */
    <div className="flex gap-4 items-start">
      <div className="min-w-0">
        <div className="msg-from text-right">USER</div>
        <div className="msg-bubble-user rounded-[var(--radius-lg)] rounded-br-[4px] px-[14px] py-1.5 leading-[1.55] overflow-hidden min-w-0 [overflow-wrap:anywhere]">
        {msg.attaches && msg.attaches.length > 0 && (
          /* 编辑态也显示附件：编辑只改文本，重发会带上它们（sendText 以气泡为准） */
          <div className="flex gap-1.5 mb-2 flex-wrap">
            {msg.attaches.map((a, i) => (
              a.kind === "image" ? (
                a.dataUrl ? (
                  /* max-w 必须是**固定长度**：写成 min(260px,100%) 会让「百分比依赖气泡宽度、气泡宽度又取决于图片」
                     形成循环依赖——算固有宽度时百分比按 auto 处理，图片按原始宽度撑气泡（宽图把气泡顶到外层
                     60% 上限，图片自己却仍被压回 260px，右边空一大块）。min-w-0 保证窄窗口下仍能被 flex 收缩 */
                  <img key={`img-${i}`} src={a.dataUrl} alt={a.name} className="max-w-[260px] min-w-0 max-h-[220px] rounded-[var(--radius-lg)] object-contain cursor-zoom-in hover:opacity-90 transition-opacity" onClick={() => { if (a.dataUrl) onViewImage?.(a.dataUrl, a.name); }} />
                ) : (
                  <div key={`doc-${i}`} className="flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-lg)] bg-white/10 max-w-[200px]">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-4 h-4 shrink-0"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><circle cx="5" cy="6" r="1.3"/><path d="M1.5 11l3.5-3.5 2.5 2.5 3-4 4 5"/></svg>
                    <span className="text-[length:var(--text-11)] truncate">{a.name}</span>
                  </div>
                )
              ) : (
                <div key={`udoc-${i}`} className="flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-lg)] bg-white/10 max-w-[200px]">
                  <DocIcon name={a.name} />
                  <span className="text-[length:var(--text-11)] truncate">{a.name}</span>
                </div>
              )
            ))}
          </div>
        )}
        {isEditing ? (
          /* 编辑框宽高都跟文字走：field-sizing:content 让 textarea 按内容自撑（宽短则窄、高按实际行数），
             max-w-full 受外层 60% 钳制，高度封顶 12 行与展示态 UserMessageText 同规格 */
          <textarea
            autoFocus
            value={curDraft}
            onChange={(e) => onDraftChange?.(e.target.value)}
            onKeyDown={(e) => {
              // 中文输入法组合中回车的 keydown 不带 isComposing 保护会误提交/漏提交——组合确认键跳过
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onCommit?.(); }
              else if (e.key === "Escape") { e.preventDefault(); onCancel?.(); }
            }}
            onBlur={onCancel}
            rows={1}
            placeholder="修改消息…"
            className="block max-w-full min-w-[3ch] bg-transparent outline-none resize-none overflow-y-auto overscroll-contain max-h-[calc(12lh+0.5px)] [field-sizing:content]"
          />
        ) : (
          /* 封顶规格见 UserMessageText（主聊天与子 Agent 过程视图共用，避免两份实现） */
          msg.text ? <UserMessageText text={msg.text} /> : null
        )}
        </div>
        {/* 铅笔常驻在每条 user 气泡下（用户已确认）；不可用时置灰并给出原因（title） */}
        <div className="flex items-center justify-between gap-1 mt-0.5 min-h-6">
          <BubbleActions text={actions.text} onPin={actions.onPin} sid={actions.sid} visible={actions.visible && !isEditing} inline />
          {/* 单条移出上下文后仍显示气泡，编辑态不显示标记（即将重发它）。 */}
          {!isEditing && msg.outOfContext ? <OutOfContextTag /> : null}
          {!isEditing && msg.imageStripped && !msg.outOfContext ? <ImageStrippedTag /> : null}
          {!isEditing && msg.imagesPathOnly ? <ImagePathOnlyTag /> : null}
          {isEditing ? (
            /* 发送按钮占编辑按钮原位（气泡下方右侧）。提交放 onMouseDown 而非 onClick：
               click 前 textarea 先 blur → onBlur 取消编辑 → 节点卸载 → click 丢失(点击无效)。
               mousedown 先于 blur 触发,提交在取消竞态前完成;preventDefault 兜底拦默认焦点转移 */
            <button
              type="button"
              title="发送"
              aria-label="发送修改后的消息"
              onMouseDown={(e) => { e.preventDefault(); onCommit?.(); }}
              className="p-0.5 text-text-muted hover:text-text-primary transition-colors"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartEdit}
              disabled={!!editDisabledReason}
              title={editDisabledReason ?? "修改并重新发送"}
              aria-label="编辑消息"
              className={`p-0.5 transition-colors ${editDisabledReason ? "text-text-muted opacity-40 cursor-not-allowed" : "text-text-muted hover:text-text-primary"}`}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>
            </button>
          )}
        </div>
      </div>
      <div className="msg-avatar user">U</div>
    </div>
  );
}
