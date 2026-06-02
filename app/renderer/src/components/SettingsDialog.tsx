import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { PromptSettings } from "./settings/PromptSettings";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface ToggleRowProps {
  label: string;
  description: string;
  hint: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, description, hint, enabled, onChange }: ToggleRowProps): JSX.Element {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 mr-4">
        <p className="text-sm text-text-primary">{label}</p>
        <p className="text-xs text-text-secondary mt-0.5">{description}</p>
        <p className="text-[11px] text-text-secondary mt-0.5 opacity-70">{hint}</p>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
          enabled ? "bg-accent" : "bg-surface-hover border border-border"
        }`}
        role="switch"
        aria-checked={enabled}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-surface-elevated shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function StarRating({ count }: { count: number }): JSX.Element {
  return (
    <span className="text-warning text-xs">
      {count}
    </span>
  );
}

const TOKEN_ROWS = [
  { label: "普通开发", stars: 1, desc: "仅 Worker agent 消耗" },
  { label: "评估模式", stars: 2, desc: "Worker + Evaluator（Playwright 自动化）" },
  { label: "TDD 模式", stars: 2, desc: "测试先行，每轮额外生成测试代码" },
  { label: "截图验证", stars: 3, desc: "image-vision 每次截图分析，Token 消耗高" },
  { label: "全开（评估+TDD+截图）", stars: 4, desc: "所有验证机制全部开启，消耗最高" },
];

// ── Agent Templates Tab ──────────────────────────────────────────────────────

function AgentsTab(): JSX.Element {
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string; prompt: string; tools: string[]; model?: string; agentType: string }[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", prompt: "", tools: "", model: "", agentType: "builder" as string });
  const [loadError, setLoadError] = useState("");

  const load = () => {
    window.electronAPI.agentTemplates.list().then(setTemplates).catch((e: unknown) => setLoadError(String(e)));
  };
  useEffect(load, []);

  const resetForm = () => {
    setForm({ name: "", description: "", prompt: "", tools: "", model: "", agentType: "builder" });
    setEditingId(null);
  };

  const handleSave = async () => {
    const toolsArr = form.tools.split(",").map((s) => s.trim()).filter(Boolean);
    const input = { ...form, tools: toolsArr, model: form.model || undefined };
    if (editingId) {
      await window.electronAPI.agentTemplates.update(editingId, input);
    } else {
      await window.electronAPI.agentTemplates.create(input);
    }
    resetForm();
    load();
  };

  const handleEdit = (t: typeof templates[0]) => {
    setEditingId(t.id);
    setForm({ name: t.name, description: t.description, prompt: t.prompt, tools: t.tools.join(", "), model: t.model || "", agentType: t.agentType });
  };

  const handleDelete = async (id: string) => {
    await window.electronAPI.agentTemplates.delete(id);
    if (editingId === id) resetForm();
    load();
  };

  const AGENT_TYPES = [
    { value: "mint", label: "Mint（PM / 主对话）" },
    { value: "orchestrator", label: "Orchestrator（调度者）" },
    { value: "builder", label: "Builder（开发者）" },
    { value: "evaluator", label: "Evaluator（验收者）" },
  ];

  return (
    <div className="px-6 py-4 overflow-y-auto space-y-4" style={{ maxHeight: "60vh" }}>
      {loadError && <p className="text-danger text-xs">{loadError}</p>}

      {/* Template List */}
      {templates.length === 0 ? (
        <p className="text-text-secondary text-xs text-center py-4">暂无 Agent 模板，创建一个吧。</p>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className={`p-3 rounded-lg border transition-colors ${editingId === t.id ? "border-accent bg-accent/5" : "border-border hover:border-accent/30"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-text-primary">{t.name}</span>
                  <span className="text-xs text-text-secondary ml-2">{t.agentType}</span>
                </div>
                <div className="flex gap-1">
                  <button className="text-xs text-text-secondary hover:text-accent transition-colors" onClick={() => handleEdit(t)}>编辑</button>
                  <button className="text-xs text-text-secondary hover:text-danger transition-colors" onClick={() => handleDelete(t.id)}>删除</button>
                </div>
              </div>
              <p className="text-xs text-text-secondary mt-0.5 truncate">{t.description}</p>
            </div>
          ))}
        </div>
      )}

      {/* Form */}
      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">{editingId ? "编辑模板" : "新建模板"}</h3>
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-text-secondary block mb-1">名称</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 Builder" />
            </div>
            <div className="w-44">
              <label className="text-xs text-text-secondary block mb-1">类型</label>
              <select className="input" value={form.agentType} onChange={(e) => setForm({ ...form, agentType: e.target.value })}>
                {AGENT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">描述（SDK 用于匹配调用时机）</label>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="如：当需要实现 task.json 中的开发任务时使用" />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">系统提示词</label>
            <textarea className="input resize-y" rows={4} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="Agent 的身份定义和工作流程..." />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">工具（逗号分隔）</label>
            <input className="input" value={form.tools} onChange={(e) => setForm({ ...form, tools: e.target.value })} placeholder="Read, Write, Edit, Bash, Glob, Grep" />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">模型（可选，不填继承默认）</label>
            <input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="如 deepseek-v4-pro" />
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 rounded-lg bg-accent text-text-inverse text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-40" disabled={!form.name || !form.prompt} onClick={handleSave}>
              {editingId ? "更新" : "创建"}
            </button>
            {editingId && (
              <button className="px-4 py-2 rounded-lg text-text-secondary text-sm hover:bg-surface-hover transition-colors" onClick={resetForm}>取消</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps): JSX.Element | null {
  const {
    evaluateMode,
    tddMode,
    screenshotVerification,
    apiBaseUrl,
    apiKey,
    model,
    availableModels,
    setEvaluateMode,
    setTddMode,
    setScreenshotVerification,
    setApiBaseUrl,
    setApiKey,
    setModel,
    setAvailableModels,
    loadFromElectron,
  } = useSettingsStore();
  const [showKey, setShowKey] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "prompts" | "agents">("general");

  useEffect(() => {
    if (open) {
      loadFromElectron();
    }
  }, [open, loadFromElectron]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 modal-overlay">
      <div className="bg-surface-elevated rounded-xl border border-border shadow-2xl modal-card" style={{ width: activeTab === "prompts" || activeTab === "agents" ? 620 : 520 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-0 border-b border-border">
          <div className="flex gap-0">
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "general" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("general")}
            >
              通用
            </button>
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "prompts" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("prompts")}
            >
              提示词
            </button>
            <button
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "agents" ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              onClick={() => setActiveTab("agents")}
            >
              Agent 模板
            </button>
          </div>
          <button
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 max-h-[520px] overflow-y-auto">
          {activeTab === "general" ? (
            <div className="space-y-5">
              {/* 外观 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">外观</h3>
                <div className="bg-surface-alt rounded-lg px-4 py-3">
                  <p className="text-sm text-text-primary">主题</p>
                  <p className="text-xs text-text-secondary mt-0.5">亮色 Mint（仅亮色）</p>
                </div>
              </section>

              {/* API 设置 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">API 配置</h3>
                <div className="bg-surface-alt rounded-lg px-4 py-3 space-y-3">
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">Base URL</label>
                    <input
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
                      placeholder="https://api.deepseek.com/anthropic"
                      value={apiBaseUrl}
                      onChange={(e) => setApiBaseUrl(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">API Key</label>
                    <div className="relative">
                      <input
                        type={showKey ? "text" : "password"}
                        className="w-full px-3 py-2 pr-8 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
                        placeholder="sk-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        ) : (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">可选模型列表</label>
                    <div className="space-y-1 mb-2">
                      {availableModels.map((m, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <input
                            className="flex-1 px-2 py-1.5 rounded bg-surface border border-border text-text-primary text-xs outline-none focus:border-accent"
                            value={m}
                            onChange={(e) => {
                              const next = [...availableModels];
                              next[i] = e.target.value;
                              setAvailableModels(next);
                            }}
                          />
                          <button
                            className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-danger transition-colors text-xs"
                            onClick={() => setAvailableModels(availableModels.filter((_, j) => j !== i))}
                          >✕</button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="px-3 py-1 rounded border border-dashed border-accent/50 text-accent text-xs hover:border-accent hover:bg-accent/5 transition-colors"
                        onClick={() => setAvailableModels([...availableModels, ""])}
                      >+ 添加模型</button>
                      <button
                        className="px-3 py-1 rounded border border-dashed border-accent/50 text-accent text-xs hover:border-accent hover:bg-accent/5 transition-colors"
                        onClick={async () => {
                          try {
                            const models = await window.electronAPI.settings.fetchModels();
                            if (models.length > 0) setAvailableModels(models);
                          } catch (e: unknown) {
                            alert(e instanceof Error ? e.message : "获取失败");
                          }
                        }}
                      >从 API 获取</button>
                    </div>
                    <p className="text-[10px] text-text-secondary mt-1.5">在聊天窗口中可切换的模型列表。默认使用第一个或下方指定的模型。</p>
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">默认模型</label>
                    {availableModels.length > 0 ? (
                      <select
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      >
                        <option value="">— 不限 —</option>
                        {availableModels.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
                        placeholder="deepseek-v4-pro[1m]"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      />
                    )}
                    <p className="text-[10px] text-text-secondary mt-0.5">新会话的默认模型，先获取模型列表后可从下拉选择</p>
                  </div>
                </div>
              </section>

              {/* 开发选项 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">开发选项</h3>
                <div className="bg-surface-alt rounded-lg px-4 divide-y divide-border">
                  <ToggleRow label="评估模式" description="每轮 Worker 完成后自动触发 Evaluator 验证" hint="启用 Playwright 自动化测试，验证前端改动正确性" enabled={evaluateMode} onChange={setEvaluateMode} />
                  <ToggleRow label="TDD 模式" description="先编写测试代码，再实现功能" hint="每次实现前先生成测试用例，以测试驱动开发流程" enabled={tddMode} onChange={setTddMode} />
                  <ToggleRow label="截图验证" description="使用 image-vision 对每次改动进行截图对比" hint="每轮完成后截图并通过视觉模型分析，确保 UI 无回归" enabled={screenshotVerification} onChange={setScreenshotVerification} />
                </div>
              </section>

              {/* Token 消耗对照表 */}
              <section>
                <h3 className="text-sm font-medium text-text-secondary mb-2">预估 Token 消耗</h3>
                <div className="bg-surface-alt rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-4 py-2.5 text-text-secondary font-medium">模式</th>
                        <th className="text-left px-4 py-2.5 text-text-secondary font-medium">说明</th>
                        <th className="text-center px-4 py-2.5 text-text-secondary font-medium">消耗</th>
                      </tr>
                    </thead>
                    <tbody>
                      {TOKEN_ROWS.map((row) => (
                        <tr key={row.label} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5 text-text-primary">{row.label}</td>
                          <td className="px-4 py-2.5 text-text-secondary">{row.desc}</td>
                          <td className="px-4 py-2.5 text-center"><StarRating count={row.stars} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : activeTab === "prompts" ? (
            <PromptSettings />
          ) : (
            <AgentsTab />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 pb-5 pt-3 border-t border-border">
          <p className="text-[11px] text-text-secondary opacity-70">
            DeepSeek 视觉桥接（待商议）
          </p>
          <button
            className="px-6 py-2 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors font-medium"
            onClick={onClose}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
