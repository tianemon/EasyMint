import { useEffect, useState } from "react";
import { Select } from "./Select";
import { useSettingsStore } from "../stores/settings-store";

interface Template {
  id: string; name: string; description: string; prompt: string;
  model?: string; provider?: string; agentType: string; thinkingLevel?: string;
}

const THINKING_LEVELS: Array<{ value: string; label: string }> = [
  { value: "off", label: "关闭(off)" },
  { value: "minimal", label: "极简(minimal)" },
  { value: "low", label: "低(low)" },
  { value: "medium", label: "中(medium)" },
  { value: "high", label: "高(high)" },
  { value: "xhigh", label: "超高(xhigh)" },
  { value: "max", label: "最大(max)" },
];

/** Mint 系统内置且不可修改(始终强制官方提示词);其余内置模板可编辑 */
const MINT_ID = "mint";
const BUILTIN_IDS = new Set(["mint", "default-builder", "mint-designer", "default-evaluator"]);

function useProviderOptions(): Array<{ value: string; label: string }> {
  const apiProviders = useSettingsStore((s) => s.apiProviders);
  if (!apiProviders) return [];
  return Object.values(apiProviders.configs ?? {}).map((cfg) => ({
    value: cfg.presetId === "custom" ? cfg.id : cfg.presetId,
    label: `${cfg.name}${cfg.presetId === "custom" ? "" : ""}`,
  }));
}

