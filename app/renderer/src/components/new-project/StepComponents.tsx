import { useState, useRef, useEffect } from "react";
import {
  TARGET_OPTIONS, COMPLETENESS_OPTIONS, BUDGET_OPTIONS,
  type ProjectFormData, type BudgetChoice,
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
        <input className="input" value={data.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="建议英文，如 my-blog" />
        <p className="text-[11px] text-text-secondary mt-1">作为文件夹名，中文可能导致路径兼容问题</p>
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

// ---- Step 2: 交付方式 ----

function Step2Form({ data, onChange }: { data: ProjectFormData; onChange: (p: Partial<ProjectFormData>) => void }): JSX.Element {
  return (
    <div className="space-y-5">

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
    </div>
  );
}

export { StepDots, Step1Form, Step2Form };
