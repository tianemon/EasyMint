import { useEffect, useRef } from "react";
import { colorAt, halfEllipseProfile, pathAt, pathPerimeter, hexToRgb } from "./glow-paths";
import { useGlowCanvas } from "./useGlowCanvas";

/**
 * orbit 环绕流光 canvas 绘制:沿卡片圆角矩形路径画光带,尾巴(渐入/渐出段)半椭圆收尖
 * (底部直线贴边框、顶部弧线收尖到 0)。方案见 docs/design/状态指示光效方案.md。
 */
interface OrbitGlowProps {
  /** 当前主题的颜色组合(1-5 色) */
  colors: string[];
}

/** 固定参数(用户定稿:除颜色外不可调):粗细 2px / 一圈 4s(UI 速度档位 2=6-2) / 彗尾 4 档=160° */
const THICKNESS = 2;
const SPEED = 4;
const TAIL_WIDTH = 160;
/** 渐入/渐出段角度(固定 20°,用户定稿:以前默认 15° 可调,现固定) */
const FADE_DEG = 20;

export function OrbitGlow({ colors }: OrbitGlowProps): JSX.Element {
  const { canvasRef, registerDraw } = useGlowCanvas();
  // props 走 ref:rAF 每帧读取,参数变化(含主题切换换色)无需重建循环
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

      // 基线 = 卡片圆角矩形外扩 t/2 的等距线;光带内边缘贴卡片边缘,外边缘 = 卡片外 t
      const w = cssW - 2 * t;
      const h = cssH - 2 * t;
      const r = Math.min(radius + t / 2, w / 2, h / 2);
      const P = pathPerimeter(w, h, r);

      const centerS = (now / 1000 / sp) * P; // 光带中心沿周长推进(sp 秒/圈)
      const tailLen = (tw / 360) * P; // 彗尾弧长(角度 → 周长比例)
      const fadeLen = Math.min((FADE_DEG / 360) * P, tailLen / 2); // 渐入/渐出段弧长(固定 20°)
      const sTail = centerS - tailLen / 2;

      const rgbList = cs.map(rgbOf);
      const n = Math.max(8, Math.ceil(tailLen / 2)); // 每 ~2px 一个采样点
      // 逐段小四边形填充(段间颜色/透明度渐变,单段 4 顶点)
      for (let i = 0; i < n; i++) {
        const p0 = segPt(i / n, sTail, tailLen, fadeLen, w, h, r, t, rgbList);
        const p1 = segPt((i + 1) / n, sTail, tailLen, fadeLen, w, h, r, t, rgbList);
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

interface SegPt {
  tx: number; ty: number; // 顶边(外边缘,含半椭圆剖面)
  bx: number; by: number; // 底边(内边缘,贴卡片边框)
  c: [number, number, number];
  alpha: number;
}

/** 单个采样点:路径点 + 法线 + 半椭圆高度剖面 + 颜色/透明度(pos 0=尾尖 1=头顶) */
function segPt(
  pos: number, sTail: number, tailLen: number, fadeLen: number,
  w: number, h: number, r: number, t: number,
  rgbList: Array<[number, number, number]>
): SegPt {
  const s = sTail + tailLen * pos;
  const p = pathAt(s, w, h, r);
  const spLen = pos * tailLen;
  // 高度剖面:渐入/渐出段半椭圆(底部直线贴边框,顶部弧线收尖到 0),主体全高
  let profile = 1;
  if (spLen < fadeLen) {
    const u = spLen / fadeLen; // 0 尖 → 1 主体
    profile = halfEllipseProfile(u);
  } else if (spLen > tailLen - fadeLen) {
    const v = (tailLen - spLen) / fadeLen; // 1 主体 → 0 尖
    profile = halfEllipseProfile(v);
  }
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
