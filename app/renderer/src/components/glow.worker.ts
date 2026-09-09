/**
 * 光效 Worker 入口：接收主线程消息 + 自驱循环绘制。
 * 协议与决策见 docs/design/光效 Worker 化方案.md。
 *
 * 注意：Worker 里没有 requestAnimationFrame（Chromium 未实现），用 setTimeout 自驱 +
 * 绝对时间调度（每帧累加 16.67ms 后按实际时刻算下次延迟），避免累积漂移。
 */
import { drawGlow, type GlowPreset, type GlowSize } from "./glow-draw";

/** Worker 全局作用域的最小类型：不引入 webworker lib，避免与 DOM lib 的全局声明重复冲突 */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
}
const scope = self as unknown as WorkerScope;

type InMsg =
  | { type: "attach"; id: number; preset: GlowPreset; canvas: OffscreenCanvas; colors: string[]; cssW: number; cssH: number; radius: number; dpr: number }
  | { type: "resume"; id: number; preset: GlowPreset; colors: string[]; cssW: number; cssH: number; radius: number; dpr: number }
  | { type: "resize"; id: number; cssW: number; cssH: number; radius: number; dpr: number }
  | { type: "colors"; id: number; colors: string[] }
  | { type: "pause"; id: number }
  | { type: "detach"; id: number };

let sessionId = 0;
let preset: GlowPreset = "orbit";
let colors: string[] = [];
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let off: OffscreenCanvas | null = null;
let size: GlowSize = { cssW: 0, cssH: 0, radius: 8, dpr: 2 };
let timer: ReturnType<typeof setTimeout> | null = null;
let nextFrame = 0;

function startLoop(): void {
  if (timer !== null) return;
  nextFrame = 0;
  tick();
}

function stopLoop(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function tick(): void {
  const t0 = performance.now();
  if (ctx && size.cssW > 0 && size.cssH > 0) {
    drawGlow(ctx, preset, t0, size, colors);
  }
  if (nextFrame === 0) nextFrame = t0;
  nextFrame += 16.67;
  timer = setTimeout(tick, Math.max(0, nextFrame - performance.now()));
}

/** 尺寸/位图变化：重分配 OffscreenCanvas 位图（改 width/height 会重置 transform，必须重设） */
function applySize(s: GlowSize): void {
  size = s;
  if (!off || !ctx) return;
  const pw = Math.max(1, Math.round(s.cssW * s.dpr));
  const ph = Math.max(1, Math.round(s.cssH * s.dpr));
  if (off.width !== pw || off.height !== ph) {
    off.width = pw;
    off.height = ph;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  }
}

scope.onmessage = (e: MessageEvent) => {
  const m = e.data as InMsg;

  if (m.type === "attach") {
    // 首次挂载：canvas 控制权由主线程转移过来
    sessionId = m.id;
    preset = m.preset;
    colors = m.colors;
    off = m.canvas;
    ctx = off.getContext("2d");
    applySize({ cssW: m.cssW, cssH: m.cssH, radius: m.radius, dpr: m.dpr });
    if (ctx) ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
    startLoop();
    return;
  }

  // 其余消息只认当前会话——延迟 detach 期间旧 id 的消息不得影响新会话
  if (m.id !== sessionId) return;

  if (m.type === "resume") {
    // StrictMode 二次挂载：canvas 已转移，仅恢复绘制并同步参数
    preset = m.preset;
    colors = m.colors;
    applySize({ cssW: m.cssW, cssH: m.cssH, radius: m.radius, dpr: m.dpr });
    startLoop();
  } else if (m.type === "resize") {
    applySize({ cssW: m.cssW, cssH: m.cssH, radius: m.radius, dpr: m.dpr });
  } else if (m.type === "colors") {
    colors = m.colors;
  } else if (m.type === "pause") {
    stopLoop();
  } else if (m.type === "detach") {
    stopLoop();
    ctx = null;
    off = null;
    sessionId = 0;
  }
};
