import { useState, useRef, useEffect, useCallback } from "react";

// ---- Types ----

type ProjectType = "web" | "mobile" | "cli" | "desktop";
type TechChoice = "react" | "vue" | "html" | "ai";
type StyleChoice = "tailwind" | "css-modules" | "pure-css" | "ai";
type BackendChoice = "node" | "python" | "none" | "ai";
type BudgetChoice = "充足" | "少量" | "免费";
type DeployChoice = "云端" | "本地";

interface ProjectFormData {
  name: string;
  projectType: ProjectType;
  dir: string;
  framework: TechChoice;
  styling: StyleChoice;
  backend: BackendChoice;
  features: string;
  colorScheme: string;
  typography: string;
  techBudget: BudgetChoice;
  deployPlatform: DeployChoice;
}

const PROJECT_TYPES = [
  { value: "web", label: "Web", desc: "网站 / SPA" },
  { value: "mobile", label: "移动", desc: "iOS / Android" },
  { value: "cli", label: "CLI", desc: "命令行工具" },
  { value: "desktop", label: "桌面", desc: "桌面应用" },
] as const;

const FRAMEWORK_OPTIONS = [
  { value: "react", label: "React" },
  { value: "vue", label: "Vue" },
  { value: "html", label: "纯 HTML" },
] as const;

const STYLE_OPTIONS = [
  { value: "tailwind", label: "Tailwind CSS" },
  { value: "css-modules", label: "CSS Modules" },
  { value: "pure-css", label: "纯 CSS" },
] as const;

const BACKEND_OPTIONS = [
  { value: "node", label: "Node.js" },
  { value: "python", label: "Python" },
  { value: "none", label: "不需要" },
] as const;

const COLOR_SCHEMES = [
  { value: "mint", label: "Mint 绿", preview: "bg-gradient-to-r from-emerald-400 to-green-500" },
  { value: "ocean", label: "Ocean 蓝", preview: "bg-gradient-to-r from-blue-400 to-cyan-500" },
  { value: "sunset", label: "Sunset 橙", preview: "bg-gradient-to-r from-orange-400 to-rose-500" },
  { value: "lavender", label: "Lavender 紫", preview: "bg-gradient-to-r from-purple-400 to-violet-500" },
] as const;

const TYPOGRAPHY_OPTIONS = [
  { value: "inter", label: "Modern — Inter" },
  { value: "georgia", label: "Classic — Georgia" },
  { value: "mono", label: "Mono — JetBrains" },
] as const;

const BUDGET_OPTIONS = [
  { value: "充足", label: "充足", desc: "优先效果与体验" },
  { value: "少量", label: "少量", desc: "控制成本，适量付费" },
  { value: "免费", label: "免费", desc: "仅使用免费/开源方案" },
] as const;

const DEPLOY_OPTIONS = [
  { value: "云端", label: "云端部署", desc: "Vercel / Railway / 云服务器" },
  { value: "本地", label: "本地运行", desc: "仅在本机使用" },
] as const;

const ALL_STEPS = [
  { number: 1, title: "项目概述", desc: "名称、类型与目录" },
  { number: 2, title: "技术偏好", desc: "框架、样式与后端" },
  { number: 3, title: "功能清单", desc: "描述核心功能" },
  { number: 4, title: "UI 风格", desc: "色彩与排版" },
  { number: 5, title: "部署方式", desc: "成本与平台" },
];

const AI_FEATURES =
  "用户注册与登录\n文章发布与管理\n分类与标签系统\n全文搜索\nMarkdown 编辑器\n响应式布局\nRSS 订阅\nSEO 元数据管理\n评论系统\n站点地图生成";

const DEFAULT_DATA: ProjectFormData = {
  name: "",
  projectType: "web",
  dir: "",
  framework: "ai",
  styling: "ai",
  backend: "ai",
  features: "",
  colorScheme: "mint",
  typography: "inter",
  techBudget: "少量",
  deployPlatform: "云端",
};

