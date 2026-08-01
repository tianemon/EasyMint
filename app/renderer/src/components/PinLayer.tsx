import { useEffect, useRef, useCallback } from "react";
import { usePinStore, type Pin } from "../stores/pin-store";
import { TextBlockView } from "./ChatBlocks";

const CARD_W = 320;
const EMPTY_PINS: Pin[] = [];

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const RESIZE_STYLES: Record<ResizeDir, string> = {
  n: "top-0 left-4 right-4 h-1.5 cursor-n-resize",
  s: "bottom-0 left-4 right-4 h-1.5 cursor-s-resize",
  e: "right-0 top-4 bottom-4 w-1.5 cursor-e-resize",
  w: "left-0 top-4 bottom-4 w-1.5 cursor-w-resize",
  ne: "top-0 right-0 w-4 h-4 cursor-ne-resize",
  nw: "top-0 left-0 w-4 h-4 cursor-nw-resize",
  se: "bottom-0 right-0 w-4 h-4 cursor-se-resize",
  sw: "bottom-0 left-0 w-4 h-4 cursor-sw-resize",
};

interface PinLayerProps {
  sessionId: string;
}

/** 图钉图标（Lucide pin 风格：帽沿收腰 + 贯穿针） */
export function PinIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* 针：从钉帽底部中心向下贯穿 */}
      <path d="M8 11.3V15" />
      {/* 钉帽：顶部锚沿 → 收腰 → 底部斜收，外接弧线圆润 */}
      <path d="M6 7.2a1.33 1.33 0 0 1-.74 1.19l-1.19.6A1.33 1.33 0 0 0 3.33 10.16v.51a.67.67 0 0 0 .67.67h8a.67.67 0 0 0 .67-.67v-.51a1.33 1.33 0 0 0-.74-1.2l-1.19-.6a1.33 1.33 0 0 1-.74-1.2V4.67a.67.67 0 0 1 .67-.67 1.33 1.33 0 0 0 0-2.67H5.33a1.33 1.33 0 0 0 0 2.67.67.67 0 0 1 .67.67z" />
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

  // 四周/拐角 resize：按方向计算新几何（西/北含坐标移动），delta 方式；宽 clamp 240-560、高 clamp 100-容器 80%
  const onResizeStart = useCallback((dir: ResizeDir) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startX = pin.x;
    const startY = pin.y;
    const startW = pin.width || CARD_W;
    const startH = pin.height || 200;

    const onMove = (ev: PointerEvent) => {
      const layerEl = layerRef.current;
      if (!layerEl) return;
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      const maxW = Math.min(560, layerEl.clientWidth);
      const maxH = Math.max(100, layerEl.clientHeight * 0.8);

      let nx = startX;
      let ny = startY;
      let nw = startW;
      let nh = startH;

      if (dir.includes("e")) nw = startW + dx;
      if (dir.includes("s")) nh = startH + dy;
      if (dir.includes("w")) {
        // 西拖：右边界固定，左边界 clamp 保证宽度 ≥ 240
        nw = startW - dx;
        nx = Math.min(Math.max(0, startX + dx), startX + startW - 240);
        nw = Math.min(Math.max(240, nw), startX + startW - nx, maxW);
      } else {
        nw = Math.min(Math.max(240, nw), maxW);
        if (dir.includes("e")) nw = Math.min(nw, layerEl.clientWidth - startX);
      }
      if (dir.includes("n")) {
        // 北拖：底边界固定，顶边界 clamp 保证高度 ≥ 100
        nh = startH - dy;
        ny = Math.min(Math.max(0, startY + dy), startY + startH - 100);
        nh = Math.min(Math.max(100, nh), startY + startH - ny, maxH);
      } else {
        nh = Math.min(Math.max(100, nh), maxH);
      }

      const store = usePinStore.getState();
      if (dir.includes("w") || dir.includes("n")) store.movePin(sessionId, pin.id, nx, ny);
      store.resizePin(sessionId, pin.id, nw, nh);
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
  }, [pin.id, pin.x, pin.y, pin.width, pin.height, sessionId, layerRef]);

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
      {/* 四周/拐角 resize 拖拽区（透明，hover 显示光标） */}
      {(Object.keys(RESIZE_STYLES) as ResizeDir[]).map((dir) => (
        <div
          key={dir}
          className={`absolute ${RESIZE_STYLES[dir]} z-10`}
          onPointerDown={onResizeStart(dir)}
          title="调整大小"
        />
      ))}
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
