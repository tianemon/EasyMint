import { useCallback, useEffect, useRef } from "react";

/**
 * 光效 canvas 生命周期 hook:rAF 循环 + ResizeObserver + devicePixelRatio 缩放 + 卡片圆角读取。
 * 三个预设组件(OrbitGlow/SlideGlow/BreatheGlow)共用;组件只需注册自己的 draw 函数。
 * 已踩坑记录(勿回退):
 * 1. canvas 是替换元素,absolute+inset+width:auto 时布局用 intrinsic 尺寸——必须 CSS 显式
 *    width/height(见 .glow-canvas),否则 JS 设 canvas.width 会改布局尺寸 → RO 无限放大循环
 * 2. 绘制恒 ctx.filter=none(ctx.filter 逐 fill 软件滤镜实测拖垮帧率 41fps→60fps)
 */

export interface GlowSize {
  /** canvas 布局尺寸(卡片 + 2×粗细外扩) */
  cssW: number;
  cssH: number;
  /** 卡片圆角 px(父元素 computed style) */
  radius: number;
}

export type GlowDrawFn = (ctx: CanvasRenderingContext2D, now: number, size: GlowSize) => void;

export function useGlowCanvas(): {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  registerDraw: (fn: GlowDrawFn | null) => void;
} {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef<GlowDrawFn | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let radius = 10;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const pw = Math.round(canvas.clientWidth * dpr);
      const ph = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const parent = canvas.parentElement;
      if (parent) {
        const br = getComputedStyle(parent).borderRadius;
        const m = br.match(/^([\d.]+)px$/);
        if (m?.[1]) radius = parseFloat(m[1]);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      const fn = drawRef.current;
      if (fn) fn(ctx, now, { cssW, cssH, radius });
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const registerDraw = useCallback((fn: GlowDrawFn | null) => {
    drawRef.current = fn;
  }, []);

  return { canvasRef, registerDraw };
}
