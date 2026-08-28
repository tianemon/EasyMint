import { useState, useRef, useEffect, useCallback } from "react";
import { buildProjectCreatedPrompt, buildFeatureRecommendPrompt, buildDirectoryTranslationPrompt, buildDirectCreatePrompt, buildInitTriggerPrompt, buildInitInstruction, detectProfile, composeProfile, systemMessage } from "../../../shared/prompts";
import type { ProjectDimensions, DeployMode } from "../../../shared/prompts";
import { StepDots, Step1Form, Step2Form, Step3Form, Step4Form } from "./new-project/StepComponents";
import { ALL_STEPS, DEFAULT_DATA, SCENE_OPTIONS, TARGET_OPTIONS, UI_STYLE_OPTIONS, type ProjectFormData, type FeatureItem } from "./new-project/ProjectFormTypes";
import { useMintChat } from "./new-project/useMintChat";

// ---- Helpers ----

function actualStepNumber(visibleSteps: typeof ALL_STEPS, currentIndex: number): number {
  return visibleSteps[currentIndex]?.number ?? 1;
}

function buildContext(data: ProjectFormData, step?: number): string {
  const targets = data.targets.map((v) => TARGET_OPTIONS.find((o) => o.value === v)?.label || v).join("、");
  const sceneLabel = SCENE_OPTIONS.find((o) => o.value === data.scene)?.label || data.scene;
  const parts: string[] = [];
  const push = (s: string) => parts.push(s);

  // Step 1: basics
  push(`名称「${data.name}」，项目形式「${targets}」，完成度「${data.completeness}」`);
  if (data.description) push(`描述「${data.description}」`);
  if (data.scene && data.scene !== "unknown") push(`项目场景「${sceneLabel}」`);

  // Step 2+: features
  if (!step || step >= 2) {
    const features = data.features.map((f) => f.name).join("；");
    push(`功能清单：「${features || "无"}」`);
  }

  // Step 3+: UI style
  if (!step || step >= 3) {
    const uiLabel = UI_STYLE_OPTIONS.find((o) => o.value === data.uiStyle)?.label || data.uiStyle;
    push(`UI 风格「${uiLabel || "未指定"}」`);
  }

  // Step 4+: deploy + AI + budget
  if (!step || step >= 4) {
    push(`部署「${data.deployPlatform}」`);
    const aiLabel = data.aiIntegration === "none" ? "无" : data.aiIntegration === "assistant" ? "AI 辅助" : data.aiIntegration === "agent" ? "Agent 自主决策" : "多 Agent 协作";
    push(`AI 集成「${aiLabel}」`);
    push(`预算「${data.techBudget}」`);
  }

  return `项目信息：${parts.join("。")}。`;
}

/** 直接创建快照：只传用户主动填的信息（名称/形式/描述/场景），不传默认值——
 *  完成度/功能/UI/部署/AI/预算等未确认项留空，让 Mint 对话引导补全。 */
function buildDirectCreateContext(data: ProjectFormData): string {
  const targets = data.targets.map((v) => TARGET_OPTIONS.find((o) => o.value === v)?.label || v).join("、");
  const sceneLabel = SCENE_OPTIONS.find((o) => o.value === data.scene)?.label || data.scene;
  const parts: string[] = [];
  if (data.name) parts.push(`名称「${data.name}」`);
  parts.push(`项目形式「${targets}」`);
  if (data.description) parts.push(`描述「${data.description}」`);
  if (data.scene && data.scene !== "unknown") parts.push(`项目场景「${sceneLabel}」`);
  return parts.join("。");
}

// ---- Main Component ----

interface NewProjectDialogProps {
  onClose: () => void;
  onCreated: (project: Project, sessionId?: string | null) => void;
}

