import { useState, useEffect } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { getPreset } from "@shared/platform-presets";
import type { ProviderConfig } from "@shared/platform-presets";
import { Select } from "../Select";
import { brandDisplayName, BRAND_BY_PI_ID, providerSelectOptions } from "../../lib/provider-brands";

interface PiModelInfo {
  id: string; name: string; contextWindow: number;
}

export interface ProviderFormProps {
  onSave: (cfg: ProviderConfig) => void;
  onCancel?: () => void;
  initial?: ProviderConfig | null;
}

export function ProviderForm({ onSave, onCancel, initial }: ProviderFormProps) {
  const editMode = initial != null;
  const [presetId, setPresetId] = useState<string>(initial?.presetId || "");
  const preset = getPreset(presetId);

  const [name, setName] = useState(initial?.name || "");
  const [apiKey, setApiKey] = useState(initial?.apiKey || "");
  const [model, setModel] = useState(initial?.model || "");
  const [models, setModels] = useState<string[]>(initial?.models || []);
  const [showKey, setShowKey] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadedProvider, setLoadedProvider] = useState<string>("");

  // 初始化：编辑已有供应商时自动加载模型列表
  useEffect(() => {
    if (presetId && presetId !== loadedProvider) {
      setLoadedProvider(presetId);
      loadModels(presetId);
    }
  }, [presetId]);

  const handlePresetSelect = async (id: string) => {
    setPresetId(id);
    // 自动填名称(用户未填写时);加载模型列表
    const brand = BRAND_BY_PI_ID.get(id);
    if (brand && !name.trim()) setName(brand.name);
    loadModels(id);
  };

  const loadModels = async (providerId: string) => {
    setLoadingModels(true);
    try {
      const piModels: PiModelInfo[] = await window.electronAPI.agent.getPiModels(providerId);
      const ids = piModels.map((m) => m.id);
      setModels(ids);
      if (!model && ids.length > 0 && ids[0]) setModel(ids[0]);
    } catch (e) { console.error("[ProviderForm] loadModels failed:", e); }
    finally { setLoadingModels(false); }
  };


  const handleSave = () => {
    if (!presetId) { alert("请选择平台"); return; }
    if (!name.trim()) { alert("请输入名称"); return; }
    if (!apiKey.trim()) { alert("请输入 API Key"); return; }
    onSave({
      id: initial?.id || `${presetId}-${Date.now()}`,
      presetId,
      name: name.trim(),
      apiKey: apiKey.trim(),
      model: model || (models[0] ?? ""),
      models,
      createdAt: initial?.createdAt || Date.now(),
    });
  };

  return (
    <div className="space-y-4">
      {/* 平台选择:下拉展示全部品牌及其接入方式(图标 + 中文名) */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">选择平台</label>
        <Select
          block
          placeholder="请选择供应商"
          value={presetId}
          onChange={handlePresetSelect}
          options={providerSelectOptions()}
          title="选择供应商"
        />
      </div>

      {/* 名称 */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">名称</label>
        <input className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent transition-colors"
          placeholder="如：我的DeepSeek" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      {/* API Key */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">API Key</label>
        <div className="relative">
          <input type={showKey ? "text" : "password"}
            className="w-full px-3 py-2 pr-9 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent transition-colors"
            placeholder={preset?.keyPlaceholder || "sk-..."} value={apiKey}
            onChange={(e) => setApiKey(e.target.value)} />
          <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
            onClick={() => setShowKey(!showKey)}>
            {showKey ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            )}
          </button>
        </div>
      </div>

      {/* 模型选择:下拉(替代按钮列表,更紧凑) */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">模型</label>
        <Select
          block
          placeholder={loadingModels ? "加载中…" : (models.length === 0 ? "无可用模型" : "选择模型")}
          value={model}
          onChange={(v: string) => setModel(v)}
          options={models.map((m) => ({ value: m, label: m }))}
          title="选择模型"
        />
        {models.length > 0 && <p className="text-[10px] text-text-muted mt-1">共 {models.length} 个模型可选</p>}
      </div>

      {/* 保存 */}
      <div className="flex gap-2 pt-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="flex-1 px-4 py-2 rounded-lg border border-border text-text-secondary text-sm hover:bg-surface-hover transition-colors">取消</button>
        )}
        <button type="button" onClick={handleSave} className="flex-1 px-4 py-2 rounded-lg bg-accent text-text-inverse text-sm font-medium hover:bg-accent-hover transition-colors">
          {editMode ? "保存" : "添加"}
        </button>
      </div>
    </div>
  );
}

