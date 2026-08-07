import { useEffect, useRef } from "react";
import { colorAtLoop, pathAt, pathPerimeter, hexToRgb } from "./glow-paths";
import { useGlowCanvas } from "./useGlowCanvas";

/**
 * breathe 呼吸灯 canvas 绘制:整圈光带 + 沿路径每个采样点向外发散柔光(由实向虚)。
 * 替代 CSS box-shadow(整圈均匀扩散,无"光带向外"感)——每个点垂直边框向外径向渐变衰减,
 * 圆角处自动贴合。方案见 docs/design/状态指示光效方案.md。
 */
interface BreatheGlowProps {
  /** 当前主题的颜色组合(多色取首色) */
  colors: string[];
}

/** 固定参数(用户定稿:除颜色外不可调):呼吸周期 3s;粗细仅参与内部几何(底线已去掉,不显示光带) */
const SPEED = 3;
const THICKNESS = 2;

/** 光晕发散预留:bloomR 最大 6px + 光带外扩 + 圆角斜向余量(四角 45° 方向光晕最外 ≈ (10+6)×√2 ≈ 23px,
    canvas 矩形外扩 E 斜向 = E×√2,需 ≥23 → E≥16)。防光晕被 canvas 矩形边界裁剪成直角 */
const BLOOM_OUTSET = 16;

