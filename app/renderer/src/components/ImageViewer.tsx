import { memo, useCallback, useEffect, useRef, useState } from "react";

export interface ImageViewerState { src: string; name?: string; }

// 缩放界限:下限可缩小看全貌,上限够看清长图细节;双击在「适应窗口 ↔ 原始像素」间切换
const MIN_SCALE = 0.2;
const MAX_SCALE = 12;
// 平滑过渡(双击/复位);滚轮与拖拽要求即时跟手,不带 transform 过渡
const SMOOTH_TRANSITION = "transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease";
const INSTANT_TRANSITION = "opacity 150ms ease";

// 自实现图片浏览器(不走系统预览渠道):磨砂遮罩 + 滚轮朝光标缩放 + 拖拽平移 +
// 双击适应/1:1 切换;Esc / 点击空白 / ✕ 关闭。遮罩与悬浮件全部走设计 token,随 data-theme 亮暗换肤。
function ImageViewer_({ view, onClose }: { view: ImageViewerState | null; onClose: () => void }): JSX.Element | null {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [smooth, setSmooth] = useState(false);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Ref 为准(State 仅供渲染):滚轮高频事件下避免闭包取到过期值
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  // 遮罩完整点击:仅 mousedown 也在遮罩上才算点外部关闭(拖选/拖图移出遮罩松开不误关)
  const overlayDownRef = useRef(false);

  const commit = useCallback((s: number, o: { x: number; y: number }, isSmooth = false) => {
    scaleRef.current = s;
    offsetRef.current = o;
    setSmooth(isSmooth);
    setScale(s);
    setOffset(o);
  }, []);

  // 平移夹取:未放大时归中,放大后限制在图片自身范围内
  const clampOffset = useCallback((o: { x: number; y: number }, s: number) => {
    const el = imgRef.current;
    if (!el || s <= 1) return { x: 0, y: 0 };
    const mx = (el.offsetWidth * (s - 1)) / 2;
    const my = (el.offsetHeight * (s - 1)) / 2;
    return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  }, []);

  // 打开/换图:复位变换与加载态;缓存图可能在 onLoad 挂上之前已完成,用 complete 兜底
  useEffect(() => {
    commit(1, { x: 0, y: 0 });
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) {
      setNatural({ w: el.naturalWidth, h: el.naturalHeight });
      setLoaded(true);
    } else {
      setNatural(null);
      setLoaded(false);
    }
  }, [view?.src, commit]);

  // Esc 关闭:capture 捕获,查看器为顶层模态时优先于下层弹窗的 Escape 处理
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [view, onClose]);

  // 滚轮缩放(朝光标):React 的 wheel 为 passive,须原生监听才能 preventDefault
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // 图片 flex 居中 → 基准中心=视口中心;缩放后保持光标下的内容点不动:o' = c − k·(c − o)
      const cx = e.clientX - window.innerWidth / 2;
      const cy = e.clientY - window.innerHeight / 2;
      const prev = scaleRef.current;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * Math.exp(-e.deltaY * 0.0015)));
      const k = next / prev;
      const o = offsetRef.current;
      commit(next, clampOffset({ x: cx - k * (cx - o.x), y: cy - k * (cy - o.y) }, next));
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [view, commit, clampOffset]);

  // 双击:适应窗口 ↔ 原始像素(小图显示已达原始大小时不放大)
  const handleDoubleClick = useCallback(() => {
    if (scaleRef.current !== 1) { commit(1, { x: 0, y: 0 }, true); return; }
    const el = imgRef.current;
    if (!el || !natural || natural.w === 0) return;
    const target = natural.w / el.offsetWidth;
    if (target > 1.01) commit(Math.min(MAX_SCALE, target), { x: 0, y: 0 }, true);
  }, [natural, commit]);

  // 拖拽平移(仅放大后):pointer capture 保证移出图片仍跟手
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (scaleRef.current <= 1) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 捕获失败不阻断拖拽,光标在图内仍跟手 */ }
    dragRef.current = { px: e.clientX, py: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
    setDragging(true);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    commit(scaleRef.current, clampOffset({ x: d.ox + e.clientX - d.px, y: d.oy + e.clientY - d.py }, scaleRef.current));
  }, [commit, clampOffset]);
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  if (!view) return null;

  return (
    <div
      ref={rootRef}
      // no-drag:遮罩盖住顶部 TabBar 拖拽区(40px),否则关闭按钮上半段与遮罩顶部点击会被拖窗口拦截(参考 QuestionHistory 抽屉同款处理)
      className="no-drag fixed inset-0 z-top flex items-center justify-center bg-surface/70 backdrop-blur-[2px] modal-overlay"
      onMouseDown={(e) => { overlayDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && overlayDownRef.current) onClose(); }}
    >
      <img
        ref={imgRef}
        src={view.src}
        alt={view.name ?? "图片预览"}
        draggable={false}
        className={`max-w-[75vw] max-h-[75vh] object-contain rounded-[var(--radius-lg)] border border-border shadow-2xl select-none ${dragging ? "cursor-grabbing" : scale > 1 ? "cursor-grab" : "cursor-zoom-in"}`}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "center center",
          opacity: loaded ? 1 : 0,
          transition: smooth && !dragging ? SMOOTH_TRANSITION : INSTANT_TRANSITION,
        }}
        onLoad={(e) => {
          setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
          setLoaded(true);
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={handleDoubleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <button
        type="button"
       
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-surface-elevated/90 border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover shadow-lg transition-colors flex items-center justify-center"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4L4 12"/></svg>
      </button>
      {/* 底部信息条:文件名 · 原始尺寸 · 缩放提示/比例(纯展示,pointer-events 穿透点击即关闭) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-[80vw] flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-surface-elevated/90 border border-border shadow-lg text-xs text-text-secondary pointer-events-none">
        {view.name && <span className="truncate">{view.name}</span>}
        {natural && natural.w > 0 && (
          <span className="shrink-0 tabular-nums">
            {view.name ? "· " : ""}{natural.w}×{natural.h}{scale === 1 ? " · 滚轮缩放，双击 1:1" : ` · ${Math.round(scale * 100)}%`}
          </span>
        )}
      </div>
    </div>
  );
}

export const ImageViewer = memo(ImageViewer_);
