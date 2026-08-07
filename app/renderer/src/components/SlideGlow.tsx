import { useEffect, useRef } from "react";
import { colorAt, halfEllipseProfile, pathAt, hexToRgb } from "./glow-paths";
import { useGlowCanvas } from "./useGlowCanvas";

/**
 * slide 顶部滑动 canvas 绘制:仅上边框弧段(顶边 + 左右圆角)——
 * 微光层(常亮低透明带) + 凸起层(半椭圆鼓包沿弧段往返移动)。
 * CSS 版圆角处直线条贴不上弧线(悬空/侵入),canvas 沿路径绘制解决。方案见 docs/design/状态指示光效方案.md。
 */
interface SlideGlowProps {
  /** 当前主题的颜色组合(1-5 色) */
  colors: string[];
}

/** 固定参数(用户定稿:除颜色外不可调):粗细 2px / 一个往返 4s(UI 速度档位 2=6-2) / 凸起宽 3 档=120° */
const THICKNESS = 2;
const SPEED = 4;
const TAIL_WIDTH = 120;

/** 凸起高度方向的透明度衰减:0-70% 实心,70-90% 渐隐,90%+ 消失(沿用 CSS 版定稿值) */
const CORE_SOLID = 0.7;
const CORE_FADE_END = 0.9;
/** 微光层透明度(对应 CSS 版 color-mix 28%) */
const GLOW_ALPHA = 0.28;

