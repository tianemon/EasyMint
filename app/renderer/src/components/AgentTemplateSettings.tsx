import { useEffect, useState } from "react";
import { Select } from "./Select";
import { useSettingsStore } from "../stores/settings-store";

interface Template {
  id: string; name: string; description: string; prompt: string; tools: string[];
  model?: string; provider?: string; agentType: string; default?: boolean; thinkingLevel?: string;
}

const COMMON_TOOLS = ["Read","Write","Edit","Bash","Glob","Grep",
  "mcp__codegraph__codegraph_context","mcp__codegraph__codegraph_impact","mcp__codegraph__codegraph_callers","mcp__codegraph__codegraph_search","mcp__codegraph__codegraph_trace",
  "mcp__playwright__browser_navigate","mcp__playwright__browser_take_screenshot","mcp__playwright__browser_snapshot",
  "mcp__playwright__browser_click","mcp__playwright__browser_type","mcp__playwright__browser_evaluate",
];

const THINKING_LEVELS = ["off","minimal","low","medium","high"];

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
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    window.electronAPI.agentTemplates.list().then((ts) => {
      setTemplates(ts.map((t) => ({ ...t, provider: (t as { provider?: string }).provider ?? "" })));
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleSave = async (data: {
    name: string; description: string; prompt: string; tools: string[];
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

  const handleSetDefault = async (id: string) => {
    await window.electronAPI.agentTemplates.setDefault(id);
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
            task 委派时可选模板;默认模板为不指定 agent 时的委派目标。
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
          <div key={tpl.id} className={`group flex items-start gap-3 p-3 rounded-lg border transition-colors ${tpl.default ? "border-accent/50 bg-accent-bg" : "border-border bg-surface hover:border-accent/30"}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{tpl.name}</span>
                {tpl.default && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent text-text-inverse shrink-0">默认</span>}
                <span className="text-[10px] text-text-muted shrink-0">{tpl.agentType}</span>
              </div>
              <div className="text-[11px] text-text-secondary mt-0.5">{tpl.description}</div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-text-muted">
                {tpl.provider && <span>供应商:{tpl.provider}</span>}
                {tpl.model && <span>模型:{tpl.model}</span>}
                {tpl.thinkingLevel && <span>思考:{tpl.thinkingLevel}</span>}
                <span>工具:{tpl.tools?.length || 0}</span>
              </div>
            </div>
            <div className="flex gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
              {!tpl.default && (
                <button onClick={() => handleSetDefault(tpl.id)}
                  className="px-2 py-1 text-[10px] rounded bg-surface border border-border text-text-secondary hover:text-accent hover:border-accent/50 transition-colors">默认</button>
              )}
              <button onClick={() => setEditing(tpl)}
                className="px-2 py-1 text-[10px] rounded bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors">编辑</button>
              {tpl.agentType === "custom" && (
                <button onClick={() => handleDelete(tpl.id)}
                  className="px-2 py-1 text-[10px] rounded bg-surface border border-border text-text-secondary hover:text-danger hover:border-danger/40 transition-colors">删除</button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/** 模板编辑/新建表单 */
function TemplateForm({ initial, onSave, onCancel, providerOptions }: {
  initial: Template | null;
  onSave: (data: { name: string; description: string; prompt: string; tools: string[]; provider?: string; model?: string; thinkingLevel?: string }) => void;
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
  const [tools, setTools] = useState<string[]>(initial?.tools || []);

  const toggleTool = (name: string) => {
    setTools((prev) => prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]);
  };

  const handleSave = () => {
    if (!name.trim() || !prompt.trim()) return;
    onSave({ name: name.trim(), description: desc.trim(), prompt: prompt.trim(), tools, provider: provider || undefined, model: model || undefined, thinkingLevel: thinkingLevel || undefined });
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
          <input className="w-full h-8 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-primary outline-none focus:border-accent/50"
            placeholder="如 deepseek-v4-flash" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="text-[11px] text-text-secondary block mb-1">思考级别</label>
        <Select block value={thinkingLevel} onChange={setThinkingLevel}
          options={THINKING_LEVELS.map((v) => ({ value: v, label: v }))} title="思考级别" />
      </div>
      <div>
        <label className="text-[11px] text-text-secondary block mb-1">工具集(已选 {tools.length})</label>
        <div className="flex flex-wrap gap-1">
          {COMMON_TOOLS.map((t) => {
            const on = tools.includes(t);
            return (
              <button key={t} onClick={() => toggleTool(t)}
                className={`px-2 py-0.5 rounded-md border text-[10px] transition-colors ${on ? "border-accent text-accent bg-accent-soft" : "border-border text-text-secondary hover:border-accent/40"}`}>
                {t}
              </button>
            );
          })}
        </div>
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
