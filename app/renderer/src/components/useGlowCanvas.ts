import { useEffect, useRef } from "react";
import { GLOW_OUTSET, drawGlow, type GlowPreset, type GlowSize } from "./glow-draw";
import { cancelDetach, glowWorker, nextGlowSessionId, scheduleDetach } from "./glow-client";

/**
 * 光效画布生命周期：默认把绘制交给 Worker（OffscreenCanvas），Worker 不可用时回退主线程 rAF。
 * 协议与决策见 docs/design/光效 Worker 化方案.md。
 *
 * 主线程职责仅剩「测量 + 转发」：Worker 读不到 DOM，尺寸/圆角/dpr 必须在这里量好再 postMessage。
 *
 * 已踩坑记录(勿回退):
 * 1. canvas 是替换元素,absolute+inset+width:auto 时布局用 intrinsic 尺寸——必须 CSS 显式
 *    width/height(见 .glow-canvas),否则 JS 设 canvas.width 会改布局尺寸 → RO 无限放大循环
 * 2. 绘制恒 ctx.filter=none(ctx.filter 逐 fill 软件滤镜实测拖垮帧率 41fps→60fps)
 * 3. canvas.transferControlToOffscreen() 一个 canvas 只能调一次——StrictMode 二次挂载
 *    必须走 resume 分支(靠 sessionRef 判断),不能重复转移
 */
export function useGlowCanvas(
  preset: GlowPreset, colors: string[]
): { canvasRef: React.RefObject<HTMLCanvasElement | null>; outset: number } {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** 已建立的光效会话；StrictMode 二次挂载时非空 → 走 resume 而非再次转移 canvas */
  const sessionRef = useRef<{ id: number } | null>(null);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    /** 测量 canvas 布局尺寸 + 父元素圆角 + dpr（Worker 侧读不到 DOM） */
    const measure = (): GlowSize => {
      let radius = 8;
      const parent = canvas.parentElement;
      if (parent) {
        const br = getComputedStyle(parent).borderRadius;
        const m = br.match(/^([\d.]+)px$/);
        if (m?.[1]) radius = parseFloat(m[1]);
      }
      return {
        cssW: canvas.clientWidth,
        cssH: canvas.clientHeight,
        radius,
        // dpr 封顶 2:光效是柔光/细线,高 dpr 多出的像素对观感提升微小、绘制成本成倍(面积按平方)
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      };
    };

    const w = glowWorker();

    // ── 回退路径：Worker 不可用 → 主线程 rAF 绘制（形态一致，但重新与主线程竞争）──
    if (!w) {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      let size = measure();
      const resize = () => {
        size = measure();
        const pw = Math.max(1, Math.round(size.cssW * size.dpr));
        const ph = Math.max(1, Math.round(size.cssH * size.dpr));
        if (canvas.width !== pw || canvas.height !== ph) {
          canvas.width = pw;
          canvas.height = ph;
          ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
        }
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);
      let raf = requestAnimationFrame(function loop(now: number) {
        raf = requestAnimationFrame(loop);
        if (size.cssW === 0 || size.cssH === 0) return;
        drawGlow(ctx, preset, now, size, colorsRef.current);
      });
      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
      };
    }

    // ── Worker 路径 ──
    const size = measure();
    let session = sessionRef.current;
    if (!session) {
      const id = nextGlowSessionId();
      session = { id };
      sessionRef.current = session;
      const off = canvas.transferControlToOffscreen();
      w.postMessage({ type: "attach", id, preset, canvas: off, colors: colorsRef.current, ...size }, [off]);
    } else {
      // StrictMode 二次挂载：canvas 已转移给 Worker，仅恢复绘制并同步参数
      cancelDetach(session.id);
      w.postMessage({ type: "resume", id: session.id, preset, colors: colorsRef.current, ...size });
    }
    const sessionId = session.id;

    const ro = new ResizeObserver(() => {
      w.postMessage({ type: "resize", id: sessionId, ...measure() });
    });
    ro.observe(canvas);

    // dpr 变化(跨屏拖动/改系统缩放)不触发 ResizeObserver——用 matchMedia 监听(每次变化需重新注册)
    let mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onDprChange = () => {
      mq.removeEventListener("change", onDprChange);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener("change", onDprChange);
      w.postMessage({ type: "resize", id: sessionId, ...measure() });
    };
    mq.addEventListener("change", onDprChange);

    return () => {
      ro.disconnect();
      mq.removeEventListener("change", onDprChange);
      w.postMessage({ type: "pause", id: sessionId });
      scheduleDetach(sessionId);
    };
  }, [preset]);

  // 配色变化单独同步（数组每次渲染都是新引用，用 join 做稳定 key 避免无谓 postMessage）
  const colorsKey = colors.join(",");
  useEffect(() => {
    const w = glowWorker();
    const id = sessionRef.current?.id;
    if (!w || id === undefined) return;
    w.postMessage({ type: "colors", id, colors: colorsRef.current });
  }, [colorsKey]);

  return { canvasRef, outset: GLOW_OUTSET[preset] };
}
