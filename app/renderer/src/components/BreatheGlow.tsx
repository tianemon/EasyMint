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

/** 段几何外扩(px):光晕层在离屏 canvas 以不透明绘制,段间外扩覆盖 AA 边缘(不透明下重叠无亮痕),
    再整幅降 alpha 叠加——分段半透明的 AA 接缝被彻底消除,与屏幕 dpr 无关 */
const OVERLAP = 1;

export function BreatheGlow({ colors }: BreatheGlowProps): JSX.Element {
  const { canvasRef, registerDraw } = useGlowCanvas();
  const propsRef = useRef({ colors });
  propsRef.current = { colors };
  /** 离屏 canvas:每层先不透明绘制,再整幅降 alpha 叠加到主 canvas */
  const offRef = useRef<HTMLCanvasElement | null>(null);

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
      if (cs.length === 0) return;
      ctx.clearRect(0, 0, cssW, cssH);

      const outset = THICKNESS + BLOOM_OUTSET; // canvas 外扩量 = 光带 + 光晕预留
      const w = cssW - 2 * outset;
      const h = cssH - 2 * outset;
      const r = Math.min(radius + THICKNESS / 2, w / 2, h / 2);
      const P = pathPerimeter(w, h, r);
      const phase = (Math.sin((2 * Math.PI * now) / 1000 / SPEED) + 1) / 2; // 0→1→0 呼吸
      // 光晕(由实向虚):发散半径 1→6px(呼吸幅度 5px,张弛感更强),光斑强度随呼吸
      const bloomR = 1 + 5 * phase;
      const bloomAlpha = 0.8 * (0.3 + 0.7 * phase);
      const half = THICKNESS / 2;
      const rgbList = cs.map(rgbOf);
      const flow = (now / 1000 / SPEED) % 1; // 颜色带沿路径流转偏移(一圈 = 呼吸周期,多色流动)

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

      // ── 光晕:10 层离散衰减(由实向虚) ──
      // 每层流程:① 离屏 canvas 以不透明绘制该层(段间外扩 OVERLAP 覆盖 AA 边缘——不透明下重叠无亮痕)
      //          ② ctx.globalAlpha 整幅降透明后 drawImage 叠加——alpha 是整幅统一操作,不可能产生接缝
      // 对比旧方案(逐段半透明 fill + 段收窄/补丁):AA 边缘在半透明下叠加必然产生亮痕/暗线,只能最小化
      //   无法消除;离屏合成把"分段"与"半透明"解耦——任何 dpr/缩放下零接缝(不再需要 shrink 收窄)
      const dpr = window.devicePixelRatio || 1;
      const off = offRef.current ?? (offRef.current = document.createElement("canvas"));
      if (off.width !== ctx.canvas.width || off.height !== ctx.canvas.height) {
        off.width = ctx.canvas.width;
        off.height = ctx.canvas.height;
      }
      const octx = off.getContext("2d")!;
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const BLOOM_LAYERS = 10;
      // 主 ctx 切到物理像素坐标系:drawImage 的 off 尺寸是物理像素,若在 dpr transform 下调用会被
      // 当作 CSS 单位再乘 dpr → 放大 dpr 倍(内容以左上角为锚膨胀,视觉整体偏向右下)——切 identity 后 1:1
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (let L = 0; L < BLOOM_LAYERS; L++) {
        const a = bloomAlpha * (1 - (L + 0.5) / BLOOM_LAYERS); // 层中点 alpha(内→外递减)
        const r2 = (bloomR * (L + 1)) / BLOOM_LAYERS;
        octx.clearRect(0, 0, cssW, cssH);
        let li = 0;
        let ai = 0;
        for (const kind of order) {
          if (kind === "line") {
            const seg = lines[li++]!;
            // 几何外扩 OVERLAP(覆盖相邻段 AA 边缘);渐变范围随端点(重叠区会被后画段覆盖,内容无碍)
            const p0 = pathAt(seg.start - OVERLAP, w, h, r);
            const p1 = pathAt(seg.end + OVERLAP, w, h, r);
            const c0 = colorAtLoop(rgbList, seg.start / P + flow);
            const c1 = colorAtLoop(rgbList, seg.end / P + flow);
            // 内边固定卡片边缘(路径 - 法线×half):层画实心环 [卡片边缘, r2],主 canvas 上叠加
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
            // 角度外扩 OVERLAP/r(同直线段的几何外扩)
            const a0 = seg.a0 - OVERLAP / r;
            const a1 = seg.a1 + OVERLAP / r;
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