export function SlideGlow({ colors }: SlideGlowProps): JSX.Element {
  const { canvasRef, registerDraw } = useGlowCanvas();
  const propsRef = useRef({ colors });
  propsRef.current = { colors };

  useEffect(() => {
    const rgbCache = new Map<string, [number, number, number]>();
    const rgbOf = (hex: string): [number, number, number] => {
      let v = rgbCache.get(hex);
      if (!v) {
        v = hexToRgb(hex);
        rgbCache.set(hex, v);
      }
      return v;
    };

    registerDraw((ctx, now, { cssW, cssH, radius }) => {
      const { colors: cs } = propsRef.current;
      const t = THICKNESS;
      const sp = SPEED;
      const tw = TAIL_WIDTH;
      if (cs.length === 0) return;
      ctx.clearRect(0, 0, cssW, cssH);

      const w = cssW - 2 * t;
      const h = cssH - 2 * t;
      const r = Math.min(radius + t / 2, w / 2, h / 2);
      const topLen = w - 2 * r;
      const arc = (Math.PI / 2) * r;
      // 上边框弧段:左上弧终点(s7=2topLen+2sideLen+3arc)顺时针 → 顶边 → 右上弧终点
      const s7 = 2 * topLen + 2 * (h - 2 * r) + 3 * arc;
      const span = topLen + 2 * arc;
      const half = t / 2;
      const rgbList = cs.map(rgbOf);
      const c0 = rgbList[0]!;

      // ── 微光层:沿弧段常亮带,两端渐隐 ──
      const glowFadeLen = Math.min(20, span * 0.05); // 端部渐隐长度(px)
      const n1 = Math.max(4, Math.ceil(span / 2));
      for (let i = 0; i < n1; i++) {
        const pos = i / n1;
        const pos2 = (i + 1) / n1;
        const p0 = edgePt(s7 + span * pos, w, h, r, t, half);
        const p1 = edgePt(s7 + span * pos2, w, h, r, t, half);
        // 端部线性渐隐
        const dist = Math.min(pos * span, (1 - pos) * span);
        const dist2 = Math.min(pos2 * span, (1 - pos2) * span);
        const a = Math.min(GLOW_ALPHA * (dist / glowFadeLen), GLOW_ALPHA);
        const a2 = Math.min(GLOW_ALPHA * (dist2 / glowFadeLen), GLOW_ALPHA);
        if (a <= 0.004 && a2 <= 0.004) continue;
        ctx.fillStyle = `rgba(${c0[0]},${c0[1]},${c0[2]},${(a + a2) / 2})`;
        ctx.beginPath();
        ctx.moveTo(p0.tx, p0.ty);
        ctx.lineTo(p1.tx, p1.ty);
        ctx.lineTo(p1.bx, p1.by);
        ctx.lineTo(p0.bx, p0.by);
        ctx.closePath();
        ctx.fill();
      }

      // ── 凸起层:半椭圆鼓包沿顶边直段往返(sin 缓动),不进入圆角弧 ──
      // 移动范围限定在顶边(topLen)内:中心 ∈ [coreLen/2, topLen-coreLen/2],
      // 绝对弧长 = s7(弧段起点) + arc(左上弧) + 顶边内位置——凸起两端不拐进圆角
      const coreLen = ((tw / 240) * span) / 2; // 凸起沿弧段长度(默认 120 → 25% 弧段)
      const phase = (Math.sin((2 * Math.PI * now) / 1000 / sp) + 1) / 2; // 0→1→0 往返
      const sCenter = coreLen / 2 + phase * (topLen - coreLen); // 凸起中心在顶边内的位置
      const n2 = Math.max(4, Math.ceil(coreLen / 2));
      for (let i = 0; i < n2; i++) {
        const pos = i / n2; // 0=左端 1=右端
        const pos2 = (i + 1) / n2;
        const u = Math.abs(pos * 2 - 1); // 0=中心 1=端
        const u2 = Math.abs(pos2 * 2 - 1);
        const profile = halfEllipseProfile(1 - u); // 路径方向:中心全高、两端收尖
        const profile2 = halfEllipseProfile(1 - u2);
        const p0 = corePt(s7 + arc + sCenter + (pos - 0.5) * coreLen, w, h, r, t, half, profile);
        const p1 = corePt(s7 + arc + sCenter + (pos2 - 0.5) * coreLen, w, h, r, t, half, profile2);
        if (p0 === null || p1 === null) continue;
        const c = colorAt(rgbList, (pos + pos2) / 2);
        // 高度方向渐变:底部实 → 顶部 90% 消失(每段独立渐变,顶点沿法线)
        const g = ctx.createLinearGradient(p0.bx, p0.by, p0.tx, p0.ty);
        g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},1)`);
        g.addColorStop(CORE_SOLID, `rgba(${c[0]},${c[1]},${c[2]},1)`);
        g.addColorStop(CORE_FADE_END, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(p0.tx, p0.ty);
        ctx.lineTo(p1.tx, p1.ty);
        ctx.lineTo(p1.bx, p1.by);
        ctx.lineTo(p0.bx, p0.by);
        ctx.closePath();
        ctx.fill();
      }
    });
    return () => registerDraw(null);
  }, [registerDraw]);

  // style 注入 --glow-outset:canvas 外扩量 = 光带粗细(cssW = 卡片 + 2t,故绘制 w = cssW - 2t)
  return (
    <canvas
      ref={canvasRef}
      className="glow-canvas"
      style={{ "--glow-outset": `${THICKNESS}px` } as React.CSSProperties}
      aria-hidden="true"
    />
  );
}

interface EdgePt {
  tx: number; ty: number; // 顶边(外边缘,光带全高)
  bx: number; by: number; // 底边(内边缘,贴卡片边框)
}

/** 微光层截面:矩形(光带厚 t) */
function edgePt(s: number, w: number, h: number, r: number, t: number, half: number): EdgePt {
  const p = pathAt(s, w, h, r);
  return {
    tx: p.x + t + p.nx * half,
    ty: p.y + t + p.ny * half,
    bx: p.x + t - p.nx * half,
    by: p.y + t - p.ny * half,
  };
}

/** 凸起截面:底边贴卡片边框,顶边沿法线伸出 2×厚度 × 路径方向剖面(两端收尖) */
function corePt(
  s: number, w: number, h: number, r: number, t: number, half: number, profile: number
): EdgePt | null {
  const p = pathAt(s, w, h, r);
  const bx = p.x + t - p.nx * half;
  const by = p.y + t - p.ny * half;
  // 高度方向:伸出 2×厚度(对应 CSS height 200%),顶部弧线
  const tx = bx + p.nx * 2 * t * profile;
  const ty = by + p.ny * 2 * t * profile;
  return { tx, ty, bx, by };
}
