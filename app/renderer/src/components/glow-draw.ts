/**
 * 光效绘制函数：主线程与 Worker 共用同一份实现（Worker 路径 + 主线程回退路径）。
 *
 * 两种绘制策略（勿「顺便统一」）：
 * - orbit / slide：沿圆角矩形周长密集采样（每 ~2px 一段小四边形），圆弧靠采样逼近。
 *   必须密集采样——它们需要沿路径的逐点颜色/透明度/剖面变化，整段填充做不到。
 * - breathe：整段填充（4 直边用四边形 + 4 圆角用 ctx.arc 真扇形）。
 *   弧段只有 8 段，四边形近似整段 90° 弧的弦高差 ≈ r×(1−cos45°) ≈ 3px（r≈9）会画成直线切角，
 *   必须用真圆弧；若改成密集采样，成本从 7 层×8 段=56 次 fill 涨到 7×~700=4900 次。
 */
import {
  colorAt, colorAtLoop, halfEllipseProfile, pathAt, pathPerimeter, hexToRgb,
} from "./glow-paths";

export type GlowPreset = "orbit" | "slide" | "breathe";

/** canvas 相对卡片的外扩量(px):光带粗细 + 光晕发散预留 */
export const GLOW_OUTSET: Record<GlowPreset, number> = { orbit: 2, slide: 2, breathe: 18 };

export interface GlowSize {
  /** canvas CSS 尺寸(卡片 + 2×outset) */
  cssW: number;
  cssH: number;
  /** 卡片圆角(父元素 computed style) */
  radius: number;
  /** 位图缩放(dpr,已封顶 2) */
  dpr: number;
}

