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
      // dpr 封顶 2:光效是柔光/细线,高 dpr(2.5-3)多出的像素对观感提升微小、绘制成本成倍(面积按平方),封顶可显著减压
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

    // 主线程繁忙自适应:聊天流式输出时消息 DOM 更新挤占主线程,rAF 帧间隔被拉大,
    // 光效仍每帧全量重绘会加剧竞争——按最近帧间隔动态隔帧绘制(把 CPU 让给渲染),空闲自动回满帧。
    let step = 1;
    let acc = 0;
    let lastNow = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = lastNow === 0 ? 0 : now - lastNow;
      lastNow = now;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      if (dt > 34) step = 3;            // 明显掉帧(<~30fps):每 3 帧画 1 帧,优先保证消息渲染流畅
      else if (dt > 24) step = 2;       // 略忙(<~40fps):隔帧绘制
      else if (dt > 0 && dt < 20 && step > 1) step = 1;  // 恢复满帧
      if (++acc % step !== 0) return;   // 跳帧:保留上帧画面(不清空),运动速度按比例略降
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
