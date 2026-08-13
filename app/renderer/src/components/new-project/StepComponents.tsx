import { useState, useRef, useEffect } from "react";
import {
  TARGET_OPTIONS, COMPLETENESS_OPTIONS, UI_STYLE_OPTIONS, BUDGET_OPTIONS,
  FRONTEND_LANG_OPTIONS, FRONTEND_FRAMEWORK_OPTIONS, BACKEND_LANG_OPTIONS,
  BACKEND_FRAMEWORK_OPTIONS, CROSS_PLATFORM_OPTIONS,
  type TechOption, type FeatureItem, type ProjectFormData, type BudgetChoice,
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

  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: r.left, width: r.width });
      }
    };
    update();
    // 点击触发器按钮不在此关闭(由 onClick 的 toggle 切换)——否则 mousedown 关闭+同步 flush+click 翻转,菜单收不回去
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
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
        <input className="input" value={data.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="建议英文，如 my-blog" />
        <p className="text-[11px] text-text-secondary mt-1">作为文件夹名，中文可能导致路径兼容问题</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">项目描述 <span className="text-text-muted text-xs font-normal">（可选，AI 帮你定）</span></label>
        <textarea className="input min-h-[60px] resize-y" value={data.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="简单描述这个项目是做什么的..." />
        <p className="text-[11px] text-text-secondary mt-1">例如：我想做一个记录每天花销的记账软件，给自己用</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">项目目录 <span className="text-danger">*</span></label>
        <button
          className="w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-left text-sm hover:bg-surface-hover transition-colors"
          onClick={async () => { const selected = await window.electronAPI.dialog.openDirectory(); if (selected) onChange({ dir: selected }); }}
        >
          <span className="text-text-secondary">{data.dir || "点击选择目录..."}</span>
        </button>
        <p className="text-[10px] text-text-secondary mt-1">默认路径可在设置中修改。不选则使用默认路径</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">目标用户 <span className="text-text-muted text-xs font-normal">（可选）</span></label>
        <input className="input" value={data.targetUsers} onChange={(e) => onChange({ targetUsers: e.target.value })} placeholder="例如：个人用户、小团队、企业内部..." />
        <p className="text-[11px] text-text-secondary mt-1">例如：我本人、我的家人、我的客户</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-text-primary">项目形式</label>
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
        <p className="text-[10px] text-text-secondary mt-1.5">选择项目的运行平台和交付形式，可添加多个</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">完成度 <span className="text-text-muted text-xs font-normal">（可选，AI 帮你定）</span></label>
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
        <label className="block text-sm font-medium text-text-primary">功能清单 <span className="text-text-muted text-xs font-normal">（可选，可让 Mint 推荐）</span></label>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 rounded-lg bg-accent text-text-inverse text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-40" onClick={onRecommendFeatures} disabled={loadingRec === "features"}>
            {loadingRec === "features" ? "Mint 思考中..." : "Mint 推荐"}
          </button>
          <button className="px-3 py-1.5 rounded-lg border border-accent-border-strong text-accent text-xs hover:border-accent hover:bg-accent-bg transition-colors" onClick={addFeature}>+ 添加功能</button>
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
        <label className="block text-sm font-medium text-text-primary mb-2">想要什么 UI 风格？ <span className="text-text-muted text-xs font-normal">（可选，让 Mint 推荐）</span></label>
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

      {/* AI 集成 */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">AI 能力集成 <span className="text-text-muted text-xs font-normal">（可选）</span></label>
        <p className="text-xs text-text-secondary mb-2">你的产品是否需要 AI 能力？这会影响技术架构。</p>
        <p className="text-[11px] text-text-secondary mb-2">提示：AI 辅助 / Agent 需要接入大模型 API，按用量计费（轻量使用每月几块钱起；部分厂商有免费额度，但有时效性）。</p>
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
                <div className="text-[10px] text-text-secondary mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 部署方式 */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">部署方式 <span className="text-text-muted text-xs font-normal">（可选，AI 帮你定）</span></label>
        <p className="text-xs text-text-secondary mb-2">Mint 会根据此选择推荐合适的技术方案。</p>
        <div className="flex gap-2">
          <button
            className={`flex-1 p-2 rounded-lg border transition-colors text-left ${data.deployPlatform === "本地" ? "bg-accent-high border-accent" : "border-border hover:border-accent-border-strong"}`}
            onClick={() => onChange({ deployPlatform: "本地" })}
          >
            <div className={`text-sm font-medium ${data.deployPlatform === "本地" ? "text-accent" : "text-text-primary"}`}>本地</div>
            <div className="text-[10px] text-text-secondary mt-0.5">本机运行，无需云服务</div>
          </button>
          <button
            className={`flex-1 p-2 rounded-lg border transition-colors text-left ${data.deployPlatform === "云端" ? "bg-accent-high border-accent" : "border-border hover:border-accent-border-strong"}`}
            onClick={() => onChange({ deployPlatform: "云端" })}
          >
            <div className={`text-sm font-medium ${data.deployPlatform === "云端" ? "text-accent" : "text-text-primary"}`}>云端</div>
            <div className="text-[10px] text-text-secondary mt-0.5">可互联网访问，有服务器费用</div>
          </button>
          <button
            className={`flex-1 p-2 rounded-lg border transition-colors text-left ${data.deployPlatform === "混合" ? "bg-accent-high border-accent" : "border-border hover:border-accent-border-strong"}`}
            onClick={() => onChange({ deployPlatform: "混合" })}
          >
            <div className={`text-sm font-medium ${data.deployPlatform === "混合" ? "text-accent" : "text-text-primary"}`}>混合</div>
            <div className="text-[10px] text-text-secondary mt-0.5">本地 UI + 云端同步</div>
          </button>
        </div>
      </div>

      {/* Tech notes textarea + Mint recommend */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-sm font-medium text-text-primary">技术偏好 <span className="text-text-muted text-xs font-normal">（可选，让 Mint 推荐）</span></label>
          <button
            className="px-3 py-1.5 rounded-lg bg-accent text-text-inverse text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onRecommend}
            disabled={!canRecommend}
          >
            {loadingRec === "tech" ? "Mint 思考中..." : "Mint 推荐"}
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

export { StepDots, Step1Form, Step2Form, Step3Form, Step4Form };