/** 主线程 2D 上下文与 OffscreenCanvas 2D 上下文 API 兼容,联合类型让两侧共用同一份绘制代码 */
export type GlowCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** hex→rgb 缓存:颜色种类有限,避免每帧重复解析 */
const rgbCache = new Map<string, [number, number, number]>();
function rgbOf(hex: string): [number, number, number] {
  let v = rgbCache.get(hex);
  if (!v) {
    v = hexToRgb(hex);
    rgbCache.set(hex, v);
  }
  return v;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function drawGlow(
  ctx: GlowCtx, preset: GlowPreset, now: number, size: GlowSize, colors: string[]
): void {
  if (colors.length === 0) return;
  if (preset === "orbit") drawOrbit(ctx, now, size, colors);
  else if (preset === "slide") drawSlide(ctx, now, size, colors);
  else drawBreathe(ctx, now, size, colors);
}

// ══════════════════════════════════════════════════════════════
// orbit:环绕流光——沿卡片圆角矩形路径画光带,尾巴(渐入/渐出段)半椭圆收尖
// (底部直线贴边框、顶部弧线收尖到 0)
// ══════════════════════════════════════════════════════════════

/** 固定参数(用户定稿:除颜色外不可调):粗细 2px / 一圈 4s / 彗尾 160° / 渐入渐出 20° */
const ORBIT_THICKNESS = 2;
const ORBIT_SPEED = 4;
const ORBIT_TAIL_DEG = 160;
const ORBIT_FADE_DEG = 20;

function drawOrbit(ctx: GlowCtx, now: number, size: GlowSize, colors: string[]): void {
  const { cssW, cssH, radius } = size;
  const t = ORBIT_THICKNESS;
  ctx.clearRect(0, 0, cssW, cssH);

  // 基线 = 卡片圆角矩形外扩 t/2 的等距线;光带内边缘贴卡片边缘,外边缘 = 卡片外 t
  const w = cssW - 2 * t;
  const h = cssH - 2 * t;
  const r = Math.min(radius + t / 2, w / 2, h / 2);
  const P = pathPerimeter(w, h, r);

  const centerS = (now / 1000 / ORBIT_SPEED) * P; // 光带中心沿周长推进(SPEED 秒/圈)
  const tailLen = (ORBIT_TAIL_DEG / 360) * P; // 彗尾弧长(角度 → 周长比例)
  const fadeLen = Math.min((ORBIT_FADE_DEG / 360) * P, tailLen / 2); // 渐入/渐出段弧长
  const sTail = centerS - tailLen / 2;

  const rgbList = colors.map(rgbOf);
  const n = Math.max(8, Math.ceil(tailLen / 2)); // 每 ~2px 一个采样点
  // 段间外扩覆盖(消除颗粒感):相邻半透明段之间 AA 各留一半会露底成细缝(色带呈粒状/断续),
  // 每段首尾沿路径外扩 ~0.75px 相互交叠(端点段夹到 [0,1] 保留渐隐)
  const ov = 0.75 / tailLen;

  for (let i = 0; i < n; i++) {
    const p0 = orbitSegPt(clamp01(i / n - ov), sTail, tailLen, fadeLen, w, h, r, t, rgbList);
    const p1 = orbitSegPt(clamp01((i + 1) / n + ov), sTail, tailLen, fadeLen, w, h, r, t, rgbList);
    if (p0.alpha <= 0.004 && p1.alpha <= 0.004) continue;
    ctx.fillStyle = `rgba(${(p0.c[0] + p1.c[0]) / 2 | 0},${(p0.c[1] + p1.c[1]) / 2 | 0},${(p0.c[2] + p1.c[2]) / 2 | 0},${(p0.alpha + p1.alpha) / 2})`;
    ctx.beginPath();
    ctx.moveTo(p0.tx, p0.ty);
    ctx.lineTo(p1.tx, p1.ty);
    ctx.lineTo(p1.bx, p1.by);
    ctx.lineTo(p0.bx, p0.by);
    ctx.closePath();
    ctx.fill();
  }
}

interface OrbitSegPt {
  tx: number; ty: number; // 顶边(外边缘,含半椭圆剖面)
  bx: number; by: number; // 底边(内边缘,贴卡片边框)
  c: [number, number, number];
  alpha: number;
}

/** 单个采样点:路径点 + 法线 + 半椭圆高度剖面 + 颜色/透明度(pos 0=尾尖 1=头顶) */
function orbitSegPt(
  pos: number, sTail: number, tailLen: number, fadeLen: number,
  w: number, h: number, r: number, t: number,
  rgbList: Array<[number, number, number]>
): OrbitSegPt {
  const s = sTail + tailLen * pos;
  const p = pathAt(s, w, h, r);
  const spLen = pos * tailLen;
  // 高度剖面:渐入/渐出段半椭圆(底部直线贴边框,顶部弧线收尖到 0),主体全高
  let profile = 1;
  if (spLen < fadeLen) profile = halfEllipseProfile(spLen / fadeLen);
  else if (spLen > tailLen - fadeLen) profile = halfEllipseProfile((tailLen - spLen) / fadeLen);
  // 透明度:端点段线性渐显/渐隐(与剖面同区段)
  let alpha = 1;
  if (spLen < fadeLen) alpha = spLen / fadeLen;
  else if (spLen > tailLen - fadeLen) alpha = (tailLen - spLen) / fadeLen;
  const c = colorAt(rgbList, pos);
  const half = t / 2;
  // pathAt 坐标相对卡片左上角(0,0),canvas 中卡片左上角在 (t,t) —— 必须平移,否则光带整体偏外 t
  return {
    tx: p.x + t + p.nx * half * profile,
    ty: p.y + t + p.ny * half * profile,
    bx: p.x + t - p.nx * half,
    by: p.y + t - p.ny * half,
    c,
    alpha,
  };
}

// ══════════════════════════════════════════════════════════════
// slide:顶部滑动——仅上边框弧段(顶边 + 左右圆角)
// 微光层(常亮低透明带) + 凸起层(半椭圆鼓包沿弧段往返移动)
// ══════════════════════════════════════════════════════════════

/** 固定参数(用户定稿:除颜色外不可调):粗细 2px / 一个往返 4s / 凸起宽 3 档=120° */
const SLIDE_THICKNESS = 2;
const SLIDE_SPEED = 4;
const SLIDE_TAIL_DEG = 120;
/** 色带沿弧段流完一圈的秒数(颜色循环流动周期) */
const SLIDE_FLOW_PERIOD = 6;
/** 凸起高度方向的透明度衰减:0-70% 实心,70-90% 渐隐,90%+ 消失(沿用 CSS 版定稿值) */
const SLIDE_CORE_SOLID = 0.7;
const SLIDE_CORE_FADE_END = 0.9;
/** 微光层透明度(对应 CSS 版 color-mix 28%) */
const SLIDE_GLOW_ALPHA = 0.28;

function drawSlide(ctx: GlowCtx, now: number, size: GlowSize, colors: string[]): void {
  const { cssW, cssH, radius } = size;
  const t = SLIDE_THICKNESS;
  const sp = SLIDE_SPEED;
  const tw = SLIDE_TAIL_DEG;
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
  const rgbList = colors.map(rgbOf);
  // 色带流动相位:单向循环递增(0→1→0 无缝),颜色沿弧段持续朝一个方向流动
  const flow = ((now / 1000) / SLIDE_FLOW_PERIOD) % 1;

  // ── 微光层:沿弧段渐变色带(颜色随位置分布 + 流动相位平移,形成循环流动),两端渐隐 ──
  // 段间外扩覆盖(消除半透明 AA 接缝颗粒):每段首尾沿路径外扩 ~0.75px,端点夹 [0,1] 保渐隐
  const ov = 0.75 / span;
  const glowFadeLen = Math.min(20, span * 0.05); // 端部渐隐长度(px)
  const n1 = Math.max(4, Math.ceil(span / 2));
  for (let i = 0; i < n1; i++) {
    const pos = clamp01(i / n1 - ov);
    const pos2 = clamp01((i + 1) / n1 + ov);
    const p0 = slideEdgePt(s7 + span * pos, w, h, r, t, half);
    const p1 = slideEdgePt(s7 + span * pos2, w, h, r, t, half);
    // 端部线性渐隐
    const dist = Math.min(pos * span, (1 - pos) * span);
    const dist2 = Math.min(pos2 * span, (1 - pos2) * span);
    const a = Math.min(SLIDE_GLOW_ALPHA * (dist / glowFadeLen), SLIDE_GLOW_ALPHA);
    const a2 = Math.min(SLIDE_GLOW_ALPHA * (dist2 / glowFadeLen), SLIDE_GLOW_ALPHA);
    if (a <= 0.004 && a2 <= 0.004) continue;
    // 颜色:沿弧段循环分布 + 流动相位——色带随时间朝一个方向平移(首尾无缝接续)
    const c = colorAtLoop(rgbList, pos + flow);
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(a + a2) / 2})`;
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
  const ov2 = 0.75 / coreLen; // 凸起段外扩(同消除接缝)
  for (let i = 0; i < n2; i++) {
    const pos = clamp01(i / n2 - ov2); // 0=左端 1=右端(端点夹取保收尖)
    const pos2 = clamp01((i + 1) / n2 + ov2);
    const u = Math.abs(pos * 2 - 1); // 0=中心 1=端
    const u2 = Math.abs(pos2 * 2 - 1);
    const profile = halfEllipseProfile(1 - u); // 路径方向:中心全高、两端收尖
    const profile2 = halfEllipseProfile(1 - u2);
    const p0 = slideCorePt(s7 + arc + sCenter + (pos - 0.5) * coreLen, w, h, r, t, half, profile);
    const p1 = slideCorePt(s7 + arc + sCenter + (pos2 - 0.5) * coreLen, w, h, r, t, half, profile2);
    if (p0 === null || p1 === null) continue;
    // 凸起颜色:取该段在弧段上的空间位置 + 流动相位——凸起随色带流动变色,而非自身固定渐变
    const sAbs = arc + sCenter + (pos - 0.5) * coreLen; // 距弧段起点的弧长(顶边直段内)
    const c = colorAtLoop(rgbList, sAbs / span + flow);
    // 高度方向渐变:底部实 → 顶部 90% 消失(每段独立渐变,顶点沿法线)
    const g = ctx.createLinearGradient(p0.bx, p0.by, p0.tx, p0.ty);
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},1)`);
    g.addColorStop(SLIDE_CORE_SOLID, `rgba(${c[0]},${c[1]},${c[2]},1)`);
    g.addColorStop(SLIDE_CORE_FADE_END, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(p0.tx, p0.ty);
    ctx.lineTo(p1.tx, p1.ty);
    ctx.lineTo(p1.bx, p1.by);
    ctx.lineTo(p0.bx, p0.by);
    ctx.closePath();
    ctx.fill();
  }
}

