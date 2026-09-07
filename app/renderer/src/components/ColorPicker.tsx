import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";

/* ────────────────────────── 颜色换算工具(私有) ────────────────────────── */

/** #rgb / #rrggbb → 小写 #rrggbb;非法输入返回 null */
function normalizeHex(raw: string): string | null {
  let hex = raw.trim();
  if (hex.startsWith("#")) hex = hex.slice(1);
  if (!/^[0-9a-fA-F]{3}$/.test(hex) && !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  return `#${hex.toLowerCase()}`;
}

interface Hsv {
  h: number; // 0-360
  s: number; // 0-1
  v: number; // 0-1
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max / 255 };
}

function hsvToHex(h: number, s: number, v: number): string {
  // 归一化 hue 到 [0,360),避免负值/越界导致分区错乱
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) { r = c; g = x; }
  else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; }
  else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toByte = (n: number): string => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

function hexToHsv(hex: string): Hsv {
  const n = normalizeHex(hex);
  if (!n) return { h: 0, s: 0, v: 0 };
  const num = parseInt(n.slice(1), 16);
  return rgbToHsv((num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff);
}

/** 常用色板:中性阶 + 常用彩色 */
const COMMON_COLORS = [
  "#ffffff", "#e5e5e5", "#d4d4d4", "#a3a3a3", "#737373", "#404040", "#171717",
  "#ef4444", "#dc2626", "#b91c1c", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#16a34a", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6",
  "#2563eb", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e",
];

/** 锚点矩形:取色面板相对触发控件定位 */
export interface ColorPickerAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ColorPickerPanelProps {
  /** 当前颜色(#rrggbb) */
  value: string;
  /** 选色即时回调 */
  onChange: (hex: string) => void;
  /** 关闭面板(点外部/Esc) */
  onClose: () => void;
  /** 锚点矩形(触发器视口坐标) */
  anchorRect: ColorPickerAnchor;
  /**
   * 免关区域(视为面板内部):点触发器本身切换开关/点同组其他色块改锚点不应先触发关闭。
   * 外部 mousedown 关闭时必须把它算内部——否则点面板内部/触发区域会先卸载面板丢 onChange(Select 踩过的坑)。
   */
  anchorEl?: HTMLElement | null;
}

/**
 * 自绘取色面板:HSV 拖选(SV 平面 + 色相条)+ 常用色板 + hex 输入。
 * createPortal 到 body 以 fixed 定位;渲染后测量,右/下超出视口则贴边或向上翻转(根治原生 color input 弹层溢出)。
 */
export function ColorPickerPanel({ value, onChange, onClose, anchorRect, anchorEl }: ColorPickerPanelProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<"sv" | "hue" | null>(null);
  const hsv = hexToHsv(value);
  // 面板内容尺寸确定,初始定位即用;渲染后测量修正越界(见下方 layout effect)
  const [pos, setPos] = useState<{ left: number; top: number }>(() => ({
    left: anchorRect.left,
    top: anchorRect.top + anchorRect.height + 4,
  }));
  const [hexText, setHexText] = useState(value);

  // 面板渲染后测量实际尺寸修正 fixed 坐标:
  // ① 右缘超出视口 → 左移贴边(与触发器左缘脱开最少)
  // ② 底部空间不足 → 向上翻转(取色控件在设置面板/窗口底部,向下会被截断)
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = anchorRect.left;
    let top = anchorRect.top + anchorRect.height + 4;
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
    if (top + h > window.innerHeight) top = Math.max(4, anchorRect.top - h - 4);
    setPos({ left, top });
  }, [anchorRect]);

  // 点面板外部 / Esc / 窗口失焦 / 外层滚动关闭。anchorEl 与面板同视为内部。
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorEl?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // 阻止传给宿主窗口级 Esc(如设置弹窗整体关闭)——嵌套弹层应只关自己,再按一次才关外层
      e.stopPropagation();
      onClose();
    };
    const onWindowBlur = (): void => onClose();
    // fixed 面板不随锚点所在滚动容器移动——外层一滚动就关,避免面板悬空脱离触发器
    const onScroll = (e: Event): void => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [onClose, anchorEl]);

  // 外部改色(拖选 SV/色相/点色板)后回填 hex 输入框;输入中 value 未变不会触发
  useEffect(() => {
    setHexText(value);
  }, [value]);

  /** SV 平面拖选:s 横向(左白→右纯色),v 纵向(上明→下黑) */
  const pickSv = (clientX: number, clientY: number): void => {
    const el = svRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    onChange(hsvToHex(hsv.h, x, 1 - y));
  };
  /** 色相条拖选:0-360 横向 */
  const pickHue = (clientX: number): void => {
    const el = hueRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onChange(hsvToHex(x * 360, hsv.s, hsv.v));
  };

  const startDrag = (kind: "sv" | "hue", e: RPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = kind;
    if (kind === "sv") pickSv(e.clientX, e.clientY);
    else pickHue(e.clientX);
  };
  const moveDrag = (e: RPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current === "sv") pickSv(e.clientX, e.clientY);
    else if (dragRef.current === "hue") pickHue(e.clientX);
  };
  const endDrag = (): void => { dragRef.current = null; };

  // hex 输入:Enter 应用并关闭;失焦应用(非法则回显当前值);Esc 走面板级关闭
  const commitHex = (close: boolean): void => {
    const n = normalizeHex(hexText);
    if (n) {
      setHexText(n);
      if (n !== value) onChange(n);
      if (close) onClose();
    } else {
      setHexText(value);
    }
  };

  const svLeftPct = hsv.s * 100;
  const svTopPct = (1 - hsv.v) * 100;
  const hueLeftPct = (hsv.h / 360) * 100;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      className="fixed z-[300] w-[220px] rounded-lg border border-border bg-surface-elevated shadow-xl overflow-hidden p-3 flex flex-col gap-2.5"
      style={{ left: pos.left, top: pos.top }}
    >
      {/* SV 平面:纯色底 + 左白渐变(横向 s)+ 上透下黑渐变(纵向 v) */}
      <div
        ref={svRef}
        className="relative h-24 rounded-md cursor-crosshair touch-none select-none overflow-hidden"
        style={{
          background: `hsl(${hsv.h} 100% 50%)`,
          // 多层渐变:首层(黑)在最上、次层(白)在下——否则左缘 s=0 整列会被白盖住,失去纵向明度
          backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0), #000), linear-gradient(to right, #fff, rgba(255,255,255,0))",
        }}
        onPointerDown={(e) => startDrag("sv", e)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="pointer-events-none absolute w-3.5 h-3.5 rounded-full border border-white -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${svLeftPct}%`, top: `${svTopPct}%`, boxShadow: "0 0 0 1px rgba(0,0,0,0.5)" }}
        />
      </div>
      {/* 色相条:0→360 彩虹渐变 */}
      <div
        ref={hueRef}
        className="relative h-3 rounded-full cursor-crosshair touch-none select-none"
        style={{
          background:
            "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
        }}
        onPointerDown={(e) => startDrag("hue", e)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="pointer-events-none absolute top-1/2 w-3.5 h-3.5 rounded-full border-2 border-white -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${hueLeftPct}%`, boxShadow: "0 0 0 1px rgba(0,0,0,0.5)" }}
        />
      </div>
      {/* 常用色板网格 */}
      <div className="grid grid-cols-7 gap-1.5">
        {COMMON_COLORS.map((c) => {
          const selected = c === value;
          return (
            <button
              key={c}
              type="button"
              onClick={() => { onChange(c); onClose(); }}
              className="w-full aspect-square rounded cursor-pointer transition-transform hover:scale-110"
              style={{
                background: c,
                boxShadow: selected
                  ? `inset 0 0 0 1px var(--color-surface-elevated), 0 0 0 1.5px var(--color-accent)`
                  : "inset 0 0 0 1px var(--color-border)",
              }}
            />
          );
        })}
      </div>
      {/* hex 输入行 + 当前色预览 */}
      <div className="flex items-center gap-2">
        <input
          value={hexText}
          onChange={(e) => setHexText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commitHex(true); }}
          onBlur={() => commitHex(false)}
          spellCheck={false}
          className="em-input h-7 flex-1 min-w-0 px-2 text-xs font-mono text-text-primary"
        />
        <div
          className="w-7 h-7 shrink-0 rounded border border-border"
          style={{ background: value }}
        />
      </div>
    </div>,
    document.body
  );
}

interface ColorPickerFieldProps {
  value: string;
  onChange: (hex: string) => void;
}

/**
 * 便捷触发器:色块按钮 + 点击弹出取色面板(锚定按钮下方),再点按钮/外部/Esc 关闭。
 * 替代原生 <input type="color">(弹层位置浏览器控制,靠窗口底部会被截断)。
 */
export function ColorPickerField({ value, onChange }: ColorPickerFieldProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<ColorPickerAnchor | null>(null);

  const toggle = (): void => {
    setOpen((o) => {
      if (!o && triggerRef.current) {
        const r = triggerRef.current.getBoundingClientRect();
        setAnchor({ left: r.left, top: r.top, width: r.width, height: r.height });
      }
      return !o;
    });
  };

  return (
    <>
      {/* 不加 label 包裹:label 关联触发会让点击文字/空白区域也打开取色器(触发区域大于视觉按钮) */}
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label="选择颜色"
        aria-expanded={open}
        className="w-7 h-7 shrink-0 rounded cursor-pointer border border-border transition-transform hover:scale-105"
        style={{ background: value }}
      />
      {open && anchor && (
        <ColorPickerPanel
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
          anchorRect={anchor}
          anchorEl={triggerRef.current}
        />
      )}
    </>
  );
}