export function NewProjectDialog({ onClose, onCreated }: NewProjectDialogProps): JSX.Element {
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

  const visibleSteps = ALL_STEPS;

  useEffect(() => {
    if (currentStep >= visibleSteps.length) setCurrentStep(visibleSteps.length - 1);
  }, [visibleSteps.length, currentStep]);

  const stepNumber = actualStepNumber(visibleSteps, currentStep);
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
              buildDirectoryTranslationPrompt(dirName),
              systemMessage("flow", buildDirectoryTranslationPrompt(dirName))
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
        const createdPrompt = buildProjectCreatedPrompt(buildContext(data, 1));
        await ask(createdPrompt, { forceNewSession: true, systemPayload: systemMessage("flow", createdPrompt) });
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
    const featurePrompt = buildFeatureRecommendPrompt(ctx);
    const resp = await ask(featurePrompt, { systemPayload: systemMessage("flow", featurePrompt) });
    setLoadingRec(null);
    if (resp) {
      // Extract the first contiguous block of bullet-point lines only.
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
        // 复杂度判定权在 Mint（creation-guide skill），前端不硬编码流程深度——
        // 这里只按中性值生成技术规范 platformSpec，原型/文档/编码流程由 Mint 判断
        const dims: ProjectDimensions = {
          product: detectProfile(data.targets).id as any,
          deploy: (data.deployPlatform === "云端" ? "cloud" : data.deployPlatform === "混合" ? "hybrid" : "local") as DeployMode,
          complexity: "medium",
          ai: data.aiIntegration,
          storage: data.deployPlatform === "云端" ? "postgres" : "sqlite",
          productUsesAI: data.aiIntegration !== "none",
          needsAuth: data.deployPlatform === "云端",
          needsPayment: false,
        };
        const profile = composeProfile(dims);
        // 持久化项目产品类型规范,供后续 Mint 会话 buildSystemPrompt 注入
        window.electronAPI.project.saveProfile(createdProject.path, profile.platformSpec).catch(() => {});
        const initPrompt = buildInitTriggerPrompt(createdProject.path, buildContext(data), buildInitInstruction(profile), data.targets);
        ask(initPrompt, { systemPayload: systemMessage("project-created", initPrompt) }).catch(() => {});
        // 轮询 session 文件，等 custom_message(project-created) 落盘后再跳转
        for (let i = 0; i < 100; i++) {
          await new Promise((r) => setTimeout(r, 100));
          const sid = sidRef.current;
          if (!sid) continue;
          try {
            const msgs: any[] = await window.electronAPI.conv.messages(sid, createdProject.path);
            if (msgs.some((m: any) => m.message?.customType === "system_message" && m.message?.details?.kind === "project-created")) break;
          } catch { /* SDK not ready yet */ }
        }
        const sid = sidRef.current;
        onCreated(createdProject, sid);
      }
    } finally {
      setInitializing(false);
      creatingRef.current = false;
    }
  };

  /** 直接创建：跳过表单后续步骤,创建项目 + 发 direct-create 消息触发 Mint 对话引导补全信息 */
  const handleDirectCreate = async () => {
    if (creatingRef.current) return;
    if (!data.name.trim()) { setCreateError("请先填写项目名称"); return; }
    creatingRef.current = true;
    setInitializing(true);
    try {
      // 确保项目已创建（若 step1 尚未走过,复用目录名翻译 + 创建逻辑）
      let project = createdProject;
      if (!project) {
        let dirName = data.name.trim();
        if (/[^\x00-\x7F]/.test(dirName)) {
          try {
            const translated = await askWorkspace(
              buildDirectoryTranslationPrompt(dirName),
              systemMessage("flow", buildDirectoryTranslationPrompt(dirName))
            );
            if (translated && /^[a-z0-9-]+$/.test(translated.trim())) dirName = translated.trim();
          } catch { /* keep original name */ }
        }
        project = await window.electronAPI.project.create({ name: dirName, path: data.dir.trim() });
        setProjectPath(project.path);
        pathRef.current = project.path;
        setCreatedProject(project);
        setCreateError(null);
      }
      // 发 direct-create 系统消息（携带项目名 + 用户已填信息快照）,Mint 开回合按 creation_flow 引导
      const directPrompt = buildDirectCreatePrompt(data.name, buildDirectCreateContext(data));
      await ask(directPrompt, { forceNewSession: true, systemPayload: systemMessage("direct-create", directPrompt) });
      const sid = sidRef.current;
      onCreated(project, sid);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "创建项目失败";
      setCreateError(msg);
      console.error("[NewProjectDialog] direct create failed:", e);
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
      case 4: return <Step4Form data={data} onChange={updateData} />;
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 modal-overlay">
      <div className="bg-surface-alt rounded-xl border border-border shadow-2xl modal-card flex flex-col" style={{ width: 560, maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-6 pt-5 pb-1 shrink-0">
          <h2 className="text-lg font-semibold text-text-primary">新建项目</h2>
          <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors" onClick={handleCancel}>✕</button>
        </div>

        <StepDots total={visibleSteps.length} current={currentStep} />

        <div className="px-6 pb-1 shrink-0">
          <p className="text-[length:var(--text-11)] text-text-muted">初步信息采集，简单填写自己的需求，帮助 AI 掌握你的偏好</p>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">{renderStepContent()}</div>

        <div className="flex items-center justify-between px-6 pb-5 pt-2 shrink-0">
          <button className="px-4 py-2 rounded-lg text-text-secondary text-sm hover:bg-surface-hover transition-colors disabled:opacity-30" disabled={currentStep === 0 || creating} onClick={goPrev}>上一步</button>
          <div className="flex gap-3">
            <div className="flex gap-2">
              <button className="ml-0.5 px-2 py-0 rounded-lg text-danger hover:bg-surface-hover transition-colors text-sm" onClick={handleCancel}>取消项目</button>
              <button className="px-2 py-0 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors text-sm disabled:opacity-50" disabled={initializing || creating} onClick={handleDirectCreate} title="跳过表单，让 Mint 在对话里引导你补全信息">
                {initializing ? "创建中..." : "直接创建"}
              </button>
            </div>
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
