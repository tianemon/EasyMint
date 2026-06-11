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

  // 记录本次已保存的供应商 ID，避免重复保存
  const [savedCfg, setSavedCfg] = useState<ProviderConfig | null>(null);

  const handleProviderSave = (cfg: ProviderConfig) => {
    // 复用已保存的 ID，避免重复创建
    const id = savedCfg?.id || cfg.id;
    const finalCfg = { ...cfg, id };
    const configs = { ...(apiProviders?.configs ?? {}), [id]: finalCfg };
    const nextData: ApiProvidersData = {
      current: id,
      configs,
    };
    setApiProviders(nextData);
    setSavedCfg(finalCfg);
  };

  const handleComplete = () => {
    localStorage.setItem("easymint_setup_complete", "true");
    window.electronAPI?.settings?.set?.("setupComplete", true);
    window.dispatchEvent(new Event("easymint-setup-complete"));
    navigate("/");
  };

  const goNext = () => setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goPrev = () => setCurrentStep((s) => Math.max(s - 1, 0));

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
            <img src="/icon.png" className="w-24 h-24 mb-6" />

            <h1 className="text-2xl font-bold text-text-primary mb-2">EasyMint</h1>
            <p className="text-sm text-text-secondary mb-1">
              AI 驱动开发，简单的操作让想法变为现实
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
                  内置 Anthropic、DeepSeek、MiMo、MiniMax 等平台
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
            {savedCfg ? (
              <div className="bg-surface-alt rounded-lg p-4 space-y-4">
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-accent/10 border border-accent/30">
                  <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-primary font-medium truncate">{savedCfg.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent shrink-0">使用中</span>
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5">
                      {savedCfg.baseUrl || "API 地址已设置"} · 模型 {savedCfg.models.length} 个
                    </div>
                  </div>
                </div>
                <button
                  className="w-full px-4 py-2 rounded-lg border border-border text-text-secondary text-xs hover:border-accent/50 transition-colors"
                  onClick={() => setSavedCfg(null)}
                >重新配置</button>
              </div>
            ) : (
              <ProviderForm onSave={handleProviderSave} />
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-border p-4 flex justify-between bg-surface-alt shrink-0">
        {currentStep === 0 ? (
          <button
            className="px-6 py-2 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors font-medium ml-auto"
            onClick={goNext}
          >
            开始设置
          </button>
        ) : (
          <button
            className="px-4 py-2 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors"
            onClick={goPrev}
          >
            返回
          </button>
        )}
        {currentStep !== 0 && (
          <button
            className="px-6 py-2 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors font-medium disabled:opacity-40"
            disabled={!savedCfg}
            onClick={handleComplete}
            title={!savedCfg ? "请先保存一个供应商配置" : undefined}
          >
            进入工作台
          </button>
        )}
      </footer>
    </div>
  );
}