export function BreatheGlow({ colors }: BreatheGlowProps): JSX.Element {
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
      if (cs.length === 0) return;
      ctx.clearRect(0, 0, cssW, cssH);

      const outset = t + BLOOM_OUTSET; // canvas 外扩量 = 光带 + 光晕预留
      const w = cssW - 2 * outset;
      const h = cssH - 2 * outset;
      const r = Math.min(radius + t / 2, w / 2, h / 2);
      const P = pathPerimeter(w, h, r);
      const phase = (Math.sin((2 * Math.PI * now) / 1000 / sp) + 1) / 2; // 0→1→0 呼吸
      // 光带透明度:用户确认只留光晕(底线关闭),恢复为 0.45 + 0.55 * phase
      const bandAlpha = 0;
      const bloomR = 1 + 5 * phase; // 发散半径:最暗 1px → 最亮 6px(呼吸幅度 5px,张弛感更强)
      const bloomAlpha = 0.8 * (0.3 + 0.7 * phase); // 光斑强度
      const half = t / 2;
      const rgbList = cs.map(rgbOf);
      const flow = (now / 1000 / sp) % 1; // 颜色带沿路径流转偏移(一圈 = 呼吸周期,多色流动)

      // 8 个整段(4 直边 + 4 圆角弧段):每段一次 fill + 段内线性渐变,fill 次数 ~112(16 光带 + 80 光晕层 + 16 补丁)。
      // 直边用四边形(pathAt 两点),弧段用真扇形(ctx.arc 内外弧)——四边形近似弧段弦高差 ~3px 会画成直线切角
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
      const shrink = 0.5; // 段收窄(px):连接区让给补丁独占,避免双画(半透明叠加亮痕)或缺口(AA 暗线)。
      // 0.5px 收窄 + 1px 补丁:重合带 2px→1px,连接痕迹宽度减半(半透明渲染下无法完全消除,仅能最小化)

      // 按路径顺序绘制(顶边→右上弧→右边→…)
      const order: Array<"line" | "arc"> = ["line", "arc", "line", "arc", "line", "arc", "line", "arc"];
      // 8 个连接点(段边界弧长),补丁独占连接区
      const joints = [s1, s2, s3, s4, s5, s6, s7, P];

      // ── 光带:整圈矩形截面(厚度 t),多色沿路径循环流转(colorAtLoop 首尾无缝) ──
      // 平移必须用 outset(card 在 canvas 坐标系中位于 (outset,outset)),用 t 会整体偏移+光晕被裁直角
      let li = 0;
      let ai = 0;
      for (const kind of order) {
        if (kind === "line") {
          const seg = lines[li++]!;
          const p0 = pathAt(seg.start + shrink, w, h, r);
          const p1 = pathAt(seg.end - shrink, w, h, r);
          const c0 = colorAtLoop(rgbList, seg.start / P + flow);
          const c1 = colorAtLoop(rgbList, seg.end / P + flow);
          const g = ctx.createLinearGradient(p0.x + outset, p0.y + outset, p1.x + outset, p1.y + outset);
          g.addColorStop(0, `rgba(${c0[0]},${c0[1]},${c0[2]},${bandAlpha})`);
          g.addColorStop(1, `rgba(${c1[0]},${c1[1]},${c1[2]},${bandAlpha})`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(p0.x + outset + p0.nx * half, p0.y + outset + p0.ny * half);
          ctx.lineTo(p1.x + outset + p1.nx * half, p1.y + outset + p1.ny * half);
          ctx.lineTo(p1.x + outset - p1.nx * half, p1.y + outset - p1.ny * half);
          ctx.lineTo(p0.x + outset - p0.nx * half, p0.y + outset - p0.ny * half);
          ctx.closePath();
          ctx.fill();
        } else {
          const seg = arcs[ai++]!;
          const c0 = colorAtLoop(rgbList, seg.cStart / P + flow);
          const c1 = colorAtLoop(rgbList, seg.cEnd / P + flow);
          const cx = seg.cx + outset; // 圆心(canvas 坐标)
          const cy = seg.cy + outset;
          const a0 = seg.a0 + shrink / r; // 收窄:起止角各收 1px 弧长
          const a1 = seg.a1 - shrink / r;
          const g = ctx.createLinearGradient(
            cx + (r + half) * Math.cos(a0), cy + (r + half) * Math.sin(a0),
            cx + (r + half) * Math.cos(a1), cy + (r + half) * Math.sin(a1)
          );
          g.addColorStop(0, `rgba(${c0[0]},${c0[1]},${c0[2]},${bandAlpha})`);
          g.addColorStop(1, `rgba(${c1[0]},${c1[1]},${c1[2]},${bandAlpha})`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, r + half, a0, a1); // 外边缘弧
          ctx.arc(cx, cy, r - half, a1, a0, true); // 内边缘弧(反向)
          ctx.closePath();
          ctx.fill();
        }
      }
      // 连接点补丁:1px 宽四边形独占连接区(颜色 = 连接点色,alpha = bandAlpha 同段),消除半透明双画亮痕
      for (const j of joints) {
        const p0 = pathAt(j - shrink, w, h, r);
        const p1 = pathAt(j + shrink, w, h, r);
        const c = colorAtLoop(rgbList, j / P + flow);
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${bandAlpha})`;
        ctx.beginPath();
        ctx.moveTo(p0.x + outset + p0.nx * half, p0.y + outset + p0.ny * half);
        ctx.lineTo(p1.x + outset + p1.nx * half, p1.y + outset + p1.ny * half);
        ctx.lineTo(p1.x + outset - p1.nx * half, p1.y + outset - p1.ny * half);
        ctx.lineTo(p0.x + outset - p0.nx * half, p0.y + outset - p0.ny * half);
        ctx.closePath();
        ctx.fill();
      }

      // ── 光晕:从光带外边缘向外,法线方向实→虚(8 层 alpha 离散衰减) ──
      // 颜色跟随光带的路径渐变(每层内 cStart→cEnd);段收窄 + 连接点补丁独占连接区(同光带)
      const BLOOM_LAYERS = 10;
      li = 0;
      ai = 0;
      for (const kind of order) {
        if (kind === "line") {
          const seg = lines[li++]!;
          const p0 = pathAt(seg.start + shrink, w, h, r);
          const p1 = pathAt(seg.end - shrink, w, h, r);
          const c0 = colorAtLoop(rgbList, seg.start / P + flow);
          const c1 = colorAtLoop(rgbList, seg.end / P + flow);
          for (let L = 0; L < BLOOM_LAYERS; L++) {
            const a = bloomAlpha * (1 - (L + 0.5) / BLOOM_LAYERS); // 层中点 alpha(内→外递减)
            const r1 = (bloomR * L) / BLOOM_LAYERS;
            const r2 = (bloomR * (L + 1)) / BLOOM_LAYERS;
            // 内边 = 卡片边缘(路径 - 法线×half)+ 法线×r1——光晕从卡片边缘开始(旧版从光带外边缘
            // 即卡片外 t px 处开始,与卡片有缝隙,肉眼可见不贴合)
            const i0x = p0.x + outset + p0.nx * (r1 - half);
            const i0y = p0.y + outset + p0.ny * (r1 - half);
            const i1x = p1.x + outset + p1.nx * (r1 - half);
            const i1y = p1.y + outset + p1.ny * (r1 - half);
            const o0x = p0.x + outset + p0.nx * (r2 - half);
            const o0y = p0.y + outset + p0.ny * (r2 - half);
            const o1x = p1.x + outset + p1.nx * (r2 - half);
            const o1y = p1.y + outset + p1.ny * (r2 - half);
            // 渐变沿路径方向(颜色 c0→c1),alpha = 层值恒定
            const g = ctx.createLinearGradient(p0.x + outset, p0.y + outset, p1.x + outset, p1.y + outset);
            g.addColorStop(0, `rgba(${c0[0]},${c0[1]},${c0[2]},${a})`);
            g.addColorStop(1, `rgba(${c1[0]},${c1[1]},${c1[2]},${a})`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(o0x, o0y);
            ctx.lineTo(o1x, o1y);
            ctx.lineTo(i1x, i1y);
            ctx.lineTo(i0x, i0y);
            ctx.closePath();
            ctx.fill();
          }
        } else {
          const seg = arcs[ai++]!;
          const c0 = colorAtLoop(rgbList, seg.cStart / P + flow);
          const c1 = colorAtLoop(rgbList, seg.cEnd / P + flow);
          const cx = seg.cx + outset;
          const cy = seg.cy + outset;
          const a0 = seg.a0 + shrink / r;
          const a1 = seg.a1 - shrink / r;
          for (let L = 0; L < BLOOM_LAYERS; L++) {
            const a = bloomAlpha * (1 - (L + 0.5) / BLOOM_LAYERS);
            const r1 = (bloomR * L) / BLOOM_LAYERS;
            const r2 = (bloomR * (L + 1)) / BLOOM_LAYERS;
            const g = ctx.createLinearGradient(
              cx + (r + half) * Math.cos(a0), cy + (r + half) * Math.sin(a0),
              cx + (r + half) * Math.cos(a1), cy + (r + half) * Math.sin(a1)
            );
            g.addColorStop(0, `rgba(${c0[0]},${c0[1]},${c0[2]},${a})`);
            g.addColorStop(1, `rgba(${c1[0]},${c1[1]},${c1[2]},${a})`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(cx, cy, r - half + r2, a0, a1); // 层外弧(从卡片边缘 r-half 向外)
            ctx.arc(cx, cy, r - half + r1, a1, a0, true); // 层内弧反向
            ctx.closePath();
            ctx.fill();
          }
        }
      }
      // 光晕连接点补丁:每层在连接点处 [j-shrink, j+shrink] 带(颜色 = 连接点色,alpha = 层值)
      for (const j of joints) {
        const p0 = pathAt(j - shrink, w, h, r);
        const p1 = pathAt(j + shrink, w, h, r);
        const c = colorAtLoop(rgbList, j / P + flow);
        for (let L = 0; L < BLOOM_LAYERS; L++) {
          const a = bloomAlpha * (1 - (L + 0.5) / BLOOM_LAYERS);
          const r1 = (bloomR * L) / BLOOM_LAYERS;
          const r2 = (bloomR * (L + 1)) / BLOOM_LAYERS;
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
          ctx.beginPath();
          ctx.moveTo(p0.x + outset + p0.nx * (r2 - half), p0.y + outset + p0.ny * (r2 - half));
          ctx.lineTo(p1.x + outset + p1.nx * (r2 - half), p1.y + outset + p1.ny * (r2 - half));
          ctx.lineTo(p1.x + outset + p1.nx * (r1 - half), p1.y + outset + p1.ny * (r1 - half));
          ctx.lineTo(p0.x + outset + p0.nx * (r1 - half), p0.y + outset + p0.ny * (r1 - half));
          ctx.closePath();
          ctx.fill();
        }
      }
    });
    return () => registerDraw(null);
  }, [registerDraw]);

  // style 注入 --glow-outset = 光带 + 光晕发散预留(cssW = 卡片 + 2×outset,绘制 w = cssW - 2×outset)
  return (
    <canvas
      ref={canvasRef}
      className="glow-canvas"
      style={{ "--glow-outset": `${THICKNESS + BLOOM_OUTSET}px` } as React.CSSProperties}
      aria-hidden="true"
    />
  );
}
