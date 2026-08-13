import { useState, useRef, useEffect, useCallback } from "react";
import { buildProjectCreatedPrompt, buildDirectoryTranslationPrompt, buildDirectCreatePrompt, buildInitTriggerPrompt, buildInitInstruction, detectProfile, composeProfile, systemMessage } from "../../../shared/prompts";
import type { ProjectDimensions, DeployMode } from "../../../shared/prompts";
import { StepDots, Step1Form, Step2Form } from "./new-project/StepComponents";
import { ALL_STEPS, DEFAULT_DATA, TARGET_OPTIONS, type ProjectFormData } from "./new-project/ProjectFormTypes";
import { useMintChat } from "./new-project/useMintChat";

// ---- Helpers ----

function actualStepNumber(visibleSteps: typeof ALL_STEPS, currentIndex: number): number {
  return visibleSteps[currentIndex]?.number ?? 1;
}

function buildContext(data: ProjectFormData, step?: number): string {
  const targets = data.targets.map((v) => TARGET_OPTIONS.find((o) => o.value === v)?.label || v).join("、");
  const parts: string[] = [];
  const push = (s: string) => parts.push(s);

  // Step 1: always include basics
  push(`名称「${data.name}」，项目形式「${targets}」，完成度「${data.completeness}」`);

  // Step 2+: include deploy + AI + budget
  if (!step || step >= 2) {
    push(`部署「${data.deployPlatform}」`);
    const aiLabel = data.aiIntegration === "none" ? "无" : data.aiIntegration === "assistant" ? "AI 辅助" : data.aiIntegration === "agent" ? "Agent 自主决策" : "多 Agent 协作";
    push(`AI 集成「${aiLabel}」`);
    push(`预算「${data.techBudget}」`);
  }

  return `项目信息：${parts.join("。")}。`;
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
        const dims: ProjectDimensions = {
          product: detectProfile(data.targets).id as any,
          deploy: (data.deployPlatform === "云端" ? "cloud" : data.deployPlatform === "混合" ? "hybrid" : "local") as DeployMode,
          // 完成度映射流程深度:完整版→中等(full 流程) / MVP→简单(需求+task.json) / 演示版→极简(跳过文档)
          complexity: data.completeness === "full" ? "medium" : data.completeness === "mvp" ? "simple" : "minimal",
          ai: data.aiIntegration,
          storage: data.deployPlatform === "云端" ? "postgres" : "sqlite",
          productUsesAI: data.aiIntegration !== "none",
          needsAuth: data.deployPlatform === "云端",
          needsPayment: false,
        };
        const profile = composeProfile(dims);
        // 持久化项目产品类型规范,供后续 Mint 会话 buildSystemPrompt 注入(阶段二)
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
      // 用局部变量 project 保存,避免依赖尚未更新的 state（createdProject 为 null）
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
      // 发 direct-create 系统消息（携带项目名 + 已采集结构化信息快照）,Mint 开回合按 creation_flow 引导
      const directPrompt = buildDirectCreatePrompt(data.name, buildContext(data));
      await ask(directPrompt, { forceNewSession: true, systemPayload: systemMessage("direct-create", directPrompt) });
      // 打开项目窗口与对话
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
      case 2: return <Step2Form data={data} onChange={updateData} />;
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
          <p className="text-[11px] text-text-muted">填完表单后，Mint 会带你经历：需求确认 → 界面原型 → 开发 → 完成</p>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">{renderStepContent()}</div>

        <div className="flex items-center justify-between px-6 pb-5 pt-2 shrink-0">
          <button className="px-4 py-2 rounded-lg text-text-secondary text-sm hover:bg-surface-hover transition-colors disabled:opacity-30" disabled={currentStep === 0 || creating} onClick={goPrev}>上一步</button>
          <div className="flex gap-2">
            <button className="px-5 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors text-sm" onClick={handleCancel}>取消项目</button>
            <button className="px-5 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors text-sm disabled:opacity-50" disabled={initializing || creating} onClick={handleDirectCreate} title="跳过表单，让 Mint 在对话里引导你补全信息">
              {initializing ? "创建中..." : "直接创建"}
            </button>
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
