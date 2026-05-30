import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { PromptSettings } from "./settings/PromptSettings";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface ToggleRowProps {
  label: string;
  description: string;
  hint: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, description, hint, enabled, onChange }: ToggleRowProps): JSX.Element {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 mr-4">
        <p className="text-sm text-text-primary">{label}</p>
        <p className="text-xs text-text-secondary mt-0.5">{description}</p>
        <p className="text-[11px] text-text-secondary mt-0.5 opacity-70">{hint}</p>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
          enabled ? "bg-accent" : "bg-surface-hover border border-border"
        }`}
        role="switch"
        aria-checked={enabled}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function StarRating({ count }: { count: number }): JSX.Element {
  return (
    <span className="text-amber-500 text-xs">
      {"⭐".repeat(count)}
    </span>
  );
}

const TOKEN_ROWS = [
  { label: "普通开发", stars: 1, desc: "仅 Worker agent 消耗" },
  { label: "评估模式", stars: 2, desc: "Worker + Evaluator（Playwright 自动化）" },
  { label: "TDD 模式", stars: 2, desc: "测试先行，每轮额外生成测试代码" },
  { label: "截图验证", stars: 3, desc: "image-vision 每次截图分析，Token 消耗高" },
  { label: "全开（评估+TDD+截图）", stars: 4, desc: "所有验证机制全部开启，消耗最高" },
];

export function SettingsDialog({ open, onClose }: SettingsDialogProps): JSX.Element | null {
  const {
    evaluateMode,
    tddMode,
    screenshotVerification,
    apiBaseUrl,
    apiKey,
    setEvaluateMode,
    setTddMode,
    setScreenshotVerification,
    setApiBaseUrl,
    setApiKey,
    loadFromElectron,
  } = useSettingsStore();
  const [showKey, setShowKey] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "prompts">("general");

  useEffect(() => {
    if (open) {
      loadFromElectron();
    }
  }, [open, loadFromElectron]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 modal-overlay">
      <div className="bg-white rounded-xl border border-border shadow-2xl modal-card" style={{ width: activeTab === "prompts" ? 620 : 520 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-0 border-b border-border">
          <div className="flex gap-0">
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "general" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("general")}
            >
              通用
            </button>
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "prompts" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("prompts")}
            >
              提示词
            </button>
          </div>
          <button
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 max-h-[520px] overflow-y-auto">
          {activeTab === "general" ? (
            <div className="space-y-5">
              {/* 外观 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">外观</h3>
                <div className="bg-surface-alt rounded-lg px-4 py-3">
                  <p className="text-sm text-text-primary">主题</p>
                  <p className="text-xs text-text-secondary mt-0.5">亮色 Mint（仅亮色）</p>
                </div>
              </section>

              {/* API 设置 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">API 配置</h3>
                <div className="bg-surface-alt rounded-lg px-4 py-3 space-y-3">
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">Base URL</label>
                    <input
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
                      placeholder="https://api.deepseek.com/anthropic"
                      value={apiBaseUrl}
                      onChange={(e) => setApiBaseUrl(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">API Key</label>
                    <div className="relative">
                      <input
                        type={showKey ? "text" : "password"}
                        className="w-full px-3 py-2 pr-8 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
                        placeholder="sk-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        ) : (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              {/* 开发选项 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">开发选项</h3>
                <div className="bg-surface-alt rounded-lg px-4 divide-y divide-border">
                  <ToggleRow label="评估模式" description="每轮 Worker 完成后自动触发 Evaluator 验证" hint="启用 Playwright 自动化测试，验证前端改动正确性" enabled={evaluateMode} onChange={setEvaluateMode} />
                  <ToggleRow label="TDD 模式" description="先编写测试代码，再实现功能" hint="每次实现前先生成测试用例，以测试驱动开发流程" enabled={tddMode} onChange={setTddMode} />
                  <ToggleRow label="截图验证" description="使用 image-vision 对每次改动进行截图对比" hint="每轮完成后截图并通过视觉模型分析，确保 UI 无回归" enabled={screenshotVerification} onChange={setScreenshotVerification} />
                </div>
              </section>

              {/* Token 消耗对照表 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">预估 Token 消耗</h3>
                <div className="bg-surface-alt rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-4 py-2.5 text-text-secondary font-medium">模式</th>
                        <th className="text-left px-4 py-2.5 text-text-secondary font-medium">说明</th>
                        <th className="text-center px-4 py-2.5 text-text-secondary font-medium">消耗</th>
                      </tr>
                    </thead>
                    <tbody>
                      {TOKEN_ROWS.map((row) => (
                        <tr key={row.label} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5 text-text-primary">{row.label}</td>
                          <td className="px-4 py-2.5 text-text-secondary">{row.desc}</td>
                          <td className="px-4 py-2.5 text-center"><StarRating count={row.stars} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : (
            <PromptSettings />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 pb-5 pt-3 border-t border-border">
          <p className="text-[11px] text-text-secondary opacity-70">
            DeepSeek 视觉桥接（待商议）
          </p>
          <button
            className="px-6 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors font-medium"
            onClick={onClose}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
