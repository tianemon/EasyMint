import { useEffect, useId, useMemo, useRef } from "react";
import { useThemeStore } from "../stores/theme-store";
// 取 SVG 源码文本（?raw）而非资源 URL：只有把标记真正内联进 DOM，页面 JS 才能拿到内部的
// <svg> 元素去控制它的 SMIL 动画；用 <img src> 或 CSS background-image 时，SVG 在独立的
// 文档里播放，外部脚本既碰不到元素也无 API 可控制。
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

interface MintAvatarProps {
  /** 生成中才播眨眼动画；空闲时冻结在睁眼静止姿态 */
  busy: boolean;
  size?: number;
  className?: string;
}

/** Mint 头像：内联矢量 SVG（应用自有资源，随主题换配色），busy 时播眨眼 */
export function MintAvatar({ busy, size = 40, className }: MintAvatarProps) {
  const isDark = useThemeStore((s) => s.effective) === "dark";
  const hostRef = useRef<HTMLDivElement>(null);
  // useId 保证跨实例唯一，但可能含「:」「«»」这类非 ASCII 字符——放进 SVG 的 url(#...) 片段引用
  // 没有可靠保证，先收敛成纯字母数字再当后缀
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, "") || "0";

  const source = isDark ? darkBlinkSvg : lightBlinkSvg;
  const markup = useMemo(() => scopeSvgIds(source, instanceId), [source, instanceId]);

  // 依赖 busy 与 markup：主题切换会整体替换内联标记（换成新的 <svg> 元素、动画回到播放态），
  // 必须对新元素重新落一次播放/冻结状态
  useEffect(() => {
    const svg = hostRef.current?.querySelector("svg");
    if (!svg) return;

    // 系统开了「减弱动态效果」就永不播放——静态是刻意的，不是忘了恢复
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (busy && !reducedMotion) {
      svg.unpauseAnimations();
      return;
    }

    // 先回到第 0 帧再冻结：眨眼周期里闭眼段占了近一半时间（keyTimes 0.4→0.87），
    // 就地暂停经常停在半闭姿态，看起来像眯着眼
    svg.setCurrentTime(0);
    svg.pauseAnimations();
  }, [busy, markup]);

  return (
    // 内联的是应用自有资源（设计稿在仓库内的副本）。项目文件或 agent 产出的 SVG 绝不能这样内联——
    // 那种 SVG 可能带脚本会被执行，必须走 <img> 由浏览器按图片沙箱处理
    <div
      ref={hostRef}
      className={className ? `mint-avatar ${className}` : "mint-avatar"}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