interface SlideEdgePt {
  tx: number; ty: number; // 顶边(外边缘,光带全高)
  bx: number; by: number; // 底边(内边缘,贴卡片边框)
}

/** 微光层截面:矩形(光带厚 t) */
function slideEdgePt(s: number, w: number, h: number, r: number, t: number, half: number): SlideEdgePt {
  const p = pathAt(s, w, h, r);
  return {
    tx: p.x + t + p.nx * half,
    ty: p.y + t + p.ny * half,
    bx: p.x + t - p.nx * half,
    by: p.y + t - p.ny * half,
  };
}

/** 凸起截面:底边贴卡片边框,顶边沿法线伸出 2×厚度 × 路径方向剖面(两端收尖) */
function slideCorePt(
  s: number, w: number, h: number, r: number, t: number, half: number, profile: number
): SlideEdgePt | null {
  const p = pathAt(s, w, h, r);
  const bx = p.x + t - p.nx * half;
  const by = p.y + t - p.ny * half;
  // 高度方向:伸出 2×厚度(对应 CSS height 200%),顶部弧线
  const tx = bx + p.nx * 2 * t * profile;
  const ty = by + p.ny * 2 * t * profile;
  return { tx, ty, bx, by };
}

// ══════════════════════════════════════════════════════════════
// breathe:呼吸灯——整圈光带 + 沿路径每个采样点向外发散柔光(由实向虚)
// 替代 CSS box-shadow(整圈均匀扩散,无"光带向外"感)
// ══════════════════════════════════════════════════════════════

