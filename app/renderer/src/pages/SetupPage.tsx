import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

const STEPS = [
  { number: 1, title: "项目概述", description: "做什么、给谁用、什么平台" },
  { number: 2, title: "技术偏好", description: "技术栈、成本、功能清单" },
  { number: 3, title: "功能清单", description: "逐项确认功能优先级" },
  { number: 4, title: "UI 风格", description: "选择设计风格" },
];

export function SetupPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);

  const handleSubmit = () => {
    navigate(`/project/${projectId}`);
  };

  return (
    <div className="flex h-screen">
      {/* Step indicator sidebar */}
      <aside className="w-56 border-r border-border p-6 flex flex-col gap-2 bg-surface-alt">
        <h2 className="text-lg font-semibold mb-4">需求采集</h2>
        {STEPS.map((step, i) => (
          <div
            key={step.number}
            className={`p-3 rounded-lg transition-colors ${
              i === currentStep
                ? "bg-accent/20 text-accent border border-accent/30"
                : i < currentStep
                  ? "text-green-400"
                  : "text-text-secondary"
            }`}
          >
            <div className="text-sm font-medium">Step {step.number}/4</div>
            <div className="text-sm">{step.title}</div>
          </div>
        ))}
      </aside>

      {/* Form area */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1 p-8">
          <div className="max-w-2xl mx-auto">
            <h1 className="text-xl font-semibold mb-2">{STEPS[currentStep]!.title}</h1>
            <p className="text-text-secondary mb-8">{STEPS[currentStep]!.description}</p>

            {/* Step content — will be fully implemented by automation tasks */}
            <div className="p-8 rounded-lg border border-border bg-surface-alt text-center text-text-secondary">
              Step {currentStep + 1} 表单内容 — 由自动化任务实现
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <footer className="border-t border-border p-4 flex justify-between bg-surface-alt">
          <button
            className="px-4 py-2 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-30"
            disabled={currentStep === 0}
            onClick={() => setCurrentStep((s) => s - 1)}
          >
            上一步
          </button>
          {currentStep < STEPS.length - 1 ? (
            <button
              className="px-6 py-2 rounded-lg bg-accent text-surface hover:bg-accent-hover transition-colors"
              onClick={() => setCurrentStep((s) => s + 1)}
            >
              下一步
            </button>
          ) : (
            <button
              className="px-6 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
              onClick={handleSubmit}
            >
              提交
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}
