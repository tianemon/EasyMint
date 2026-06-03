import { useState, useRef, useEffect, useCallback } from "react";
import { buildProjectCreatedPrompt, buildFeatureRecommendPrompt, buildTechRecommendPrompt, buildInitTriggerPrompt, PROJECT_INIT_INSTRUCTION } from "../../../shared/prompts";

// ---- Types ----

type BudgetChoice = "充足" | "少量" | "免费";
type DeployChoice = "云端" | "本地";
type CompletenessChoice = "full" | "mvp" | "demo";

interface TechOption { value: string; label: string; desc: string }

interface FeatureItem {
  name: string;
}

interface ProjectFormData {
  name: string;
  targets: string[];
  dir: string;
  description: string;
  targetUsers: string;
  completeness: CompletenessChoice;
  features: FeatureItem[];
  uiStyle: string;
  techNotes: string;
  techBudget: BudgetChoice;
  deployPlatform: DeployChoice;
}

const TARGET_OPTIONS = [
  { value: "web", label: "Web 网页", desc: "浏览器访问，不限设备" },
  { value: "ios-mobile", label: "iOS 移动 App", desc: "iPhone / iPad 原生应用" },
  { value: "android-mobile", label: "Android 移动 App", desc: "Android 手机/平板原生应用" },
  { value: "windows-desktop", label: "Windows 桌面应用", desc: "Windows 原生桌面应用" },
  { value: "macos-desktop", label: "macOS 桌面应用", desc: "Mac 原生桌面应用" },
  { value: "linux-desktop", label: "Linux 桌面应用", desc: "Linux 原生桌面应用" },
  { value: "cli", label: "命令行工具", desc: "跨平台终端工具" },
] as const;

const COMPLETENESS_OPTIONS = [
  { value: "full", label: "完整版", desc: "功能完备，可直接上线" },
  { value: "mvp", label: "MVP", desc: "最小可行产品，验证核心想法" },
  { value: "demo", label: "演示版", desc: "原型展示，核心流程可跑通" },
] as const;

const FRONTEND_LANG_OPTIONS: TechOption[] = [
  { value: "typescript", label: "TypeScript", desc: "JavaScript 的超集，类型安全" },
  { value: "javascript", label: "JavaScript", desc: "Web 原生语言，无需编译" },
];

const FRONTEND_FRAMEWORK_OPTIONS: TechOption[] = [
  { value: "react", label: "React", desc: "最主流的前端框架，生态最大" },
  { value: "vue", label: "Vue", desc: "渐进式框架，上手快，中文社区强" },
  { value: "svelte", label: "Svelte", desc: "编译时框架，打包极小，极致性能" },
  { value: "angular", label: "Angular", desc: "企业级框架，适合大型项目" },
  { value: "solidjs", label: "SolidJS", desc: "类 React 写法，无虚拟 DOM，超高性能" },
  { value: "none-fe", label: "纯 HTML（无框架）", desc: "零依赖，单文件即可，适合极简项目" },
];

const BACKEND_LANG_OPTIONS: TechOption[] = [
  { value: "node", label: "Node.js", desc: "与前端同语言，全栈统一" },
  { value: "python", label: "Python", desc: "AI/ML 首选，开发速度快" },
  { value: "go", label: "Go", desc: "高性能微服务，部署简单" },
  { value: "php", label: "PHP", desc: "快速出活，部署便宜" },
  { value: "java", label: "Java", desc: "企业级标准，稳定可靠" },
];

const BACKEND_FRAMEWORK_OPTIONS: TechOption[] = [
  { value: "express", label: "Express", desc: "Node.js 最流行的 HTTP 框架" },
  { value: "nestjs", label: "NestJS", desc: "企业级 Node.js 框架，类 Angular 架构" },
  { value: "fastapi", label: "FastAPI", desc: "高性能 Python API 框架" },
  { value: "django", label: "Django", desc: "Python 全栈框架，自带 ORM 和后台" },
  { value: "gin", label: "Gin", desc: "Go 高性能 HTTP 框架" },
  { value: "laravel", label: "Laravel", desc: "PHP 全栈框架，生态成熟" },
  { value: "spring", label: "Spring Boot", desc: "Java 企业级框架" },
];

