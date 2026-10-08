import { uiText } from "../../lib/i18n";
/**
 * 环境检测的「重新检测」—— **全项目唯一一处定义**（设置页与引导流程共用）。
 *
 * 为什么单独抽出来：此前设置页有两个同文案按钮，而且刷新范围不同（标题栏那个只刷
 * Git/Node/CodeGraph 三个检测器，面板那个刷系统组件并重置沙盒失败缓存）——用户无从分辨，
 * 还出过"一进设置页就是两个按钮"的缺陷（面板用哨兵值判断是否由外层接管，与外层初值撞车）。
 *
 * 现在的口径（用户拍板）：**按钮由宿主提供、动作只有一个**——
 * 核心动作永远是 `EnvPanelHandle.retest()`（重探 + 重置沙盒失败缓存），
 * 宿主额外要刷的范围用 `onBeforeRetest` 注入（设置页用它带上三个检测器）。
 * `EnvPanel` 自身不再渲染任何刷新按钮，所以"同屏两个"在结构上不可能再出现，
 * 也不再有"两个按钮刷的东西不一样"这种隐藏差异。
 *
 * ── 为什么用 ref 句柄，而不是一个计数 prop（如 refreshKey）？────────────────────
 * React 官方 `useImperativeHandle` 文档确实有一条 Pitfall：
 *   「If you can express something as a prop, you should not use a ref.」
 * 并举例 `{ open, close }` 应改为 `isOpen` prop。
 * 但同一页的「Exposing your own imperative methods」正例，形状与本组件完全一致：
 *   父组件点按钮 → `postRef.current.scrollAndFocusAddComment()`。
 * 我们选 ref 的关键理由**不是"ref 更高级"**，而是：计数 prop 把「一个动作」编码成
 * 「一个数字的含义」，必然要额外约定"初值算不算触发/undefined 代表什么"——上一次的缺陷
 * （面板用哨兵值判断是否由外层接管，与外层初值撞车 → 同屏两个按钮）正是这种隐式值域约定造成的。
 * ref 直接表达"执行这个动作"，没有值域可撞。
 *
 * React 19 起 `ref` 就是普通 prop（不必再包 forwardRef），故 `EnvPanel` 用 `{ ref }` 解构 +
 * `useImperativeHandle` 暴露单一方法。
 *
 * ⚠️ 调用处必须有可选链：SSR / 静态渲染（我们的组件测试）下 `useImperativeHandle` 不执行，
 * `panel.current` 为 **null**。
 */
import type { RefObject } from "react";
import type { EnvPanelHandle } from "./EnvPanel";

export function EnvRetestButton({ panel, onBeforeRetest, className = "" }: {
  panel: RefObject<EnvPanelHandle | null>;
  /** 宿主自己的刷新范围（如 Git/Node/CodeGraph），在面板重探之前执行 */
  onBeforeRetest?: () => void;
  className?: string;
}): JSX.Element {
  return (
    <button
      className={`em-hover-control px-3 py-2 rounded-[var(--radius-lg)] text-xs text-text-secondary ${className}`}
      onClick={() => {
        onBeforeRetest?.();
        panel.current?.retest();
      }}
    >
      {uiText("ui.EnvRetestButton.checkAgain")}</button>
  );
}
