import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildBlocks, ChatBlockView } from "./ChatBlocks";
import { AttachItem, ChatMessage, piBlocksToEntries, mergeConsecutiveText, piEventToEntries, displayToolLabel, mapSessionMessages, getMsgCopyText } from "./chat-utils";
import { chatActions } from "../stores/chat-actions";
import { useSettingsStore } from "../stores/settings-store";
import { useTabStore } from "../stores/tab-store";
import { useChatStore } from "../stores/chat-store";
import { CONFIRM_DEVELOPMENT_PROMPT } from "../../../shared/prompts";

import { useStatusStore } from "../stores/status-store";
import { StatusBar } from "./StatusBar";
import { useDelegationStore } from "../stores/delegation-store";
import { normalizeApiError } from "../../../shared/api-errors";
import { PermissionPrompt } from "./PermissionPrompt";
import { ChatInput, AttachPreview } from "./ChatInput";
import { SessionStatsPopup } from "./SessionStatsPopup";
import { CompactionDialog } from "./CompactionDialog";
import { getWorkspaceDir } from "../lib/getWorkspaceDir";
import { blocksToMarkdown, selectionToBlocks } from "../lib/selection-to-markdown";
import { PinLayer } from "./PinLayer";
import { usePinStore } from "../stores/pin-store";
import { DelegationProgress, type DelegationUiState, type DelegationTaskUi } from "./DelegationProgress";
import { ContextMenu, type ContextMenuData, type ContextMenuItem } from "./ContextMenu";
import { QuestionHistory } from "./QuestionHistory";
import { BubbleActions, roleColor, DocIcon } from "./ChatBubbleActions";
import { AskUserCard } from "./AskUserCard";
import { useAskStore } from "../stores/ask-store";


interface ChatPanelProps {
  projectPath: string;
  sessionId?: string;
  /** 设计会话标记(tab 直传,避免多新 tab 反查错配导致用错 Mint-D/Mint 模板) */
  isDesigner?: boolean;
  /** 所在 tab id(sendMessage 透传,onChatSession 回绑时精确锚定,防发送中切 tab/关 tab 错配) */
  tabId?: string;
  onSessionCreated?: (sessionId: string) => void;
  onActivity?: () => void;
  onNewProject?: () => void;
}

/** 系统消息 kind → 头部标签(系统卡片统一形态的辨识信息) */
const SYSTEM_KIND_LABELS: Record<string, string> = {
  delegation: "子 Agent 委派",
  shell: "后台命令",
  "project-created": "项目初始化",
  flow: "流程指令",
  handoff: "会话交接",
  summary: "上下文摘要",
};

/** 压缩弹窗「写交接提示词」:让 Mint 总结当前会话,输出可复制的交接内容(不压缩) */
const HANDOFF_PROMPT = "请总结当前会话的全部内容，并写一份交接提示词（包含项目状态、已完成的工作、当前进度、遇到的问题、下一步计划），以便在新会话中继续工作。请直接输出交接提示词内容，用中文。";

