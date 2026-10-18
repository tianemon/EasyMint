import { appText } from "../lib/i18n";
import { uiText, useUiLocale } from "../lib/i18n";
import { useState, useRef, useEffect, useCallback } from "react";
import { buildFeatureRecommendPrompt, buildDirectoryTranslationPrompt, buildDirectCreatePrompt, buildInitTriggerPrompt, buildInitInstruction, systemMessage } from "../../../shared/prompts";
import type { SystemMessagePayload } from "../../../shared/prompts";
import { StepDots, Step1Form, Step2Form, Step3Form, Step4Form } from "./new-project/StepComponents";
import { ALL_STEPS, DEFAULT_DATA, SCENE_OPTIONS, TARGET_OPTIONS, UI_STYLE_OPTIONS, type ProjectFormData, type FeatureItem } from "./new-project/ProjectFormTypes";
import { useMintChat } from "./new-project/useMintChat";
import { Modal } from "./ui/Modal";
import { createVisualSpec, visualSpecPrompt, type VisualSelection } from "../../../shared/visual-design/spec";
function visualSelection(data: ProjectFormData): VisualSelection { return {projectName:data.name,projectDescription:data.description,styleId:data.uiStyle,palette:data.uiPalette,effect:data.uiEffect,brandId:data.uiBrand,layout:data.uiLayout,targets:data.targets}; }
import { DELIVERY_FIELDS, deliveryContext, projectProfile } from "./new-project/project-requirements";
import { PROJECT_DRAFT_KEY, parseProjectDraft } from "./new-project/project-draft";

// ---- Helpers ----

/** IPC 错误剥壳：invoke 抛错被 Electron 包装成 "Error invoking remote method 'x': Error: 中文"，
 *  去掉包装只留业务文案（技术报错不展示原始堆栈） */
function cleanIpcError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const m = msg.match(/^Error invoking remote method '[^']+': (?:Error: )?([\s\S]+)$/);
  return (m?.[1]?.trim() || msg).trim() || uiText("ui.NewProjectDialog.couldNotCreateProject");
}

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
    const features = data.features.map((f) => f.name.trim()).filter(Boolean).join("；");
    push(`功能清单：「${features || "无"}」`);
  }

  // Step 3+: UI style
  if ((!step || step >= 3) && data.targets.some((target) => target !== "cli")) {
    const uiLabel = UI_STYLE_OPTIONS.find((o) => o.value === data.uiStyle)?.label || data.uiStyle;
    push(`UI 风格「${uiLabel || "未指定"}」`);
    const designContext = visualSpecPrompt(createVisualSpec(visualSelection(data)));
    if (designContext) push(designContext);
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

/** Carry explicit input, including selected visual tokens, without turning delivery defaults into requirements. */
function buildDirectCreateContext(data: ProjectFormData): string {
  const targets = data.targets.map((v) => TARGET_OPTIONS.find((o) => o.value === v)?.label || v).join("、");
  const sceneLabel = SCENE_OPTIONS.find((o) => o.value === data.scene)?.label || data.scene;
  const parts: string[] = [];
  if (data.name) parts.push(`名称「${data.name}」`);
  parts.push(`项目形式「${targets}」`);
  if (data.description) parts.push(`描述「${data.description}」`);
  if (data.scene && data.scene !== "unknown") parts.push(`项目场景「${sceneLabel}」`);
  const features = data.features.map((feature) => feature.name.trim()).filter(Boolean);
  if (features.length) parts.push(`功能清单：「${features.join("；")}」`);
  if (data.targets.some((target) => target !== "cli")) {
    if (data.uiStyle && data.uiStyle !== "custom") parts.push(`UI 风格「${UI_STYLE_OPTIONS.find((option) => option.value === data.uiStyle)?.label || data.uiStyle}」`);
    const designContext = visualSpecPrompt(createVisualSpec(visualSelection(data)));
    if (designContext) parts.push(designContext);
  }
  parts.push(...deliveryContext(data, true));
  return parts.join("。");
}

async function saveProjectProfile(projectPath: string, specification: string, visual?: VisualSelection): Promise<void> {
  const result: unknown = await window.electronAPI.project.saveProfile(projectPath, specification, visual);
  if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== true) {
    throw new Error(result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : uiText("creation.profileSaveFailed"));
  }
}

// ---- Main Component ----