// ---- Helpers ----

function getVisibleSteps(projectType: ProjectType) {
  if (projectType === "cli") {
    return ALL_STEPS.filter((s) => s.number !== 4);
  }
  return ALL_STEPS;
}

function actualStepNumber(visibleSteps: typeof ALL_STEPS, currentIndex: number): number {
  return visibleSteps[currentIndex]?.number ?? 1;
}

// ---- Sub-components ----

function StepDots({
  total,
  current,
}: {
  total: number;
  current: number;
}): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1 rounded-full transition-all duration-250 ${
            i <= current ? "w-6 bg-accent" : "w-2 bg-border"
          }`}
        />
      ))}
    </div>
  );
}

function TechOptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  showAI,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  showAI?: boolean;
}): JSX.Element {
  return (
    <div>
      <label className="block text-sm font-medium text-text-primary mb-2">{label}</label>
      <div className="flex gap-2 flex-wrap">
        {options.map((opt) => (
          <button
            key={opt.value}
            className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
              value === opt.value
                ? "bg-accent/20 border-accent text-accent"
                : "border-border text-text-secondary hover:border-accent/50"
            }`}
            onClick={() => onChange(opt.value as T)}
          >
            {opt.label}
          </button>
        ))}
        {showAI !== false && (
          <button
            className={`px-3 py-1.5 rounded-lg border border-dashed text-sm transition-colors ${
              value === ("ai" as T)
                ? "bg-accent/20 border-accent text-accent"
                : "border-accent/40 text-accent/60 hover:border-accent hover:text-accent"
            }`}
            onClick={() => onChange("ai" as T)}
          >
            AI 推荐
          </button>
        )}
      </div>
    </div>
  );
}

