import { useId, useMemo } from "react";
import { useThemeStore } from "../stores/theme-store";
// 取 SVG 源码文本（?raw）而非资源 URL：内联进 DOM 才能给每个实例的 id 加后缀（重复 id 会串 clip-path），
// 并能用同一份标记按主题换配色；用 <img src> 时每个实例是独立文档、拿不到元素也无法改内部 id。
import darkBlinkSvg from "../assets/avatar/avatar-dark-blink.svg?raw";
import lightBlinkSvg from "../assets/avatar/avatar-light-blink.svg?raw";

/**
 * 给内联 SVG 里的 id 加实例后缀，并同步改写引用它们的 url(#id)。
 * 同时渲染几十个头像意味着文档里会有几十份同源标记，而 id 是文档级唯一的：
 * 重复 id 时浏览器只解析到第一个，后面实例的 clip-path 会引用别人的 defs（两套主题标记都在场时
 * 甚至会引用到另一种配色的副本），剪裁结果不可预期。用「先收集所有 id 再整体替换」而不是硬替换
 * 已知名字，图形将来新增 id 也能覆盖到。
 * 替换后的标记里若有 url(#x) 找不到对应的 id="x"，说明结构超出预期（改动只做了一半）：
 * 此时返回原样标记——宁可渲染未去重的原样，也不能产出引用了不存在 id 的半坏 SVG（剪裁会直接失效）。
 */
function scopeSvgIds(markup: string, suffix: string): string {
  const ids = new Set<string>();
  for (const m of markup.matchAll(/\bid="([^"]+)"/g)) {
    if (m[1]) ids.add(m[1]);
  }
  if (ids.size === 0) return markup;

  let out = markup;
  for (const id of ids) {
    out = out.split(`id="${id}"`).join(`id="${id}-${suffix}"`);
    out = out.split(`url(#${id})`).join(`url(#${id}-${suffix})`);
  }
  for (const ref of out.matchAll(/url\(#([^)]+)\)/g)) {
    if (!out.includes(`id="${ref[1]}"`)) return markup;
  }
  return out;
}

/**
 * 剥掉 SMIL 动画元素，只留静态图形（rx 的初值就是睁眼尺寸）。眨眼改由 CSS 关键帧驱动：
 * 见 index.css 的 `.mint-live .mint-avatar ellipse[…]`——那条规则由容器上的一个类开关，
 * 该容器下所有头像（含新挂载的行）一起生效。
 *
 * 为什么不用 SMIL 自带的动画：内联 SVG 共享 HTML 文档的动画时间线，pauseAnimations() /
 * unpauseAnimations() 作用在整页而非单个实例上——N 个头像各自按状态去调就是 N 个控制者互相覆盖，
 * 最终状态取决于谁最后执行（实测表现为「空闲也在眨」「只有最后一个在眨」，不可控）。
 * CSS 类没有执行顺序问题：谁也不用调谁，规则命中与否只由容器上那一个类决定。
 */
function stripSmil(markup: string): string {
  return markup.replace(/<animate\b[\s\S]*?\/>\s*/g, "");
}

interface MintAvatarProps {
  size?: number;
  className?: string;
}

/** Mint 头像：内联矢量 SVG（应用自有资源，随主题换配色）。眨不眨眼由祖先容器上的 .mint-live 决定（只有最新一条 Mint 消息的那行带它） */
export function MintAvatar({ size = 40, className }: MintAvatarProps) {
  const isDark = useThemeStore((s) => s.effective) === "dark";
  // useId 保证跨实例唯一，但可能含「:」「«»」这类非 ASCII 字符——放进 SVG 的 url(#...) 片段引用
  // 没有可靠保证，先收敛成纯字母数字再当后缀
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, "") || "0";

  const markup = useMemo(
    () => scopeSvgIds(stripSmil(isDark ? darkBlinkSvg : lightBlinkSvg), instanceId),
    [isDark, instanceId],
  );
  // 必须 memo 成同一个对象：React 判定 dangerouslySetInnerHTML 要不要重写，比的是**这个对象的身份**
  // 而不是 __html 字符串（react-dom 的 props diff 用 !== 比对象，全文件只有赋值处才读 __html）。
  // 写成对象字面量的话每次重渲染身份都不同 → 每次都重写 innerHTML → 内联 SVG 被整体重建 →
  // 新建的 ellipse 从 t=0 重新开始动画。流式输出时最明显：正在输出的那行每帧重渲染，头像永远停在
  // 动画起点（看不到眨眼），而历史行不再重渲染、动画时间线保持，照常眨眼。
  const html = useMemo(() => ({ __html: markup }), [markup]);

  return (
    // 内联的是应用自有资源（设计稿在仓库内的副本）。项目文件或 agent 产出的 SVG 绝不能这样内联——
    // 那种 SVG 可能带脚本会被执行，必须走 <img> 由浏览器按图片沙箱处理
    <div
      className={`mint-avatar${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={html}
    />
  );
}
