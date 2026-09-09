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
  /** 采样间距倍率:1=精细(约 2px/段) 2=降级(约 4px/段),由主线程繁忙度自适应 */
  segScale: number;
  /** 主 canvas 位图缩放(dpr,已封顶 2)。离屏 canvas 必须用同一值,否则 dpr>2 时内容被放大错位 */
  dpr: number;
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
    // dpr 封顶 2:光效是柔光/细线,高 dpr(2.5-3)多出的像素对观感提升微小、绘制成本成倍(面积按平方),封顶可显著减压
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
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

    // 主线程繁忙自适应:聊天流式输出时消息 DOM 更新挤占主线程,rAF 帧间隔被拉大。
    // 旧方案(隔帧跳绘)把"主线程卡顿"转嫁成"光效跳跃"——位置按真实时间算,采样率降低即运动不连续,
    // 2px 细光带高速跑动时跳帧比降精度更明显。改为保持每帧绘制、忙时放大采样间距(段数减半):
    // 运动仍平滑,单帧成本同样减半。
    //
    // 判据用"帧间隔相对基准的偏离"而非绝对毫秒:30Hz 屏/省电模式的正常帧间隔就是 33ms,
    // 按绝对值判会永久误判为繁忙且无法恢复。基准首帧取自实际帧间隔(自动适配 30/60/120Hz),
    // 且只在空闲帧向当前 dt 靠拢——繁忙帧不上浮,否则流式输出期间基准会被繁忙值污染、自适应失效。
    // 代价:跨屏拖到更低刷新率且基准已锁低时会保持降级(性能弱,降级无害)。
    let baseDt = 0;
    let segScale = 1;
    let busyFrames = 0;
    let idleFrames = 0;
    let lastNow = 0;
    let lastDpr = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = lastNow === 0 ? 0 : now - lastNow;
      lastNow = now;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      // dpr 变化(跨屏拖动/改系统缩放)不触发 ResizeObserver,这里补检——值变了才重分配位图
      const curDpr = Math.min(window.devicePixelRatio || 1, 2);
      if (curDpr !== lastDpr) {
        lastDpr = curDpr;
        resize();
      }
      if (dt > 0) {
        if (baseDt === 0) baseDt = dt;
        if (dt > baseDt * 1.6) { busyFrames++; idleFrames = 0; }
        else if (dt < baseDt * 1.25) {
          idleFrames++; busyFrames = 0;
          baseDt = baseDt * 0.99 + dt * 0.01;  // 空闲帧才校准基准
        } else { busyFrames = 0; idleFrames = 0; }
        // 滞回:连续 8 帧繁忙才降级、连续 30 帧空闲才恢复——临界负载下不反复切换(否则光效速度忽快忽慢)
        if (busyFrames >= 8 && segScale < 2) segScale = 2;
        else if (idleFrames >= 30 && segScale > 1) segScale = 1;
      }
      const fn = drawRef.current;
      if (fn) fn(ctx, now, { cssW, cssH, radius, segScale, dpr });
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
