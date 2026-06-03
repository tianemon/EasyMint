import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSettingsStore } from "../stores/settings-store";

const STEPS = [
  { number: 1, title: "配置 API", description: "设置 API 地址和密钥" },
  { number: 2, title: "获取模型", description: "拉取可用模型列表" },
  { number: 3, title: "准备就绪", description: "EasyMint 已配置完成" },
];

export function OnboardingPage(): JSX.Element {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com/anthropic");
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const storeSetApiBaseUrl = useSettingsStore((s) => s.setApiBaseUrl);
  const storeSetApiKey = useSettingsStore((s) => s.setApiKey);
  const storeSetAvailableModels = useSettingsStore((s) => s.setAvailableModels);

  useEffect(() => {
    const saved = localStorage.getItem("easymint_api_base_url");
    if (saved) setBaseUrl(saved);
  }, []);

  const handleFetchModels = async () => {
    setFetching(true);
    setFetchError(null);
    try {
      if (!key.trim()) { setFetchError("请先填写 API Key"); setFetching(false); return; }
      storeSetApiBaseUrl(baseUrl);
      storeSetApiKey(key);
      localStorage.setItem("easymint_api_base_url", baseUrl);
      const list = await window.electronAPI.settings.fetchModels();
      setModels(list);
      storeSetAvailableModels(list);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : "获取失败");
    } finally {
      setFetching(false);
    }
  };

  const handleComplete = () => {
    storeSetApiBaseUrl(baseUrl);
    storeSetApiKey(key);
    localStorage.setItem("easymint_setup_complete", "true");
    // Persist to main process so createWindow can skip Onboarding on restart
    window.electronAPI?.settings?.set?.("setupComplete", true);
    localStorage.removeItem("easymint_api_base_url");
    window.dispatchEvent(new Event("easymint-setup-complete"));
    navigate("/");
  };

  const goNext = () => setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goPrev = () => setCurrentStep((s) => Math.max(s - 1, 0));
  const isLastStep = currentStep === STEPS.length - 1;

  return (
    <div className="flex flex-col h-full">
      {/* Step indicator */}
      <div className="flex justify-center gap-3 pt-12 pb-2">
        {STEPS.map((step, i) => (
          <div key={step.number} className="flex items-center gap-3">
            <div
              className={`w-2 h-2 rounded-full transition-colors ${
                i < currentStep ? "bg-accent"
                  : i === currentStep ? "bg-accent ring-2 ring-accent/30"
                  : "bg-border"
              }`}
            />
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-[2px] transition-colors ${i < currentStep ? "bg-accent" : "bg-border"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pb-8">
        <div className="w-full max-w-[480px]">
          <h1 className="text-xl font-semibold text-center mb-1">{STEPS[currentStep]!.title}</h1>
          <p className="text-text-secondary text-center text-sm mb-8">{STEPS[currentStep]!.description}</p>

          {currentStep === 0 && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-text-secondary block mb-1">API Base URL</label>
                <input
                  className="w-full px-3 py-2.5 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.deepseek.com/anthropic"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary block mb-1">API Key</label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-3 py-2.5 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent font-mono"
                    type={showKey ? "text" : "password"}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="sk-..."
                  />
                  <button
                    className="px-3 py-2 rounded-lg border border-border text-text-secondary hover:text-text-primary text-xs"
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? "隐藏" : "显示"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border p-6 flex flex-col items-center gap-4">
                {models.length > 0 ? (
                  <>
                    <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                      <span className="text-accent text-lg">✓</span>
                    </div>
                    <p className="text-sm text-text-primary">已获取 {models.length} 个模型</p>
                    <div className="w-full max-h-40 overflow-y-auto bg-surface-alt rounded-lg p-3">
                      {models.map((m) => (
                        <div key={m} className="text-xs text-text-secondary font-mono py-0.5">{m}</div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                      <span className="text-2xl">📡</span>
                    </div>
                    <p className="text-sm text-text-secondary text-center">
                      点击下方按钮从 API 获取可用模型列表
                    </p>
                    <button
                      className="px-6 py-2.5 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors font-medium disabled:opacity-40"
                      disabled={fetching}
                      onClick={handleFetchModels}
                    >
                      {fetching ? "获取中..." : "获取模型列表"}
                    </button>
                    {fetchError && (
                      <p className="text-xs text-danger text-center">{fetchError}</p>
                    )}
                    <button
                      className="text-xs text-text-secondary hover:text-accent underline transition-colors"
                      onClick={() => { setModels(["跳过"]); }}
                    >
                      跳过，稍后设置
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="flex flex-col items-center gap-6 py-8">
              <div className="w-20 h-20 rounded-full bg-accent flex items-center justify-center">
                <span className="text-3xl text-text-inverse">✓</span>
              </div>
              <div className="text-center">
                <h2 className="text-xl font-semibold mb-2">EasyMint 已准备就绪</h2>
                <p className="text-sm text-text-secondary">
                  API 已配置{models.length > 0 ? `，${models.length} 个模型可用` : ""}。现在可以开始创建项目了
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border p-4 flex justify-between bg-surface-alt shrink-0">
        {!isLastStep ? (
          <>
            <button
              className="px-4 py-2 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-30"
              disabled={currentStep === 0}
              onClick={goPrev}
            >
              返回
            </button>
            <button
              className="px-6 py-2 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors font-medium disabled:opacity-40"
              disabled={currentStep === 0 && !key.trim()}
              onClick={goNext}
            >
              下一步
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
              className="px-6 py-2 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors font-medium"
              onClick={handleComplete}
            >
              进入工作台
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