interface NewProjectDialogProps {
  onClose: () => void;
  onCreated: (project: Project, sessionId?: string | null) => void;
}

export function NewProjectDialog({ onClose, onCreated }: NewProjectDialogProps): JSX.Element {
  useUiLocale();
  const [draft] = useState(() => parseProjectDraft(sessionStorage.getItem(PROJECT_DRAFT_KEY)));
  const [currentStep, setCurrentStep] = useState(() => Math.min(draft?.step ?? 0, draft?.data.targets.every((target) => target === "cli") ? 2 : 3));
  const [data, setData] = useState<ProjectFormData>(draft?.data ?? DEFAULT_DATA);
  const [initializing, setInitializing] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const pathRef = useRef<string | null>(null);
  /** 创建成功的项目记录（幂等重试用：会话启动失败后再点「创建项目」跳过建目录直接启动） */
  const projectRef = useRef<Project | null>(null);
  const [loadingRec, setLoadingRec] = useState<string | null>(null);
  const [recommendationFailed, setRecommendationFailed] = useState(false);
  const { startSession, askWorkspace, disposeWorkspaceSession } = useMintChat(pathRef);

  const updateData = useCallback((patch: Partial<ProjectFormData>) => setData((prev) => ({
    ...prev, ...patch,
    deliveryTouched: { ...prev.deliveryTouched, ...Object.fromEntries(DELIVERY_FIELDS.filter(key => key in patch).map(key => [key, true])) },
  })), []);

  useEffect(() => {
    sessionStorage.setItem(PROJECT_DRAFT_KEY, JSON.stringify({ data, step: currentStep }));
  }, [data, currentStep]);

  // 卸载时清理流程级旁路会话（成功创建导航离开/取消/直接关闭都走这里）
  useEffect(() => () => { disposeWorkspaceSession(); }, [disposeWorkspaceSession]);

  // ── S2 落盘原子化：目录名预热缓存 + Step1 路径实时预览 ──
  const dirNameCacheRef = useRef<{ raw: string; translated: string } | null>(null);
  const [previewDirName, setPreviewDirName] = useState<string | null>(null);

  /** 解析目录名：预热缓存命中直接用；未命中时非 ASCII 现翻译（走旁路共享会话）；ASCII 用原名 */
  const resolveDirName = useCallback(async (raw: string): Promise<string> => {
    const name = raw.trim();
    const cached = dirNameCacheRef.current;
    if (cached?.raw === name) return cached.translated;
    if (!/[^\x00-\x7F]/.test(name)) return name;
    let translated = name;
    try {
      const resp = await askWorkspace(
        buildDirectoryTranslationPrompt(name),
        systemMessage("flow", buildDirectoryTranslationPrompt(name))
      );
      if (resp && /^[a-z0-9-]+$/.test(resp.trim())) translated = resp.trim();
    } catch { /* keep original name */ }
    dirNameCacheRef.current = { raw: name, translated };
    return translated;
  }, [askWorkspace]);

  // 预热：name 输入停顿 1s 后悄悄翻译并缓存（最终创建零等待），预览行同步更新
  const [translating, setTranslating] = useState(false);
  useEffect(() => {
    const name = data.name.trim();
    if (!name) { setPreviewDirName(null); setTranslating(false); return; }
    if (!/[^\x00-\x7F]/.test(name)) { setPreviewDirName(name); setTranslating(false); return; }
    // 非 ASCII：先即时显示原名（预览不空窗），1s 停顿后翻译覆盖；等待期标「翻译中」让在途可见
    setPreviewDirName(name);
    setTranslating(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const resolved = await resolveDirName(name);
      if (!cancelled) { setPreviewDirName(resolved); setTranslating(false); }
    }, 1000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [data.name, resolveDirName]);

  // 目录冲突即时预检：目录名与基目录确定后探测「已存在非空」——Step1 就红字预警（创建必被拒）
  const [dirConflict, setDirConflict] = useState(false);
  useEffect(() => {
    if (!previewDirName || !data.dir.trim()) { setDirConflict(false); return; }
    let cancelled = false;
    window.electronAPI.project.checkDir(data.dir.trim(), previewDirName)
      .then((r) => { if (!cancelled) setDirConflict(r.conflict); })
      .catch(() => { if (!cancelled) setDirConflict(false); });
    return () => { cancelled = true; };
  }, [previewDirName, data.dir]);

  const hasUi = data.targets.some((target) => target !== "cli");
  const visibleSteps = hasUi ? ALL_STEPS : ALL_STEPS.filter((step) => step.number !== 3);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [currentStep]);

  useEffect(() => {
    if (currentStep >= visibleSteps.length) setCurrentStep(visibleSteps.length - 1);
  }, [visibleSteps.length, currentStep]);

  const stepNumber = actualStepNumber(visibleSteps, currentStep);
  const isLastStep = currentStep === visibleSteps.length - 1;

  const canNext = () => {
    return data.name.trim() !== "" && data.dir.trim() !== "" && !dirConflict && !initializing;
  };

  const goPrev = () => setCurrentStep((s) => Math.max(s - 1, 0));

  // S2：Step1 不再落盘——目录/正式会话在最终「创建项目」时原子创建；下一步仅切步骤
  const goNext = () => {
    setCurrentStep((s) => Math.min(s + 1, visibleSteps.length - 1));
  };

  const handleRecommendFeatures = async () => {
    setLoadingRec("features");
    setRecommendationFailed(false);
    const ctx = `项目名称：${data.name}，${buildContext(data, 1)}`;
    const featurePrompt = buildFeatureRecommendPrompt(ctx);
    // 走旁路会话（不再注入正式会话产生隐藏回合）；默认主模型（不传 opts.model）
    const resp = await askWorkspace(featurePrompt, systemMessage("flow", featurePrompt));
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
      if (parsed.length > 0) setData((current) => {
        const seen = new Set(current.features.map((feature) => feature.name.trim().toLocaleLowerCase()));
        const additions = parsed.filter((feature) => {
          const name = feature.name.trim().toLocaleLowerCase();
          if (seen.has(name)) return false;
          seen.add(name);
          return true;
        });
        return { ...current, features: [...current.features, ...additions] };
      });
      else setRecommendationFailed(true);
    }
    else setRecommendationFailed(true);
  };

  // Closing preserves editable draft values; a formal project is only created on submit.
  const handleCancel = () => {
    if (!creatingRef.current) onClose();
  };

  const creatingRef = useRef(false);

  /** Only a successful startup identity completes creation; failures retain the project and draft for retry. */
  const launchSession = useCallback(async (project: Project, prompt: string, payload: SystemMessagePayload): Promise<void> => {
    const identity = await startSession(prompt, payload);
    sessionStorage.removeItem(PROJECT_DRAFT_KEY);
    onCreated(project, identity.sessionId);
  }, [startSession, onCreated]);

  /** S2 原子创建：目录名（预热缓存/现算）→ 落盘 → 建正式会话（cwd=项目目录）→ 导航 */
  const handleCreate = async () => {
    if (creatingRef.current) return;
    if (!data.name.trim()) { setCreateError(uiText("ui.NewProjectDialog.enterAProjectNameFirst")); return; }
    creatingRef.current = true;
    setInitializing(true);
    try {
      // 幂等：首次创建成功但会话启动失败的重试场景——项目已在盘，跳过建目录直接启动
      let project = projectRef.current;
      if (!project) {
        const dirName = await resolveDirName(data.name);
        project = await window.electronAPI.project.create({ name: dirName, path: data.dir.trim() });
        pathRef.current = project.path;
        projectRef.current = project;
      }
      setCreateError(null);

      // 流程深度（原型/文档/编码）的判定权在 Mint（creation-guide skill），前端不参与——
      // 这里只按 产品形态 / 部署 / AI / 存储 四个维度生成技术规范 platformSpec
      const profile = projectProfile(data);
      // 持久化项目产品类型规范,供后续 Mint 会话 buildSystemPrompt 注入
      await saveProjectProfile(project.path, [profile.platformSpec, ...deliveryContext(data)].join("\n"), hasUi ? visualSelection(data) : undefined);
      const initPrompt = buildInitTriggerPrompt(project.path, buildContext(data), buildInitInstruction(profile), data.targets, profile);
      await launchSession(project, initPrompt, systemMessage("project-created", initPrompt));
    } catch (e: unknown) {
      setCreateError(cleanIpcError(e));
      console.error("[NewProjectDialog] create failed:", e);
    } finally {
      setInitializing(false);
      creatingRef.current = false;
    }
  };

  /** 直接创建：跳过表单后续步骤,创建项目 + 发 direct-create 消息触发 Mint 对话引导补全信息 */
  const handleDirectCreate = async () => {
    if (creatingRef.current) return;
    if (!data.name.trim()) { setCreateError(uiText("ui.NewProjectDialog.enterAProjectNameFirst")); return; }
    creatingRef.current = true;
    setInitializing(true);
    try {
      // 与表单路径同一原子创建（目录名共享预热缓存）；kickoff 消息不同（direct-create）
      let project = projectRef.current;
      if (!project) {
        const dirName = await resolveDirName(data.name);
        project = await window.electronAPI.project.create({ name: dirName, path: data.dir.trim() });
        pathRef.current = project.path;
        projectRef.current = project;
      }
      setCreateError(null);
      const profile = projectProfile(data);
      await saveProjectProfile(project.path, [profile.platformSpec, ...deliveryContext(data, true)].join("\n"), hasUi ? visualSelection(data) : undefined);
      // 发 direct-create 系统消息（携带项目名 + 用户已填信息快照）,Mint 开回合按 creation_flow 引导
      const directPrompt = buildDirectCreatePrompt(data.name, buildDirectCreateContext(data));
      await launchSession(project, directPrompt, systemMessage("direct-create", directPrompt));
    } catch (e: unknown) {
      setCreateError(cleanIpcError(e));
      console.error("[NewProjectDialog] direct create failed:", e);
    } finally {
      setInitializing(false);
      creatingRef.current = false;
    }
  };

  const renderStepContent = () => {
    switch (stepNumber) {
      case 1: return <Step1Form data={data} onChange={updateData} previewDirName={previewDirName} dirConflict={dirConflict} translating={translating} />;
      case 2: return <Step2Form data={data} onChange={updateData} onRecommendFeatures={handleRecommendFeatures} loadingRec={loadingRec} recommendationFailed={recommendationFailed} />;
      case 3: return <Step3Form data={data} onChange={updateData} />;
      case 4: return <Step4Form data={data} onChange={updateData} />;
      default: return null;
    }
  };

  return (
    <Modal overlayClassName="creation-dialog-overlay modal-overlay" overlayClose={false} onClose={handleCancel}>
      <div className="creation-dialog modal-card flex flex-col" data-step={stepNumber} role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <div className="flex items-center justify-between px-6 pt-5 pb-1 shrink-0">
          <h2 id="new-project-title" className="text-sm font-medium text-text-secondary">{uiText("nav.newProject")}</h2>
          <button className="creation-icon-button" aria-label={uiText("common.close")} disabled={initializing} onClick={handleCancel}>✕</button>
        </div>

        <StepDots total={visibleSteps.length} current={currentStep} steps={visibleSteps} />

        {/* settings-body 作用域：输入框/下拉触发器在本弹窗内同样走凹槽化（无边框拼色语言） */}
        <div ref={bodyRef} className="settings-body creation-dialog-body overflow-y-auto flex-1">
          <fieldset className="creation-step-content" key={stepNumber} disabled={initializing}>
            {renderStepContent()}
          </fieldset>
          {createError && (
            <p role="alert" className="mt-3 text-xs text-danger whitespace-pre-wrap break-all">{appText(createError)}</p>
          )}
        </div>

        <div className="creation-dialog-footer">
          <button className="em-hover-control px-3 py-2 rounded-[var(--radius-lg)] text-text-secondary text-sm transition-all disabled:opacity-30" disabled={currentStep === 0 || initializing} onClick={goPrev}>{uiText("ui.NewProjectDialog.previousStep")}</button>
          <div className="flex gap-3">
            <div className="flex gap-2">
              <button className="em-hover-control px-2 py-2 rounded-[var(--radius-lg)] text-text-secondary transition-all text-sm disabled:opacity-50" disabled={!canNext()} onClick={handleDirectCreate} title={uiText("creation.directHint")}>
                {uiText("ui.ChatPanel.directCreation")}
              </button>
            </div>
            {!isLastStep ? (
              <button className="px-5 py-2 rounded-[var(--radius-lg)] btn-accent text-sm font-medium" disabled={!canNext()} onClick={goNext}>{uiText("common.next")}</button>
            ) : (
              <button className="px-5 py-2 rounded-[var(--radius-lg)] btn-accent text-sm font-medium" disabled={!canNext()} onClick={handleCreate}>
                {initializing ? uiText("ui.NewProjectDialog.creating") : uiText("ui.NewProjectDialog.createProject")}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