/** Agent 模板设置(列表+编辑表单) */
export function AgentTemplateSettings(): JSX.Element {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [previewing, setPreviewing] = useState<Template | null>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    window.electronAPI.agentTemplates.list().then((ts) => {
      setTemplates(ts.map((t) => ({ ...t, provider: (t as { provider?: string }).provider ?? "" })));
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleSave = async (data: {
    name: string; description: string; prompt: string;
    provider?: string; model?: string; thinkingLevel?: string;
  }) => {
    if (!data.name.trim() || !data.prompt.trim()) return;
    if (editing) {
      await window.electronAPI.agentTemplates.update(editing.id, data);
    } else {
      await window.electronAPI.agentTemplates.create({ ...data, agentType: "custom" });
    }
    setEditing(null); setAdding(false);
    load(); // reload list
  };

  const handleDelete = async (id: string) => {
    if (!confirm("删除此模板？")) return;
    await window.electronAPI.agentTemplates.delete(id);
    load();
  };

  const providerOptions = useProviderOptions();

  if (adding || editing) {
    return <TemplateForm initial={editing} onSave={handleSave} providerOptions={providerOptions} onCancel={() => { setEditing(null); setAdding(false); }} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text-primary">Agent 模板</h3>
          <p className="text-[11px] text-text-secondary/70 mt-0.5">
            task 委派时可选模板;省略则不指定模板,创建标准子 Agent(无模板人设)。Mint 为系统内置不可修改,其余内置模板可编辑。
          </p>
        </div>
        <button onClick={() => setAdding(true)}
          className="px-3 py-1 rounded-lg border border-accent text-accent text-xs font-medium hover:bg-accent-subtle transition-colors">
          + 新建模板
        </button>
      </div>
      {loading ? (
        <div className="text-xs text-text-secondary/60 py-4 text-center">加载中...</div>
      ) : templates.length === 0 ? (
        <div className="text-xs text-text-secondary/60 py-4 text-center">暂无自定义模板</div>
      ) : (
        templates.map((tpl) => (
          <div key={tpl.id} className="group flex items-start gap-3 p-3 rounded-lg border border-border bg-surface hover:border-accent/30 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{tpl.name}</span>
                {BUILTIN_IDS.has(tpl.id) && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent-subtle text-accent shrink-0">内置</span>}
                <span className="text-[10px] text-text-muted shrink-0">{tpl.agentType}</span>
              </div>
              <div className="text-[11px] text-text-secondary mt-0.5">{tpl.description}</div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-text-muted">
                {tpl.provider && <span>供应商:{tpl.provider}</span>}
                {tpl.model && <span>模型:{tpl.model}</span>}
                {tpl.thinkingLevel && <span>思考:{tpl.thinkingLevel}</span>}
              </div>
            </div>
            <div className="flex gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
              {tpl.id === MINT_ID ? (
                <button onClick={() => setPreviewing(tpl)}
                  className="px-2 py-1 text-[10px] rounded bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors">预览</button>
              ) : (
                <>
                  <button onClick={() => setEditing(tpl)}
                    className="px-2 py-1 text-[10px] rounded bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors">编辑</button>
                  {!BUILTIN_IDS.has(tpl.id) && (
                    <button onClick={() => handleDelete(tpl.id)}
                      className="px-2 py-1 text-[10px] rounded bg-surface border border-border text-text-secondary hover:text-danger hover:border-danger/40 transition-colors">删除</button>
                  )}
                </>
              )}
            </div>
          </div>
        ))
      )}
      {previewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPreviewing(null)}>
          <div className="w-[640px] max-h-[80vh] flex flex-col rounded-xl bg-bg border border-border shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-medium text-text-primary">{previewing.name} · 内置模板</h3>
              <button onClick={() => setPreviewing(null)} className="text-[11px] text-text-secondary hover:text-text-primary">关闭</button>
            </div>
            <div className="px-4 py-2 text-[11px] text-text-secondary border-b border-border">系统内置提示词,不可修改</div>
            <pre className="flex-1 overflow-auto px-4 py-3 text-xs text-text-secondary whitespace-pre-wrap font-mono leading-relaxed">{previewing.prompt}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

/** 模板编辑/新建表单 */
function TemplateForm({ initial, onSave, onCancel, providerOptions }: {
  initial: Template | null;
  onSave: (data: { name: string; description: string; prompt: string; provider?: string; model?: string; thinkingLevel?: string }) => void;
  onCancel: () => void;
  providerOptions: Array<{ value: string; label: string }>;
}): JSX.Element {
  const editMode = initial != null;
  const [name, setName] = useState(initial?.name || "");
  const [desc, setDesc] = useState(initial?.description || "");
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [provider, setProvider] = useState(initial?.provider || "");
  const [model, setModel] = useState(initial?.model || "");
  const [thinkingLevel, setThinkingLevel] = useState(initial?.thinkingLevel || "medium");

  // 供应商切换→加载该供应商的模型列表
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [loadingProviderModels, setLoadingProviderModels] = useState(false);
  useEffect(() => {
    if (!provider) { setProviderModels([]); return; }
    // 自定义供应商(presetId==="custom")的 Pi provider id = config.id,用户输入;内置供应商直接查
    const apiProviders = useSettingsStore.getState().apiProviders;
    const cfg = apiProviders?.configs?.[provider];
    const piProvider = cfg?.presetId === "custom" ? cfg.id : provider;
    // 如果配置里有缓存的模型列表,直接用
    if (cfg?.models?.length) {
      setProviderModels(cfg.models);
      return;
    }
    // 否则从 Pi 拉取
    setLoadingProviderModels(true);
    window.electronAPI.agent.getPiModels(piProvider).then((ms) => {
      setProviderModels(ms.map((m) => m.id));
    }).catch(() => setProviderModels([])).finally(() => setLoadingProviderModels(false));
  }, [provider]);

  const handleSave = () => {
    if (!name.trim() || !prompt.trim()) return;
    onSave({ name: name.trim(), description: desc.trim(), prompt: prompt.trim(), provider: provider || undefined, model: model || undefined, thinkingLevel: thinkingLevel || undefined });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">{editMode ? "编辑模板" : "新建模板"}</h3>
        <button onClick={onCancel} className="text-[11px] text-text-secondary hover:text-text-primary">取消</button>
      </div>
      <div>
        <label className="text-[11px] text-text-secondary block mb-1">名称 *</label>
        <input className="w-full h-8 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-primary outline-none focus:border-accent/50"
          placeholder="如 测试员" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="text-[11px] text-text-secondary block mb-1">一句话描述 *</label>
        <input className="w-full h-8 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-primary outline-none focus:border-accent/50"
          placeholder="如 专门写单元测试" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div>
        <label className="text-[11px] text-text-secondary block mb-1">人格/职责 prompt *</label>
        <textarea className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent/50 resize-none"
          rows={4} placeholder="定义 Agent 的行为方式、专业领域、工作风格..."
          value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-text-secondary block mb-1">供应商(可选)</label>
          <Select block placeholder="留空用全局默认" value={provider} onChange={setProvider}
            options={providerOptions} title="选择供应商" />
        </div>
        <div>
          <label className="text-[11px] text-text-secondary block mb-1">模型 id(可选)</label>
          {providerModels.length > 0 ? (
            <Select block placeholder={loadingProviderModels ? "加载中…" : "选择模型"} value={model} onChange={setModel}
              options={providerModels.map((m) => ({ value: m, label: m }))} title="选择模型" />
          ) : (
            <input className="w-full h-8 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-primary outline-none focus:border-accent/50"
              placeholder="如 deepseek-v4-flash" value={model} onChange={(e) => setModel(e.target.value)} />
          )}
        </div>
      </div>
      <div>
        <label className="text-[11px] text-text-secondary block mb-1">思考级别</label>
        <Select block value={thinkingLevel} onChange={setThinkingLevel}
          options={THINKING_LEVELS} title="思考级别" />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-md text-xs text-text-secondary hover:bg-surface-hover">取消</button>
        <button onClick={handleSave}
          disabled={!name.trim() || !prompt.trim()}
          className={`px-4 py-1.5 rounded-md text-xs font-medium ${name.trim() && prompt.trim() ? "bg-accent text-white hover:bg-accent-high" : "opacity-40 cursor-not-allowed bg-surface text-text-secondary"}`}>
          保存
        </button>
      </div>
    </div>
  );
}