/** 单个"默认/兜底"模型配置组(供应商 + 模型) */
function ModelSlot({
  title,
  provider,
  model,
  models,
  onProvider,
  onModel,
}: {
  title: string;
  provider: string;
  model: string;
  models: string[];
  onProvider: (id: string) => void;
  onModel: (v: string) => void;
}): JSX.Element {
  return (
    <div className="bg-surface-alt rounded-lg border border-border px-4 py-3 space-y-3">
      <h3 className="text-xs font-medium text-text-primary">{title}</h3>
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">供应商</label>
        <Select
          block
          placeholder="请选择(留空用当前激活)"
          value={provider}
          onChange={onProvider}
          options={providerSelectOptions()}
          title="选择供应商"
        />
      </div>
      {provider && (
        <div>
          <label className="text-xs text-text-secondary block mb-1.5">模型</label>
          <Select
            block
            placeholder={models.length === 0 ? "该供应商无可用模型" : "选择模型"}
            value={model}
            onChange={onModel}
            options={models.map((m) => ({ value: m, label: m }))}
            title="选择模型"
          />
        </div>
      )}
    </div>
  );
}

/** 默认模型 + 兜底模型设置(需求 1) + 子 Agent 默认模型(需求 2) */
export function ModelDefaultsSettings(): JSX.Element {
  const {
    defaultProvider, defaultModel, fallbackProvider, fallbackModel,
    setDefaultProvider, setDefaultModel, setFallbackProvider, setFallbackModel,
    subagentDefaultModel, setSubagentDefaultModel,
  } = useSettingsStore();
  const [defaultModels, setDefaultModels] = useState<string[]>([]);
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);
  const [subModels, setSubModels] = useState<string[]>([]);

  const loadModels = async (providerId: string): Promise<string[]> => {
    if (!providerId) return [];
    try {
      const ms = await window.electronAPI.agent.getPiModels(providerId);
      return ms.map((m) => m.id);
    } catch { return []; }
  };

  // 子 agent 默认模型(格式 "provider:model")拆分
  const subProvider = subagentDefaultModel.includes(":") ? subagentDefaultModel.split(":")[0]! : subagentDefaultModel;
  const subModel = subagentDefaultModel.includes(":") ? subagentDefaultModel.split(":")[1]! : "";

  // 初始化:已有配置时加载模型列表
  useEffect(() => {
    if (defaultProvider) loadModels(defaultProvider).then(setDefaultModels);
    if (fallbackProvider) loadModels(fallbackProvider).then(setFallbackModels);
    if (subProvider) loadModels(subProvider).then(setSubModels);
  }, []);

  const handleDefaultProvider = (id: string) => {
    setDefaultProvider(id);
    if (id) { setDefaultModel(""); loadModels(id).then(setDefaultModels); } else setDefaultModels([]);
  };
  const handleFallbackProvider = (id: string) => {
    setFallbackProvider(id);
    if (id) { setFallbackModel(""); loadModels(id).then(setFallbackModels); } else setFallbackModels([]);
  };
  const handleSubProvider = (id: string) => {
    setSubagentDefaultModel(id ? `${id}:${subModel}` : "");
    if (id) loadModels(id).then(setSubModels); else setSubModels([]);
  };
  const handleSubModel = (v: string) => {
    setSubagentDefaultModel(subProvider ? `${subProvider}:${v}` : v);
  };

  return (
    <div className="space-y-4">
      <ModelSlot
        title="默认模型(会话未指定时使用)"
        provider={defaultProvider}
        model={defaultModel}
        models={defaultModels}
        onProvider={handleDefaultProvider}
        onModel={setDefaultModel}
      />
      <ModelSlot
        title="兜底模型(默认模型不可用时降级)"
        provider={fallbackProvider}
        model={fallbackModel}
        models={fallbackModels}
        onProvider={handleFallbackProvider}
        onModel={setFallbackModel}
      />
      <ModelSlot
        title="子 Agent 默认模型(委派 Builder/Evaluator 未指定时使用)"
        provider={subProvider}
        model={subModel}
        models={subModels}
        onProvider={handleSubProvider}
        onModel={handleSubModel}
      />
    </div>
  );
}

