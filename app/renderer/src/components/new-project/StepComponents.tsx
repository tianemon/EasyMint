import { isMobileTarget } from "@shared/project-targets";
import { uiText, useUiLocale } from "../../lib/i18n";
import { useState, useRef, useEffect } from "react";
import {
  TARGET_OPTIONS, SCENE_OPTIONS, COMPLETENESS_OPTIONS, BUDGET_OPTIONS,
  type ProjectFormData, type FeatureItem, type BudgetChoice, type SceneChoice,
} from "./ProjectFormTypes";
import type { AIIntegration } from "../../../../shared/prompts";
import { deploymentChoices } from "./creation-rules";
import { StylePicker } from "./StylePicker";

export type { ProjectFormData };

function StepNavigation({ current, steps, onSelect, disabled, canAdvance }: {
  current: number; steps: { number: number; title: string; desc: string }[];
  onSelect: (index: number) => void; disabled: boolean; canAdvance: boolean;
}): JSX.Element {
  return <nav className="creation-wizard-nav" aria-label={uiText("creation.progress")}>
    <span className="creation-wizard-selection" aria-hidden="true" style={{ transform: `translateY(calc(${current} * (var(--creation-step-size) + 8px)))` }} />
    {steps.map((step, index) => <button type="button" key={step.number}
      className={`creation-wizard-nav-step${index < current ? " is-complete" : ""}`}
      aria-current={index === current ? "step" : undefined}
      disabled={disabled || (index > current && !canAdvance)} onClick={() => onSelect(index)}>
      <span className="creation-wizard-number" aria-hidden="true">{index < current ? "✓" : index + 1}</span>
      <span><strong>{step.title}</strong></span>
    </button>)}
  </nav>;
}

// ---- Custom Select (matches white+green theme) ----

function Select({ value, onChange, options, placeholder, descriptions = true }: { value: string; onChange: (v: string) => void; options: readonly { value: string; label: string; desc: string }[]; placeholder?: string; descriptions?: boolean }): JSX.Element {
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
        className="em-select-trigger w-full flex items-center justify-between px-3 py-2 rounded-[var(--radius-lg)] bg-surface text-text-primary text-sm outline-none text-left"
        onClick={() => setOpen(!open)}
      >
        <span className={selected ? "text-text-primary" : "text-text-secondary"}>
          {selected ? descriptions ? `${selected.label} — ${selected.desc}` : selected.label : (placeholder || uiText("ui.StepComponents.choose"))}
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
              {descriptions && <span className="text-text-secondary ml-1.5 text-xs">{o.desc}</span>}
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
  const directoryPath = previewDirName
    ? `${data.dir.replace(/[\\/]+$/, "")}${data.dir.includes("\\") ? "\\" : "/"}${previewDirName}`
    : data.dir;
  const targetGroups = [
    { label: uiText("creation.platform.webTools"), values: ["web", "wechat-miniprogram", "cli"] },
    { label: uiText("creation.platform.desktop"), values: ["windows-desktop", "macos-desktop", "linux-desktop"] },
    { label: uiText("creation.platform.mobile"), values: ["ios-mobile", "android-mobile", "harmony-mobile"] },
  ];
  const toggleTarget = (value: string) => {
    const selected = data.targets.includes(value);
    if (selected && data.targets.length === 1) return;
    onChange({ targets: selected ? data.targets.filter(target => target !== value) : [...data.targets, value] });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.projectName")}<span className="text-danger">*</span></label>
        <input className="em-input px-3 py-2" aria-label={uiText("ui.StepComponents.projectName")} value={data.name} onChange={(e) => onChange({ name: e.target.value })} placeholder={uiText("creation.namePlaceholder")} />
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.projectDirectory")}<span className="text-danger">*</span></label>
        <button
          className="em-select-trigger em-hover-control w-full px-3 py-2 rounded-[var(--radius-lg)] bg-surface text-left text-sm transition-all"
          aria-label={uiText("ui.StepComponents.projectDirectory")}
          aria-describedby="project-location-value"
          aria-busy={translating || undefined}
          title={directoryPath}
          onClick={async () => { const selected = await window.electronAPI.dialog.openDirectory(); if (selected) onChange({ dir: selected }); }}
        >
          <span id="project-location-value" className="text-text-secondary break-all">{directoryPath || uiText("ui.StepComponents.chooseADirectory")}</span>
        </button>
        {dirConflict && <p role="alert" className="mt-1 text-xs text-danger">{uiText("ui.StepComponents.thisDirectoryExistsAndIsNonemptyOr")}</p>}
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.projectDescription")}</label>
        <textarea className="em-input px-3 py-2 min-h-[60px] resize-y" value={data.description} onChange={(e) => onChange({ description: e.target.value })} placeholder={uiText("ui.StepComponents.eGAPersonalAppForTracking")} />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.howWillYouUseThisProject")}</label>
        <Select value={data.scene} onChange={(v) => onChange({ scene: v as SceneChoice })} options={SCENE_OPTIONS} descriptions={false} placeholder={uiText("ui.ProjectFormTypes.notSureLetAiDecide")} />
      </div>

      <div className="creation-target-field">
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.projectType")}</label>
        {targetGroups.map(group => <div key={group.label} className="creation-target-group" role="group" aria-label={group.label}>
          <span className="creation-target-group-label">{group.label}</span>
          <div className="creation-target-options">{group.values.map(value => {
            const option = TARGET_OPTIONS.find(item => item.value === value)!;
            return <button type="button" key={value} aria-pressed={data.targets.includes(value)} title={option.desc}
              onClick={() => toggleTarget(value)}>{option.label}</button>;
          })}</div>
        </div>)}
      </div>
    </div>
  );
}

