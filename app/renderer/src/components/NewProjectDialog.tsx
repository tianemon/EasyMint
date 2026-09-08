import { useState, useRef, useEffect, useCallback } from "react";
import { buildFeatureRecommendPrompt, buildDirectoryTranslationPrompt, buildDirectCreatePrompt, buildInitTriggerPrompt, buildInitInstruction, detectProfile, composeProfile, systemMessage } from "../../../shared/prompts";
import type { ProjectDimensions, DeployMode, SystemMessagePayload } from "../../../shared/prompts";
import { StepDots, Step1Form, Step2Form, Step3Form, Step4Form } from "./new-project/StepComponents";
import { ALL_STEPS, DEFAULT_DATA, SCENE_OPTIONS, TARGET_OPTIONS, UI_STYLE_OPTIONS, type ProjectFormData, type FeatureItem } from "./new-project/ProjectFormTypes";
import { useMintChat } from "./new-project/useMintChat";
import { Modal } from "./ui/Modal";

// ---- Helpers ----

/** IPC 错误剥壳：invoke 抛错被 Electron 包装成 "Error invoking remote method 'x': Error: 中文"，
 *  去掉包装只留业务文案（技术报错不展示原始堆栈） */
function cleanIpcError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const m = msg.match(/^Error invoking remote method '[^']+': (?:Error: )?([\s\S]+)$/);
  return (m?.[1]?.trim() || msg).trim() || "创建项目失败";
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
  const [initializing, setInitializing] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const pathRef = useRef<string | null>(null);
  /** 创建成功的项目记录（幂等重试用：会话启动失败后再点「创建项目」跳过建目录直接启动） */
  const projectRef = useRef<Project | null>(null);
  const [loadingRec, setLoadingRec] = useState<string | null>(null);
  const { ask, askWorkspace, disposeWorkspaceSession, sidRef } = useMintChat(pathRef);

  const updateData = useCallback((patch: Partial<ProjectFormData>) => setData((prev) => ({ ...prev, ...patch })), []);

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
    const t = setTimeout(async () => {
      setPreviewDirName(await resolveDirName(name));
      setTranslating(false);
    }, 1000);
    return () => clearTimeout(t);
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

  // S2：Step1 不再落盘——目录/正式会话在最终「创建项目」时原子创建；下一步仅切步骤
  const goNext = () => {
    setCurrentStep((s) => Math.min(s + 1, visibleSteps.length - 1));
  };

  const handleRecommendFeatures = async () => {
    setLoadingRec("features");
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

  // S2：取消 = 丢弃草稿（落盘已移到最终创建，表单期无任何磁盘动作）
  const handleCancel = () => {
    onClose();
  };

  const creatingRef = useRef(false);

  /** 等待正式会话 sid 就位（onChatSession 回绑，毫秒级；最多 5s 兜底）——就位即导航，首消息在聊天流式出现 */
  const waitForSid = async (): Promise<string | null> => {
    for (let i = 0; i < 50; i++) {
      if (sidRef.current) return sidRef.current;
      await new Promise((r) => setTimeout(r, 100));
    }
    return sidRef.current;
  };

  /**
   * S3 统一启动：kickoff 消息发正式会话（fire-and-forget，首回合在聊天流式进行）→ sid 就位即导航。
   * 失败路径：ask 失败留在弹窗（createError 可见，项目已建则幂等跳过建目录再点即重试）；
   * 导航后异常 = 项目页自然态（无会话可随时发起对话），非死胡同——无需专用重试按钮。
   */
  const launchSession = useCallback(async (project: Project, prompt: string, payload: SystemMessagePayload): Promise<void> => {
    ask(prompt, { forceNewSession: true, systemPayload: payload }).catch(() => {
      // 回合启动失败：弹窗可能已导航走（sid 先到）——聊天页空态可自然对话；未导航则 createError 由调用方展示
      console.error("[NewProjectDialog] session kickoff failed");
    });
    const sid = await waitForSid();
    onCreated(project, sid);
  }, [ask, onCreated]);

  /** S2 原子创建：目录名（预热缓存/现算）→ 落盘 → 建正式会话（cwd=项目目录）→ 导航 */
  const handleCreate = async () => {
    if (creatingRef.current) return;
    if (!data.name.trim()) { setCreateError("请先填写项目名称"); return; }
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
      window.electronAPI.project.saveProfile(project.path, profile.platformSpec).catch(() => {});
      const initPrompt = buildInitTriggerPrompt(project.path, buildContext(data), buildInitInstruction(profile), data.targets);
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
    if (!data.name.trim()) { setCreateError("请先填写项目名称"); return; }
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
      case 2: return <Step2Form data={data} onChange={updateData} onRecommendFeatures={handleRecommendFeatures} loadingRec={loadingRec} />;
      case 3: return <Step3Form data={data} onChange={updateData} />;
      case 4: return <Step4Form data={data} onChange={updateData} />;
      default: return null;
    }
  };

  return (
    <Modal overlayClassName="bg-black/50 modal-overlay" overlayClose={false} onClose={handleCancel}>
      <div className="bg-surface-alt rounded-xl border border-border shadow-2xl modal-card flex flex-col" style={{ width: 560, maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-6 pt-5 pb-1 shrink-0">
          <h2 className="text-lg font-semibold text-text-primary">新建项目</h2>
          <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors" onClick={handleCancel}>✕</button>
        </div>

        <StepDots total={visibleSteps.length} current={currentStep} />

        <div className="px-6 pb-1 shrink-0">
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {renderStepContent()}
          {createError && (
            <p className="mt-3 text-xs text-danger whitespace-pre-wrap break-all">{createError}</p>
          )}
        </div>

        <div className="flex items-center justify-between px-6 pb-5 pt-2 shrink-0">
          <button className="px-4 py-2 rounded-lg text-text-secondary text-sm hover:bg-surface-hover transition-colors disabled:opacity-30" disabled={currentStep === 0} onClick={goPrev}>上一步</button>
          <div className="flex gap-3">
            <div className="flex gap-2">
              {/* S2：取消 = 丢弃草稿（落盘已移到最终创建，不再有「取消项目=删真目录」的歧义） */}
              <button className="ml-0.5 px-2 py-0 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors text-sm" onClick={handleCancel}>取消</button>
              <button className="px-2 py-0 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors text-sm disabled:opacity-50" disabled={initializing} onClick={handleDirectCreate}>
                {initializing ? "创建中..." : "直接创建"}
              </button>
            </div>
            {!isLastStep ? (
              <button className="px-6 py-2 rounded-lg btn-accent text-sm font-medium" disabled={!canNext()} onClick={goNext}>下一步</button>
            ) : (
              <button className="px-6 py-2 rounded-lg btn-accent text-sm font-medium" disabled={!canNext() || initializing} onClick={handleCreate}>
                {initializing ? "创建中..." : "创建项目"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