const CROSS_PLATFORM_OPTIONS: TechOption[] = [
  { value: "flutter", label: "Flutter", desc: "Google 的跨平台框架，Dart 语言，移动/Web/桌面" },
  { value: "react-native", label: "React Native", desc: "Facebook 的跨平台框架，React 语法，移动端为主" },
  { value: "electron", label: "Electron", desc: "Web 技术构建桌面应用（Windows/macOS/Linux）" },
  { value: "tauri", label: "Tauri", desc: "Rust 驱动的轻量桌面应用框架" },
  { value: "uniapp", label: "uni-app", desc: "Vue 语法，一套代码多端发布，国内生态成熟" },
  { value: "kotlin-mp", label: "Kotlin Multiplatform", desc: "JetBrains 跨平台方案，Android/iOS/桌面" },
];

const UI_STYLE_OPTIONS = [
  { value: "skeuomorphism", label: "拟物化", desc: "模仿现实物体的质感与纹理，让用户感到熟悉、亲切" },
  { value: "flat", label: "扁平化", desc: "简洁、二维、无阴影和纹理，强调内容本身" },
  { value: "material", label: "Material Design", desc: "通过层级、阴影和动画模拟纸张与墨水的物理世界" },
  { value: "neumorphism", label: "新拟态", desc: "用精致的内外阴影模拟浮雕或嵌入的立体效果" },
  { value: "glassmorphism", label: "玻璃拟态", desc: "模拟磨砂玻璃质感，透明度和背景模糊创造层次感" },
  { value: "claymorphism", label: "粘土拟态", desc: "3D Q版风格，明亮色彩、圆润边角和厚实阴影" },
  { value: "liquid-glass", label: "液态玻璃", desc: "动态的玻璃拟态，光线折射与流动效果" },
  { value: "neo-brutalism", label: "新粗野主义", desc: "粗重边框、强烈对比色、大胆排版，极具视觉冲击力" },
  { value: "minimalism", label: "极简主义", desc: "大量留白、无装饰排版、有限配色，只保留核心元素" },
  { value: "bauhaus", label: "包豪斯", desc: "几何形状与红黄蓝三原色，形式服务于功能" },
  { value: "retrofuturism", label: "复古未来主义", desc: "混合赛博朋克、霓虹灯、蒸汽波，用复古视角想象未来" },
  { value: "brutalism", label: "粗野主义", desc: "结构外露、放弃装饰，纯粹功能性呈现，原始而极致" },
  { value: "anti-design", label: "反设计", desc: "混乱、不和谐、朋克风，挑战传统美学与可用性规则" },
  { value: "acid-graphics", label: "酸性设计", desc: "高饱和度、液态金属感、迷幻几何，视觉冲击力极强" },
] as const;

const BUDGET_OPTIONS = [
  { value: "充足", label: "充足", desc: "优先效果与体验" },
  { value: "少量", label: "少量", desc: "控制成本，适量付费" },
  { value: "免费", label: "免费", desc: "仅使用免费/开源方案" },
] as const;

const DEPLOY_OPTIONS = [
  { value: "本地", label: "本地运行", desc: "仅在本机使用" },
  { value: "云端", label: "云端部署", desc: "Vercel / Railway / 云服务器" },
] as const;

const ALL_STEPS = [
  { number: 1, title: "项目概述", desc: "名称、类型与目录" },
  { number: 2, title: "功能清单", desc: "用户实际使用的功能" },
  { number: 3, title: "视觉风格", desc: "UI 设计风格" },
  { number: 4, title: "技术选型", desc: "前端、后端与成本" },
  { number: 5, title: "部署方式", desc: "云端或本地" },
];

const DEFAULT_DATA: ProjectFormData = {
  name: "",
  targets: ["web"],
  dir: "~/EasyMintProject/",
  description: "",
  targetUsers: "",
  completeness: "mvp",
  features: [],
  uiStyle: "",
  techNotes: "",
  techBudget: "少量",
  deployPlatform: "本地",
};

// ---- Helpers ----

