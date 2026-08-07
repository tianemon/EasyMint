/**
 * 光效 canvas 共享工具:圆角矩形路径参数化 + 颜色工具。
 * 三个预设组件(OrbitGlow/SlideGlow/BreatheGlow)复用同一套路径系统,保证圆角贴合一致。
 */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface PathPt {
  x: number;
  y: number;
  nx: number; // 外法线
  ny: number;
}

/**
 * 圆角矩形路径:沿周长弧长 s 取点 + 外法线(顺时针,自顶边左端 (r,0) 出发)。
 * 坐标相对卡片左上角(0,0),绘制时需 +t 平移到 canvas 坐标。
 */
export function pathAt(s: number, w: number, h: number, r: number): PathPt {
  const topLen = w - 2 * r;
  const sideLen = h - 2 * r;
  const arc = (Math.PI / 2) * r;
  const P = 2 * topLen + 2 * sideLen + 4 * arc;
  s = ((s % P) + P) % P;
  const s1 = topLen;
  const s2 = s1 + arc;
  const s3 = s2 + sideLen;
  const s4 = s3 + arc;
  const s5 = s4 + topLen;
  const s6 = s5 + arc;
  const s7 = s6 + sideLen;
  // 顶边(左端 → 右端)
  if (s < s1) return { x: r + s, y: 0, nx: 0, ny: -1 };
  // 右上圆角
  if (s < s2) {
    const a = -Math.PI / 2 + ((s - s1) / arc) * (Math.PI / 2);
    return { x: w - r + Math.cos(a) * r, y: r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
  }
  // 右边(上 → 下)
  if (s < s3) return { x: w, y: r + (s - s2), nx: 1, ny: 0 };
  // 右下圆角
  if (s < s4) {
    const a = ((s - s3) / arc) * (Math.PI / 2);
    return { x: w - r + Math.cos(a) * r, y: h - r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
  }
  // 底边(右 → 左)
  if (s < s5) return { x: w - r - (s - s4), y: h, nx: 0, ny: 1 };
  // 左下圆角
  if (s < s6) {
    const a = Math.PI / 2 + ((s - s5) / arc) * (Math.PI / 2);
    return { x: r + Math.cos(a) * r, y: h - r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
  }
  // 左边(下 → 上)
  if (s < s7) return { x: 0, y: h - r - (s - s6), nx: -1, ny: 0 };
  // 左上圆角
  const a = Math.PI + ((s - s7) / arc) * (Math.PI / 2);
  return { x: r + Math.cos(a) * r, y: r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
}

/** 圆角矩形周长(与 pathAt 一致) */
export function pathPerimeter(w: number, h: number, r: number): number {
  const topLen = w - 2 * r;
  const sideLen = h - 2 * r;
  return 2 * topLen + 2 * sideLen + 2 * Math.PI * r;
}

/**
 * 带内均分插值颜色(尾→头 colors[0..last],相邻色标直接插值)。
 * pos ∈ [0,1],len = 颜色数。
 */
export function colorAt(rgbList: Array<[number, number, number]>, pos: number): [number, number, number] {
  const len = rgbList.length;
  const ci = Math.min(len - 1, Math.floor(pos * len));
  const cj = Math.min(len - 1, ci + 1);
  const ct = pos * len - ci;
  return lerpRgb(rgbList[ci]!, rgbList[cj]!, ct);
}

/** 闭合环循环插值颜色:pos=1 接回 colors[0],首尾无缝(闭合光带用,如呼吸灯整圈) */
export function colorAtLoop(rgbList: Array<[number, number, number]>, pos: number): [number, number, number] {
  const len = rgbList.length;
  const p = ((pos % 1) + 1) % 1;
  const seg = p * len;
  const ci = Math.floor(seg) % len;
  const cj = (ci + 1) % len;
  return lerpRgb(rgbList[ci]!, rgbList[cj]!, seg - Math.floor(seg));
}

function lerpRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** 半椭圆剖面:u∈[0,1](0=尖 1=主体),高度按半椭圆曲线(底部直线贴边框、顶部弧线收尖) */
export function halfEllipseProfile(u: number): number {
  return Math.sqrt(2 * u - u * u);
}
