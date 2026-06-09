import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSettingsStore } from "../stores/settings-store";
import { ProviderForm } from "../components/settings/ProviderSettings";
import type { ProviderConfig, ApiProvidersData } from "@shared/platform-presets";

const STEPS = [
  { number: 1, title: "欢迎使用 EasyMint" },
  { number: 2, title: "选择 AI 供应商" },
];

export function OnboardingPage(): JSX.Element {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const { apiProviders, setApiProviders } = useSettingsStore();

  const handleProviderSave = (cfg: ProviderConfig) => {
    const configs = { ...(apiProviders?.configs ?? {}), [cfg.id]: cfg };
    const nextData: ApiProvidersData = {
      current: cfg.id,
      configs,
    };
    setApiProviders(nextData);
  };

  const handleComplete = () => {
    localStorage.setItem("easymint_setup_complete", "true");
    window.electronAPI?.settings?.set?.("setupComplete", true);
    window.dispatchEvent(new Event("easymint-setup-complete"));
    navigate("/");
  };

  const goNext = () => setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goPrev = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const hasProvider = apiProviders?.current && apiProviders?.configs?.[apiProviders.current];

  return (
    <div className="flex flex-col h-full">
      {/* Step indicator */}
      <div className="flex justify-center gap-3 pt-12 pb-2">
        {STEPS.map((step, i) => (
          <div key={step.number} className="flex items-center gap-3">
            <div
              className={`w-2 h-2 rounded-full transition-colors ${
                i < currentStep
                  ? "bg-accent"
                  : i === currentStep
                    ? "bg-accent ring-2 ring-accent/30"
                    : "bg-border"
              }`}
            />
            {i < STEPS.length - 1 && (
              <div
                className={`w-8 h-[2px] transition-colors ${
                  i < currentStep ? "bg-accent" : "bg-border"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pb-8">
        {currentStep === 0 ? (
          /* ── Step 1: Welcome ── */
          <div className="w-full max-w-[480px] flex flex-col items-center text-center">
            {/* Logo */}
            <div className="w-24 h-24 rounded-2xl bg-accent/10 flex items-center justify-center mb-6">
              <svg
                viewBox="0 0 64 64"
                fill="none"
                className="w-14 h-14 text-accent"
              >
                <path
                  d="M32 4C32 4 12 20 12 36c0 8 6 14 14 14 4 0 6-2 6-6V28c0-2 2-4 4-4s4 2 4 4v16c0 4 2 6 6 6 8 0 14-6 14-14C60 20 32 4 32 4Z"
                  fill="currentColor"
                  opacity="0.9"
                />
                <path
                  d="M32 8s14 12 14 24c0 4-2 8-6 8s-6-3-6-6V22c0-2-2-4-4-4s-4 2-4 4v12c0 3-2 6-6 6s-6-4-6-8c0-12 14-24 14-24Z"
                  fill="currentColor"
                />
              </svg>
            </div>

            <h1 className="text-2xl font-bold text-text-primary mb-2">EasyMint</h1>
            <p className="text-sm text-text-secondary mb-1">
              AI 驱动开发，让不懂技术的人也能创建软件
            </p>
            <p className="text-xs text-text-muted mb-8 leading-relaxed">
              填写项目需求，Mint 自动拆解任务、选择技术栈、调度 Builder 编码、
              Evaluator 验收，你只需要对话。
            </p>

            <div className="flex flex-col gap-3 w-full">
              <div className="px-4 py-3 rounded-lg bg-surface-alt text-left">
                <p className="text-sm font-medium text-text-primary">AI 项目管理</p>
                <p className="text-xs text-text-muted mt-0.5">
                  Mint 自动分析需求、拆分任务、跟进进度
                </p>
              </div>
              <div className="px-4 py-3 rounded-lg bg-surface-alt text-left">
                <p className="text-sm font-medium text-text-primary">自动开发执行</p>
                <p className="text-xs text-text-muted mt-0.5">
                  Builder 编码 → Evaluator 验收，全自动循环
                </p>
              </div>
              <div className="px-4 py-3 rounded-lg bg-surface-alt text-left">
                <p className="text-sm font-medium text-text-primary">多平台支持</p>
                <p className="text-xs text-text-muted mt-0.5">
                  内置 Anthropic、DeepSeek、Kimi、MiniMax 等 8 个平台
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* ── Step 2: Provider Setup ── */
          <div className="w-full max-w-[540px]">
            <h1 className="text-xl font-semibold text-center mb-1">
              选择 AI 供应商
            </h1>
            <p className="text-text-secondary text-center text-sm mb-6">
              选择一个平台并填写 API Key 即可开始使用
            </p>
            <ProviderForm onSave={handleProviderSave} />
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-border p-4 flex justify-between bg-surface-alt shrink-0">
        {currentStep === 0 ? (
          <>
            <div />
            <button
              className="px-6 py-2 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors font-medium"
              onClick={goNext}
            >
              开始设置
            </button>
          </>
        ) : (
          <>
            <button
              className="px-4 py-2 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors"
              onClick={goPrev}
            >
              返回
            </button>
            <button
              className="px-6 py-2 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors font-medium disabled:opacity-40"
              disabled={!hasProvider}
              onClick={handleComplete}
              title={!hasProvider ? "请先保存一个供应商配置" : undefined}
            >
              进入工作台
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
