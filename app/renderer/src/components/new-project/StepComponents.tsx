import { uiText, useUiLocale } from "../../lib/i18n";
import { useState, useRef, useEffect } from "react";
import {
  TARGET_OPTIONS, SCENE_OPTIONS, COMPLETENESS_OPTIONS, UI_STYLE_OPTIONS, BUDGET_OPTIONS,
  type ProjectFormData, type FeatureItem, type BudgetChoice, type SceneChoice,
} from "./ProjectFormTypes";
import type { AIIntegration } from "../../../../shared/prompts";

export type { ProjectFormData };

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
  useUiLocale();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  // 定位:菜单高度已知后钳制在视口内——底部放不下则向上展开,防止弹窗底部行的下拉超出屏幕
  const placeMenu = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = r.width;
    const h = menuRef.current?.offsetHeight ?? 0;
    let top = r.bottom + 4;
    if (h > 0 && top + h > window.innerHeight - 4) {
      const up = r.top - h - 4;
      top = up >= 4 ? up : Math.max(4, window.innerHeight - h - 4);
    }
    setPos({ top, left: r.left, width });
  };

  useEffect(() => {
    if (!open) return;
    placeMenu();
    // 点击触发器按钮不在此关闭(由 onClick 的 toggle 切换)——否则 mousedown 关闭+同步 flush+click 翻转,菜单收不回去
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    window.addEventListener("scroll", placeMenu, true);
    window.addEventListener("resize", placeMenu);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("scroll", placeMenu, true);
      window.removeEventListener("resize", placeMenu);
    };
  }, [open]);

  return (
    <div>
      <button
        ref={btnRef}
        className="em-select-trigger w-full flex items-center justify-between px-3 py-2 rounded-[var(--radius-lg)] bg-surface border border-border text-text-primary text-sm outline-none text-left"
        onClick={() => setOpen(!open)}
      >
        <span className={selected ? "text-text-primary" : "text-text-secondary"}>
          {selected ? `${selected.label} — ${selected.desc}` : (placeholder || uiText("ui.StepComponents.choose"))}
        </span>
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className={`w-3 h-3 shrink-0 transition-transform text-text-secondary ${open ? "rotate-180" : ""}`}>
          <path d="M3 5l3 3 3-3"/>
        </svg>
      </button>
      {open && (
        <div ref={menuRef} className="fixed z-dropdown bg-surface-elevated rounded-[var(--radius-lg)] shadow-lg max-h-52 overflow-y-auto" style={{ top: pos.top, left: pos.left, width: pos.width }}>
          {options.map((o) => (
            <button
              key={o.value}
              className={`w-full text-left px-3 py-2 text-sm transition-all ${o.value === value ? "bg-accent-soft text-accent" : "text-text-primary em-hover-control"}`}
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

// ---- Step 1: 基本信息 ----

function Step1Form({ data, onChange, previewDirName, dirConflict, translating }: { data: ProjectFormData; onChange: (p: Partial<ProjectFormData>) => void; previewDirName?: string | null; dirConflict?: boolean; translating?: boolean }): JSX.Element {
  useUiLocale();
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
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.projectName")}<span className="text-danger">*</span></label>
        <input className="em-input px-3 py-2" value={data.name} onChange={(e) => onChange({ name: e.target.value })} placeholder={uiText("ui.StepComponents.chineseNamesAreTranslatedIntoEnglishDirectory")} />
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.projectDirectory")}<span className="text-danger">*</span></label>
        <button
          className="em-select-trigger em-hover-control w-full px-3 py-2 rounded-[var(--radius-lg)] bg-surface border border-border text-left text-sm transition-all"
          onClick={async () => { const selected = await window.electronAPI.dialog.openDirectory(); if (selected) onChange({ dir: selected }); }}
        >
          <span className="text-text-secondary">{data.dir || uiText("ui.StepComponents.chooseADirectory")}</span>
        </button>
        {/* 实时路径预览——教会用户「我的文件在哪」；目录冲突在此行红字预警（创建必被拒） */}
        {previewDirName && (
          dirConflict ? (
            <p className="mt-1 text-[length:var(--text-3xs)] text-danger">
              {uiText("ui.StepComponents.thisDirectoryExistsAndIsNonemptyOr")}</p>
          ) : (
            <p className="mt-1 text-[length:var(--text-3xs)] text-text-muted">
              {uiText("ui.StepComponents.willBeCreatedAt")}<span className="font-mono text-text-secondary">{data.dir}/{previewDirName}</span>
              {translating && <span className="ml-1.5 text-text-muted">{uiText("ui.StepComponents.translatingDirectoryName")}</span>}
            </p>
          )
        )}
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.projectDescription")}<span className="text-text-muted text-xs font-normal">{uiText("ui.StepComponents.optionalDescribeYourIdeaInOneSentence")}</span></label>
        <textarea className="em-input px-3 py-2 min-h-[60px] resize-y" value={data.description} onChange={(e) => onChange({ description: e.target.value })} placeholder={uiText("ui.StepComponents.eGAPersonalAppForTracking")} />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.howWillYouUseThisProject")}<span className="text-text-muted text-xs font-normal">{uiText("ui.StepComponents.mintCanHelpDecide")}</span></label>
        <Select value={data.scene} onChange={(v) => onChange({ scene: v as SceneChoice })} options={SCENE_OPTIONS} placeholder={uiText("ui.ProjectFormTypes.notSureLetAiDecide")} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-text-primary">{uiText("ui.StepComponents.projectType")}<span className="text-text-muted text-xs font-normal">{uiText("ui.StepComponents.platformsAndDeliveryFormatsSelectMultiple")}</span></label>
          <button className="px-2 py-0.5 rounded-[var(--radius-lg)] bg-accent-soft text-accent text-xs hover:bg-accent-bg transition-colors" onClick={addTarget}>{uiText("ui.StepComponents.add")}</button>
        </div>
        <div className="space-y-2">
          {data.targets.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <Select value={t} onChange={(v) => updateTarget(i, v)} options={TARGET_OPTIONS} />
              </div>
              {data.targets.length > 1 && (
                <button className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-lg)] text-text-secondary hover:text-danger transition-colors shrink-0" onClick={() => removeTarget(i)}>✕</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Step 2: 功能清单 ----

function Step2Form({
  data, onChange, onRecommendFeatures, loadingRec,
}: {
  data: ProjectFormData;
  onChange: (p: Partial<ProjectFormData>) => void;
  onRecommendFeatures: () => void;
  loadingRec: string | null;
}): JSX.Element {
  useUiLocale();
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
        <label className="block text-sm font-medium text-text-primary">{uiText("ui.ProjectFormTypes.features")}<span className="text-text-muted text-xs font-normal">{uiText("ui.StepComponents.optional")}</span></label>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 rounded-[var(--radius-lg)] btn-accent text-sm font-medium" onClick={onRecommendFeatures} disabled={loadingRec === "features"}>
            {loadingRec === "features" ? uiText("ui.StepComponents.mintIsThinking") : uiText("ui.StepComponents.mintSuggests")}
          </button>
          <button className="px-3 py-1.5 rounded-[var(--radius-lg)] bg-accent-soft text-accent text-xs hover:bg-accent-bg transition-colors" onClick={addFeature}>{uiText("ui.StepComponents.addFeature")}</button>
        </div>
      </div>

      {loadingRec === "features" && (
        <p className="text-xs text-text-secondary py-3 text-center animate-pulse">{uiText("ui.StepComponents.mintIsSuggestingFeatures")}</p>
      )}
      {data.features.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className="flex-1 em-input px-3 py-2"
            value={f.name}
            onChange={(e) => updateFeature(i, { name: e.target.value })}
            placeholder={uiText("ui.StepComponents.feature", { v0: i + 1 })}
          />
          <button className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-lg)] text-text-secondary hover:text-danger transition-colors text-xs shrink-0" onClick={() => removeFeature(i)}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ---- Step 3: UI 风格 ----

function Step3Form({ data, onChange }: { data: ProjectFormData; onChange: (p: Partial<ProjectFormData>) => void }): JSX.Element {
  useUiLocale();
  const predefined = UI_STYLE_OPTIONS.find((o) => o.value === data.uiStyle);
  const isCustomText = data.uiStyle === "custom" || (!predefined && data.uiStyle !== "");

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.whatUiStyleWouldYouLike")}<span className="text-text-muted text-xs font-normal">{uiText("ui.StepComponents.optional")}</span></label>
        <Select
          value={predefined ? data.uiStyle : "custom"}
          onChange={(v) => onChange({ uiStyle: v })}
          options={UI_STYLE_OPTIONS}
          placeholder={uiText("ui.StepComponents.askMintToSuggest")}
        />
        <p className="text-[length:var(--text-11)] text-text-secondary mt-1">{uiText("ui.StepComponents.youCanAdjustThisDuringPrototyping")}</p>
      </div>
      {isCustomText && (
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.describeACustomStyle")}</label>
          <textarea className="em-input px-3 py-2 min-h-[60px] resize-y" value={data.uiStyle === "custom" ? "" : data.uiStyle} onChange={(e) => onChange({ uiStyle: e.target.value })} placeholder={uiText("ui.StepComponents.eGAMixOfCyberpunkAnd")} />
        </div>
      )}
    </div>
  );
}

// ---- Step 4: 交付方式 ----

function Step4Form({ data, onChange }: { data: ProjectFormData; onChange: (p: Partial<ProjectFormData>) => void }): JSX.Element {
  useUiLocale();
  return (
    <div className="space-y-5">

      {/* 完成度 */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.whatShouldTheFirstVersionInclude")}<span className="text-text-muted text-xs font-normal">{uiText("ui.StepComponents.optionalAiCanHelpDecide")}</span></label>
        <div className="flex gap-2">
          {COMPLETENESS_OPTIONS.map((opt) => {
            const active = data.completeness === opt.value;
            return (
              <button
                key={opt.value}
                className={`flex-1 p-3 rounded-[var(--radius-lg)] transition-all text-left ${active
                  ? "bg-[var(--preset-active)] text-text-primary"
                  : "bg-[var(--preset-idle)] hover:shadow-[inset_0_0_0_999px_var(--preset-hover)] text-text-secondary"}`}
                onClick={() => onChange({ completeness: opt.value })}
              >
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs text-text-muted mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* AI 集成 */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.aiIntegration")}<span className="text-text-muted text-xs font-normal">{uiText("ui.StepComponents.optional")}</span></label>
        <p className="text-[length:var(--text-11)] text-text-secondary mb-2">{uiText("ui.StepComponents.aiAssistanceAndAgentsRequireAnLlm")}</p>
        <div className="flex gap-2">
          {[
            { value: "none", label: uiText("ui.StepComponents.notNeeded"), desc: uiText("ui.StepComponents.noAi") },
            { value: "assistant", label: uiText("ui.NewProjectDialog.aiAssistance"), desc: uiText("ui.StepComponents.enhanceFeaturesWithAnLlmApi") },
            { value: "agent", label: "Agent", desc: uiText("ui.StepComponents.autonomousDecisionsAndToolUse") },
          ].map((opt) => {
            const active = data.aiIntegration === opt.value;
            return (
              <button key={opt.value} className={`flex-1 p-2 rounded-[var(--radius-lg)] transition-all text-left ${active ? "bg-[var(--preset-active)] text-text-primary" : "bg-[var(--preset-idle)] hover:shadow-[inset_0_0_0_999px_var(--preset-hover)] text-text-secondary"}`} onClick={() => onChange({ aiIntegration: opt.value as AIIntegration })}>
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 部署方式 */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.deployment")}<span className="text-text-muted text-xs font-normal">{uiText("ui.StepComponents.optionalAiCanHelpDecide")}</span></label>
        <div className="flex gap-2">
          <button
            className={`flex-1 p-2 rounded-[var(--radius-lg)] transition-all text-left ${data.deployPlatform === "本地" ? "bg-[var(--preset-active)] text-text-primary" : "bg-[var(--preset-idle)] hover:shadow-[inset_0_0_0_999px_var(--preset-hover)] text-text-secondary"}`}
            onClick={() => onChange({ deployPlatform: "本地" })}
          >
            <div className="text-sm font-medium">{uiText("ui.StepComponents.local")}</div>
            <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">{uiText("ui.StepComponents.runLocallyWithoutCloudServices")}</div>
          </button>
          <button
            className={`flex-1 p-2 rounded-[var(--radius-lg)] transition-all text-left ${data.deployPlatform === "云端" ? "bg-[var(--preset-active)] text-text-primary" : "bg-[var(--preset-idle)] hover:shadow-[inset_0_0_0_999px_var(--preset-hover)] text-text-secondary"}`}
            onClick={() => onChange({ deployPlatform: "云端" })}
          >
            <div className="text-sm font-medium">{uiText("ui.StepComponents.cloud")}</div>
            <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">{uiText("ui.StepComponents.accessibleOnlineServerCostsApply")}</div>
          </button>
          <button
            className={`flex-1 p-2 rounded-[var(--radius-lg)] transition-all text-left ${data.deployPlatform === "混合" ? "bg-[var(--preset-active)] text-text-primary" : "bg-[var(--preset-idle)] hover:shadow-[inset_0_0_0_999px_var(--preset-hover)] text-text-secondary"}`}
            onClick={() => onChange({ deployPlatform: "混合" })}
          >
            <div className="text-sm font-medium">{uiText("ui.StepComponents.hybrid")}</div>
            <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">{uiText("ui.StepComponents.localUiWithCloudSync")}</div>
          </button>
        </div>
      </div>

      {/* 预算 */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.developmentAndOperationsBudget")}<span className="text-text-muted text-xs font-normal">{uiText("ui.StepComponents.optionalAiCanHelpDecide")}</span></label>
        <div className="flex gap-2">
          {BUDGET_OPTIONS.map((opt) => {
            const active = data.techBudget === opt.value;
            return (
              <button key={opt.value} className={`flex-1 p-3 rounded-[var(--radius-lg)] transition-all text-left ${active ? "bg-[var(--preset-active)] text-text-primary" : "bg-[var(--preset-idle)] hover:shadow-[inset_0_0_0_999px_var(--preset-hover)] text-text-secondary"}`} onClick={() => onChange({ techBudget: opt.value as BudgetChoice })}>
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs text-text-muted mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { StepDots, Step1Form, Step2Form, Step3Form, Step4Form };