function Step1Form({
  data,
  onChange,
}: {
  data: ProjectFormData;
  onChange: (p: Partial<ProjectFormData>) => void;
}): JSX.Element {
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          项目名称 <span className="text-red-400">*</span>
        </label>
        <input
          className="input"
          value={data.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="例如：个人博客"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">项目类型</label>
        <div className="grid grid-cols-2 gap-2">
          {PROJECT_TYPES.map((opt) => {
            const active = data.projectType === opt.value;
            return (
              <button
                key={opt.value}
                className={`p-3 rounded-lg border transition-colors text-left ${
                  active
                    ? "bg-accent/20 border-accent"
                    : "border-border hover:border-accent/50"
                }`}
                onClick={() => onChange({ projectType: opt.value as ProjectType })}
              >
                <div className={`text-sm font-medium ${active ? "text-accent" : "text-text-primary"}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-text-secondary mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          项目目录 <span className="text-red-400">*</span>
        </label>
        <button
          className="w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-left text-sm hover:bg-surface-hover transition-colors"
          onClick={async () => {
            const selected = await window.electronAPI.dialog.openDirectory();
            if (selected) onChange({ dir: selected });
          }}
        >
          {data.dir || "点击选择目录..."}
        </button>
      </div>
    </div>
  );
}

function Step2Form({
  data,
  onChange,
}: {
  data: ProjectFormData;
  onChange: (p: Partial<ProjectFormData>) => void;
}): JSX.Element {
  return (
    <div className="space-y-5">
      <TechOptionGroup
        label="前端框架"
        options={FRAMEWORK_OPTIONS}
        value={data.framework}
        onChange={(v) => onChange({ framework: v })}
      />

      <TechOptionGroup
        label="样式方案"
        options={STYLE_OPTIONS}
        value={data.styling}
        onChange={(v) => onChange({ styling: v })}
      />

      {data.projectType === "web" && (
        <TechOptionGroup
          label="后端技术"
          options={BACKEND_OPTIONS}
          value={data.backend}
          onChange={(v) => onChange({ backend: v })}
        />
      )}
    </div>
  );
}

function Step3Form({
  data,
  onChange,
}: {
  data: ProjectFormData;
  onChange: (p: Partial<ProjectFormData>) => void;
}): JSX.Element {
  const [isTyping, setIsTyping] = useState(false);
  const typewriterRef = useRef<number | null>(null);

  const startTypewriter = useCallback(() => {
    if (isTyping) return;
    setIsTyping(true);
    let i = 0;
    const base = data.features;
    onChange({ features: base + "\n" });

    typewriterRef.current = window.setInterval(() => {
      if (i < AI_FEATURES.length) {
        onChange({ features: base + "\n" + AI_FEATURES.slice(0, i + 1) });
        i++;
      } else {
        if (typewriterRef.current !== null) {
          clearInterval(typewriterRef.current);
          typewriterRef.current = null;
        }
        setIsTyping(false);
      }
    }, 30);
  }, [isTyping, data.features, onChange]);

  useEffect(() => {
    return () => {
      if (typewriterRef.current !== null) clearInterval(typewriterRef.current);
    };
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-text-primary">
          功能描述
        </label>
        <button
          className={`px-3 py-1 rounded-lg border border-dashed text-xs transition-colors ${
            isTyping
              ? "border-accent/30 text-accent/40 cursor-not-allowed"
              : "border-accent/50 text-accent hover:border-accent hover:bg-accent/10"
          }`}
          onClick={startTypewriter}
          disabled={isTyping}
        >
          ✨ AI 推荐
        </button>
      </div>
      <textarea
        className="input min-h-[160px] resize-y"
        value={data.features}
        onChange={(e) => onChange({ features: e.target.value })}
        placeholder="描述项目需要实现的功能，点击「✨ AI 推荐」获取建议..."
      />
    </div>
  );
}

function Step4Form({
  data,
  onChange,
}: {
  data: ProjectFormData;
  onChange: (p: Partial<ProjectFormData>) => void;
}): JSX.Element {
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">色彩方案</label>
        <div className="grid grid-cols-2 gap-2">
          {COLOR_SCHEMES.map((opt) => {
            const active = data.colorScheme === opt.value;
            return (
              <button
                key={opt.value}
                className={`p-3 rounded-lg border transition-colors text-left flex items-center gap-3 ${
                  active
                    ? "bg-accent/10 border-accent ring-1 ring-accent/30"
                    : "border-border hover:border-accent/50"
                }`}
                onClick={() => onChange({ colorScheme: opt.value })}
              >
                <div className={`w-8 h-8 rounded-full shrink-0 ${opt.preview}`} />
                <span className={`text-sm ${active ? "text-accent font-medium" : "text-text-primary"}`}>
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">排版风格</label>
        <div className="flex gap-2 flex-wrap">
          {TYPOGRAPHY_OPTIONS.map((opt) => {
            const active = data.typography === opt.value;
            return (
              <button
                key={opt.value}
                className={`px-4 py-2.5 rounded-lg border transition-colors text-sm ${
                  active
                    ? "bg-accent/20 border-accent text-accent"
                    : "border-border text-text-secondary hover:border-accent/50"
                }`}
                onClick={() => onChange({ typography: opt.value })}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Step5Form({
  data,
  onChange,
}: {
  data: ProjectFormData;
  onChange: (p: Partial<ProjectFormData>) => void;
}): JSX.Element {
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">技术费用</label>
        <div className="flex gap-2">
          {BUDGET_OPTIONS.map((opt) => {
            const active = data.techBudget === opt.value;
            return (
              <button
                key={opt.value}
                className={`flex-1 p-3 rounded-lg border transition-colors text-left ${
                  active
                    ? "bg-accent/20 border-accent"
                    : "border-border hover:border-accent/50"
                }`}
                onClick={() => onChange({ techBudget: opt.value as BudgetChoice })}
              >
                <div className={`text-sm font-medium ${active ? "text-accent" : "text-text-primary"}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-text-secondary mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">部署平台</label>
        <div className="flex gap-2">
          {DEPLOY_OPTIONS.map((opt) => {
            const active = data.deployPlatform === opt.value;
            return (
              <button
                key={opt.value}
                className={`flex-1 p-3 rounded-lg border transition-colors text-left ${
                  active
                    ? "bg-accent/20 border-accent"
                    : "border-border hover:border-accent/50"
                }`}
                onClick={() => onChange({ deployPlatform: opt.value as DeployChoice })}
              >
                <div className={`text-sm font-medium ${active ? "text-accent" : "text-text-primary"}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-text-secondary mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- Main Component ----

interface NewProjectDialogProps {
  onClose: () => void;
  onCreated: (project: Project) => void;
}

export function NewProjectDialog({ onClose, onCreated }: NewProjectDialogProps): JSX.Element {
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<ProjectFormData>(DEFAULT_DATA);
  const [creating, setCreating] = useState(false);

  const updateData = useCallback(
    (patch: Partial<ProjectFormData>) => setData((prev) => ({ ...prev, ...patch })),
    [],
  );

  const visibleSteps = getVisibleSteps(data.projectType);

  // Reset step if we go out of bounds after project type change
  useEffect(() => {
    if (currentStep >= visibleSteps.length) {
      setCurrentStep(visibleSteps.length - 1);
    }
  }, [visibleSteps.length, currentStep]);

  const stepNumber = actualStepNumber(visibleSteps, currentStep);
  const stepInfo = ALL_STEPS[stepNumber - 1];
  const isLastStep = currentStep === visibleSteps.length - 1;

  const canNext = () => {
    if (stepNumber === 1) return data.name.trim() !== "" && data.dir.trim() !== "";
    return true;
  };

  const goNext = () => setCurrentStep((s) => Math.min(s + 1, visibleSteps.length - 1));
  const goPrev = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const handleCreate = async () => {
    if (!data.name.trim() || !data.dir.trim()) return;
    setCreating(true);
    try {
      const project = await window.electronAPI.project.create({
        name: data.name.trim(),
        path: data.dir.trim(),
      });
      onCreated(project);
    } catch {
      setCreating(false);
    }
  };

  const renderStepContent = () => {
    switch (stepNumber) {
      case 1:
        return <Step1Form data={data} onChange={updateData} />;
      case 2:
        return <Step2Form data={data} onChange={updateData} />;
      case 3:
        return <Step3Form data={data} onChange={updateData} />;
      case 4:
        return <Step4Form data={data} onChange={updateData} />;
      case 5:
        return <Step5Form data={data} onChange={updateData} />;
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 modal-overlay">
      <div className="bg-white rounded-xl border border-border shadow-2xl modal-card" style={{ width: 560 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-1">
          <h2 className="text-lg font-semibold text-text-primary">新建项目</h2>
          <button
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Step dots */}
        <StepDots total={visibleSteps.length} current={currentStep} />

        {/* Step title */}
        <div className="px-6 pb-1">
          <p className="text-xs text-text-secondary">
            Step {stepNumber}/{ALL_STEPS.length} · {stepInfo?.title}
          </p>
          <p className="text-sm text-text-secondary mt-0.5">{stepInfo?.desc}</p>
        </div>

        {/* Step content */}
        <div className="px-6 py-4 min-h-[240px]">{renderStepContent()}</div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 pb-5 pt-2">
          <button
            className="px-4 py-2 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-30"
            disabled={currentStep === 0}
            onClick={goPrev}
          >
            上一步
          </button>
          {!isLastStep ? (
            <button
              className="px-6 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors font-medium disabled:opacity-50"
              disabled={!canNext()}
              onClick={goNext}
            >
              下一步
            </button>
          ) : (
            <button
              className="px-6 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors font-medium disabled:opacity-50"
              disabled={!canNext() || creating}
              onClick={handleCreate}
            >
              {creating ? "创建中..." : "创建项目"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
