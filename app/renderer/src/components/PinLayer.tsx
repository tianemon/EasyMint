import { useState, useEffect, useRef, useCallback } from "react";
import { usePinStore, type Pin } from "../stores/pin-store";
import { TextBlockView } from "./ChatBlocks";

const CARD_W = 320;
const EMPTY_PINS: Pin[] = [];

interface PinLayerProps {
  sessionId: string;
  /** 消息滚动容器（选区监听挂载点） */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

/** 图钉图标 */
function PinIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.8 1.7a1.5 1.5 0 012.1 0l2.4 2.4a1.5 1.5 0 010 2.1l-1.1 1.1-4.5-4.5 1.1-1.1z" />
      <path d="M8.7 5.4L4 6.1l-.7 4.7L8.7 5.4z" />
      <path d="M1.5 14.5l3.8-3.8" />
    </svg>
  );
}

// ── 单个便签卡片 ─────────────────────────────────────

interface PinCardProps {
  pin: Pin;
  sessionId: string;
  layerRef: React.RefObject<HTMLDivElement | null>;
}

function PinCard({ pin, sessionId, layerRef }: PinCardProps): JSX.Element {
  // 渲染 clamp：窗口缩小后便签不丢失（只影响显示，不改持久化坐标）
  const layer = layerRef.current;
  const maxX = layer ? Math.max(0, layer.clientWidth - CARD_W) : pin.x;
  const maxY = layer ? Math.max(0, layer.clientHeight - 100) : pin.y;
  const x = Math.min(Math.max(0, pin.x), maxX);
  const y = Math.min(Math.max(0, pin.y), maxY);

  // 拖动：delta 方式（起点 + 位移），与坐标系无关；pointer capture 保证拖出卡片不丢
  const onDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startPinX = pin.x;
      const startPinY = pin.y;

      const onMove = (ev: PointerEvent) => {
        const layerEl = layerRef.current;
        const mx = layerEl ? Math.max(0, layerEl.clientWidth - CARD_W) : Infinity;
        const my = layerEl ? Math.max(0, layerEl.clientHeight - 100) : Infinity;
        const nx = Math.min(Math.max(0, startPinX + (ev.clientX - startClientX)), mx);
        const ny = Math.min(Math.max(0, startPinY + (ev.clientY - startClientY)), my);
        usePinStore.getState().movePin(sessionId, pin.id, nx, ny);
      };
      const onUp = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        usePinStore.getState().persistPins(sessionId);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
    },
    [pin.id, pin.x, pin.y, sessionId, layerRef],
  );

  return (
    <div
      className="absolute rounded-xl border border-border bg-surface-elevated shadow-xl overflow-hidden"
      style={{ left: x, top: y, width: CARD_W }}
      onPointerDown={() => usePinStore.getState().bringToFront(sessionId, pin.id)}
    >
      {/* 标题栏（拖动把手） */}
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-alt border-b border-border cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onDragStart}
      >
        <PinIcon className="w-3 h-3 text-text-secondary shrink-0" />
        <span className="flex-1 text-xs font-medium text-text-primary truncate">{pin.title}</span>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="移除便签"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => usePinStore.getState().removePin(sessionId, pin.id)}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="w-3 h-3"><path d="M4 4l8 8M12 4L4 12" /></svg>
        </button>
      </div>
      {/* 内容区：Markdown 快照，超高滚动 */}
      <div className="px-3 py-2 overflow-y-auto" style={{ maxHeight: layer ? layer.clientHeight * 0.4 : "40vh" }}>
        <TextBlockView block={{ kind: "text", text: pin.content }} />
      </div>
    </div>
  );
}

// ── 悬浮层 ───────────────────────────────────────────

export function PinLayer({ sessionId, scrollRef }: PinLayerProps): JSX.Element {
  const pins = usePinStore((s) => s.pinsBySession[sessionId]) || EMPTY_PINS;
  const layerRef = useRef<HTMLDivElement>(null);
  const [selBtn, setSelBtn] = useState<{ x: number; y: number; text: string } | null>(null);

  // 挂载 / 切会话时加载便签
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.pin.get(sessionId).then((loaded) => {
      if (!cancelled) usePinStore.getState().loadPins(sessionId, loaded);
    }).catch((e: unknown) => {
      console.error("[pin] load failed", e);
      if (!cancelled) usePinStore.getState().loadPins(sessionId, []);
    });
    return () => { cancelled = true; };
  }, [sessionId]);

  // 新便签（x<0 未定位）分配默认位置：右上角错开堆叠，分配后持久化
  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const unpositioned = pins.filter((p) => p.x < 0);
    if (unpositioned.length === 0) return;
    const store = usePinStore.getState();
    const positionedCount = pins.length - unpositioned.length;
    unpositioned.forEach((p, i) => {
      const idx = (positionedCount + i) % 5;
      store.movePin(sessionId, p.id, Math.max(16, el.clientWidth - CARD_W - 16 - idx * 24), 16 + idx * 24);
    });
    store.persistPins(sessionId);
  }, [pins, sessionId]);

  // 选区钉住：消息区选中文字 → 选区附近浮出"钉住"按钮
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onMouseUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) { setSelBtn(null); return; }
      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) { setSelBtn(null); return; }
      const rect = range.getBoundingClientRect();
      const layerRect = layerRef.current?.getBoundingClientRect();
      if (!layerRect) return;
      setSelBtn({ x: rect.right - layerRect.left + 4, y: rect.bottom - layerRect.top + 4, text: sel.toString() });
    };
    const onMouseDown = (e: MouseEvent) => {
      // 点击浮动按钮本身不隐藏（交给按钮 onClick）
      if ((e.target as HTMLElement).closest("[data-pin-sel-btn]")) return;
      setSelBtn(null);
    };
    container.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      container.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [scrollRef]);

  const handleSelPin = useCallback(() => {
    // 副作用移出 setState updater：StrictMode 下 updater 会被 double-invoke，updater 内的 addPin 会执行两次
    if (selBtn) {
      usePinStore.getState().addPin(sessionId, selBtn.text);
      window.getSelection()?.removeAllRanges();
      setSelBtn(null);
    }
  }, [sessionId, selBtn]);

  return (
    <div ref={layerRef} className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
      {pins.map((pin) => (
        <div key={pin.id} className="pointer-events-auto contents">
          <PinCard pin={pin} sessionId={sessionId} layerRef={layerRef} />
        </div>
      ))}
      {selBtn && (
        <button
          data-pin-sel-btn
          className="absolute pointer-events-auto flex items-center gap-1 px-2 py-1 rounded-md bg-surface-elevated border border-border shadow-lg text-xs text-text-primary hover:bg-surface-hover transition-colors"
          style={{ left: selBtn.x, top: selBtn.y }}
          onClick={handleSelPin}
        >
          <PinIcon className="w-3 h-3" />
          钉住
        </button>
      )}
    </div>
  );
}