export function ChatPanel({ projectPath, sessionId: existingSid, tabId, isDesigner, onSessionCreated, onActivity, onNewProject }: ChatPanelProps): JSX.Element {
  const tempSidRef = useRef<string | null>(null);
  if (!existingSid && !tempSidRef.current) tempSidRef.current = `__new_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const initialSid = existingSid ?? tempSidRef.current!;
  const [sid, setSid] = useState<string>(initialSid);
  const emptyArr = useRef<ChatMessage[]>([]);
  const rawMsgs = useChatStore((s) => s.messagesBySession[sid]);
  const messages: ChatMessage[] = rawMsgs || (emptyArr.current as ChatMessage[]);

  const [_currentRunId, setCurrentRunId] = useState<string | null>(null);
  const currentChatRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const busyRef = useRef(false);
  // 打断时间戳:打断后 1.5s 内的 agent:exit 是旧回合残留(abort 触发),
  // 忽略不清 busy——打断瞬间后台通知开的新回合(turn_start 已设 busy)不被误清
  const interruptAtRef = useRef(0);
  // 会话消息加载中(打开已有会话的磁盘读取+解析耗时):显示加载提示,避免空态跳变
  const [sessionLoading, setSessionLoading] = useState(false);
  // 缓存恢复的使用率暂存:消息加载完成后再应用(避免加载期间输入卡片显示旧进度误导)
  const pendingCtxRef = useRef<number | null>(null);
  // 回合级错误时间戳:error 后 1s 内残留事件不重新设 busy(错误回合已结束)
  const lastErrorAtRef = useRef(0);
  const ctxThresholdFiredRef = useRef(0); // 已按阈值触发过主动压缩（防止同轮重复触发）
  // 压缩弹窗「下次回复完触发」:回复结束(agent:exit)后重置阈值防重 → 重新弹窗走同样流程
  const rearmAfterExitRef = useRef(false);
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
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState("auto");
  const storeModel = useSettingsStore((s) => s.model);
  const setStoreModel = useSettingsStore((s) => s.setModel);
  const showThinking = useSettingsStore((s) => s.showThinking);
  // 全局聊天思考等级:仅作为新会话的初始默认(方案 B,聊天下拉可临时改)
  const globalThinkingLevel = useSettingsStore((s) => s.chatThinkingLevel);
  const [thinkingLevel, setThinkingLevel] = useState(globalThinkingLevel || "medium");
  // 用户是否手动切过思考等级:手动切过后不再跟随全局变化(方案 B)
  const userChangedThinkingRef = useRef(false);
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
    const targetTop = window.innerHeight - rect.height - 16; // --s4 = 16px
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

  const showToolUse = useSettingsStore((s) => s.showToolUse);
  const [chatModel, setChatModel] = useState("");
  // 会话绑定的供应商 piId(需求 5:不同会话不同供应商)
  const [chatProvider, setChatProvider] = useState<string>("");
  // 全局默认模型变化(设置中切供应商联动更新 store.model)→ 主会话模型跟随,全局生效;
  // 挂载时同步初始值;会话缓存恢复(其后执行)可覆盖为会话绑定模型
  useEffect(() => {
    if (storeModel) setChatModel(storeModel);
  }, [storeModel]);

  const handleModelChange = useCallback(async (m: string) => {
    setChatModel(m); setStoreModel(m);
    const sid = sidRef.current;
    if (sid) { window.electronAPI.agent.setModel(sid, m).catch(() => {}); }
  }, [setStoreModel]);
  const [showStats, setShowStats] = useState(false);
  // 压缩确认弹层：auto=阈值自动触发 / manual=统计弹窗按钮
  const [compactDialog, setCompactDialog] = useState<{ source: "auto" | "manual"; threshold?: number } | null>(null);
  const handleThinkingLevelChange = useCallback((level: string) => {
    userChangedThinkingRef.current = true;
    setThinkingLevel(level);
    // 等级随发送应用(sendMessage 带 thinkingLevel,主进程 resume 分支应用)——不再立即 IPC,
    // 避免"切等级 IPC 与发送 IPC 并发"的 SDK 竞态窗口
  }, []);

  // 加固(启动竞态):store 异步加载完成前,新会话可能拿到默认 medium。
  // 全局值变化且用户未手动切过时,同步本地值;手动切过后不再跟随(方案 B)。
  useEffect(() => {
    if (globalThinkingLevel && !userChangedThinkingRef.current) {
      setThinkingLevel(globalThinkingLevel);
    }
  }, [globalThinkingLevel]);

  const msgIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  /** 输入框变化处理：检测开头 / 触发命令面板（仅在输入框纯命令上下文下，不影响代码片段） */
  const autoScrollRef = useRef(true);
  // 最新回合输出块 id:thinking/tool 块归入目标(不做文本 diff,流式临时内容)
  const latestAiIdRef = useRef(0);
  // steer 打断标记
  const steeringRef = useRef(false);
  const sidRef = useRef<string>(initialSid);
  // 当前会话的 pending ask（Mint 提问卡片，聊天区内嵌）
  const pendingAsk = useAskStore((s) => Object.values(s.asks).find((a) => a.sessionId === sid)) || null;

  // ask 卡片弹出时自动滚动到底部（卡片在消息列表尾部文档流，virtualizer anchorTo 不感知它，
  // 需显式滚容器到底——否则用户停留在原位置看不到提问）
  useEffect(() => {
    if (!pendingAsk) return;
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [pendingAsk]);
  // 按会话读压缩/摘要状态(须在 sidRef 声明后——useStatusStore selector 渲染期执行)
  const summarizing = useStatusStore((s) => s.bySession[sidRef.current]?.summarizing ?? false);
  const compacting = useStatusStore((s) => s.bySession[sidRef.current]?.compacting ?? false);
  const [compactDone, setCompactDone] = useState(false);
  const prevCompacting = useRef(false);
  useEffect(() => {
    if (prevCompacting.current && !compacting) setCompactDone(true);
    prevCompacting.current = compacting;
  }, [compacting]);
  useEffect(() => {
    if (!compactDone) return;
    const t = setTimeout(() => setCompactDone(false), 3000);
    return () => clearTimeout(t);
  }, [compactDone]);
  // 压缩超时兜底:SDK 压缩卡死(无 compaction_end)时 60s 后强制清除蒙版
  useEffect(() => {
    if (!compacting) return;
    const t = setTimeout(() => {
      useStatusStore.getState().setCompacting(sidRef.current, false);
      useStatusStore.getState().setSummarizing(sidRef.current, false);
      useStatusStore.getState().popSignal(sidRef.current, "compact");
      useStatusStore.getState().popSignal(sidRef.current, "summary");
    }, 60000);
    return () => clearTimeout(t);
  }, [compacting]);
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

  // 消息列表虚拟化：只渲染可视区 ± overscan 的消息，长对话时 DOM 从数千节点降到 ~30
  // HMR 防御：容器元素用 state 驱动（而非 ref）——DOM 重建时 ref 回调触发 setState，
  // 强制重渲染让 virtualizer 的 _willUpdate 检测到 scrollElement 变化并重新绑定 observer
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const attachScrollRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    setScrollEl(el);
  }, []);
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => 100,
    overscan: 8,
    // 正规手段(替代手写贴底链):anchorTo: "end" 是库原生聊天列表机制——
    // 用户在底部时内容测量变化(流式增长)自动保持贴底;用户滚动离开自动停止跟随。
    // scrollToIndex 的 scrollState 在测量变化时持续校正对齐直到稳定(官方处理估算→实测)
    anchorTo: "end",
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
  const jumpToMessage = useCallback((msgId: number) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    autoScrollRef.current = false;
    if (idx < messages.length - 1) {
      // 非末尾:显示回底按钮(用户可从历史位置一键回底);目标即末尾则保持贴底态
      awayFromBottomRef.current = true;
      setAwayFromBottom(true);
    }
    virtualizer.scrollToIndex(idx, { align: "start" });
    setHighlightMsgId(msgId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightMsgId(null), 1500);
  }, [messages, virtualizer]);

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

  // ── 子 Agent 委派进度卡片 ─────────────────────────
  const [delegation, setDelegation] = useState<DelegationUiState | null>(null);
  // 事件回调内跟踪当前委派状态(副作用必须移出 useState updater——
  // updater 渲染期间执行,调用其他 store 会触发跨组件更新警告)
  const delegationRef = useRef<DelegationUiState | null>(null);

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
      delegationRef.current = next;
      setDelegation(next);
    });
    return unsubInit;
  }, []);

  // Mint ask_user 提问卡片：接收广播（按会话过滤，其他会话的提问不显示）+ 关闭
  useEffect(() => {
    const offReq = window.electronAPI.agent.onAskRequest((data) => {
      if (!data || data.sessionId !== sidRef.current) return;
      useAskStore.getState().setAsk(data);
    });
    const offClosed = window.electronAPI.agent.onAskClosed((data) => {
      useAskStore.getState().clearAsk(data.requestId);
    });
    return () => { offReq(); offClosed(); };
  }, []);

  useEffect(() => {
    const unsub = window.electronAPI.agent.onDelegationProgress((data: DelegationProgressEvent) => {
      // 过滤:仅显示当前窗口 chat 的委派;currentChatRef 未初始化(非主会话 tab)→ 拒绝,
      // 否则 A 会话的委派进度穿透到所有打开的会话 tab(后台任务通知跨会话显示)
      if (!currentChatRef.current) return;
      if (data.chatId && data.chatId !== currentChatRef.current) return;
      const prev = delegationRef.current;
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
      const isNewDelegation = !prev || prev.delegationId !== data.delegationId;
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
      const tasks = prev && prev.delegationId === data.delegationId ? [...prev.tasks] : [];
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
      delegationRef.current = next;
      // 副作用(事件回调内,合法):委派开始 → 常驻「调用 Agent」;结束 → 清除
      if (!prev) {
        useStatusStore.getState().pushSignal(sidRef.current, "agent", "调用 Agent");
      }
      if (finished && (!prev || !prev.finished)) {
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
      setDelegation(next);
    });
    return unsub;
  }, []);

  // 委派/shell 状态订阅已移至 App.tsx 全局常驻(所有 tab 关闭时也要保持 store 新鲜);
  // 此处组件直接读 useDelegationStore 按会话过滤显示

  // 委派触发消息落盘后固定附着点：Mint 主动发起时回合未结束消息未落盘,
  // progress 事件捕获不到 triggerMsgId——消息流更新后补捕获并固定,
  // 卡片不再随"最后一条 AI 消息"漂移(委派完成/打断时 Mint 输出会追加新消息)
  useEffect(() => {
    if (!delegation || delegation.triggerMsgId || delegation.finished) return;
    const aiMsgs = messages.filter((m) => m.role === "ai");
    const lastAi = aiMsgs[aiMsgs.length - 1];
    if (!lastAi?.id) return;
    const fixed: DelegationUiState = { ...delegation, triggerMsgId: lastAi.id };
    delegationRef.current = fixed;
    setDelegation(fixed);
  }, [messages, delegation]);

  // 委派全部完成 3 秒后自动收起卡片
  useEffect(() => {
    if (!delegation?.finished) return;
    const t = setTimeout(() => setDelegation(null), 3000);
    return () => clearTimeout(t);
  }, [delegation?.finished]);

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
        if (!cancelled && msgs.length === 0) { await new Promise((r) => setTimeout(r, 500)); if (cancelled) return; msgs = await window.electronAPI.conv.messages(existingSid, projectDir); }
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
          if (!cancelled && mapped.length > 0) { useChatStore.getState().loadSession(sid, mapped); msgIdRef.current = Math.max(...mapped.map((m) => m.id)); }
          // 加载完成 → 恢复会话缓存的使用率（延迟到此时：避免加载期间输入卡片显示旧进度误导）
          if (!cancelled && pendingCtxRef.current) {
            useStatusStore.getState().setCtxPct(sid, pendingCtxRef.current);
            pendingCtxRef.current = null;
          }
        }
        if (!cancelled) setSessionLoading(false);
    })();
    return () => { cancelled = true; };
  }, [existingSid, projectPath]);

  // showThinking / showToolUse 切换时重新从磁盘加载，使过滤生效
  useEffect(() => {
    if (!existingSid) return;
    const projectDir = projectPath || getWorkspaceDir();
    let cancelled = false;
    (async () => {
      const msgs = await window.electronAPI.conv.messages(existingSid, projectDir);
      if (!cancelled && msgs.length > 0) {
        const mapped = mapSessionMessages(msgs);
        if (mapped.length > 0) useChatStore.getState().loadSession(sidRef.current, mapped);
      }
    })();
    return () => { cancelled = true; };
  }, [showThinking, showToolUse]);

  useEffect(() => {
    const unsub = window.electronAPI.agent.onStream((event: StreamEvent) => {
      if (event.source === "worker") return;
      if (currentChatRef.current) {
        // Filter by chatId when known
        if (!event.runId && !event.chatId) return;
        if (event.runId && event.runId !== currentChatRef.current) return;
        if (event.chatId && event.chatId !== currentChatRef.current) return;
      } else if (existingSid) {
        if (!event.sessionId || event.sessionId !== existingSid) return;
      } else {
        // 没有活跃 chat，也没有已知 session → 拒绝所有外部事件，防止跨窗口污染
        return;
      }
      // 打断后:只丢弃被打断回合的残留内容帧;通知(新注入)正常渲染,
      // 新回合(turn_start,如打断后的 Mint 总结)开始 → 恢复渲染。
      // (原实现 return 丢弃一切——打断通知/总结回合全被吞,磁盘有而 UI 无)
      if (stoppedRef.current) {
        if (event.type === "turn_start") {
          stoppedRef.current = false;
        } else if (event.type !== "custom_event") {
          return;
        }
      }
      if (!currentChatRef.current) {
        const cid = event.chatId || event.runId;
        if (cid) { currentChatRef.current = cid; setCurrentRunId(cid); }
      }
      // error 后 1s 内的残留事件(tool_result/message_end 等)不重新设 busy——
      // error 分支已清 busy(回合结束),残留事件会把按钮打回打断态;新回合 turn_start 除外
      if (event.type === "turn_start" || Date.now() - lastErrorAtRef.current > 1000) {
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
        // 回合开始 → 保持「正在请求」(同 id 更新)——turn_start 在 SDK 发起 API 请求前 emit,
        // 至首个响应块到达前状态栏语义 = 等待 API 返回;收到 thinking 块才转「正在思考」
        useStatusStore.getState().pushSignal(sidRef.current, "request", "正在请求...");
        latestAiIdRef.current = 0;
        steeringRef.current = false;
        // 用户已在弹窗打开期间继续对话 → 关闭压缩询问(选项 1/4 会 abort 新回合,不能误打断)
        setCompactDialog(null);
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
      }
      // tool progress — 状态栏工具信号;shell 计数由后台命令事件驱动(agent:shell-count),
      // 不再按工具事件累加(前台瞬时工具不计入 shell•N)
      if (event.type === "tool_progress" && event.toolName) {
        const label = displayToolLabel(event.toolName, event.toolArgs);
        // 开始执行工具 → 思考信号结束(否则 tool pop 后回退显示「正在思考」);
        // 按 toolCallId 区分信号——连续工具互不干扰(前一个 tool_done 不误 pop 后一个)
        useStatusStore.getState().popSignal(sidRef.current, "request");
        useStatusStore.getState().pushSignal(sidRef.current, `tool:${event.toolCallId ?? "?"}`, label);
      }
      // tool done — 工具执行结束,pop 自己的工具信号;
      // 回合仍在 → 显示「正在处理」(中性等待态,消除状态栏空档;
      // 下一步 turn_start 转「正在请求」/ thinking 帧转「正在思考」/ 文本帧 pop)
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
        useStatusStore.getState().setCompacting(sidRef.current, true);
        useStatusStore.getState().pushSignal(sidRef.current, "compact",
          manualCompactingRef.current ? "正在整理会话..." : "检测到上下文需整理，正在整理…");
      }
      // compacted = 压缩完成：清除 compacting（触发"会话已整理完毕"提示），
      // 并兜底清除 summarizing（防御轮转总结路径的残留）
      if (event.type === "compacted") {
        useStatusStore.getState().setCompacting(sidRef.current, false);
        useStatusStore.getState().setSummarizing(sidRef.current, false);
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
        // 清工具信号:打断时 bash 工具执行信号("sleep 90" 等)残留栈里,
        // 不清理则提示消失后回退显示残留的工具信号
        useStatusStore.getState().popSignalsByPrefix(sidRef.current, "tool:");
        // 打断(abort)是主动操作,按钮状态变化即反馈——不显示提示;
        // 真实错误(503/429/超时)归一化后停留 8s
        if (!/abort|cancel/i.test(event.message || "")) {
          useStatusStore.getState().pushSignal(sidRef.current, "error", normalizeApiError(event.message) || "出错了", 8000);
        }
      }
      // custom 系统消息(委派完成/后台 shell/流程指令)→ 独立即时显示:
      // triggerTurn: false 注入,立即落盘 + 立即事件(带 streaming 标记,
      // loadSession 时被磁盘版本替代,不重复)
      if (event.type === "custom_event" && event.text) {
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
    const unsubExit = window.electronAPI.agent.onExit(({ runId }: { runId: string }) => { if (!currentChatRef.current) return; if (runId !== currentChatRef.current) return; if (Date.now() - interruptAtRef.current < 1500) return; latestAiIdRef.current = 0; busyRef.current = false; setBusy(false); useStatusStore.getState().popSignal(sidRef.current, "request"); useStatusStore.getState().popSignalsByPrefix(sidRef.current, "tool:"); onActivity?.(); if (rearmAfterExitRef.current) { rearmAfterExitRef.current = false; ctxThresholdFiredRef.current = 0; } });
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
        onSessionCreated?.(realSid);
      } else if (!sidRef.current) {
        sidRef.current = realSid;
        setSid(realSid);
        useTabStore.getState().setSessionRunning(realSid, true);
        onSessionCreated?.(realSid);
      }
    });
    // Context rotation events — filter by chatId
    const unsubCtxSum = window.electronAPI.agent.onContextSummarizing(({ chatId: ctxChatId, type }: { chatId: string; type?: string }) => {
      if (!currentChatRef.current) return;
      if (ctxChatId !== currentChatRef.current) return;
      if (type === "done") {
        // 压缩/总结结束兜底:清除压缩蒙版与总结状态(compacted 可能因中止不广播)
        useStatusStore.getState().setCompacting(sidRef.current, false);
        useStatusStore.getState().setSummarizing(sidRef.current, false);
        useStatusStore.getState().popSignal(sidRef.current, "summary");
        useStatusStore.getState().popSignal(sidRef.current, "compact");
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
    const unsubCtxUsage = window.electronAPI.agent.onContextUsage(({ chatId: ctxChatId, percentage }) => {
      if (!currentChatRef.current) return;
      if (ctxChatId !== currentChatRef.current) return;
      // percentage 为 null = 压缩后尚无新回复,使用率未知——置 null 前端显示"—",不显示 0 误导
      const pct = percentage === null ? null : Math.round(percentage);
      useStatusStore.getState().setCtxPct(sidRef.current, pct);
      if (sidRef.current) {
        window.electronAPI.sessionCache.write(sidRef.current, { contextUsage: pct }).catch(() => {});
      }
      // 主动压缩：使用率达到设置阈值就弹窗询问（不直接压缩——用户可跳过或带命令压缩）
      const threshold = useSettingsStore.getState().contextThreshold || 75;
      const sid = sidRef.current;
      const st = useStatusStore.getState().bySession[sid];
      if (
        pct !== null &&
        pct >= threshold &&
        !st?.compacting && !st?.summarizing &&
        ctxThresholdFiredRef.current !== threshold &&
        currentChatRef.current
      ) {
        ctxThresholdFiredRef.current = threshold;
        console.log(`[ChatPanel] ctx ${pct}% ≥ ${threshold}% → 弹窗询问压缩`);
        setCompactDialog({ source: "auto", threshold });
      }
      // 使用率显著回落（压缩完成）后允许再次触发
      if (pct !== null && pct < threshold - 20) ctxThresholdFiredRef.current = 0;
    });
    return () => { unsub(); unsubExit(); unsubSid(); unsubCtxSum(); unsubCtxUsage(); if (sidRef.current) { useTabStore.getState().setSessionRunning(sidRef.current, false); if (!sidRef.current.startsWith("__new_")) { window.electronAPI.agent.scheduleIdleTimeout(sidRef.current, 10 * 60 * 1000); } } useStatusStore.getState().reset(sidRef.current); };
  }, []);

  // Summarizing timeout — 120s safety net
  useEffect(() => {
    if (!summarizing) return;
    const timer = setTimeout(() => {
      useStatusStore.getState().setSummarizing(sidRef.current, false);
      useStatusStore.getState().popSignal(sidRef.current, "summary");
      useStatusStore.getState().pushSignal(sidRef.current, "error", "摘要超时，将开新会话继续", 8000);
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
      useStatusStore.getState().pushSignal(sidRef.current, "error", "压缩状态异常，已恢复界面（压缩可能仍在后台）", 8000);
      console.error("[ChatPanel] compaction timed out after 120s");
    }, 120_000);
    return () => clearTimeout(timer);
  }, [compacting]);

  // Busy 卡住兜底：30s 无事件时，用 session.isStreaming 核实
  useEffect(() => {
    if (!busy || !existingSid) return;
    const interval = setInterval(async () => {
      try {
        const streaming = await window.electronAPI.agent.isStreaming(sidRef.current);
        if (!streaming) {
          setBusy(false);
          useStatusStore.getState().popSignal(sidRef.current, "request");
          useStatusStore.getState().popSignalsByPrefix(sidRef.current, "tool:");
        }
      } catch { /* 网络错误忽略 */ }
    }, 30_000);
    return () => clearInterval(interval);
  }, [busy, existingSid]);

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
    if (!existingSid) return;
    window.electronAPI.sessionCache.read(existingSid).then((cache) => {
      if (cache) {
        if (cache.permissionMode) setPermissionMode(cache.permissionMode);
        if (cache.model) setChatModel(cache.model);
        if (cache.provider) setChatProvider(cache.provider);
        if (cache.contextUsage !== null && cache.contextUsage > 0) pendingCtxRef.current = cache.contextUsage; // 暂存,消息加载完成后再应用
        // 会话绑定的供应商(设置中切供应商时写入)→ 活跃会话热切应用;
        // 未活跃时会话由重建分支用 preferredProvider 恢复,无需在此处理
        if (cache.model && cache.provider) {
          window.electronAPI.agent.setModel(existingSid, cache.model, cache.provider).catch(() => {});
        }
      }
    }).catch(() => {});
  }, [existingSid]);

  useEffect(() => {
    if (sidRef.current) {
      window.electronAPI.sessionCache.write(sidRef.current, { permissionMode }).catch(() => {});
    }
  }, [permissionMode]);

  useEffect(() => {
    if (sidRef.current && chatModel) {
      window.electronAPI.sessionCache.write(sidRef.current, { model: chatModel }).catch(() => {});
    }
  }, [chatModel]);

  // ── Send ───────────────────────────────────────────

  const sendText = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg && attaches.length === 0) return;
    // 用户发新消息 → 取消当前会话挂起的 ask_user（对齐 cc：发消息 = 转向，提问等待无意义）
    const asks = useAskStore.getState().asks;
    for (const k in asks) {
      if (asks[k]!.sessionId === sidRef.current) {
        window.electronAPI.agent.respondAsk(k, null);
        useAskStore.getState().clearAsk(k);
      }
    }
    // 重入保护:新会话首条消息在途(onChatSession 绑定真实 sid 前)时再发送 → 丢弃。
    // 否则会再建第二个会话、首回合回复丢失;已有会话时走下方 steer 插话分支,不受影响
    if (busyRef.current && !existingSid) return;

    // Build agent message with numbered markers
    const parts: string[] = [];
    attaches.forEach((a, i) => {
      const tag = a.kind === "image" ? "Image" : "File";
      parts.push(`[${tag} #${i + 1}: ${a.path}]`);
    });
    if (msg) parts.push(msg);
    const agentText = parts.join("\n");

    const ts = Date.now();
    useChatStore.getState().appendUserMsg(sidRef.current, { role: "user", text: msg || undefined, attaches: [...attaches], timestamp: ts });
    // 首条消息:输入卡片从居中平滑下移到底部(FLIP)
    if (!messages.length && !existingSid) {
      startCardLeave();
    }
    // 新用户消息 → 重置输出段块状态(steer 插话不触发 turn_start 时兜底)
    latestAiIdRef.current = 0;
    setAttaches([]);
    onActivity?.();
    stoppedRef.current = false; autoScrollRef.current = true; scrollToBottom(true);

    // Mint 输出期间发送消息 → steer 插话，不需新建会话
    if (busy && currentChatRef.current && existingSid) {
      steeringRef.current = true;
      try {
        await window.electronAPI.agent.steer(existingSid, agentText);
      } catch { /* steer 失败不影响 UI */ }
      return;
    }

    busyRef.current = true; setBusy(true); useStatusStore.getState().pushSignal(sidRef.current, "request", "正在请求...");

    try {
      currentChatRef.current = null;
      // 编码图片附件为 Pi ImageContent 格式
      const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
      for (const a of attaches) {
        if (a.kind === "image" && a.dataUrl) {
          const m = a.dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
          if (m) images.push({ type: "image" as const, data: m[2]!, mimeType: m[1]! });
        }
      }
      const tab = useTabStore.getState().tabs.find(function(t) { return t.sessionId === sid || (!t.sessionId && !existingSid); });
      const effectivePath = projectPath || getWorkspaceDir();
      // 新会话:角色取自空状态选择(chatRole);恢复会话:沿用 tab 的 isDesigner
      const roleDesigner = existingSid ? (isDesigner ?? tab?.isDesigner) : chatRole === "mint-d";
      const result = await window.electronAPI.agent.sendMessage(effectivePath, agentText, { sessionId: existingSid ?? null, permissionMode: permissionMode ?? "auto", isDesigner: roleDesigner, images: images.length > 0 ? images : undefined, thinkingLevel: thinkingLevel ?? "medium", preferredProvider: chatProvider || undefined, tabId });
      setCurrentRunId(result.chatId); currentChatRef.current = result.chatId;
    } catch { busyRef.current = false; setBusy(false); currentChatRef.current = null; useStatusStore.getState().pushSignal(sidRef.current, "error", "发送失败，请检查网络后重试", 8000); }
  }, [busy, attaches, projectPath, permissionMode, thinkingLevel, chatProvider, chatRole, tabId]);

  useEffect(() => { chatActions.register((t: string) => sendText(t)); return () => chatActions.unregister(); }, [sendText]);

  const hasMessages = messages.length > 0;

  // Tool-call driven UI actions — Mint calls show_* tools, frontend detects tool_use entries
  const lastToolUses = useMemo(() => {
    if (messages.length === 0) return [];
    const lastAi = messages.filter((m) => m.role === "ai" && m.entries).pop();
    if (!lastAi?.entries) return [];
    return lastAi.entries.filter((e) => e.kind === "tool_use");
  }, [messages]);
  // 工具广播直连:Mint 调 show_confirm_dev/show_new_project 时立即显示(不受 busy 影响);
  // 点击按钮消费后从消息中移除 show_* 条目,推断分支不再命中(打断/回合结束不会复活)。
  // 消息推断(lastToolUses)保留作历史恢复兜底。
  const [confirmDevFlag, setConfirmDevFlag] = useState(false);
  const [newProjectFlag, setNewProjectFlag] = useState(false);
  useEffect(() => {
    const off1 = window.electronAPI.agent.onConfirmDev(() => setConfirmDevFlag(true));
    const off2 = window.electronAPI.agent.onNewProject(() => setNewProjectFlag(true));
    return () => { off1(); off2(); };
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
  const showNewProjectBtn = onNewProject && (newProjectFlag || (!busy && lastToolUses.some((e) => (e as { name?: string }).name === "show_new_project")));

  // ── Render user bubble ─────────────────────────────

  function UserBubble({ msg }: { msg: ChatMessage }): JSX.Element {
    return (
      /* 宽度钳制由外层 relative（shrink-0 max-w-[75%]）负责；
         此处不再设 max-w/w-fit，避免相对 fit-content 层的循环依赖导致短文本被压窄 */
      <div className="flex gap-4 items-start">
        <div className="min-w-0">
          <div className="msg-from text-right">USER</div>
          <div className="msg-bubble-user rounded-[10px] rounded-br-[4px] px-[14px] py-1.5 leading-[1.55] overflow-hidden min-w-0 [overflow-wrap:anywhere]">
          {msg.attaches && msg.attaches.length > 0 && (
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {msg.attaches.map((a, i) => (
                a.kind === "image" ? (
                  a.dataUrl ? (
                    <img key={`img-${i}`} src={a.dataUrl} alt={a.name} className="max-w-[260px] max-h-[220px] rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setPreviewImage(a.dataUrl || null)} />
                  ) : (
                    <div key={`doc-${i}`} className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/10 max-w-[200px]">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-4 h-4 shrink-0"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><circle cx="5" cy="6" r="1.3"/><path d="M1.5 11l3.5-3.5 2.5 2.5 3-4 4 5"/></svg>
                      <span className="text-[length:var(--text-11)] truncate">{a.name}</span>
                    </div>
                  )
                ) : (
                  <div key={`udoc-${i}`} className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/10 max-w-[200px]">
                    <DocIcon name={a.name} />
                    <span className="text-[length:var(--text-11)] truncate">{a.name}</span>
                  </div>
                )
              ))}
            </div>
          )}
          {msg.text ? <div className="whitespace-pre-wrap [overflow-wrap:anywhere] min-w-0">{msg.text}</div> : null}
          </div>
        </div>
        <div className="msg-avatar user">U</div>
      </div>
    );
  }

  const userBubble = useCallback((msg: ChatMessage) => (
    <UserBubble msg={msg} />
  ), []);

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
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  // 气泡动态鼓出:与当前宽度反比(窄滑块鼓多、宽滑块鼓少),两边视觉膨胀感一致;
  // 基准=标准按钮宽(首渲染时 ref 未绑,回退 48+3)
  const growX = sliderBox ? (14 * ((roleBtnRefs.current[0]?.offsetWidth ?? 48) + 3)) / sliderBox.width : 14;

  // 输入卡片(空态与非空态共用同一实例,仅外层容器不同)——包裹层做 FLIP 位移测量
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const renderChatInput = (
    <div ref={inputWrapRef}>
      <ChatInput
        busy={busy}
        attaches={attaches}
        setAttaches={setAttaches}
        onSend={sendText}
        onStop={() => { stoppedRef.current = true; busyRef.current = false; interruptAtRef.current = Date.now(); const rid = currentChatRef.current; if (rid) window.electronAPI.agent.abort(rid); setBusy(false); }}
        onPaste={handlePaste}
        imgInputRef={imgInputRef}
        docInputRef={docInputRef}
        onImgChange={handleImgChange}
        onDocChange={handleDocChange}
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
        chatModel={chatModel || storeModel}
        onModelChange={handleModelChange}
        thinkingLevel={thinkingLevel}
        onThinkingLevelChange={handleThinkingLevelChange}
        sessionId={sidRef.current}
        onStatsClick={() => setShowStats(true)}
      />
    </div>
  );

  return (
    <div className="absolute inset-0 flex flex-col" onDragOver={handleDragOver} onDrop={handleDrop}>
      <div
        ref={attachScrollRef}
        onScroll={handleScroll}
        onWheel={handleUserInput}
        onTouchStart={handleUserInput}
        onTouchMove={handleUserInput}
        onMouseDown={handleUserInput}
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
                    className="pb-8"
                  >
                    {/* 跳转高亮层:常驻 absolute 不占布局(虚拟滚动测量零干扰)、opacity 过渡
                        (圆角始终存在,消失只是淡出,无「圆角变直角」)、仅上边外扩 5px——
                        高亮矩形上边框与消息内容(含头像)留 5px 间距,其余边贴合内容 */}
                    <div
                      className={`absolute -top-[5px] inset-x-[26px] bottom-0 rounded-[10px] bg-accent-bg transition-opacity duration-500 pointer-events-none ${msg.id === highlightMsgId ? "opacity-100" : "opacity-0"}`}
                    />
                    <MemoChatMessage
                      msg={msg}
                      showThinking={showThinking}
                      showToolUse={showToolUse}
                      busy={vi.index === messages.length - 1 && busy}
                      userBubble={userBubble}
                      onPin={handlePin}
                      onContextMenu={handleMsgContextMenu}
                      sid={sid}
                    />
                    {/* 委派进度卡片：固定附着在触发消息气泡下方(左对齐气泡)；
                        triggerMsgId 缺失(委派由 Mint 主动发起,消息未落盘时捕获不到)时
                        挂在最后一条 AI 消息下兜底 */}
                    {(delegation && delegation.triggerMsgId === msg.id) ||
                      (delegation && !delegation.triggerMsgId && vi.index === messages.length - 1 && msg.role === "ai") ? (
                      <div className="flex gap-4 items-start" style={{ padding: "0 var(--s8)" }}>
                        <div style={{ width: 34, flexShrink: 0 }} />
                        <DelegationProgress delegation={delegation} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {showNewProjectBtn && (
              <div className="flex justify-center pb-3">
                <button
                  onClick={() => { setNewProjectFlag(false); consumeShowTools(); onNewProject?.(); }}
                  className="px-6 py-2.5 rounded-xl bg-accent text-text-inverse text-sm font-medium hover:bg-accent-hover transition-colors shadow-sm"
                >
                  新建项目
                </button>
              </div>
            )}
            {showConfirmDev && (
              <div className="flex justify-center pb-3">
                <button
                  onClick={() => { setConfirmDevFlag(false); consumeShowTools(); sendText(CONFIRM_DEVELOPMENT_PROMPT); }}
                  className="px-6 py-2.5 rounded-[10px] bg-accent text-text-inverse text-sm font-semibold border-none cursor-pointer transition-all duration-200 hover:bg-accent-hover hover:-translate-y-px active:translate-y-0"
                >
                  确认开发
                </button>
              </div>
            )}
            {/* Compact 完成提示 */}
            {compactDone && (
              <div className="flex justify-center py-3">
                <span className="text-[length:var(--text-11)] text-text-secondary bg-surface-alt px-3 py-1 rounded-full border border-border/50">会话已整理完毕</span>
              </div>
            )}

          </div>
        )}
        {/* Mint 提问卡片：独立于消息列表（空态也显示），渲染在滚动区尾部；宽度与输入卡片一致 */}
        {pendingAsk && (
          <div className="mx-[var(--s16)] pt-1 pb-2">
            <AskUserCard request={pendingAsk} />
          </div>
        )}
      </div>

      {/* 状态栏:独立于输入区,渲染在输入容器上方 */}
      <StatusBar sessionId={sidRef.current} />
      <PermissionPrompt />

      {/* Attach preview — above thinking when busy;mx-4 与输入卡片左右边距(--s16)对齐,否则条比卡片宽;
          复用 ChatInput 胶囊式组件(busy/非 busy 视觉一致,不再有 64px 放大缩略图) */}
      {busy && attaches.length > 0 && (
        <div className="mx-4 px-4 py-2 bg-surface-alt/30 border-t border-border/50 shrink-0"><AttachPreview attaches={attaches} setAttaches={setAttaches} /></div>
      )}

      {/* 气泡锚点容器:仅用于气泡悬浮定位(独立于输入卡片 DOM,悬浮在卡片上方)。
          空态时 flex-1 垂直居中基础上再上移 200px(视觉重心偏上),有消息后回底部(shrink-0);
          首条消息发送时输入卡片包裹层 FLIP 动画平滑下移 */}
      <div
        className={`relative ${(!hasMessages || leavingStartCard) ? "flex-1 flex flex-col justify-center" : "shrink-0"}`}
        style={!hasMessages && !leavingStartCard ? { transform: "translateY(-200px)" } : undefined}
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
                className="group relative flex items-center rounded-full bg-glass-track border border-glass-track-border p-1 backdrop-blur-[20px] backdrop-saturate-[1.4]"
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
                  {sliderPressed && (
                    <>
                      {/* 边框彩虹色散:细描边环(mask 只留 0.5px 环)叠在灰色边框上,
                          低透明度渐变——玻璃边缘的彩虹折射 */}
                      <span
                        className="absolute inset-0 rounded-full pointer-events-none"
                        style={{
                          padding: 0.5,
                          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                          WebkitMaskComposite: "xor",
                          maskComposite: "exclude",
                          background: "linear-gradient(135deg, rgba(244,63,94,0.4), rgba(245,158,11,0.4) 20%, rgba(34,197,94,0.4) 40%, rgba(59,130,246,0.4) 60%, rgba(168,85,247,0.4) 80%, rgba(244,63,94,0.4))",
                        }}
                      />
                    </>
                  )}
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
            title={showNewMsg ? "查看最新消息" : "回到底部"}
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
          onImmediate={() => {
            // 不预置 compacting——蒙版显示完全跟随 SDK 真实状态(compacting 事件);
            // SDK 未真正开始压缩(如 abort 挂起)则不显示,避免误导
            window.electronAPI.agent.compact(sidRef.current).catch(() => {});
            setCompactDialog(null);
          }}
          onWithInstructions={(instructions) => {
            window.electronAPI.agent.compact(sidRef.current, instructions || undefined).catch(() => {});
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
      {/* 内容便签悬浮层：仅当前会话可见，随 tab 显隐 */}
      <PinLayer sessionId={sid} />
      {/* 用户历史提问：右上角按钮 + 右侧抽屉（跳转消息顶部对齐并高亮） */}
      <QuestionHistory sessionId={sid} messages={messages} onJump={jumpToMessage} />
      <ContextMenu menu={ctxMenu} onClose={closeMenu} />
      {/* 钉住提示 */}
      {pinToast && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg bg-surface-elevated border border-border shadow-lg text-xs text-text-primary pointer-events-none">
          {pinToast}
        </div>
      )}
      {/* Image lightbox */}
      {previewImage && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center outline-none"
          onClick={() => setPreviewImage(null)}
          onKeyDown={(e) => { if (e.key === "Escape") setPreviewImage(null); }}
          tabIndex={-1} ref={(el) => el?.focus()}>
          <img src={previewImage} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()} />
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
            onClick={(e) => { e.stopPropagation(); setPreviewImage(null); }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5"><path d="M4 4l8 8M12 4L4 12"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Memo message item: avoids re-rendering all messages on each stream event ──

interface MemoChatMessageProps {
  msg: ChatMessage;
  showThinking: boolean;
  showToolUse: boolean;
  busy: boolean;
  userBubble: (msg: ChatMessage) => JSX.Element;
  onPin: (text: string) => void;
  onContextMenu: (msg: ChatMessage, e: React.MouseEvent) => void;
  sid: string;
}

const MemoChatMessage = memo(function MemoChatMessage({ msg, showThinking, showToolUse, busy, userBubble, onPin, onContextMenu, sid }: MemoChatMessageProps) {
  const visible = useMemo(() => {
    if (!msg.entries) return [];
    return msg.entries.filter((e) => {
      if (e.kind === "text") return true;
      if (e.kind === "thinking") return showThinking;
      // 开发工具结果始终显示(edit diff / read/write/bash 精简摘要,原设计意图);
      // 其余工具结果(如 mcp_tavily 搜索结果)跟随开关,关闭时不渲染
      if (e.kind === "tool_result") return showToolUse || e.name === "edit" || e.name === "read" || e.name === "write" || e.name === "bash";
      return showToolUse;
    });
  }, [msg.entries, showThinking, showToolUse]);

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
        .replace(/^\[系统消息\]-\[Agent执行结果\]\s*/, "")
        .replace(/^\[系统消息\]\s*/, "");
      // 委派/后台 shell 结果:解析 ⏺ 摘要行(红绿灯三色);其他 kind:纯文本
      const isResult = kind === "delegation" || kind === "shell";
      const rows = isResult ? body.split("\n").filter((l) => l.startsWith("⏺ ")) : [];
      return (
        <div
          className="flex gap-4 items-start"
          style={{ padding: "0 var(--s8)" }}
          onContextMenu={(e) => onContextMenu(msg, e)}
        >
          <div style={{ width: 34, flexShrink: 0 }} />
          <div className="relative w-fit max-w-[75%] min-w-0 my-1" onMouseEnter={showActions} onMouseLeave={scheduleHideActions}>
            <div className="msg-bubble-system rounded-[10px] rounded-bl-[4px] border border-border bg-surface-elevated overflow-hidden">
              {/* 头部:系统图标 + kind 标签(区别于 assistant 的 Mint 头像气泡) */}
              <div className="flex items-center gap-1.5 px-[14px] pt-1.5 text-[length:var(--text-11)] text-text-secondary">
                <svg className="shrink-0 text-info" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M8 7.5V11" />
                  <path d="M8 5h.01" />
                </svg>
                <span>{SYSTEM_KIND_LABELS[kind] ?? "系统消息"}</span>
              </div>
              {/* 内容区 */}
              <div className="px-[14px] pb-1.5 leading-[1.55]">
                {isResult ? (
                  rows.map((row, i) => {
                    const m = row.match(/^⏺ (.+?) — (完成|失败|中止)(?: · (\d+)s)?$/);
                    // 中止=人为打断(黄),失败=意外中断(红),完成=绿——原生 ⏺ 字符
                    const status = m?.[2];
                    const dotColor = status === "中止" ? "text-interrupt" : status === "失败" ? "text-fail" : "text-done";
                    return (
                      <div key={i} className="flex items-center gap-2 py-0.5">
                        <span className={`${dotColor} shrink-0 text-[length:var(--text-2xs)] leading-none`}>⏺</span>
                        {m ? (
                          <>
                            <span className="text-text-primary">{m[1]}</span>
                            <span className={`${dotColor}`}>— {m[2]}</span>
                            {m[3] && <span className="text-text-secondary/70 tabular-nums">· {m[3]}s</span>}
                          </>
                        ) : (
                          <span className="text-text-secondary">{row.slice(2)}</span>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="whitespace-pre-wrap [overflow-wrap:anywhere] text-text-primary">{body}</div>
                )}
              </div>
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
             max-w-[75%]：超长文本钳制宽度后由内部 overflow-wrap 换行 */}
          <div className="relative shrink-0 max-w-[75%] min-w-0" onMouseEnter={showActions} onMouseLeave={scheduleHideActions}>
            {userBubble(msg)}
            <BubbleActions text={copyText} onPin={onPin} sid={sid} visible={actionsVisible} />
          </div>
        </div>
      </div>
    );
  }

  if (visible.length === 0) return null;

  // 群聊消息:按 agentRole 标注角色(头像首字符 + 角色名 + 转发来源标记)
  const role = msg.agentRole;
  const avatarChar = role ? role.charAt(0).toUpperCase() : "M";
  const displayName = role ?? "Mint";

  return (
    <div className="msg-in" onContextMenu={(e) => onContextMenu(msg, e)}>
      <div className="flex gap-4 items-start max-w-[75%]">
        <div className="msg-avatar agent" style={role ? { backgroundColor: roleColor(role), color: "#fff" } : undefined}>{avatarChar}</div>
        <div className="min-w-0 relative" onMouseEnter={showActions} onMouseLeave={scheduleHideActions}>
          <div className="msg-from">
            {displayName}
            {role && msg.forwarded && (
              <span className="text-text-secondary/60 ml-1.5 text-[length:var(--text-2xs)] font-normal">· {msg.forwardedFrom ? `来自 ${msg.forwardedFrom}` : "来自转发"}</span>
            )}
          </div>
          <div className="msg-bubble-agent rounded-[10px] rounded-bl-[4px] px-[14px] py-1.5 overflow-hidden">
            {blocks.map((block, i) => (
              <ChatBlockView key={`blk-${msg.id}-${i}`} block={block} streaming={busy} />
            ))}
          </div>
          <BubbleActions text={copyText} onPin={onPin} sid={sid} visible={actionsVisible} />
        </div>
      </div>
    </div>
  );
});