/** 固定参数(用户定稿:除颜色外不可调):呼吸周期 3s;粗细仅参与内部几何(不显示光带) */
const BREATHE_SPEED = 3;
const BREATHE_THICKNESS = 2;
/** 光晕发散预留:bloomR 最大 6px + 光带外扩 + 圆角斜向余量(四角 45° 方向光晕最外 ≈ (10+6)×√2 ≈ 23px,
    canvas 矩形外扩 E 斜向 = E×√2,需 ≥23 → E≥16)。防光晕被 canvas 矩形边界裁剪成直角 */
const BREATHE_BLOOM_OUTSET = 16;
/** 段几何外扩(px):光晕层在离屏 canvas 以不透明绘制,段间外扩覆盖 AA 边缘(不透明下重叠无亮痕),
    再整幅降 alpha 叠加——分段半透明的 AA 接缝被彻底消除,与屏幕 dpr 无关 */
const BREATHE_OVERLAP = 1;
/** 层数直接决定成本(每层 = 8 段 fill + 全幅 clearRect + 全幅 drawImage);
    10→7:alpha 与半径分布均按层数归一化,层数减少只是离散采样变粗,观感差异极小 */
const BREATHE_LAYERS = 7;

/** 离屏 canvas:每层先不透明绘制,再整幅降 alpha 叠加。模块级复用——
    同一时刻只有一个 breathe 实例在跑(Worker 单例 / 回退路径单实例) */
let bloomCanvas: OffscreenCanvas | null = null;

