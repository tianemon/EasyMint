import { useEffect, useRef, useCallback } from "react";
import { usePinStore, type Pin } from "../stores/pin-store";
import { TextBlockView } from "./ChatBlocks";

const CARD_W = 320;
const EMPTY_PINS: Pin[] = [];

interface PinLayerProps {
  sessionId: string;
}

/** 图钉图标 */
export function PinIcon({ className }: { className?: string }): JSX.Element {
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
  const maxX = layer ? Math.max(0, layer.clientWidth - (pin.width || CARD_W)) : pin.x;
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
        const mx = layerEl ? Math.max(0, layerEl.clientWidth - (pin.width || CARD_W)) : Infinity;
        const my = layerEl ? Math.max(0, layerEl.clientHeight - 100) : Infinity;
        const nx = Math.min(Math.max(0, startPinX + (ev.clientX - startClientX)), mx);
        const ny = Math.min(Math.max(0, startPinY + (ev.clientY - startClientY)), my);
        usePinStore.getState().movePin(sessionId, pin.id, nx, ny);
      };
      const onUp = () => {
        // onUp 幂等：pointerup / pointercancel 复用同一清理函数
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        usePinStore.getState().persistPins(sessionId);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [pin.id, pin.x, pin.y, sessionId, layerRef],
  );

  // resize：右下角手柄拖动，delta 方式；宽 clamp 240-560，高 clamp 100-容器 80%
  const onResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startW = pin.width || CARD_W;
    const startH = pin.height || 200;

    const onMove = (ev: PointerEvent) => {
      const layerEl = layerRef.current;
      const maxH = layerEl ? Math.max(100, layerEl.clientHeight * 0.8) : Infinity;
      const nw = Math.min(Math.max(240, startW + (ev.clientX - startClientX)), 560);
      const nh = Math.min(Math.max(100, startH + (ev.clientY - startClientY)), maxH);
      usePinStore.getState().resizePin(sessionId, pin.id, nw, nh);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      usePinStore.getState().persistPins(sessionId);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }, [pin.id, pin.width, pin.height, sessionId, layerRef]);

  return (
    <div
      className="absolute rounded-xl border border-border bg-surface-elevated shadow-xl overflow-hidden"
      style={{ left: x, top: y, width: pin.width || CARD_W }}
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
      <div className="px-3 py-2 overflow-y-auto" style={pin.height ? { height: pin.height } : { maxHeight: layer ? layer.clientHeight * 0.4 : "40vh" }}>
        <TextBlockView block={{ kind: "text", text: pin.content }} />
      </div>
      {/* resize 手柄：右下角拖动调整大小 */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors"
        onPointerDown={onResizeStart}
        title="调整大小"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="w-2.5 h-2.5"><path d="M12 12L4 4M12 12V8M12 12H8" /></svg>
      </div>
    </div>
  );
}

// ── 悬浮层 ───────────────────────────────────────────

export function PinLayer({ sessionId }: PinLayerProps): JSX.Element {
  const pins = usePinStore((s) => s.pinsBySession[sessionId]) || EMPTY_PINS;
  const layerRef = useRef<HTMLDivElement>(null);

  // 挂载 / 切会话时加载便签
  useEffect(() => {
    let cancelled = false;
    // dev server 等无 electronAPI 环境直接跳过（与 pin-store.persistPins 守卫一致）
    if (typeof window === "undefined" || !window.electronAPI?.pin?.get) return;
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

  return (
    <div ref={layerRef} className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
      {pins.map((pin) => (
        <div key={pin.id} className="pointer-events-auto contents">
          <PinCard pin={pin} sessionId={sessionId} layerRef={layerRef} />
        </div>
      ))}
    </div>
  );
}