function getVisibleSteps(targets: string[]) {
  if (targets.length === 1 && targets[0] === "cli") return ALL_STEPS.filter((s) => s.number !== 3);
  return ALL_STEPS;
}

function actualStepNumber(visibleSteps: typeof ALL_STEPS, currentIndex: number): number {
  return visibleSteps[currentIndex]?.number ?? 1;
}

function buildContext(data: ProjectFormData, step?: number): string {
  const targets = data.targets.map((v) => TARGET_OPTIONS.find((o) => o.value === v)?.label || v).join("、");
  const parts: string[] = [];
  const push = (s: string) => parts.push(s);

  // Step 1: always include basics
  push(`名称「${data.name}」，项目形式「${targets}」，描述「${data.description}」，目标用户「${data.targetUsers}」，完成度「${data.completeness}」`);

  // Step 2+: include features
  if (!step || step >= 2) {
    const features = data.features.map((f) => f.name).join("；");
    push(`功能清单：「${features || "无"}"」`);
  }

  // Step 3+: include UI style
  if (!step || step >= 3) {
    push(`UI 风格「${data.uiStyle || "未指定"}」`);
  }

  // Step 4+: include tech stack
  if (!step || step >= 4) {
    if (data.techNotes) push(`技术偏好「${data.techNotes}」`);
    push(`预算「${data.techBudget}」`);
  }

  // Step 5: include deploy
  if (!step || step >= 5) {
    push(`部署「${data.deployPlatform}」`);
  }

  return `项目信息：${parts.join("。")}。`;
}

// ---- Sub-components ----

function StepDots({ total, current }: { total: number; current: number }): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={`h-1 rounded-full transition-all duration-250 ${i <= current ? "w-6 bg-accent" : "w-2 bg-border"}`} />
      ))}
    </div>
  );
}