// ---- Step 2: 功能清单 ----

function Step2Form({
  data, onChange, onRecommendFeatures, loadingRec, recommendationFailed,
}: {
  data: ProjectFormData;
  onChange: (p: Partial<ProjectFormData>) => void;
  onRecommendFeatures: () => void;
  loadingRec: string | null;
  recommendationFailed?: boolean;
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
        <label className="block text-sm font-medium text-text-primary">{uiText("ui.ProjectFormTypes.features")}</label>
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
      {recommendationFailed && <p role="alert" className="text-xs text-danger py-2">{uiText("creation.featuresRetry")}</p>}
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

function Step3Form({ data, onChange, active = true }: { data: ProjectFormData; onChange: (p: Partial<ProjectFormData>) => void; active?: boolean }): JSX.Element {
  return <StylePicker active={active} layout={data.uiLayout} targets={data.targets} projectName={data.name} projectDescription={data.description} appearance={{ palette: "default", effect: data.uiEffect }} onAppearanceChange={(value) => onChange({ uiPalette: "default", uiEffect: value.effect, uiBrand: "" })} value={data.uiStyle} onChange={(uiStyle) => onChange({ uiStyle, ...(uiStyle === "liquid-glass" && data.uiStyle !== uiStyle ? { uiEffect: "subtle" } : {}) })} defaultDevice={!data.targets.includes("web") && data.targets.some((target) => isMobileTarget(target) || target === "wechat-miniprogram") ? "mobile" : "web"} />;
}

// ---- Step 4: 交付方式 ----

function Step4Form({ data, onChange }: { data: ProjectFormData; onChange: (p: Partial<ProjectFormData>) => void }): JSX.Element {
  useUiLocale();
  return (
    <div className="space-y-5">

      {/* 完成度 */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.whatShouldTheFirstVersionInclude")}</label>
        <div className="flex gap-2">
          {COMPLETENESS_OPTIONS.map((opt) => {
            const active = data.completeness === opt.value;
            return (
              <button
                key={opt.value}
                aria-pressed={active}
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
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.aiIntegration")}</label>
        <p className="text-[length:var(--text-11)] text-text-secondary mb-2">{uiText("ui.StepComponents.aiAssistanceAndAgentsRequireAnLlm")}</p>
        <div className="flex gap-2">
          {[
            { value: "none", label: uiText("ui.StepComponents.notNeeded"), desc: uiText("ui.StepComponents.noAi") },
            { value: "assistant", label: uiText("ui.NewProjectDialog.aiAssistance"), desc: uiText("ui.StepComponents.enhanceFeaturesWithAnLlmApi") },
            { value: "agent", label: "Agent", desc: uiText("ui.StepComponents.autonomousDecisionsAndToolUse") },
          ].map((opt) => {
            const active = data.aiIntegration === opt.value;
            return (
              <button key={opt.value} aria-pressed={active} className={`flex-1 p-2 rounded-[var(--radius-lg)] transition-all text-left ${active ? "bg-[var(--preset-active)] text-text-primary" : "bg-[var(--preset-idle)] hover:shadow-[inset_0_0_0_999px_var(--preset-hover)] text-text-secondary"}`} onClick={() => onChange({ aiIntegration: opt.value as AIIntegration })}>
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Deployment options keep the original row layout and follow the selected platform. */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.deployment")}</label>
        <div className="flex gap-2">
          {deploymentChoices(data.targets).map(value => {
            const keys = { auto: "auto", "client-only": "clientOnly", "cloud-dev": "cloudDev", 本地: "local", 云端: "cloud", 混合: "hybrid" };
            const key = keys[value];
            const mini = data.targets.includes("wechat-miniprogram");
            const hint = mini && key === "clientOnly" ? "creation.deploy.clientOnlyMiniHint" : mini && key === "cloud" ? "creation.deploy.customBackendHint" : `creation.deploy.${key}Hint`;
            return <button key={value} aria-pressed={data.deployPlatform === value}
              className={`flex-1 min-w-0 p-2 rounded-[var(--radius-lg)] transition-all text-left ${data.deployPlatform === value ? "bg-[var(--preset-active)] text-text-primary" : "bg-[var(--preset-idle)] hover:shadow-[inset_0_0_0_999px_var(--preset-hover)] text-text-secondary"}`}
              onClick={() => onChange({ deployPlatform: value })}>
              <div className="text-sm font-medium">{uiText(`creation.deploy.${key}`)}</div>
              <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">{uiText(hint)}</div>
            </button>;
          })}
        </div>
        {data.deployPlatform === "client-only" && data.aiIntegration !== "none" && <p role="status" className="mt-2 text-xs text-accent">{uiText("creation.aiWithoutBackendHint")}</p>}
      </div>

      {/* 预算 */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">{uiText("ui.StepComponents.developmentAndOperationsBudget")}</label>
        <div className="flex gap-2">
          {BUDGET_OPTIONS.map((opt) => {
            const active = data.techBudget === opt.value;
            return (
              <button key={opt.value} aria-pressed={active} className={`flex-1 p-3 rounded-[var(--radius-lg)] transition-all text-left ${active ? "bg-[var(--preset-active)] text-text-primary" : "bg-[var(--preset-idle)] hover:shadow-[inset_0_0_0_999px_var(--preset-hover)] text-text-secondary"}`} onClick={() => onChange({ techBudget: opt.value as BudgetChoice })}>
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

export { StepNavigation, Step1Form, Step2Form, Step3Form, Step4Form };
