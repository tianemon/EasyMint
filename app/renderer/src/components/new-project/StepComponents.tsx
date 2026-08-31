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
        className="w-full input px-3 py-2 text-left flex items-center justify-between"
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
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${o.value === value ? "bg-accent-bg text-accent" : "text-text-primary hover:bg-surface-hover"}`}
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
        <input className="input px-3 py-2" value={data.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="中文名称会自动翻译为英文目录" />
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">项目目录 <span className="text-danger">*</span></label>
        <button
          className="w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-left text-sm hover:bg-surface-hover transition-colors"
          onClick={async () => { const selected = await window.electronAPI.dialog.openDirectory(); if (selected) onChange({ dir: selected }); }}
        >
          <span className="text-text-secondary">{data.dir || "点击选择目录..."}</span>
        </button>
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">项目描述 <span className="text-text-muted text-xs font-normal">（可选，一句话说清楚想做什么）</span></label>
        <textarea className="input px-3 py-2 min-h-[60px] resize-y" value={data.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="例如：记录每天花销的记账软件，给自己用" />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">这个项目你打算怎么用？ <span className="text-text-muted text-xs font-normal">（可让 Mint 判断）</span></label>
        <Select value={data.scene} onChange={(v) => onChange({ scene: v as SceneChoice })} options={SCENE_OPTIONS} placeholder="没想好，由AI自己判断" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-text-primary">项目形式 <span className="text-text-muted text-xs font-normal">（运行平台与交付形式，可多个）</span></label>
          <button className="px-2 py-0.5 rounded border border-accent-border-strong text-accent text-xs hover:border-accent hover:bg-accent-subtle transition-colors" onClick={addTarget}>+ 添加</button>
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
        <label className="block text-sm font-medium text-text-primary">功能清单 <span className="text-text-muted text-xs font-normal">（可选）</span></label>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 rounded-lg btn-accent text-sm font-medium" onClick={onRecommendFeatures} disabled={loadingRec === "features"}>
            {loadingRec === "features" ? "Mint 思考中..." : "Mint 推荐"}
          </button>
          <button className="px-3 py-1.5 rounded-lg border border-accent-border-strong text-accent text-xs hover:border-accent hover:bg-accent-bg transition-colors" onClick={addFeature}>+ 添加功能</button>
        </div>
      </div>

      {loadingRec === "features" && (
        <p className="text-xs text-text-secondary py-3 text-center animate-pulse">Mint 正在推荐功能…</p>
      )}
      {data.features.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className="flex-1 input px-3 py-2"
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

// ---- Step 3: UI 风格 ----

function Step3Form({ data, onChange }: { data: ProjectFormData; onChange: (p: Partial<ProjectFormData>) => void }): JSX.Element {
  const predefined = UI_STYLE_OPTIONS.find((o) => o.value === data.uiStyle);
  const isCustomText = data.uiStyle === "custom" || (!predefined && data.uiStyle !== "");

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">想要什么 UI 风格？ <span className="text-text-muted text-xs font-normal">（可选）</span></label>
        <Select
          value={predefined ? data.uiStyle : "custom"}
          onChange={(v) => onChange({ uiStyle: v })}
          options={UI_STYLE_OPTIONS}
          placeholder="让 Mint 推荐"
        />
        <p className="text-[length:var(--text-11)] text-text-secondary mt-1">原型阶段可再调整</p>
      </div>
      {isCustomText && (
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">自定义风格描述</label>
          <textarea className="input px-3 py-2 min-h-[60px] resize-y" value={data.uiStyle === "custom" ? "" : data.uiStyle} onChange={(e) => onChange({ uiStyle: e.target.value })} placeholder="例如：赛博朋克 + 极简主义混搭..." />
        </div>
      )}
    </div>
  );
}

// ---- Step 4: 交付方式 ----

function Step4Form({ data, onChange }: { data: ProjectFormData; onChange: (p: Partial<ProjectFormData>) => void }): JSX.Element {
  return (
    <div className="space-y-5">

      {/* 完成度 */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">先做到什么程度？ <span className="text-text-muted text-xs font-normal">（可选，AI 帮你定）</span></label>
        <div className="flex gap-2">
          {COMPLETENESS_OPTIONS.map((opt) => {
            const active = data.completeness === opt.value;
            return (
              <button
                key={opt.value}
                className={`flex-1 p-3 rounded-lg border transition-colors text-left ${active ? "bg-accent-high border-accent" : "border-border hover:border-accent-border-strong"}`}
                onClick={() => onChange({ completeness: opt.value })}
              >
                <div className={`text-sm font-medium ${active ? "text-accent" : "text-text-primary"}`}>{opt.label}</div>
                <div className="text-xs text-text-secondary mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* AI 集成 */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">AI 能力集成 <span className="text-text-muted text-xs font-normal">（可选）</span></label>
        <p className="text-[length:var(--text-11)] text-text-secondary mb-2">AI 辅助 / Agent 需接入大模型 API，按用量计费；部分厂商有免费额度（有时效）</p>
        <div className="flex gap-2">
          {[
            { value: "none", label: "不需要", desc: "无 AI" },
            { value: "assistant", label: "AI 辅助", desc: "调用 LLM API 增强功能" },
            { value: "agent", label: "Agent", desc: "自主决策、工具调用" },
          ].map((opt) => {
            const active = data.aiIntegration === opt.value;
            return (
              <button key={opt.value} className={`flex-1 p-2 rounded-lg border transition-colors text-left ${active ? "bg-accent-high border-accent" : "border-border hover:border-accent-border-strong"}`} onClick={() => onChange({ aiIntegration: opt.value as AIIntegration })}>
                <div className={`text-sm font-medium ${active ? "text-accent" : "text-text-primary"}`}>{opt.label}</div>
                <div className="text-[length:var(--text-2xs)] text-text-secondary mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 部署方式 */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">部署方式 <span className="text-text-muted text-xs font-normal">（可选，AI 帮你定）</span></label>
        <div className="flex gap-2">
          <button
            className={`flex-1 p-2 rounded-lg border transition-colors text-left ${data.deployPlatform === "本地" ? "bg-accent-high border-accent" : "border-border hover:border-accent-border-strong"}`}
            onClick={() => onChange({ deployPlatform: "本地" })}
          >
            <div className={`text-sm font-medium ${data.deployPlatform === "本地" ? "text-accent" : "text-text-primary"}`}>本地</div>
            <div className="text-[length:var(--text-2xs)] text-text-secondary mt-0.5">本机运行，无需云服务</div>
          </button>
          <button
            className={`flex-1 p-2 rounded-lg border transition-colors text-left ${data.deployPlatform === "云端" ? "bg-accent-high border-accent" : "border-border hover:border-accent-border-strong"}`}
            onClick={() => onChange({ deployPlatform: "云端" })}
          >
            <div className={`text-sm font-medium ${data.deployPlatform === "云端" ? "text-accent" : "text-text-primary"}`}>云端</div>
            <div className="text-[length:var(--text-2xs)] text-text-secondary mt-0.5">可互联网访问，有服务器费用</div>
          </button>
          <button
            className={`flex-1 p-2 rounded-lg border transition-colors text-left ${data.deployPlatform === "混合" ? "bg-accent-high border-accent" : "border-border hover:border-accent-border-strong"}`}
            onClick={() => onChange({ deployPlatform: "混合" })}
          >
            <div className={`text-sm font-medium ${data.deployPlatform === "混合" ? "text-accent" : "text-text-primary"}`}>混合</div>
            <div className="text-[length:var(--text-2xs)] text-text-secondary mt-0.5">本地 UI + 云端同步</div>
          </button>
        </div>
      </div>

      {/* 预算 */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">开发运维成本 <span className="text-text-muted text-xs font-normal">（可选，AI 帮你定）</span></label>
        <div className="flex gap-2">
          {BUDGET_OPTIONS.map((opt) => {
            const active = data.techBudget === opt.value;
            return (
              <button key={opt.value} className={`flex-1 p-3 rounded-lg border transition-colors text-left ${active ? "bg-accent-high border-accent" : "border-border hover:border-accent-border-strong"}`} onClick={() => onChange({ techBudget: opt.value as BudgetChoice })}>
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

export { StepDots, Step1Form, Step2Form, Step3Form, Step4Form };