function drawBreathe(ctx: GlowCtx, now: number, size: GlowSize, colors: string[]): void {
  const { cssW, cssH, radius, dpr } = size;
  ctx.clearRect(0, 0, cssW, cssH);

  const outset = BREATHE_THICKNESS + BREATHE_BLOOM_OUTSET; // canvas 外扩量 = 光带 + 光晕预留
  const w = cssW - 2 * outset;
  const h = cssH - 2 * outset;
  const r = Math.min(radius + BREATHE_THICKNESS / 2, w / 2, h / 2);
  const P = pathPerimeter(w, h, r);
  const phase = (Math.sin((2 * Math.PI * now) / 1000 / BREATHE_SPEED) + 1) / 2; // 0→1→0 呼吸
  // 光晕(由实向虚):发散半径 1→6px(呼吸幅度 5px),光斑强度随呼吸
  const bloomR = 1 + 5 * phase;
  // 0.675 = 原版 0.8 与柔化 0.55 的中间值:内圈叠加 alpha ≈ 0.9(0.8≈0.97 太实,0.55≈0.85 略淡)
  const bloomAlpha = 0.675 * (0.3 + 0.7 * phase);
  const half = BREATHE_THICKNESS / 2;
  const rgbList = colors.map(rgbOf);
  const flow = (now / 1000 / BREATHE_SPEED) % 1; // 颜色带沿路径流转偏移(一圈 = 呼吸周期,多色流动)

  // 8 个整段(4 直边 + 4 圆角弧段):直边用四边形(pathAt 两点),弧段用真扇形(ctx.arc 内外弧)
  // ——四边形近似弧段弦高差 ~3px 会画成直线切角
  const topLen = w - 2 * r;
  const sideLen = h - 2 * r;
  const arc = (Math.PI / 2) * r;
  const s1 = topLen;
  const s2 = s1 + arc;
  const s3 = s2 + sideLen;
  const s4 = s3 + arc;
  const s5 = s4 + topLen;
  const s6 = s5 + arc;
  const s7 = s6 + sideLen;
  const PI = Math.PI;
  // 直边段(按路径顺序):start/end 弧长;弧段:圆心(相对卡片)+ 起止角
  const lines = [
    { start: 0, end: s1 },                  // 顶边
    { start: s2, end: s3 },                 // 右边
    { start: s4, end: s5 },                 // 底边
    { start: s6, end: s7 },                 // 左边
  ];
  const arcs = [
    { cx: w - r, cy: r, a0: -PI / 2, a1: 0, cStart: s1, cEnd: s2 },      // 右上
    { cx: w - r, cy: h - r, a0: 0, a1: PI / 2, cStart: s3, cEnd: s4 },   // 右下
    { cx: r, cy: h - r, a0: PI / 2, a1: PI, cStart: s5, cEnd: s6 },      // 左下
    { cx: r, cy: r, a0: PI, a1: 3 * PI / 2, cStart: s7, cEnd: P },       // 左上
  ];
  // 按路径顺序绘制(顶边→右上弧→右边→…)
  const order: Array<"line" | "arc"> = ["line", "arc", "line", "arc", "line", "arc", "line", "arc"];

  // ── 光晕:多层离散衰减(由实向虚) ──
  // 每层流程:① 离屏 canvas 以不透明绘制该层(段间外扩 BREATHE_OVERLAP 覆盖 AA 边缘——不透明下重叠无亮痕)
  //          ② ctx.globalAlpha 整幅降透明后 drawImage 叠加——alpha 是整幅统一操作,不可能产生接缝
  // 对比旧方案(逐段半透明 fill + 段收窄/补丁):AA 边缘在半透明下叠加必然产生亮痕/暗线,只能最小化
  //   无法消除;离屏合成把"分段"与"半透明"解耦——任何 dpr/缩放下零接缝
  const off = bloomCanvas ?? (bloomCanvas = new OffscreenCanvas(1, 1));
  if (off.width !== ctx.canvas.width || off.height !== ctx.canvas.height) {
    off.width = ctx.canvas.width;
    off.height = ctx.canvas.height;
  }
  const octx = off.getContext("2d");
  if (!octx) return;
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 主 ctx 切到物理像素坐标系:drawImage 的 off 尺寸是物理像素,若在 dpr transform 下调用会被
  // 当作 CSS 单位再乘 dpr → 放大 dpr 倍(内容以左上角为锚膨胀,视觉整体偏向右下)——切 identity 后 1:1
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let L = 0; L < BREATHE_LAYERS; L++) {
    // 层中点 alpha 平方衰减(内→外递减):外层更快趋近 0,视觉厚度更薄、边缘更虚
    const a = bloomAlpha * (1 - (L + 0.5) / BREATHE_LAYERS) ** 2;
    // 层半径 1.5 次方分布(外层更密,原版线性与平方的中间值):边缘渐变更缓更虚
    const r2 = bloomR * ((L + 1) / BREATHE_LAYERS) ** 1.5;
    octx.clearRect(0, 0, cssW, cssH);
    let li = 0;
    let ai = 0;
    for (const kind of order) {
      if (kind === "line") {
        const seg = lines[li++]!;
        // 几何外扩 BREATHE_OVERLAP(覆盖相邻段 AA 边缘);渐变范围随端点(重叠区会被后画段覆盖,内容无碍)
        const p0 = pathAt(seg.start - BREATHE_OVERLAP, w, h, r);
        const p1 = pathAt(seg.end + BREATHE_OVERLAP, w, h, r);
        const c0 = colorAtLoop(rgbList, seg.start / P + flow);
        const c1 = colorAtLoop(rgbList, seg.end / P + flow);
        // 内边固定卡片边缘(路径 - 法线×half):层画实心环 [卡片边缘, r2]
        // ——旧版窄环带 [r1,r2] 宽 0.1~0.6px 小于 AA 边缘,弧段曲率损失大→圆角明显比直线淡
        const i0x = p0.x + outset + p0.nx * -half;
        const i0y = p0.y + outset + p0.ny * -half;
        const i1x = p1.x + outset + p1.nx * -half;
        const i1y = p1.y + outset + p1.ny * -half;
        const o0x = p0.x + outset + p0.nx * (r2 - half);
        const o0y = p0.y + outset + p0.ny * (r2 - half);
        const o1x = p1.x + outset + p1.nx * (r2 - half);
        const o1y = p1.y + outset + p1.ny * (r2 - half);
        // 渐变沿路径方向(颜色 c0→c1),alpha=1(离屏不透明,后续整幅降透明)
        const g = octx.createLinearGradient(p0.x + outset, p0.y + outset, p1.x + outset, p1.y + outset);
        g.addColorStop(0, `rgb(${c0[0]},${c0[1]},${c0[2]})`);
        g.addColorStop(1, `rgb(${c1[0]},${c1[1]},${c1[2]})`);
        octx.fillStyle = g;
        octx.beginPath();
        octx.moveTo(o0x, o0y);
        octx.lineTo(o1x, o1y);
        octx.lineTo(i1x, i1y);
        octx.lineTo(i0x, i0y);
        octx.closePath();
        octx.fill();
      } else {
        const seg = arcs[ai++]!;
        const c0 = colorAtLoop(rgbList, seg.cStart / P + flow);
        const c1 = colorAtLoop(rgbList, seg.cEnd / P + flow);
        const cx = seg.cx + outset; // 圆心(canvas 坐标)
        const cy = seg.cy + outset;
        // 角度外扩 BREATHE_OVERLAP/r(同直线段的几何外扩)
        const a0 = seg.a0 - BREATHE_OVERLAP / r;
        const a1 = seg.a1 + BREATHE_OVERLAP / r;
        const g = octx.createLinearGradient(
          cx + (r + half) * Math.cos(a0), cy + (r + half) * Math.sin(a0),
          cx + (r + half) * Math.cos(a1), cy + (r + half) * Math.sin(a1)
        );
        g.addColorStop(0, `rgb(${c0[0]},${c0[1]},${c0[2]})`);
        g.addColorStop(1, `rgb(${c1[0]},${c1[1]},${c1[2]})`);
        octx.fillStyle = g;
        octx.beginPath();
        octx.arc(cx, cy, r - half + r2, a0, a1); // 层外弧(从卡片边缘 r-half 向外)
        octx.arc(cx, cy, r - half, a1, a0, true); // 层内弧固定卡片边缘(实心环,同直线段)
        octx.closePath();
        octx.fill();
      }
    }
    // 整幅降 alpha 叠加(globalAlpha 作用于 drawImage 合成)——alpha 整幅统一,无接缝
    ctx.globalAlpha = a;
    ctx.drawImage(off, 0, 0);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
