import { applyFeatureRecommendations } from "./new-project/feature-recommendations";
import { CreationStepViewport } from "./new-project/CreationStepViewport";
import { appText } from "../lib/i18n";
import { uiText, useUiLocale } from "../lib/i18n";
import { useState, useRef, useEffect, useCallback } from "react";
import { buildFeatureRecommendPrompt, buildDirectoryTranslationPrompt, buildDirectCreatePrompt, buildInitTriggerPrompt, buildInitInstruction, systemMessage } from "../../../shared/prompts";
import type { SystemMessagePayload } from "../../../shared/prompts";
import { StepNavigation, Step1Form, Step2Form, Step3Form, Step4Form } from "./new-project/StepComponents";
import { ALL_STEPS, DEFAULT_DATA, SCENE_OPTIONS, TARGET_OPTIONS, UI_STYLE_OPTIONS, type ProjectFormData, type FeatureItem } from "./new-project/ProjectFormTypes";
import { useMintChat } from "./new-project/useMintChat";
import { useSettingsStore } from "../stores/settings-store";
import { Modal } from "./ui/Modal";
import { createVisualSpec, visualSpecPrompt, type VisualSelection } from "../../../shared/visual-design/spec";
function visualSelection(data: ProjectFormData): VisualSelection { return {projectName:data.name,projectDescription:data.description,styleId:data.uiStyle,palette:"default",effect:data.uiEffect,brandId:"",layout:data.uiLayout,targets:data.targets}; }
import { deliveryContext, projectProfile } from "./new-project/project-requirements";
import { deploymentChoices, freshCreationData, updateCreationData } from "./new-project/creation-rules";
import { isRecoverableProject, matchesCreationInput, prepareCreationProject, recommendationContextChanged, type PendingCreation } from "./new-project/project-creation";
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
  push(`名称「${data.name}」，项目形式「${targets}」`);
  if (data.description) push(`描述「${data.description}」`);
  if (data.scene && data.scene !== "unknown") push(`项目场景「${sceneLabel}」`);

  // Step 2+: features
  if (!step || step >= 2) {
    const features = data.features.map((f) => f.name.trim()).filter(Boolean).join("；");
    push(`功能清单：「${features || "待补充"}」`);
  }

  // Step 3+: UI style
  if ((!step || step >= 3) && data.targets.some((target) => target !== "cli")) {
    const uiLabel = UI_STYLE_OPTIONS.find((o) => o.value === data.uiStyle)?.label || data.uiStyle;
    push(`UI 风格「${uiLabel || "未指定"}」`);
    const designContext = visualSpecPrompt(createVisualSpec(visualSelection(data)));
    if (designContext) push(designContext);
  }

  // Step 4+: delivery preferences use the same resolved values as initialization.
  if (!step || step >= 4) parts.push(...deliveryContext(data));

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
  const [data, setData] = useState<ProjectFormData>(() => draft?.data ?? { ...freshCreationData(), dir: useSettingsStore.getState().defaultProjectDir || DEFAULT_DATA.dir });
  const [initializing, setInitializing] = useState(false);
  const [stepTransitioning, setStepTransitioning] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const pathRef = useRef<string | null>(null);
  const [pendingCreation, setPendingCreation] = useState<PendingCreation | undefined>(draft?.pendingCreation);
  const [recoveredProject, setRecoveredProject] = useState<Project | null>(null);
  const [checkingRecovery, setCheckingRecovery] = useState(!!draft?.pendingCreation);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const creationCompleteRef = useRef(false);
  const recommendationGenerationRef = useRef(0);
  const [loadingRec, setLoadingRec] = useState<string | null>(null);
  const [recommendationFailed, setRecommendationFailed] = useState(false);
  const { startSession, askForm, disposeFormRequests } = useMintChat(pathRef);

  const [deploymentNotice, setDeploymentNotice] = useState(draft?.deploymentReset ?? false);
  const updateData = useCallback((patch: Partial<ProjectFormData>) => {
    if (recommendationContextChanged(data, patch)) {
      recommendationGenerationRef.current++;
      setLoadingRec(null);
      setRecommendationFailed(false);
    }
    if (patch.targets) setDeploymentNotice(!deploymentChoices(patch.targets).includes(data.deployPlatform));
    if (patch.deployPlatform) setDeploymentNotice(false);
    setData(previous => updateCreationData(previous, patch));
  }, [data]);

  useEffect(() => {
    if (!creationCompleteRef.current) sessionStorage.setItem(PROJECT_DRAFT_KEY, JSON.stringify({ data, step: currentStep, pendingCreation }));
  }, [data, currentStep, pendingCreation]);

  // A draft supplies only a hint. Never exempt a directory from conflict checks without main-process validation.
  useEffect(() => {
    let cancelled = false;
    setRecoveredProject(null);
    setRecoveryFailed(false);
    if (!pendingCreation) { setCheckingRecovery(false); return; }
    setCheckingRecovery(true);
    void window.electronAPI.project.get(pendingCreation.projectId).then(project => {
      if (cancelled) return;
      if (isRecoverableProject(pendingCreation, project)) setRecoveredProject(project);
      else { setPendingCreation(undefined); setCreateError(uiText("creation.recoveryChanged")); }
    }).catch(() => { if (!cancelled) setRecoveryFailed(true); })
      .finally(() => { if (!cancelled) setCheckingRecovery(false); });
    return () => { cancelled = true; };
  }, [pendingCreation, recoveryAttempt]);

  const continuingCreation = !!recoveredProject && matchesCreationInput(pendingCreation, data);

  // Closing the dialog cancels only its form requests; formal project sessions are independent.
  useEffect(() => () => { recommendationGenerationRef.current++; disposeFormRequests(); }, [disposeFormRequests]);

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
      const resp = await askForm(
        buildDirectoryTranslationPrompt(name),
        "directory-name"
      );
      if (resp && /^[a-z0-9-]+$/.test(resp.trim())) translated = resp.trim();
    } catch { /* keep original name */ }
    dirNameCacheRef.current = { raw: name, translated };
    return translated;
  }, [askForm]);

  // 预热：name 输入停顿 1s 后悄悄翻译并缓存（最终创建零等待），预览行同步更新
  const [translating, setTranslating] = useState(false);
  useEffect(() => {
    const name = data.name.trim();
    if (continuingCreation && pendingCreation) {
      setPreviewDirName(pendingCreation.directoryName);
      setTranslating(false);
      return;
    }
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
  }, [data.name, resolveDirName, continuingCreation, pendingCreation]);

  // 目录冲突即时预检：目录名与基目录确定后探测「已存在非空」——Step1 就红字预警（创建必被拒）
  const [dirConflict, setDirConflict] = useState(false);
  useEffect(() => {
    if (continuingCreation || !previewDirName || !data.dir.trim()) { setDirConflict(false); return; }
    let cancelled = false;
    window.electronAPI.project.checkDir(data.dir.trim(), previewDirName)
      .then((r) => { if (!cancelled) setDirConflict(r.conflict); })
      .catch(() => { if (!cancelled) setDirConflict(false); });
    return () => { cancelled = true; };
  }, [previewDirName, data.dir, continuingCreation]);

  const hasUi = data.targets.some((target) => target !== "cli");
  const visibleSteps = hasUi ? ALL_STEPS : ALL_STEPS.filter((step) => step.number !== 3);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (createError) bodyRef.current?.querySelector<HTMLElement>(".creation-wizard-pane:not([hidden])")?.scrollTo({ top: 0 }); }, [createError]);

  useEffect(() => {
    if (currentStep >= visibleSteps.length) setCurrentStep(visibleSteps.length - 1);
  }, [visibleSteps.length, currentStep]);

  const stepNumber = actualStepNumber(visibleSteps, currentStep);
  const isLastStep = currentStep === visibleSteps.length - 1;

  const canNext = () => {
    return data.name.trim() !== "" && data.dir.trim() !== "" && (!dirConflict || continuingCreation) && !initializing && !checkingRecovery && !recoveryFailed;
  };

  const goPrev = () => setCurrentStep((s) => Math.max(s - 1, 0));

  // S2：Step1 不再落盘——目录/正式会话在最终「创建项目」时原子创建；下一步仅切步骤
  const goNext = () => {
    setCurrentStep((s) => Math.min(s + 1, visibleSteps.length - 1));
  };

  const handleRecommendFeatures = async () => {
    const generation = ++recommendationGenerationRef.current;
    setLoadingRec("features");
    setRecommendationFailed(false);
    const ctx = `项目名称：${data.name}，${buildContext(data, 1)}`;
    const featurePrompt = buildFeatureRecommendPrompt(ctx);
    // 表单辅助仅请求文本，沿用当前默认模型。
    const resp = await askForm(featurePrompt, "features");
    if (generation !== recommendationGenerationRef.current) return;
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
        if (generation !== recommendationGenerationRef.current) return current;
        return { ...current, features: applyFeatureRecommendations(current.features, parsed) };
      });
      else setRecommendationFailed(true);
    }
    else setRecommendationFailed(true);
  };

  // Closing preserves the draft, including a verifiable hint if submission already created a project.
  const handleCancel = () => {
    if (!creatingRef.current) onClose();
  };

  const creatingRef = useRef(false);

  /** Only a successful startup identity completes creation; failures retain the project and draft for retry. */
  const launchSession = useCallback(async (project: Project, prompt: string, payload: SystemMessagePayload): Promise<void> => {
    const identity = await startSession(prompt, payload);
    creationCompleteRef.current = true;
    sessionStorage.removeItem(PROJECT_DRAFT_KEY);
    onCreated(project, identity.sessionId);
  }, [startSession, onCreated]);

  const prepareProject = async (): Promise<Project> => {
    recommendationGenerationRef.current++;
    setLoadingRec(null);
    const result = await prepareCreationProject(data, pendingCreation, window.electronAPI.project, resolveDirName);
    if (!result) {
      setPendingCreation(undefined);
      setRecoveredProject(null);
      throw new Error(uiText("creation.recoveryChanged"));
    }
    pathRef.current = result.project.path;
    setPendingCreation(result.pending);
    setRecoveredProject(result.project);
    // Persist immediately: later profile/session failures must not orphan the created project on reopen.
    sessionStorage.setItem(PROJECT_DRAFT_KEY, JSON.stringify({ data, step: currentStep, pendingCreation: result.pending }));
    return result.project;
  };

  /** Submit: resolve or recover the project, persist its configuration, start a session, then navigate. */
  const handleCreate = async () => {
    if (creatingRef.current || stepTransitioning) return;
    if (!data.name.trim()) { setCreateError(uiText("ui.NewProjectDialog.enterAProjectNameFirst")); return; }
    creatingRef.current = true;
    setInitializing(true);
    try {
      const project = await prepareProject();
      setCreateError(null);

      // 流程深度（原型/文档/编码）的判定权在 Mint（creation-guide skill），前端不参与——
      // 这里只按 产品形态 / 部署 / AI / 存储 四个维度生成技术规范 platformSpec
      const profile = projectProfile(data);
      // 持久化项目产品类型规范,供后续 Mint 会话 buildSystemPrompt 注入
      await saveProjectProfile(project.path, [profile.platformSpec, profile.initSteps, ...deliveryContext(data)].join("\n"), hasUi ? visualSelection(data) : undefined);
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
    if (creatingRef.current || stepTransitioning) return;
    if (!data.name.trim()) { setCreateError(uiText("ui.NewProjectDialog.enterAProjectNameFirst")); return; }
    creatingRef.current = true;
    setInitializing(true);
    try {
      const project = await prepareProject();
      setCreateError(null);
      const profile = projectProfile(data);
      await saveProjectProfile(project.path, [profile.platformSpec, profile.initSteps, ...deliveryContext(data, true)].join("\n"), hasUi ? visualSelection(data) : undefined);
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

  const renderStepContent = (number: number) => {
    switch (number) {
      case 1: return <Step1Form data={data} onChange={updateData} previewDirName={previewDirName} dirConflict={dirConflict} translating={translating} />;
      case 2: return <Step2Form data={data} onChange={updateData} onRecommendFeatures={handleRecommendFeatures} loadingRec={loadingRec} recommendationFailed={recommendationFailed} />;
      case 3: return <Step3Form data={data} onChange={updateData} active={stepNumber === 3} />;
      case 4: return <Step4Form data={data} onChange={updateData} />;
      default: return null;
    }
  };

  const notices = <>
    {deploymentNotice && <p role="status" className="creation-wizard-notice">{uiText("creation.deploymentReset")}</p>}
    {checkingRecovery && <p role="status" className="creation-wizard-notice">{uiText("creation.checkingRecovery")}</p>}
    {recoveryFailed && <p role="alert" className="creation-wizard-notice text-danger">{uiText("creation.recoveryFailed")} <button type="button" className="underline" onClick={() => setRecoveryAttempt(value => value + 1)}>{uiText("creation.checkAgain")}</button></p>}
    {!checkingRecovery && !recoveryFailed && recoveredProject && <p role="status" className="creation-wizard-notice">{uiText(continuingCreation ? "creation.resumeHint" : "creation.newIdentityHint")}</p>}
    {createError && <p role="alert" className="creation-wizard-notice text-danger whitespace-pre-wrap break-all">{appText(createError)}</p>}
  </>;
  const selectedStep = visibleSteps[currentStep] ?? visibleSteps[0]!;
  const subtitle = (stepNumber === 1 ? uiText("creation.wizard.basicsHint") : selectedStep.desc).replace(/[。.]+$/, "");
  const selectStep = (index: number) => {
    if (initializing || (index > currentStep && !canNext())) return;
    setCurrentStep(index);
  };

  return (
    <Modal overlayClassName="creation-dialog-overlay modal-overlay" overlayClose={false} onClose={handleCancel}>
      <div className="creation-dialog creation-wizard modal-card" data-step={stepNumber} role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <aside className="creation-wizard-rail">
          <h2 id="new-project-title" className="creation-wizard-title">{uiText("nav.newProject")}</h2>
          <StepNavigation current={currentStep} steps={visibleSteps} onSelect={selectStep} disabled={initializing} canAdvance={canNext()} />
          <div className="creation-wizard-draft"><span aria-hidden="true" />{uiText(initializing ? "ui.NewProjectDialog.creating" : "creation.wizard.draftSaved")}</div>
        </aside>
        <div className="creation-wizard-main" ref={bodyRef}>
          <header className="creation-wizard-header">
            <div className="creation-wizard-heading" key={stepNumber}>
              <h3 className="creation-wizard-step-title" tabIndex={-1}>{selectedStep.title}</h3>
              <p>{subtitle}</p>
            </div>
            <button type="button" className="creation-icon-button" aria-label={uiText("common.close")} disabled={initializing} onClick={handleCancel}>×</button>
          </header>
          <CreationStepViewport step={stepNumber} onTransitionChange={setStepTransitioning} pages={visibleSteps.map(info => ({ id: info.number, content: <>
            {notices}
            <fieldset className="creation-step-content" disabled={initializing || stepTransitioning} aria-label={info.title}>
              {renderStepContent(info.number)}
            </fieldset>
          </> }))} />
          <footer className="creation-wizard-footer">
            <button type="button" className="creation-wizard-previous" disabled={currentStep === 0 || initializing} onClick={goPrev}>{uiText("ui.NewProjectDialog.previousStep")}</button>
            <div>
              <button type="button" className="creation-wizard-direct" disabled={!canNext() || stepTransitioning} onClick={handleDirectCreate} title={uiText("creation.directHint")}>{uiText("ui.ChatPanel.directCreation")}</button>
              {!isLastStep ? <button type="button" className="btn-accent creation-wizard-next" disabled={!canNext()} onClick={goNext}>{uiText("common.next")}</button>
                : <button type="button" className="btn-accent creation-wizard-next" disabled={!canNext() || stepTransitioning} onClick={handleCreate}>{uiText(initializing ? "ui.NewProjectDialog.creating" : "ui.NewProjectDialog.createProject")}</button>}
            </div>
          </footer>
        </div>
      </div>
    </Modal>
  );
}