// ── Provider 列表管理器 ──────────────────────────────────────────

export function ProvidersManager() {
  const { apiProviders, setApiProviders } = useSettingsStore();
  const [editing, setEditing] = useState<ProviderConfig | null>(null);
  const [adding, setAdding] = useState(false);
  const configs = Object.values(apiProviders?.configs ?? {});

  const handleSave = (cfg: ProviderConfig) => {
    const current = apiProviders?.current;
    const updated = { ...(apiProviders?.configs ?? {}), [cfg.id]: cfg };
    setApiProviders({ current: current ?? cfg.id, configs: updated });
    setEditing(null);
    setAdding(false);
  };

  const handleDelete = (id: string) => {
    const next = { ...(apiProviders?.configs ?? {}) };
    delete next[id];
    const current: string | null = apiProviders?.current === id ? (Object.keys(next)[0] ?? null) : (apiProviders?.current ?? null);
    setApiProviders({ current, configs: next });
  };

  if (adding || editing) {
    return (
      <ProviderForm
        initial={editing}
        onSave={handleSave}
        onCancel={() => { setEditing(null); setAdding(false); }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">API 供应商</h3>
        <button onClick={() => setAdding(true)}
          className="px-3 py-1 rounded-lg border border-accent text-accent text-xs font-medium hover:bg-accent-subtle transition-colors">
          + 添加供应商
        </button>
      </div>
      {configs.length === 0 ? (
        <p className="text-xs text-text-secondary">尚未添加供应商，请点击上方按钮添加。</p>
      ) : (
        configs.map((cfg) => {
          const isActive = apiProviders?.current === cfg.id;
          const brand = BRAND_BY_PI_ID.get(cfg.presetId);
          return (
            <div key={cfg.id} className={`group flex items-center gap-3 p-3 rounded-lg border transition-colors ${isActive ? "border-accent bg-accent-subtle" : "border-border bg-surface hover:border-accent-border-strong"}`}>
              {/* 品牌图标 */}
              {brand?.icon && <img src={brand.icon} className="w-5 h-5 rounded shrink-0 object-contain" alt="" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary truncate">{cfg.name}</span>
                  {isActive && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent text-text-inverse shrink-0">当前</span>}
                  <span className="text-[10px] text-text-muted shrink-0">{brand ? brandDisplayName(brand) : cfg.presetId}</span>
                </div>
                <div className="text-[11px] text-text-secondary mt-0.5 truncate">
                  <span className="font-mono">{cfg.model}</span>
                  <span className="text-text-muted mx-1.5">·</span>
                  <span>Key {cfg.apiKey.slice(0, 8)}…</span>
                </div>
              </div>
              <div className="flex gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                {!isActive && (
                  <button onClick={() => setApiProviders({ ...apiProviders!, current: cfg.id, configs: apiProviders!.configs })}
                    className="px-2 py-1 text-[10px] rounded bg-surface border border-border text-text-secondary hover:text-accent hover:border-accent-border-strong transition-colors">启用</button>
                )}
                <button onClick={() => setEditing(cfg)}
                  className="px-2 py-1 text-[10px] rounded bg-surface border border-border text-text-secondary hover:text-text-primary hover:border-accent-border-strong transition-colors">编辑</button>
                <button onClick={() => handleDelete(cfg.id)}
                  className="px-2 py-1 text-[10px] rounded bg-surface border border-border text-text-secondary hover:text-danger hover:border-danger/40 transition-colors">删除</button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
