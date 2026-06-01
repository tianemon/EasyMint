import { useState, useCallback, type DragEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";

// ---- Types ----

interface Feature {
  id: string;
  name: string;
  priority: "P0" | "P1" | "P2";
}

interface SetupFormData {
  projectName: string;
  targetUsers: string;
  platforms: string[];
  completeness: "full" | "mvp" | "demo";
  techStack: string;
  costSensitivity: "low" | "medium" | "high";
  featureOverview: string;
  features: Feature[];
  uiStyle: "ios-glass" | "neumorphism" | "material" | "minimal" | "glassmorphism";
}

const PLATFORM_OPTIONS = [
  { value: "web", label: "Web" },
  { value: "mobile", label: "移动" },
  { value: "desktop", label: "桌面" },
  { value: "cli", label: "CLI" },
] as const;

const COMPLETENESS_OPTIONS = [
  { value: "full", label: "完整", desc: "所有功能全部实现" },
  { value: "mvp", label: "MVP", desc: "最简可用产品" },
  { value: "demo", label: "Demo", desc: "概念演示原型" },
] as const;

const COST_OPTIONS = [
  { value: "low", label: "低", desc: "优先免费/开源方案" },
  { value: "medium", label: "中", desc: "可接受适量付费服务" },
  { value: "high", label: "高", desc: "优先效果，成本次之" },
] as const;

const STEPS = [
  { number: 1, title: "项目概述", description: "做什么、给谁用、什么平台" },
  { number: 2, title: "技术偏好", description: "技术栈、成本、功能清单" },
  { number: 3, title: "功能清单", description: "逐项确认功能优先级" },
  { number: 4, title: "UI 风格", description: "选择设计风格" },
];

const UI_STYLES = [
  { value: "ios-glass", label: "iOS 液态玻璃", desc: "半透明毛玻璃层叠效果，柔和光影", preview: "bg-gradient-to-br from-blue-400/40 via-white/20 to-purple-400/30 backdrop-blur" },
  { value: "neumorphism", label: "新拟物", desc: "柔和凸起/凹陷，同色系光影", preview: "bg-[#e0e5ec] shadow-[8px_8px_16px_#c8ccd4,-8px_-8px_16px_#f8fcff]" },
  { value: "material", label: "Material", desc: "卡片+阴影+鲜明配色，Google 设计语言", preview: "bg-white shadow-lg border-t-4 border-blue-500" },
  { value: "minimal", label: "黑白极简", desc: "大面积留白，清晰排版，无冗余装饰", preview: "bg-white border border-gray-200" },
  { value: "glassmorphism", label: "毛玻璃", desc: "背景模糊+半透明+鲜艳边框", preview: "bg-white/10 backdrop-blur-md border border-white/20" },
] as const;

const DEFAULT_DATA: SetupFormData = {
  projectName: "",
  targetUsers: "",
  platforms: [],
  completeness: "mvp",
  techStack: "",
  costSensitivity: "medium",
  featureOverview: "",
  features: [],
  uiStyle: "minimal",
};

// ---- Helper: generate requirements.md content ----

function generateRequirements(data: SetupFormData): string {
  const platformLabels: Record<string, string> = { web: "Web", mobile: "移动", desktop: "桌面", cli: "CLI" };
  const completenessLabels: Record<string, string> = { full: "完整实现", mvp: "MVP（最简可用）", demo: "Demo（概念演示）" };
  const costLabels: Record<string, string> = { low: "低", medium: "中", high: "高" };
  const uiLabels: Record<string, string> = {
    "ios-glass": "iOS 液态玻璃",
    neumorphism: "新拟物",
    material: "Material",
    minimal: "黑白极简",
    glassmorphism: "毛玻璃",
  };
  const p0 = data.features.filter((f) => f.priority === "P0");
  const p1 = data.features.filter((f) => f.priority === "P1");
  const p2 = data.features.filter((f) => f.priority === "P2");

  return `# 需求规格 — ${data.projectName}

## 项目概述

- **项目名称**: ${data.projectName}
- **目标用户**: ${data.targetUsers}
- **目标平台**: ${data.platforms.map((p) => platformLabels[p] ?? p).join("、")}
- **完成度期望**: ${completenessLabels[data.completeness] ?? data.completeness}

## 技术偏好

- **技术栈偏好**: ${data.techStack || "无特殊偏好"}
- **成本敏感度**: ${costLabels[data.costSensitivity] ?? data.costSensitivity}

## 功能概述

${data.featureOverview || "（未填写）"}

## 功能清单

### P0 — 核心功能（必须实现）
${p0.length > 0 ? p0.map((f) => `- ${f.name}`).join("\n") : "（无）"}

### P1 — 重要功能（尽量实现）
${p1.length > 0 ? p1.map((f) => `- ${f.name}`).join("\n") : "（无）"}

### P2 — 可选功能（有余力则实现）
${p2.length > 0 ? p2.map((f) => `- ${f.name}`).join("\n") : "（无）"}

## UI 风格

- **选择**: ${uiLabels[data.uiStyle] ?? data.uiStyle}
`;
}

// ---- Sub-components ----

function StepIndicator({ currentStep, onStepClick }: { currentStep: number; onStepClick: (i: number) => void }): JSX.Element {
  return (
    <aside className="w-56 border-r border-border p-6 flex flex-col gap-2 bg-surface-alt">
      <h2 className="text-lg font-semibold mb-4">需求采集</h2>
      {STEPS.map((step, i) => (
        <button
          key={step.number}
          className={`p-3 rounded-lg transition-colors text-left ${
            i === currentStep
              ? "bg-accent/20 text-accent border border-accent/30"
              : i < currentStep
                ? "text-success hover:bg-surface-hover"
                : "text-text-secondary hover:bg-surface-hover"
          }`}
          onClick={() => onStepClick(i)}
        >
          <div className="text-sm font-medium">Step {step.number}/4</div>
          <div className="text-sm">{step.title}</div>
        </button>
      ))}
    </aside>
  );
}

function Step1Form({ data, onChange }: { data: SetupFormData; onChange: (patch: Partial<SetupFormData>) => void }): JSX.Element {
  const togglePlatform = (val: string) => {
    const next = data.platforms.includes(val)
      ? data.platforms.filter((p) => p !== val)
      : [...data.platforms, val];
    onChange({ platforms: next });
  };

  return (
    <div className="space-y-6">
      <FormField label="项目名称" required>
        <input
          className="input"
          value={data.projectName}
          onChange={(e) => onChange({ projectName: e.target.value })}
          placeholder="例如：个人记账软件"
        />
      </FormField>

      <FormField label="目标用户" required>
        <input
          className="input"
          value={data.targetUsers}
          onChange={(e) => onChange({ targetUsers: e.target.value })}
          placeholder="例如：非技术用户、中小企业主"
        />
      </FormField>

      <FormField label="目标平台">
        <div className="flex gap-2 flex-wrap">
          {PLATFORM_OPTIONS.map((opt) => {
            const active = data.platforms.includes(opt.value);
            return (
              <button
                key={opt.value}
                className={`px-4 py-2 rounded-lg border transition-colors text-sm ${
                  active
                    ? "bg-accent/20 border-accent text-accent"
                    : "border-border text-text-secondary hover:border-accent/50"
                }`}
                onClick={() => togglePlatform(opt.value)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </FormField>

      <FormField label="完成度期望">
        <div className="flex gap-2">
          {COMPLETENESS_OPTIONS.map((opt) => {
            const active = data.completeness === opt.value;
            return (
              <button
                key={opt.value}
                className={`flex-1 p-4 rounded-lg border transition-colors text-left ${
                  active
                    ? "bg-accent/20 border-accent"
                    : "border-border hover:border-accent/50"
                }`}
                onClick={() => onChange({ completeness: opt.value as SetupFormData["completeness"] })}
              >
                <div className={`text-sm font-medium ${active ? "text-accent" : "text-text-primary"}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-text-secondary mt-1">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </FormField>
    </div>
  );
}

function Step2Form({ data, onChange }: { data: SetupFormData; onChange: (patch: Partial<SetupFormData>) => void }): JSX.Element {
  return (
    <div className="space-y-6">
      <FormField label="技术栈偏好" hint="可选，留空则由 AI 自动选择">
        <input
          className="input"
          value={data.techStack}
          onChange={(e) => onChange({ techStack: e.target.value })}
          placeholder="例如：React + Node.js + SQLite"
        />
      </FormField>

      <FormField label="成本敏感度">
        <div className="flex gap-2">
          {COST_OPTIONS.map((opt) => {
            const active = data.costSensitivity === opt.value;
            return (
              <button
                key={opt.value}
                className={`flex-1 p-4 rounded-lg border transition-colors text-left ${
                  active
                    ? "bg-accent/20 border-accent"
                    : "border-border hover:border-accent/50"
                }`}
                onClick={() => onChange({ costSensitivity: opt.value as SetupFormData["costSensitivity"] })}
              >
                <div className={`text-sm font-medium ${active ? "text-accent" : "text-text-primary"}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-text-secondary mt-1">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </FormField>

      <FormField label="功能概述">
        <textarea
          className="input min-h-[120px] resize-y"
          value={data.featureOverview}
          onChange={(e) => onChange({ featureOverview: e.target.value })}
          placeholder="简要描述项目需要实现的核心功能，例如：&#10;- 用户注册与登录&#10;- 收支记录与分类&#10;- 月度统计报表"
        />
      </FormField>
    </div>
  );
}

function Step3Form({ data, onChange }: { data: SetupFormData; onChange: (patch: Partial<SetupFormData>) => void }): JSX.Element {
  const [newFeature, setNewFeature] = useState("");

  const addFeature = () => {
    const name = newFeature.trim();
    if (!name) return;
    onChange({
      features: [...data.features, { id: `feat-${Date.now()}`, name, priority: "P2" }],
    });
    setNewFeature("");
  };

  const removeFeature = (id: string) => {
    onChange({ features: data.features.filter((f) => f.id !== id) });
  };

  const setPriority = (id: string, priority: "P0" | "P1" | "P2") => {
    onChange({
      features: data.features.map((f) => (f.id === id ? { ...f, priority } : f)),
    });
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, priority: "P0" | "P1" | "P2") => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (id) setPriority(id, priority);
  };

  const renderColumn = (priority: "P0" | "P1" | "P2", label: string, colorClass: string) => {
    const items = data.features.filter((f) => f.priority === priority);
    return (
      <div
        className={`flex-1 rounded-lg border border-border p-3 min-h-[200px] transition-colors ${
          items.length > 0 ? "" : "border-dashed"
        }`}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, priority)}
      >
        <div className={`text-xs font-semibold mb-2 ${colorClass}`}>
          {label} <span className="text-text-secondary font-normal">({items.length})</span>
        </div>
        <div className="space-y-1.5">
          {items.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded bg-surface-hover text-sm group cursor-grab active:cursor-grabbing"
              draggable
              onDragStart={(e) => handleDragStart(e, f.id)}
            >
              <span className="text-text-secondary text-xs shrink-0">⠿</span>
              <span className="flex-1 truncate">{f.name}</span>
              <button
                className="shrink-0 text-text-secondary hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1"
                onClick={() => removeFeature(f.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          className="input flex-1"
          value={newFeature}
          onChange={(e) => setNewFeature(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addFeature()}
          placeholder="输入功能名称，按 Enter 添加"
        />
        <button
          className="px-4 py-2 rounded-lg bg-accent text-surface hover:bg-accent-hover transition-colors text-sm"
          onClick={addFeature}
          disabled={!newFeature.trim()}
        >
          添加
        </button>
      </div>

      <div className="flex gap-3">
        {renderColumn("P0", "P0 核心", "text-danger")}
        {renderColumn("P1", "P1 重要", "text-yellow-400")}
        {renderColumn("P2", "P2 可选", "text-text-secondary")}
      </div>

      <p className="text-xs text-text-secondary">
        拖拽功能卡片到对应优先级列，或点击列头切换
      </p>
    </div>
  );
}

function Step4Form({ data, onChange }: { data: SetupFormData; onChange: (patch: Partial<SetupFormData>) => void }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3">
      {UI_STYLES.map((style) => {
        const active = data.uiStyle === style.value;
        return (
          <button
            key={style.value}
            className={`p-4 rounded-xl border transition-colors text-left ${
              active
                ? "border-accent bg-accent/10 ring-1 ring-accent/30"
                : "border-border hover:border-accent/50 bg-surface-alt"
            }`}
            onClick={() => onChange({ uiStyle: style.value as SetupFormData["uiStyle"] })}
          >
            <div className={`h-16 rounded-lg mb-3 ${style.preview}`} />
            <div className={`text-sm font-medium ${active ? "text-accent" : "text-text-primary"}`}>
              {style.label}
            </div>
            <div className="text-xs text-text-secondary mt-1">{style.desc}</div>
          </button>
        );
      })}
    </div>
  );
}

function FormField({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <label className="block text-sm font-medium text-text-primary mb-2">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-text-secondary mt-1">{hint}</p>}
    </div>
  );
}

// ---- Main Page ----

export function SetupPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<SetupFormData>(DEFAULT_DATA);

  const updateData = useCallback(
    (patch: Partial<SetupFormData>) => setData((prev) => ({ ...prev, ...patch })),
    [],
  );

  const handleSubmit = async () => {
    if (!projectId) return;
    const project = await window.electronAPI.project.get(projectId);
    if (!project) return;
    const filePath = `${project.path}/docs/requirements.md`;
    const content = generateRequirements(data);
    await window.electronAPI.file.writeContent(filePath, content);
    navigate(`/project/${projectId}`);
  };

  const goNext = () => setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goPrev = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <Step1Form data={data} onChange={updateData} />;
      case 1:
        return <Step2Form data={data} onChange={updateData} />;
      case 2:
        return <Step3Form data={data} onChange={updateData} />;
      case 3:
        return <Step4Form data={data} onChange={updateData} />;
      default:
        return null;
    }
  };

  const isLastStep = currentStep === STEPS.length - 1;

  return (
    <div className="flex h-screen">
      <StepIndicator currentStep={currentStep} onStepClick={setCurrentStep} />

      <main className="flex-1 flex flex-col">
        <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-2xl mx-auto">
            <h1 className="text-xl font-semibold mb-2">{STEPS[currentStep]!.title}</h1>
            <p className="text-text-secondary mb-8">{STEPS[currentStep]!.description}</p>

            {renderStep()}
          </div>
        </div>

        <footer className="border-t border-border p-4 flex justify-between bg-surface-alt">
          <button
            className="px-4 py-2 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-30"
            disabled={currentStep === 0}
            onClick={goPrev}
          >
            上一步
          </button>
          {!isLastStep ? (
            <button
              className="px-6 py-2 rounded-lg bg-accent text-surface hover:bg-accent-hover transition-colors font-medium"
              onClick={goNext}
            >
              下一步
            </button>
          ) : (
            <button
              className="px-6 py-2 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors font-medium disabled:opacity-50"
              onClick={handleSubmit}
              disabled={!projectId}
            >
              提交
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}
