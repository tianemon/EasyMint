import { useState, useRef, useEffect, useCallback } from "react";

// ---- Types ----

type PlatformChoice = "web" | "mobile" | "cli" | "desktop";
type FrameworkChoice = "react" | "vue" | "html";
type StyleChoice = "tailwind" | "css-modules" | "pure-css";
type BackendChoice = "node" | "python" | "none";
type BudgetChoice = "充足" | "少量" | "免费";
type DeployChoice = "云端" | "本地";
type CompletenessChoice = "full" | "mvp" | "demo";

interface FeatureItem {
  name: string;
  priority: "P0" | "P1" | "P2";
}

interface ProjectFormData {
  name: string;
  platforms: PlatformChoice[];
  dir: string;
  description: string;
  targetUsers: string;
  completeness: CompletenessChoice;
  features: FeatureItem[];
  uiStyle: string;
  framework: FrameworkChoice;
  styling: StyleChoice;
  backend: BackendChoice;
  techBudget: BudgetChoice;
  deployPlatform: DeployChoice;
}

const PLATFORM_OPTIONS = [
  { value: "web", label: "Web", desc: "网站 / SPA" },
  { value: "mobile", label: "移动", desc: "iOS / Android" },
  { value: "cli", label: "CLI", desc: "命令行工具" },
  { value: "desktop", label: "桌面", desc: "桌面应用" },
] as const;

const COMPLETENESS_OPTIONS = [
  { value: "full", label: "完整版", desc: "功能完备，可直接上线" },
  { value: "mvp", label: "MVP", desc: "最小可行产品，验证核心想法" },
  { value: "demo", label: "演示版", desc: "原型展示，核心流程可跑通" },
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
  { value: "云端", label: "云端部署", desc: "Vercel / Railway / 云服务器" },
  { value: "本地", label: "本地运行", desc: "仅在本机使用" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "P0", label: "P0 必做" },
  { value: "P1", label: "P1 该做" },
  { value: "P2", label: "P2 可做" },
] as const;

const ALL_STEPS = [
  { number: 1, title: "项目概述", desc: "名称、类型与目录" },
  { number: 2, title: "功能清单", desc: "核心功能与优先级" },
  { number: 3, title: "视觉风格", desc: "UI 设计风格" },
  { number: 4, title: "技术选型", desc: "框架、样式与后端" },
  { number: 5, title: "部署方式", desc: "成本与平台" },
];

const DEFAULT_DATA: ProjectFormData = {
  name: "",
  platforms: ["web"],
  dir: "~/EasyMintProject/",
  description: "",
  targetUsers: "",
  completeness: "mvp",
  features: [],
  uiStyle: "minimalism",
  framework: "react",
  styling: "tailwind",
  backend: "node",
  techBudget: "少量",
  deployPlatform: "云端",
};

// ---- Helpers ----

function getVisibleSteps(platforms: PlatformChoice[]) {
  if (platforms.length === 1 && platforms[0] === "cli") return ALL_STEPS.filter((s) => s.number !== 3);
  return ALL_STEPS;
}

function actualStepNumber(visibleSteps: typeof ALL_STEPS, currentIndex: number): number {
  return visibleSteps[currentIndex]?.number ?? 1;
}

