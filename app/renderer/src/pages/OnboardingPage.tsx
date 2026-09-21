import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSettingsStore } from "../stores/settings-store";
import { useThemeStore } from "../stores/theme-store";
import { PiImportCard, envAutoAdvanceAllowed, manualSkipDropsAutoAdvance } from "../components/settings/PiImport";
import { ProviderForm } from "../components/settings/ProviderSettings";
import { EnvPanel } from "../components/env/EnvPanel";
import { TavilyKeySection } from "../components/settings/TavilyKeySection";
import { WindowControls } from "../components/WindowControls";
import type { ProviderConfig, ApiProvidersData } from "@shared/platform-presets";

const STEPS = [
  { number: 1, title: "欢迎使用 EasyMint" },
  // 依赖问题必须在"进入工作台之前"处理掉：放到对话中途才发现，用户已经聊了几轮、挫败感最强
  { number: 2, title: "准备运行环境" },
  { number: 3, title: "选择 AI 供应商" },
];

/** 各步骤的「内容整体上移量」(px)，0 或缺省即保持居中。两处都是用户直接指定的观感：
 *  - 欢迎页 80px（2026-09-15：「字体再小一号，整体上移80px」）
 *  - 环境检测页 60px（同日：「…只显示标题和动画，然后整体上移60px」）
 *  实现用内层的 `padding-bottom: 2 × 偏移`——内层是 `justify-center`，底部多留 2 倍才会把内容中心抬高 1 倍。
 *  **不用 translate**：位移不参与布局，会把内容顶出滚动区（顶部从此再也滚不到）。 */
const STEP_LIFT_PX: Record<number, number> = { 0: 80, 1: 60 };

