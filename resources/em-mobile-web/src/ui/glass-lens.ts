/**
 * 液态玻璃折射层 —— Web 原生近似，不是 WebGL2 材质逐像素复刻。
 *
 * 视觉真值源要求「中心保留背景色彩与明暗结构且稳定；边缘承担集中的扭曲」。
 * 本机 Chrome 实测（tests/glass-render.test.mjs 与开发期探针）得到四条硬约束：
 *  1. `backdrop-filter: url(#SVG feDisplacementMap)`（非前缀属性）能真实折射背景；
 *     `-webkit-backdrop-filter: url()` 在 Chrome 被忽略。
 *  2. 整块折射层上的径向 mask-image（以及 clip-path）会把整个 backdrop-filter 结果裁没
 *     （差值全 0），因此不能用「整块 lens + 径向 mask」；但四条边缘带各自加向内的
 *     线性渐隐 mask 不会让滤镜失效，只改变强度分布，可用且更贴近「平滑进入中心」。
 *  3. 父层若先做 blur(18px)，子层采样到的是已无细节的模糊像素，url() 折射贡献
 *     从 9988 掉到 199（500×320 判据下几乎归零）。
 * 因此：折射面用四条 [data-lens-band] 边缘带（Glass.tsx 的 .glass-lens-t/b/l/r），
 * 中心交给独立的 .glass-frost 磨砂层承接 blur(18px)，父层在 has-lens 时不再整体模糊。
 * 这是与 A4 字面「父层保留 blur + 整块径向 mask」的偏离，理由与数据见汇报。
 */

import { detectPlatform, usesLayeredGlass } from '../core/platform';

export const LENS_FILTER_ID = 'em-liquid-lens';
/**
 * 边缘带的滤镜链：位移在前、磨砂在后。
 * blur 必须接近中心磨砂层的量级（18px），否则边缘带会留出一圈「比中心清楚」的环——
 * 位移是几何量（scale 16），先做位移再做 blur 不会削弱折射，只是把折射细节磨平。
 */
export const LENS_BACKDROP = `url(#${LENS_FILTER_ID}) blur(12px) saturate(1.6)`;

// 单一数据源：节点规格同时用于 createElementNS 注入和对外暴露的 SVG 标记，
// 后者供 tests/glass-render.test.mjs 用 esbuild 导入后构造真实浏览器测试页，
// 保证「被测滤镜」和「产物滤镜」是同一份。
const LENS_NODES: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ['feTurbulence', {
    type: 'fractalNoise', baseFrequency: '0.008 0.014', numOctaves: '2',
    seed: '7', stitchTiles: 'stitch', result: 'noise',
  }],
  ['feGaussianBlur', { in: 'noise', stdDeviation: '0.6', result: 'softNoise' }],
  ['feDisplacementMap', {
    in: 'SourceGraphic', in2: 'softNoise', scale: '16',
    xChannelSelector: 'R', yChannelSelector: 'G',
  }],
];

function serializeNode([tag, attrs]: readonly [string, Readonly<Record<string, string>>]): string {
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
  return `<${tag}${a}/>`;
}

/** 完整的 <filter> 标记：真实浏览器像素测试复用，避免「测的不是产物」的假阳性。 */
export const LENS_FILTER_MARKUP =
  `<filter id="${LENS_FILTER_ID}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">`
  + LENS_NODES.map(serializeNode).join('')
  + '</filter>';

const SVG_NS = 'http://www.w3.org/2000/svg';
let injected = false;

/** 幂等注入一个 0 尺寸、aria-hidden 的 <svg><defs>…</defs></svg> 到 body。 */
export function ensureLensDefs(): void {
  if (injected || typeof document === 'undefined' || !document.body) return;
  injected = true;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.style.width = '0';
  svg.style.height = '0';
  svg.style.overflow = 'hidden';
  const defs = document.createElementNS(SVG_NS, 'defs');
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', LENS_FILTER_ID);
  filter.setAttribute('x', '-20%');
  filter.setAttribute('y', '-20%');
  filter.setAttribute('width', '140%');
  filter.setAttribute('height', '140%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  for (const [tag, attrs] of LENS_NODES) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    filter.appendChild(node);
  }
  defs.appendChild(filter);
  svg.appendChild(defs);
  document.body.appendChild(svg);
}

/**
 * 能力门槛：只是语法 + 系统偏好的门控，不代表「渲染一定生效」。
 * 真实折射效果由 tests/glass-render.test.mjs 的 Chrome 像素差值证明。
 */
export function supportsLens(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  // 只有 iOS 走分层折射。Android / 鸿蒙不做分层：这些 WebView 的合成器在
  // 「父层 overflow:hidden+圆角 → 子层 backdrop-filter」这条路径上不一定合成，
  // 表现是输入卡完全没有磨砂。直接走整块模糊（.glass-liquid 的基础 blur），
  // 少一点边缘位移，换来各端观感一致。
  if (typeof navigator !== 'undefined'
    && !usesLayeredGlass(detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0))) return false;
  const url = CSS.supports('backdrop-filter', `url(#${LENS_FILTER_ID})`)
    || CSS.supports('-webkit-backdrop-filter', `url(#${LENS_FILTER_ID})`);
  // backdrop-filter 整体不可用时页面会挂 glass-fallback，此时不应启用折射。
  const blur = CSS.supports('backdrop-filter', 'blur(1px)')
    || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
  if (!url || !blur) return false;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return false;
  return true;
}

/**
 * 用 CSSOM 设置 backdrop-filter：CSP `style-src 'self'` 不含 unsafe-inline，
 * 且外链 CSS 中的 url(#id) 在部分浏览器会按样式表 URL 解析 fragment 而找不到 filter。
 * 传 .glass 根节点（或任一容器）时，把滤镜设到其中全部 [data-lens-band] 边缘带；
 * 传单条边缘带时直接设置。不做任何内联 style 属性或外链 url(#id) 的写法。
 */
export function applyLens(el: HTMLElement | null): void {
  if (!el || !supportsLens()) return;
  const targets: HTMLElement[] = el.hasAttribute('data-lens-band')
    ? [el]
    : Array.from(el.querySelectorAll<HTMLElement>('[data-lens-band]'));
  for (const node of targets) {
    node.style.backdropFilter = LENS_BACKDROP;
    node.style.setProperty('-webkit-backdrop-filter', LENS_BACKDROP);
  }
}