function buildContext(data: ProjectFormData): string {
  const platforms = data.platforms.join("、");
  const features = data.features.map((f) => `${f.name}(${f.priority})`).join("；");
  const hasWeb = data.platforms.includes("web");
  return `项目信息：名称「${data.name}」，平台「${platforms}」，描述「${data.description}」，目标用户「${data.targetUsers}」，完成度「${data.completeness}」。功能清单：「${features}」。UI风格「${data.uiStyle}」。${hasWeb ? `技术选型：框架「${data.framework}」，样式「${data.styling}」，后端「${data.backend}」。` : ""}预算「${data.techBudget}」，部署「${data.deployPlatform}」。`;
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

// ---- Step 1: Overview ----

function Step1Form({ data, onChange }: { data: ProjectFormData; onChange: (p: Partial<ProjectFormData>) => void }): JSX.Element {
  const togglePlatform = (v: PlatformChoice) => {
    const set = new Set(data.platforms);
    if (set.has(v)) set.delete(v); else set.add(v);
    if (set.size === 0) return;
    onChange({ platforms: [...set] as PlatformChoice[] });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">项目名称 <span className="text-red-400">*</span></label>
        <input className="input" value={data.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="例如：个人博客" />
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">项目类型（可多选）</label>
        <div className="grid grid-cols-2 gap-2">
          {PLATFORM_OPTIONS.map((opt) => {
            const active = data.platforms.includes(opt.value);
            return (
              <button
                key={opt.value}
                className={`p-3 rounded-lg border transition-colors text-left ${active ? "bg-accent/20 border-accent" : "border-border hover:border-accent/50"}`}
                onClick={() => togglePlatform(opt.value)}
              >
                <div className={`text-sm font-medium ${active ? "text-accent" : "text-text-primary"}`}>{opt.label}</div>
                <div className="text-xs text-text-secondary mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">项目目录 <span className="text-red-400">*</span></label>
        <button
          className="w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-left text-sm hover:bg-surface-hover transition-colors"
          onClick={async () => { const selected = await window.electronAPI.dialog.openDirectory(); if (selected) onChange({ dir: selected }); }}
        >
          <span className={data.dir && data.dir !== "~/EasyMintProject/" ? "text-text-primary" : "text-text-secondary"}>{data.dir || "点击选择目录..."}</span>
        </button>
        <p className="text-[10px] text-text-secondary mt-1">默认 ~/EasyMintProject/，不选则使用默认路径</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">项目描述</label>
        <textarea className="input min-h-[60px] resize-y" value={data.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="简单描述这个项目是做什么的..." />
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">目标用户</label>
        <input className="input" value={data.targetUsers} onChange={(e) => onChange({ targetUsers: e.target.value })} placeholder="例如：个人用户、小团队、企业内部..." />
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

// ---- Step 2: Features (structured with P0/P1/P2 + Mint recommend) ----

function Step2Form({
  data, onChange, onRecommendFeatures, loadingRec,
}: {
  data: ProjectFormData;
  onChange: (p: Partial<ProjectFormData>) => void;
  onRecommendFeatures: () => void;
  loadingRec: string | null;
}): JSX.Element {
  const addFeature = () => {
    onChange({ features: [...data.features, { name: "", priority: "P1" as const }] });
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
          <button className="px-3 py-1 rounded-lg border border-dashed border-accent/50 text-accent text-xs hover:border-accent hover:bg-accent/10 transition-colors" onClick={onRecommendFeatures} disabled={loadingRec === "features"}>
            {loadingRec === "features" ? "思考中..." : "✨ Mint 推荐"}
          </button>
          <button className="px-3 py-1 rounded-lg border border-dashed border-accent/50 text-accent text-xs hover:border-accent hover:bg-accent/10 transition-colors" onClick={addFeature}>+ 添加功能</button>
        </div>
      </div>
      {data.features.length === 0 && !loadingRec && (
        <p className="text-xs text-text-secondary py-3 text-center">暂无功能，点击"+ 添加功能"或"✨ Mint 推荐"开始。</p>
      )}
      {loadingRec === "features" && (
        <p className="text-xs text-text-secondary py-3 text-center animate-pulse">Mint 正在根据项目信息推荐功能...</p>
      )}
      {data.features.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className="flex-1 px-2 py-1.5 rounded-lg bg-surface border border-border text-text-primary text-xs outline-none focus:border-accent"
            value={f.name}
            onChange={(e) => updateFeature(i, { name: e.target.value })}
            placeholder={`功能 ${i + 1}`}
          />
          <select
            className="px-2 py-1.5 rounded-lg bg-surface border border-border text-text-primary text-xs outline-none focus:border-accent shrink-0"
            value={f.priority}
            onChange={(e) => updateFeature(i, { priority: e.target.value as "P0" | "P1" | "P2" })}
          >
            {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-red-500 transition-colors text-xs" onClick={() => removeFeature(i)}>✕</button>
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
        <select
          className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
          value={isCustom ? "" : data.uiStyle}
          onChange={(e) => onChange({ uiStyle: e.target.value })}
        >
          <option value="" disabled>— 选择预设风格 —</option>
          {UI_STYLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label} — {opt.desc}</option>
          ))}
        </select>
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
  const hasWeb = data.platforms.includes("web");
  return (
    <div className="space-y-5">
      {!hasWeb && <p className="text-xs text-text-secondary">非 Web 项目可跳过技术选型。</p>}
      <div className="text-center py-4">
        <button
          className="px-6 py-3 rounded-lg border-2 border-dashed border-accent/40 text-accent hover:border-accent hover:bg-accent/5 transition-colors disabled:opacity-50"
          onClick={onRecommend}
          disabled={loadingRec !== null}
        >
          {loadingRec === "tech" ? (
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3"/><path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
              Mint 正在推荐...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M8 2l1 4h4l-3 2.5 1 4-3-2.5-3 2.5 1-4-3-2.5h4L8 2z"/></svg>
              让 Mint 推荐技术栈
            </span>
          )}
        </button>
        <p className="text-xs text-text-secondary mt-2">Mint 会根据项目信息和行业现状推荐三个技术方案</p>
      </div>

      {hasWeb && (
        <div className="space-y-3 bg-surface-alt rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">前端框架</span>
            <span className="text-sm font-medium text-text-primary">{FRAMEWORK_OPTIONS.find((o) => o.value === data.framework)?.label || data.framework}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">样式方案</span>
            <span className="text-sm font-medium text-text-primary">{STYLE_OPTIONS.find((o) => o.value === data.styling)?.label || data.styling}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">后端技术</span>
            <span className="text-sm font-medium text-text-primary">{BACKEND_OPTIONS.find((o) => o.value === data.backend)?.label || data.backend}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Step 5: Deploy ----

function Step5Form({ data, onChange }: { data: ProjectFormData; onChange: (p: Partial<ProjectFormData>) => void }): JSX.Element {
  return (
    <div className="space-y-5">
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
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">部署平台</label>
        <div className="flex gap-2">
          {DEPLOY_OPTIONS.map((opt) => {
            const active = data.deployPlatform === opt.value;
            return (
              <button key={opt.value} className={`flex-1 p-3 rounded-lg border transition-colors text-left ${active ? "bg-accent/20 border-accent" : "border-border hover:border-accent/50"}`} onClick={() => onChange({ deployPlatform: opt.value as DeployChoice })}>
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

// ---- AI Helper ----

function useMintChat(pathRef: React.RefObject<string | null>) {
  const sidRef = useRef<string | null>(null);

  const getCwd = useCallback(() => {
    return pathRef.current || "~/EasyMintProject/workspace/";
  }, [pathRef]);

  const ask = useCallback((prompt: string): Promise<string> => {
    const cwd = getCwd();
    return new Promise((resolve) => {
      let chatId = "";
      let text = "";
      const unsubStream = window.electronAPI.agent.onStream((event: StreamEvent) => {
        if (chatId && event.runId !== chatId) return;
        if (event.type === "assistant" && typeof event.data.text === "string") text += event.data.text;
      });
      const unsubSession = window.electronAPI.agent.onChatSession(({ sessionId: sid }) => { sidRef.current = sid; });
      const unsubExit = window.electronAPI.agent.onExit(({ runId }) => {
        if (chatId && runId !== chatId) return;
        unsubStream(); unsubSession(); unsubExit();
        resolve(text.trim());
      });
      window.electronAPI.agent.sendMessage(cwd, prompt, { sessionId: sidRef.current }).then((result) => {
        chatId = result.chatId;
      }).catch(() => { unsubStream(); unsubSession(); unsubExit(); resolve(""); });
    });
  }, [pathRef]);

  return { ask, sidRef };
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
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const pathRef = useRef<string | null>(null);
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const [loadingRec, setLoadingRec] = useState<string | null>(null);

  const { ask, sidRef } = useMintChat(pathRef);

  const updateData = useCallback((patch: Partial<ProjectFormData>) => setData((prev) => ({ ...prev, ...patch })), []);

  const visibleSteps = getVisibleSteps(data.platforms);

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
        const project = await window.electronAPI.project.create({ name: data.name.trim(), path: data.dir.trim() });
        setProjectPath(project.path);
        pathRef.current = project.path;
        setCreatedProject(project);
        await ask(`[系统通知] 用户点击了新建项目。请默默收集以下需求，无需主动回复：\n${buildContext(data)}\n收到后只需回复"已记录"。`);
      } catch { /* ignore */ }
      setCreating(false);
    }
    setCurrentStep((s) => Math.min(s + 1, visibleSteps.length - 1));
  };

  const handleRecommendFeatures = async () => {
    setLoadingRec("features");
    const ctx = `项目名称：${data.name}，平台：${data.platforms.join("、")}，描述：${data.description}，目标用户：${data.targetUsers}`;
    const resp = await ask(`结合以下项目信息，给用户推荐功能清单：${ctx}\n要求：每行一个功能，格式为"[功能名称](优先级)"，如"[用户登录](P0)"。优先级按P0/P1/P2划分。列出最重要的6-10个功能。`);
    setLoadingRec(null);
    if (resp) {
      const lines = resp.split("\n").filter((l) => l.trim());
      const parsed: FeatureItem[] = [];
      for (const line of lines) {
        const m = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (m) {
          const name = m[1]!.trim();
          const rawP = m[2]!.trim().toUpperCase();
          const priority = (rawP.includes("P0") ? "P0" : rawP.includes("P2") ? "P2" : "P1") as "P0" | "P1" | "P2";
          parsed.push({ name, priority });
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
    const info = `项目名称：${data.name}，平台：${data.platforms.join("、")}，描述：${data.description}，目标用户：${data.targetUsers}，完成度：${data.completeness}`;
    const resp = await ask(`结合以下项目信息和当前行业趋势，推荐三个技术方案：${info}\n\n每个方案用一行，格式：方案N: [框架](前端) + [样式](CSS方案) + [后端](后端技术) - 一句话理由\n如果项目不需要后端，后端写\"无\"。\n\n给出三个方案后，在最后一行单独写：推荐: 方案X ，其中X是你最推荐的方案号。`);
    setLoadingRec(null);
    if (resp) {
      // Parse the recommended plan and auto-fill
      const recMatch = resp.match(/推荐:\s*方案(\d)/i);
      const recNum = recMatch ? parseInt(recMatch[1]!) : 1;
      const planRegex = new RegExp(`方案${recNum}:\\s*\\[([^\\]]+)\\]\\(前端\\)\\s*\\+\\s*\\[([^\\]]+)\\]\\(CSS方案\\)\\s*\\+\\s*\\[([^\\]]+)\\]\\(后端技术\\)`, "i");
      const planMatch = resp.match(planRegex);
      if (planMatch) {
        const fw = planMatch[1]!.toLowerCase();
        const st = planMatch[2]!.toLowerCase();
        const be = planMatch[3]!.toLowerCase();
        const fwOpt = FRAMEWORK_OPTIONS.find((o) => o.label.toLowerCase().includes(fw) || o.value === fw);
        const stOpt = STYLE_OPTIONS.find((o) => o.label.toLowerCase().includes(st) || o.value === st);
        const beOpt = BACKEND_OPTIONS.find((o) => o.label.toLowerCase().includes(be) || o.value === be || be.includes("无"));
        const patch: Partial<ProjectFormData> = {};
        if (fwOpt) patch.framework = fwOpt.value;
        if (stOpt) patch.styling = stOpt.value;
        if (be.includes("无")) patch.backend = "none";
        else if (beOpt) patch.backend = beOpt.value;
        if (Object.keys(patch).length > 0) updateData(patch);
      }
    }
  };

  const handleCancel = async () => {
    if (createdProject) {
      await window.electronAPI.project.delete(createdProject.id).catch(() => {});
    }
    onClose();
  };

  const handleCreate = async () => {
    setCreating(true);
    if (createdProject) {
      // 发送文档编写指令（项目路径此时已确定）
      const ctx = buildContext(data);
      const initPrompt = `[系统通知] 项目已创建完毕。

项目路径：${createdProject.path}

${ctx}

请立即按顺序编写以下项目文档（直接编辑已有文件即可）：

1. docs/APP_SPEC.md — 项目需求规格文档
2. docs/ARCHITECTURE.md — 架构设计文档
3. README.md — 项目说明文档
4. CLAUDE.md — 更新项目上下文

task.json 和 init.sh 暂时不要修改。完成后总结已完成的工作。`;
      ask(initPrompt).catch(() => {});
      const sid = sidRef.current;
      if (openInNewWindow) {
        await window.electronAPI.window.openProject(createdProject.id, sid ?? undefined);
        onClose();
      } else {
        onCreated(createdProject, sid);
      }
    }
    setCreating(false);
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
      <div className="bg-white rounded-xl border border-border shadow-2xl modal-card flex flex-col" style={{ width: 560, maxHeight: "90vh" }}>
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
          <div className="flex gap-2">
            <button className="px-4 py-2 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-30" disabled={currentStep === 0 || creating} onClick={goPrev}>上一步</button>
            <button className="px-4 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors text-sm" onClick={handleCancel}>取消项目</button>
          </div>
          {!isLastStep ? (
            <button className="px-6 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors font-medium disabled:opacity-50" disabled={!canNext() || creating} onClick={goNext}>
              {creating ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3"/><path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
                  创建中...
                </span>
              ) : "下一步"}
            </button>
          ) : (
            <button className="px-6 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors font-medium disabled:opacity-50" disabled={!canNext() || creating} onClick={handleCreate}>
              {creating ? "创建中..." : "创建项目"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