export function OnboardingPage(): JSX.Element {
  const navigate = useNavigate();
  const isDark = useThemeStore((s) => s.effective) === "dark";
  const [currentStep, setCurrentStep] = useState(0);
  const { setApiProviders } = useSettingsStore();

  // 记录本次已保存的供应商 ID，避免重复保存
  const [savedCfg, setSavedCfg] = useState<ProviderConfig | null>(null);

  // 重新运行引导时预填已配置的供应商（设置 store 异步加载，故订阅而非读一次快照）：
  // 否则「重看一遍引导」会被迫重填 API Key——配置本身不丢，只是多一道无谓操作
  const apiProviders = useSettingsStore((s) => s.apiProviders);
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !apiProviders?.current) return;
    const cur = apiProviders.configs?.[apiProviders.current];
    if (cur) setSavedCfg(cur);
    prefilled.current = true;
  }, [apiProviders]);

  const handleProviderSave = async (cfg: ProviderConfig) => {
    // 复用已保存的 ID，避免重复创建
    const id = cfg.id;
    const finalCfg = { ...cfg, id };
    // 以主进程配置为基底：渲染态未加载完成时为空，用它重建会丢掉已有供应商配置
    const saved = (await window.electronAPI.settings.get()).apiProviders;
    const nextData: ApiProvidersData = {
      ...saved,
      current: id,
      configs: { ...(saved?.configs ?? {}), [id]: finalCfg },
    };
    if (await setApiProviders(nextData)) setSavedCfg(finalCfg);
  };

  const handleComplete = () => {
    localStorage.setItem("easymint_setup_complete", "true");
    window.electronAPI?.settings?.set?.("setupComplete", true);
    window.dispatchEvent(new Event("easymint-setup-complete"));
    navigate("/");
  };

  const goPrev = useCallback(() => setCurrentStep((s) => Math.max(s - 1, 0)), []);

  // ── Step 2 的 pi 配置检测（2026-09-21 布点，用户拍板）──
  // 进入引导即做零 IO 存在性探测（probe 不读会话内容）：命中 → Step 2 渲染「导入 pi 配置」
  // 卡片，并把「就绪即自动离开」收走（跳过只由「下一步」或导入完成触发，**不锁定**）；
  // 未命中 → Step 2 保持纯过场原样（就绪即自动走，2026-09-15 的定位不变——大多数用户无感知）。
  // 探测失败按未命中：导入是增值项，不能挡主流程。
  const [piProbe, setPiProbe] = useState<"pending" | "hit" | "miss">("pending");
  const piImported = useRef(false);
  /** env 就绪信号先到、pi 探测未落定时的记账（probe 落定后由重放 effect 兑现） */
  const envReadySeen = useRef(false);
  useEffect(() => {
    let active = true;
    window.electronAPI.settings.piImport({ probe: true })
      .then((summary) => { if (active) setPiProbe(summary.found ? "hit" : "miss"); })
      .catch(() => { if (active) setPiProbe("miss"); });
    return () => { active = false; };
  }, []);

  // 环境就绪 → **直接**进入下一步（用户 2026-09-15：这一步是纯过场，"没问题就直接跳供应商页面"）。
  // 守卫用 ref 而非 state：**只自动跳一次**——用户自己按「返回」回到本步时不该被立刻推走（否则回不去）。
  // 早先这里有 1.2s 延迟，是为让"正在进入下一步…"那句被看见；用户已明确不要那句文案，
  // 于是延迟一并去掉 —— 没有话要说，就没有停的理由。
  const envAutoAdvanced = useRef(false);
  /** 面板还要不要"就绪即自动离开"。**自动跳过一次后就不再传 onReady** ——
   *  面板据此回落到普通态（显示依赖状态与「下一步」按钮），而不是挂着一个永不跳转的过场动画。 */
  const [willAutoAdvance, setWillAutoAdvance] = useState(true);
  const handleEnvReady = useCallback((): void => {
    if (envAutoAdvanced.current) return;
    // pi 门控（见 envAutoAdvanceAllowed）：检测未落定 / 命中且未导入 → 先记账不放行——
    // 自动跳过去等于把导入入口收走；落定为未命中时由下方重放 effect 把挂起的信号兑现
    if (!envAutoAdvanceAllowed(piProbe, piImported.current)) {
      envReadySeen.current = true;
      return;
    }
    envAutoAdvanced.current = true;
    setWillAutoAdvance(false);
    // 函数式更新并判当前步：交回宿主是异步的，期间用户可能已经按「返回」
    setCurrentStep((s) => (s === 1 ? s + 1 : s));
  }, [piProbe]);

  // probe 落定后重放被挂起的 env 就绪信号（只在「env 探测快于 pi 探测」的窗口期会走到）
  useEffect(() => {
    if (!envReadySeen.current || envAutoAdvanced.current) return;
    if (!envAutoAdvanceAllowed(piProbe, piImported.current)) return;
    envAutoAdvanced.current = true;
    setWillAutoAdvance(false);
    setCurrentStep((s) => (s === 1 ? s + 1 : s));
  }, [piProbe]);

  // 导入完成 → 直接进 Step 3（用户拍板：Step 3 会像平常一样直接展示导入的供应商——
  // prefill effect 订阅 settings store，导入后的 apiProviders.current 会渲染成「使用中」卡片）。
  // 置 envAutoAdvanced：用户「返回」再进本步时不被自动推走。EnvPanel 随之卸载，
  // 与既有「底部下一步跳过」是同一条路径（本来就允许在装依赖途中离开本步）。
  const handlePiImported = useCallback((): void => {
    piImported.current = true;
    envAutoAdvanced.current = true;
    setWillAutoAdvance(false);
    setCurrentStep((s) => (s === 1 ? s + 1 : s));
  }, []);

  // 手动离开 Step 2 时：门控场景（命中 pi 未导入）下收走「就绪即自动离开」——
  // 跳过是显式决定，返回重挂走普通态（依赖状态列表 + 仍可导入的 pi 卡片），
  // 而不是过场动画 + 每次都被门控拦住的 onReady（行为对但路径绕）。
  const goNext = useCallback(() => {
    if (currentStep === 1 && manualSkipDropsAutoAdvance(piProbe, piImported.current)) {
      setWillAutoAdvance(false);
    }
    setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  }, [currentStep, piProbe]);

  return (
    <div className="flex flex-col h-full">
      {/* Windows 自绘窗口按钮 + 顶部拖拽区（无 TabBar 的页面单独提供） */}
      <div className="relative h-[35px] shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        <WindowControls />
      </div>
      {/* Step indicator —— **环境检测这一步整块不渲染**（用户 2026-09-15：这一步只留标题 + 动画）。
          连带它那截 `pt-12` 的留白一起消失，内容区自然变高、内容上提。 */}
      {currentStep !== 1 && (
        <div className="flex justify-center gap-3 pt-12 pb-2">
          {STEPS.map((step, i) => (
            <div key={step.number} className="flex items-center gap-3">
              <div
                className={`w-2 h-2 rounded-full transition-colors ${
                  i < currentStep
                    ? "bg-accent"
                    : i === currentStep
                      ? "bg-accent ring-2 ring-accent-border"
                      : "bg-text-muted"
                }`}
              />
              {i < STEPS.length - 1 && (
                <div
                  className={`w-8 h-[2px] transition-colors ${
                    i < currentStep ? "bg-accent" : "bg-text-muted"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Content：外层必须可滚动（overflow-y-auto），否则 flex-1 项的 min-height:auto
          会让超高内容把 footer 顶出视口，而 #app-shell 是 overflow:hidden —— 实测（1400×900 窗口、
          表单展开态）：不加滚动时内容区高 869 > 可用空间 642，footer 被裁 227px、「进入工作台」
          完全不可见；加上后 footer 稳定留在视口内，超高内容在内容区内部滚动。
          内层用 flex-1，**不要用 min-h-full**：min-height:100% 在这个 flex 项父容器上解析不出来
          （实测内层退化成内容高、内容贴顶），flex-1 + justify-center 才能既撑满又居中。 */}
      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col">
        {/* 各步骤的内容整体上移量（见 STEP_LIFT_PX）；0 = 保持居中 */}
        <div
          className="flex-1 flex flex-col items-center justify-center"
          style={{ paddingBottom: (STEP_LIFT_PX[currentStep] ?? 0) * 2 }}
        >
          {currentStep === 0 ? (
            /* ── Step 1: Welcome ── */
            <div className="flex flex-col items-center text-center">
              {/* Logo：直接用图标本身（素材自带圆角口径），不套卡片容器——容器形状会在图标四角外露（形状套两层）、
                  且图标本体只占图片 80.5%，套容器后可见图标更小。与关于页（无容器、图标直接 80px）一致。
                  图标跟随主题取亮/暗版（与关于页、Dock 同一套素材） */}
              <img src={isDark ? "appicon-dark.png" : "appicon-light.png"} alt="EasyMint" className="w-24 h-24 mb-6" />

              {/* 欢迎主文案（用户 2026-09-15 给的新文案，替换原来的标题 + 两段说明）。
                  **一排展示、不换行**（用户要求）：无头实测这行在 24px/600、PingFang SC 下宽 **681.0px**，
                  而引导页内容可用宽约 **960px**（窗口最小宽 1024 − 两侧 px-8 共 64），留有余量 ——
                  故去掉原先的 `max-w-[480px]` 约束并加 `whitespace-nowrap`。
                  （字号历程：用户先要"大一些"→ 按规范补 30px 档，实测 873.5px 几乎占满；随后用户
                  「字体再小一号」→ 回到 `--text-2xl`(24px)，那个 3xl 档因 0 引用已删。
                  末尾句号按用户要求去掉，实测宽度随之由 698.5px 降到 681.0px。）
                  字体保持系统默认栈：曾试过圆体，但三平台没有共同的预装圆体（Windows 的「幼圆」属
                  Office 附带而非系统自带），要三平台一致只能打包字体文件，用户 2026-09-15 决定作罢。
                  若将来文案变长，会退化成内容区横向滚动（不裁字）。行高保持 tight，万一折行也不显散。
                  下方原有三张能力卡已按用户要求（2026-09-15）删除。 */}
              <h1 className="text-[length:var(--text-2xl)] leading-tight font-semibold text-text-primary whitespace-nowrap">
                欢迎使用EasyMint，简单设置过后，进行开发你的第一个APP吧
              </h1>
            </div>
          ) : currentStep === 1 ? (
            /* ── Step 2: 环境准备（缺失依赖在这里装/引导，避免进工作台后命令全跑不了）──
               刷新按钮由本页提供（面板自身不再渲染）：动作与设置页是同一份实现。
               autoFix：进来就自动装（不再要求用户点「一键安装」）；就绪即自动进下一步。
               pi 检测命中时追加「导入 pi 配置」卡片（2026-09-21）：卡片与 EnvPanel 并列，
               自动跳转由 handleEnvReady 的门控收走，跳过走底部「下一步」（不锁定）；
               未命中/探测中不渲染任何额外内容——本步保持纯过场。
               这里**不放「重新检测」按钮**（用户 2026-09-15：那个按钮不该出现在动画下方）——
               这一步的出路是「一键安装/一键修复」（面板内）或底部的「下一步」跳过；
               真要重测，去「设置 → 环境检测」（那里的按钮由设置页提供，是全项目唯一一处）。 */
            <div className="w-full max-w-[540px] space-y-4">
              <EnvPanel
                variant="onboarding"
                autoFix
                onReady={willAutoAdvance ? handleEnvReady : undefined}
              />
              {piProbe === "hit" && <PiImportCard onImported={handlePiImported} />}
            </div>
          ) : (
            /* ── Step 3: Provider Setup ── */
            <div className="w-full max-w-[540px]">
              <h1 className="text-xl font-semibold text-center mb-1">
                选择 AI 供应商
              </h1>
              <p className="text-text-secondary text-center text-sm mb-6">
                选择一个平台并填写 API Key 即可开始使用
              </p>
              {/* pi 导入入口在 Step 2（命中才出现）；导入完成后这里的 prefill 会把导入的
                  供应商直接显示成「使用中」卡片 */}
              {savedCfg ? (
                <div className="bg-surface-alt rounded-[var(--radius-lg)] p-4 space-y-4">
                  <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] bg-accent-soft">
                    <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-text-primary font-medium truncate">{savedCfg.name}</span>
                        <span className="text-[length:var(--text-2xs)] px-1.5 py-0.5 rounded-[var(--radius-lg)] bg-accent-high text-accent shrink-0">使用中</span>
                      </div>
                      <div className="text-[length:var(--text-11)] text-text-muted mt-0.5">
                        模型 {savedCfg.models.length} 个 · {savedCfg.model}
                      </div>
                    </div>
                  </div>
                  <button
                    className="em-hover-control w-full px-4 py-2 rounded-[var(--radius-lg)] text-text-secondary text-xs transition-all"
                    onClick={() => setSavedCfg(null)}
                  >重新配置</button>
                </div>
              ) : (
                <ProviderForm onSave={handleProviderSave} />
              )}
              {/* 联网能力（可选）：与供应商独立存储（settings.apiKeys）、失焦即生效，
                  所以放在表单之外——不随「保存供应商配置」提交，也不需要第二个保存按钮 */}
              <TavilyKeySection />
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="p-4 flex justify-between bg-surface-alt shrink-0">
        {currentStep === 0 ? (
          <button
            className="btn-accent px-6 py-2 rounded-[var(--radius-lg)] font-medium ml-auto"
            onClick={goNext}
          >
            开始设置
          </button>
        ) : (
          <button
            className="em-hover-control px-6 py-2 rounded-[var(--radius-lg)] text-text-secondary transition-all"
            onClick={goPrev}
          >
            返回
          </button>
        )}
        {currentStep === 1 && (
          <button
            className="btn-accent px-6 py-2 rounded-[var(--radius-lg)] font-medium"
            onClick={goNext}
          >
            下一步
          </button>
        )}
        {currentStep === 2 && (
          <button
            className="btn-accent px-6 py-2 rounded-[var(--radius-lg)] font-medium"
            disabled={!savedCfg}
            onClick={handleComplete}
          >
            进入工作台
          </button>
        )}
      </footer>
    </div>
  );
}