// ---- Custom Select (matches white+green theme) ----

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: readonly { value: string; label: string; desc: string }[]; placeholder?: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: r.left, width: r.width });
      }
    };
    update();
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  return (
    <div>
      <button
        ref={btnRef}
        className="w-full input text-left flex items-center justify-between"
        onClick={() => setOpen(!open)}
      >
        <span className={selected ? "text-text-primary" : "text-text-secondary"}>
          {selected ? `${selected.label} — ${selected.desc}` : (placeholder || "请选择...")}
        </span>
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className={`w-3 h-3 shrink-0 transition-transform text-text-secondary ${open ? "rotate-180" : ""}`}>
          <path d="M3 5l3 3 3-3"/>
        </svg>
      </button>
      {open && (
        <div ref={menuRef} className="fixed z-[9999] bg-surface-elevated border border-border rounded-lg shadow-lg max-h-52 overflow-y-auto" style={{ top: pos.top, left: pos.left, width: pos.width }}>
          {options.map((o) => (
            <button
              key={o.value}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${o.value === value ? "bg-accent/10 text-accent" : "text-text-primary hover:bg-surface-hover"}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span>{o.label}</span>
              <span className="text-text-secondary ml-1.5 text-xs">{o.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Step 1: Overview ----

function Step1Form({ data, onChange }: { data: ProjectFormData; onChange: (p: Partial<ProjectFormData>) => void }): JSX.Element {
  const updateTarget = (i: number, value: string) => {
    const next = [...data.targets];
    next[i] = value;
    onChange({ targets: next });
  };
  const addTarget = () => {
    onChange({ targets: [...data.targets, "web"] });
  };
  const removeTarget = (i: number) => {
    if (data.targets.length <= 1) return;
    onChange({ targets: data.targets.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">项目名称 <span className="text-danger">*</span></label>
        <input className="input" value={data.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="例如：个人博客" />
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">项目描述</label>
        <textarea className="input min-h-[60px] resize-y" value={data.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="简单描述这个项目是做什么的..." />
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">项目目录 <span className="text-danger">*</span></label>
        <button
          className="w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-left text-sm hover:bg-surface-hover transition-colors"
          onClick={async () => { const selected = await window.electronAPI.dialog.openDirectory(); if (selected) onChange({ dir: selected }); }}
        >
          <span className={data.dir && data.dir !== "~/EasyMintProject/" ? "text-text-primary" : "text-text-secondary"}>{data.dir || "点击选择目录..."}</span>
        </button>
        <p className="text-[10px] text-text-secondary mt-1">默认 ~/EasyMintProject/，不选则使用默认路径</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">目标用户</label>
        <input className="input" value={data.targetUsers} onChange={(e) => onChange({ targetUsers: e.target.value })} placeholder="例如：个人用户、小团队、企业内部..." />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-text-primary">项目形式</label>
          <button className="px-2 py-0.5 rounded border border-dashed border-accent/50 text-accent text-xs hover:border-accent hover:bg-accent/5 transition-colors" onClick={addTarget}>+ 添加</button>
        </div>
        <div className="space-y-2">
          {data.targets.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <Select value={t} onChange={(v) => updateTarget(i, v)} options={TARGET_OPTIONS} />
              </div>
              {data.targets.length > 1 && (
                <button className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-danger transition-colors shrink-0" onClick={() => removeTarget(i)}>✕</button>
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-text-secondary mt-1.5">选择项目的运行平台和交付形式，可添加多个</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">完成度</label>
        <div className="flex gap-2">
          {COMPLETENESS_OPTIONS.map((opt) => {
            const active = data.completeness === opt.value;
            return (
              <button
                key={opt.value}
                className={`flex-1 p-3 rounded-lg border transition-colors text-left ${active ? "bg-accent/20 border-accent" : "border-border hover:border-accent/50"}`}
                onClick={() => onChange({ completeness: opt.value })}
              >
                <div className={`text-sm font-medium ${active ? "text-accent" : "text-text-primary"}`}>{opt.label}</div>
                <div className="text-xs text-text-secondary mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- Step 2: Features ----

function Step2Form({
  data, onChange, onRecommendFeatures, loadingRec,
}: {
  data: ProjectFormData;
  onChange: (p: Partial<ProjectFormData>) => void;
  onRecommendFeatures: () => void;
  loadingRec: string | null;
}): JSX.Element {
  const addFeature = () => {
    onChange({ features: [...data.features, { name: "" }] });
  };

  const updateFeature = (idx: number, f: Partial<FeatureItem>) => {
    const next = [...data.features];
    next[idx] = { ...next[idx]!, ...f };
    onChange({ features: next });
  };

  const removeFeature = (idx: number) => {
    onChange({ features: data.features.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-text-primary">功能清单</label>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 rounded-lg bg-accent text-text-inverse text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-40" onClick={onRecommendFeatures} disabled={loadingRec === "features"}>
            {loadingRec === "features" ? "思考中..." : "Mint 推荐"}
          </button>
          <button className="px-3 py-1.5 rounded-lg border border-dashed border-accent/50 text-accent text-xs hover:border-accent hover:bg-accent/10 transition-colors" onClick={addFeature}>+ 添加功能</button>
        </div>
      </div>
      {data.features.length === 0 && !loadingRec && (
        <p className="text-xs text-text-secondary py-3 text-center">暂无功能，点击"+ 添加功能"或"Mint 推荐"开始。</p>
      )}
      {loadingRec === "features" && (
        <p className="text-xs text-text-secondary py-3 text-center animate-pulse">Mint 正在根据项目信息推荐功能...</p>
      )}
      {data.features.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className="flex-1 input"
            value={f.name}
            onChange={(e) => updateFeature(i, { name: e.target.value })}
            placeholder={`功能 ${i + 1}`}
          />
          <button className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-danger transition-colors text-xs shrink-0" onClick={() => removeFeature(i)}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ---- Step 3: Visual Style ----

function Step3Form({ data, onChange }: { data: ProjectFormData; onChange: (p: Partial<ProjectFormData>) => void }): JSX.Element {
  const selectedOption = UI_STYLE_OPTIONS.find((o) => o.value === data.uiStyle);
  const isCustom = !selectedOption && data.uiStyle !== "";

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">想要什么 UI 风格？</label>
        <input
          className="input"
          value={isCustom ? data.uiStyle : ""}
          onChange={(e) => onChange({ uiStyle: e.target.value })}
          placeholder="自定义风格描述，例如：赛博朋克+极简主义混搭..."
        />
      </div>
      <div>
        <label className="block text-xs text-text-secondary mb-1.5">或者从经典风格中选择：</label>
        <Select
          value={isCustom ? "" : data.uiStyle}
          onChange={(v) => onChange({ uiStyle: v })}
          options={UI_STYLE_OPTIONS}
          placeholder="— 不限，让 Mint 推荐 —"
        />
      </div>
    </div>
  );
}

// ---- Step 4: Tech with Mint recommendation ----

function Step4Form({
  data, onChange, onRecommend, loadingRec,
}: {
  data: ProjectFormData;
  onChange: (p: Partial<ProjectFormData>) => void;
  onRecommend: () => void;
  loadingRec: string | null;
}): JSX.Element {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const canRecommend = !loadingRec && data.techBudget !== undefined;

  const appendToNotes = (label: string) => {
    const current = data.techNotes.trim();
    const toAdd = current ? `，${label}` : label;
    onChange({ techNotes: current + toAdd });
  };

  return (
    <div className="space-y-5">

      {/* Budget */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">开发运维成本</label>
        <div className="flex gap-2">
          {BUDGET_OPTIONS.map((opt) => {
            const active = data.techBudget === opt.value;
            return (
              <button key={opt.value} className={`flex-1 p-3 rounded-lg border transition-colors text-left ${active ? "bg-accent/20 border-accent" : "border-border hover:border-accent/50"}`} onClick={() => onChange({ techBudget: opt.value as BudgetChoice })}>
                <div className={`text-sm font-medium ${active ? "text-accent" : "text-text-primary"}`}>{opt.label}</div>
                <div className="text-xs text-text-secondary mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tech notes textarea + Mint recommend */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-sm font-medium text-text-primary">技术偏好</label>
          <button
            className="px-3 py-1.5 rounded-lg bg-accent text-text-inverse text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onRecommend}
            disabled={!canRecommend}
          >
            {loadingRec === "tech" ? "Mint 推荐中..." : "Mint 推荐"}
          </button>
        </div>
        {!canRecommend && (
          <p className="text-[10px] text-text-secondary mb-1">选择成本后可使用 Mint 推荐</p>
        )}
        <textarea
          className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent resize-none"
          rows={3}
          placeholder="让 Mint 帮你推荐，或者自己写，例如：前端用 React + TypeScript，后端用 Node.js"
          value={data.techNotes}
          onChange={(e) => onChange({ techNotes: e.target.value })}
        />
      </div>

      {/* Advanced: tech chip quick-select, collapsed by default */}
      <div>
        <button
          className="text-xs text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1.5"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className={`w-2.5 h-2.5 transition-transform ${showAdvanced ? "rotate-90" : ""}`}><path d="M4 2l4 4-4 4"/></svg>
          有技术偏好吗？展开参考选项
        </button>
        {showAdvanced && (
          <div className="mt-3 space-y-3 pl-4 border-l-2 border-border">
            <ChipGroup label="前端语言" options={FRONTEND_LANG_OPTIONS} onSelect={appendToNotes} />
            <ChipGroup label="前端框架" options={FRONTEND_FRAMEWORK_OPTIONS} onSelect={appendToNotes} />
            <ChipGroup label="后端语言" options={BACKEND_LANG_OPTIONS} onSelect={appendToNotes} />
            <ChipGroup label="后端框架" options={BACKEND_FRAMEWORK_OPTIONS} onSelect={appendToNotes} />
            <ChipGroup label="多平台框架" options={CROSS_PLATFORM_OPTIONS} onSelect={appendToNotes} />
          </div>
        )}
      </div>
    </div>
  );
}

function ChipGroup({ label, options, onSelect }: { label: string; options: TechOption[]; onSelect: (label: string) => void }): JSX.Element {
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            className="tip px-2 py-1 rounded border border-border text-xs text-text-secondary hover:border-accent/40 hover:text-text-primary transition-colors"
            onClick={() => onSelect(o.label)}
            data-tip={o.desc}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Step 5: Deploy ----

function Step5Form({ data, onChange }: { data: ProjectFormData; onChange: (p: Partial<ProjectFormData>) => void }): JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-secondary">选择项目的最终部署方式，决定用户如何访问。</p>
      <div className="flex gap-2">
        <button
          className={`flex-1 p-4 rounded-lg border transition-colors text-left ${data.deployPlatform === "本地" ? "bg-accent/20 border-accent" : "border-border hover:border-accent/50"}`}
          onClick={() => onChange({ deployPlatform: "本地" })}
        >
          <div className={`text-sm font-medium mb-1.5 ${data.deployPlatform === "本地" ? "text-accent" : "text-text-primary"}`}>本地部署</div>
          <div className="text-xs text-text-secondary space-y-0.5">
            <div>完全免费，无需云服务</div>
            <div>仅在本机电脑上运行</div>
            <div>适合个人工具和内部使用</div>
          </div>
        </button>
        <button
          className={`flex-1 p-4 rounded-lg border transition-colors text-left ${data.deployPlatform === "云端" ? "bg-accent/20 border-accent" : "border-border hover:border-accent/50"}`}
          onClick={() => onChange({ deployPlatform: "云端" })}
        >
          <div className={`text-sm font-medium mb-1.5 ${data.deployPlatform === "云端" ? "text-accent" : "text-text-primary"}`}>云端部署</div>
          <div className="text-xs text-text-secondary space-y-0.5">
            <div>需要云服务资源（可以互联网访问）</div>
            <div>有服务器费用产生（Vercel / Railway / 云服务器等）</div>
            <div>适合需要对外提供服务的项目</div>
          </div>
        </button>
      </div>
    </div>
  );
}

// ---- AI Helper ----

function useMintChat(pathRef: React.RefObject<string | null>) {
  const sidRef = useRef<string | null>(null);      // project session

  const getCwd = useCallback(() => {
    return pathRef.current || "~/EasyMintProject/workspace/";
  }, [pathRef]);

  const WORKSPACE_DIR = "~/EasyMintProject/workspace/";

  /** Send a prompt and wait for the full response. Uses sidRef for session reuse. */
  const ask = useCallback((prompt: string, opts?: { forceNewSession?: boolean }): Promise<string> => {
    const cwd = getCwd();
    const sessionId = opts?.forceNewSession ? null : sidRef.current;
    return new Promise((resolve) => {
      let chatId = "";
      let text = "";
      const unsubStream = window.electronAPI.agent.onStream((event: StreamEvent) => {
        if (chatId && event.runId !== chatId) return;
        if (event.type === "assistant" && typeof event.data.text === "string") text += event.data.text;
      });
      const unsubSession = window.electronAPI.agent.onChatSession(({ sessionId: sid }) => {
        if (sid) sidRef.current = sid;
      });
      const unsubExit = window.electronAPI.agent.onExit(({ runId }) => {
        if (chatId && runId !== chatId) return;
        unsubStream(); unsubSession(); unsubExit();
        resolve(text.trim());
      });
      window.electronAPI.agent.sendMessage(cwd, prompt, { sessionId }).then((result) => {
        chatId = result.chatId;
      }).catch(() => { unsubStream(); unsubSession(); unsubExit(); resolve(""); });
    });
  }, [pathRef]);

  /**
   * One-shot workspace ask for lightweight tasks like name translation.
   * Always creates a fresh chat with a fast model, kills it after the response.
   */
  const askWorkspace = useCallback((prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      let chatId = "";
      let sessionId = "";
      let text = "";
      const unsubStream = window.electronAPI.agent.onStream((event: StreamEvent) => {
        if (chatId && event.runId !== chatId) return;
        if (event.type === "assistant" && typeof event.data.text === "string") text += event.data.text;
      });
      const unsubSession = window.electronAPI.agent.onChatSession(({ sessionId: sid }) => {
        if (sid) sessionId = sid;
      });
      const unsubExit = window.electronAPI.agent.onExit(({ runId }) => {
        if (chatId && runId !== chatId) return;
        unsubStream(); unsubSession(); unsubExit();
        // Kill chat loop + delete session from disk
        if (chatId) window.electronAPI.agent.killChat(chatId).catch(() => {});
        if (sessionId) window.electronAPI.conv.delete(sessionId, WORKSPACE_DIR).catch(() => {});
        resolve(text.trim());
      });
      window.electronAPI.agent.sendMessage(WORKSPACE_DIR, prompt, {
        sessionId: null,
        model: "deepseek-v4-flash",
      }).then((result) => {
        chatId = result.chatId;
      }).catch(() => { unsubStream(); unsubSession(); unsubExit(); resolve(""); });
    });
  }, []);

  return { ask, askWorkspace, sidRef };
}

// ---- Main Component ----

interface NewProjectDialogProps {
  onClose: () => void;
  onCreated: (project: Project, sessionId?: string | null) => void;
  /** If true, open the created project in a new window instead of in-place navigation */
  openInNewWindow?: boolean;
}

export function NewProjectDialog({ onClose, onCreated, openInNewWindow }: NewProjectDialogProps): JSX.Element {
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<ProjectFormData>(DEFAULT_DATA);
  const [creating, setCreating] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const pathRef = useRef<string | null>(null);
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const [loadingRec, setLoadingRec] = useState<string | null>(null);
  const { ask, askWorkspace, sidRef } = useMintChat(pathRef);

  const updateData = useCallback((patch: Partial<ProjectFormData>) => setData((prev) => ({ ...prev, ...patch })), []);

  const visibleSteps = getVisibleSteps(data.targets);

  useEffect(() => {
    if (currentStep >= visibleSteps.length) setCurrentStep(visibleSteps.length - 1);
  }, [visibleSteps.length, currentStep]);

  const stepNumber = actualStepNumber(visibleSteps, currentStep);
  const stepInfo = ALL_STEPS[stepNumber - 1];
  const isLastStep = currentStep === visibleSteps.length - 1;

  const canNext = () => {
    if (stepNumber === 1) return data.name.trim() !== "" && data.dir.trim() !== "";
    return true;
  };

  const goPrev = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const goNext = async () => {
    if (stepNumber === 1 && !projectPath) {
      setCreating(true);
      try {
        // Step 1a: If name is non-ASCII, translate via workspace chat (fast, throwaway)
        let dirName = data.name.trim();
        if (/[^\x00-\x7F]/.test(dirName)) {
          try {
            const translated = await askWorkspace(
              `[系统消息] 请把"${dirName}"翻译成简短的英文目录名（小写、连字符分隔），直接回复翻译结果不要加任何解释`
            );
            if (translated && /^[a-z0-9-]+$/.test(translated.trim())) {
              dirName = translated.trim();
            }
          } catch { /* keep original name */ }
        }

        // Step 1b: Create project with (possibly translated) name
        const project = await window.electronAPI.project.create({ name: dirName, path: data.dir.trim() });
        setProjectPath(project.path);
        pathRef.current = project.path;
        setCreatedProject(project);
        setCreateError(null);

        // Step 1c: Force a new session under the project path (not workspace)
        await ask(buildProjectCreatedPrompt(buildContext(data, 1)), { forceNewSession: true });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "创建项目失败";
        setCreateError(msg);
        console.error("[NewProjectDialog] create failed:", e);
      } finally {
        setCreating(false);
      }
    }
    if (!createError) {
      setCurrentStep((s) => Math.min(s + 1, visibleSteps.length - 1));
    }
  };

  const handleRecommendFeatures = async () => {
    setLoadingRec("features");
    const ctx = `项目名称：${data.name}，${buildContext(data, 1)}`;
    const resp = await ask(buildFeatureRecommendPrompt(ctx));
    setLoadingRec(null);
    if (resp) {
      // Extract the first contiguous block of bullet-point lines only.
      // Stop at the first non-bullet line to avoid mixing in analysis text.
      const parsed: FeatureItem[] = [];
      for (const raw of resp.split("\n")) {
        const line = raw.trim();
        if (/^[-•*]\s/.test(line)) {
          const name = line.replace(/^[-•*]\s*/, "");
          if (name) parsed.push({ name });
        } else if (parsed.length > 0) {
          break; // end of bullet block — skip commentary below
        }
      }
      if (parsed.length > 0) {
        const current = data.features;
        if (current.length === 0) {
          updateData({ features: parsed });
        } else {
          updateData({ features: [...current, ...parsed] });
        }
      }
    }
  };

  const handleRecommend = async () => {
    setLoadingRec("tech");
    const info = `项目名称：${data.name}，${buildContext(data, 4)}`;
    const resp = await ask(buildTechRecommendPrompt(info, data.techNotes));
    setLoadingRec(null);
    if (resp) {
      const text = resp.trim();
      updateData({ techNotes: text });
    }
  };

  const handleCancel = async () => {
    if (createdProject) {
      await window.electronAPI.project.delete(createdProject.id).catch(() => {});
    }
    onClose();
  };

  const creatingRef = useRef(false);

  const handleCreate = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setInitializing(true);
    try {
      if (createdProject) {
        const initPrompt = buildInitTriggerPrompt(createdProject.path, buildContext(data), PROJECT_INIT_INSTRUCTION, data.targets);
        // Fire-and-forget: don't block navigation waiting for Mint's response.
        // ChatPanel will stream the reply live after mount, and history loads
        // automatically once SDK persists the session.
        ask(initPrompt).catch(() => {});
        const sid = sidRef.current;
        // Navigate immediately — sidRef was already set in step 1
        console.log("[handleCreate] navigating with sid=%s", sid);
        if (openInNewWindow) {
          await window.electronAPI.window.openProject(createdProject.id, sid ?? undefined, true);
          onClose();
        } else {
          onCreated(createdProject, sid);
        }
      }
    } finally {
      setInitializing(false);
      creatingRef.current = false;
    }
  };

  const renderStepContent = () => {
    switch (stepNumber) {
      case 1: return <Step1Form data={data} onChange={updateData} />;
      case 2: return <Step2Form data={data} onChange={updateData} onRecommendFeatures={handleRecommendFeatures} loadingRec={loadingRec} />;
      case 3: return <Step3Form data={data} onChange={updateData} />;
      case 4: return <Step4Form data={data} onChange={updateData} onRecommend={handleRecommend} loadingRec={loadingRec} />;
      case 5: return <Step5Form data={data} onChange={updateData} />;
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 modal-overlay">
      <div className="bg-surface-elevated rounded-xl border border-border shadow-2xl modal-card flex flex-col" style={{ width: 560, maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-6 pt-5 pb-1 shrink-0">
          <h2 className="text-lg font-semibold text-text-primary">新建项目</h2>
          <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors" onClick={handleCancel}>✕</button>
        </div>

        <StepDots total={visibleSteps.length} current={currentStep} />

        <div className="px-6 pb-1 shrink-0">
          <p className="text-xs text-text-secondary">Step {stepNumber}/{ALL_STEPS.length} · {stepInfo?.title}</p>
          <p className="text-sm text-text-secondary mt-0.5">{stepInfo?.desc}</p>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">{renderStepContent()}</div>

        <div className="flex items-center justify-between px-6 pb-5 pt-2 shrink-0">
          <button className="px-4 py-2 rounded-lg text-text-secondary text-sm hover:bg-surface-hover transition-colors disabled:opacity-30" disabled={currentStep === 0 || creating} onClick={goPrev}>上一步</button>
          <div className="flex gap-2">
            <button className="text-xs text-text-secondary hover:text-danger transition-colors" onClick={handleCancel}>取消项目</button>
            {!isLastStep ? (
            <button className="px-6 py-2 rounded-lg bg-accent text-text-inverse text-sm hover:bg-accent-hover transition-colors font-medium disabled:opacity-50" disabled={!canNext() || creating} onClick={goNext}>
              {creating ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3"/><path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
                  初始化中...
                </span>
              ) : "下一步"}
            </button>
          ) : (
            <button className="px-6 py-2 rounded-lg bg-accent text-text-inverse text-sm hover:bg-accent-hover transition-colors font-medium disabled:opacity-50" disabled={!canNext() || initializing} onClick={handleCreate}>
              {initializing ? "创建中..." : "创建项目"}
            </button>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
