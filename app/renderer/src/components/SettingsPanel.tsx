import { useEffect } from "react";
import { useSettingsStore } from "../stores/settings-store";

export function SettingsPanel(): JSX.Element {
  const {
    theme,
    evaluateMode,
    claudePath,
    claudeVersion,
    toggleTheme,
    setEvaluateMode,
    loadFromElectron,
  } = useSettingsStore();

  useEffect(() => {
    loadFromElectron();
  }, [loadFromElectron]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto p-6 space-y-8">
        <h2 className="text-lg font-semibold text-text-primary">设置</h2>

        {/* 主题切换 */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-text-secondary">外观</h3>
          <div className="flex items-center justify-between bg-surface-alt rounded-lg px-4 py-3">
            <div>
              <p className="text-sm text-text-primary">主题</p>
              <p className="text-xs text-text-secondary mt-0.5">
                当前: {theme === "dark" ? "暗色" : "亮色"}
              </p>
            </div>
            <button
              onClick={toggleTheme}
              className="px-4 py-2 rounded-lg border border-border text-sm text-text-primary hover:bg-surface-hover transition-colors"
            >
              {theme === "dark" ? "☀ 切换亮色" : "🌙 切换暗色"}
            </button>
          </div>
        </section>

        {/* 评估模式 */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-text-secondary">评估</h3>
          <div className="bg-surface-alt rounded-lg px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-primary">评估模式</p>
                <p className="text-xs text-text-secondary mt-0.5">
                  开启后每轮 worker 完成自动触发 evaluator 验证
                </p>
              </div>
              <button
                onClick={() => setEvaluateMode(!evaluateMode)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  evaluateMode ? "bg-accent" : "bg-surface-hover border border-border"
                }`}
                role="switch"
                aria-checked={evaluateMode}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    evaluateMode ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">
              评估模式使用 Playwright 自动化测试工具验证前端改动的正确性。评估结果会显示在流式输出面板中，FAIL 项需优先修复。
            </p>
          </div>
        </section>

        {/* Claude CLI 检测 */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-text-secondary">Claude CLI</h3>
          <div className="bg-surface-alt rounded-lg px-4 py-3">
            {claudePath ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-accent" />
                  <span className="text-sm text-text-primary">已检测到</span>
                </div>
                <p className="text-xs text-text-secondary pl-4">
                  路径: {claudePath}
                </p>
                <p className="text-xs text-text-secondary pl-4">
                  版本: {claudeVersion}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-yellow-500" />
                <span className="text-sm text-text-secondary">
                  未检测到 Claude CLI
                </span>
              </div>
            )}
            <p className="text-xs text-text-secondary mt-2">
              Claude CLI 用于 AI 自动化开发的执行引擎。请确保 claude 在 PATH 中可用。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
