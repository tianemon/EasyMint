import { useState, useEffect, useCallback } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { PLATFORM_PRESETS, getPreset } from "@shared/platform-presets";
import type { ProviderConfig } from "@shared/platform-presets";

interface PiProviderInfo {
  id: string; name: string; baseUrl?: string;
}

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
  const [piModelDetails, setPiModelDetails] = useState<PiModelInfo[]>([]);
  const [piInfo, setPiInfo] = useState<PiProviderInfo | null>(null);
  const [loadedProvider, setLoadedProvider] = useState<string>("");

  // 初始化：编辑已有供应商时自动加载模型列表
  useEffect(() => {
    if (presetId && presetId !== loadedProvider) {
      setLoadedProvider(presetId);
      window.electronAPI.agent.getPiProviders().then((all) => {
        const info = all.find((x) => x.id === presetId);
        if (info) setPiInfo(info);
      }).catch(() => {});
      loadModels(presetId);
    }
  }, [presetId]);

  const handlePresetSelect = async (id: string) => {
    setPresetId(id);
    const p = getPreset(id);
    if (!p) return;
    // 异步加载 Pi provider 信息和模型列表
    window.electronAPI.agent.getPiProviders().then((all) => {
      const info = all.find((x) => x.id === id);
      if (info) setPiInfo(info);
    }).catch(() => {});
    loadModels(id);
  };

  const loadModels = async (providerId: string) => {
    setLoadingModels(true);
    try {
      const piModels: PiModelInfo[] = await window.electronAPI.agent.getPiModels(providerId);
      setPiModelDetails(piModels);
      const ids = piModels.map((m) => m.id);
      setModels(ids);
      if (!model && ids.length > 0 && ids[0]) setModel(ids[0]);
    } catch (e) { console.error("[ProviderForm] loadModels failed:", e); }
    finally { setLoadingModels(false); }
  };

  const selectedModelDetail = piModelDetails.find((m) => m.id === model);

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
      {/* 预设选择 */}
      <div>
        <label className="text-xs text-text-secondary block mb-2">选择平台</label>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORM_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handlePresetSelect(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                presetId === p.id
                  ? "bg-accent text-white"
                  : "bg-surface border border-border text-text-secondary hover:border-accent-border-strong"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* 名称 */}
      <div>
        <label className="text-xs text-text-secondary block mb-1">名称</label>
        <input className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
          placeholder="如：我的DeepSeek" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      {/* API Key */}
      <div>
        <label className="text-xs text-text-secondary block mb-1">API Key</label>
        <div className="relative">
          <input type={showKey ? "text" : "password"}
            className="w-full px-3 py-2 pr-8 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
            placeholder={preset?.keyPlaceholder || "sk-..."} value={apiKey}
            onChange={(e) => setApiKey(e.target.value)} />
          <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
            onClick={() => setShowKey(!showKey)}>
            {showKey ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            )}
          </button>
        </div>
      </div>


      {/* 模型选择 */}
      <div>
        <label className="text-xs text-text-secondary block mb-1">模型列表</label>
        <div className="space-y-1 mb-2 max-h-40 overflow-y-auto">
          {models.map((m) => (
            <button key={m} type="button"
              className={`block w-full px-2 py-1.5 rounded text-xs text-left transition-colors ${m === model ? "bg-accent-subtle text-accent font-medium" : "bg-surface border border-border text-text-primary hover:border-accent-border-strong"}`}
              onClick={() => setModel(m)}>
              {m}
              {m === model && <span className="text-[10px] ml-1.5">✓ 默认</span>}
            </button>
          ))}
        </div>
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
          const preset = getPreset(cfg.presetId);
          const isActive = apiProviders?.current === cfg.id;
          return (
            <div key={cfg.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${isActive ? "border-accent bg-accent-subtle" : "border-border bg-surface"}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{cfg.name}</span>
                  {isActive && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent text-text-inverse">当前</span>}
                  <span className="text-[10px] text-text-muted">{preset?.name || cfg.presetId}</span>
                </div>
                <div className="text-[11px] text-text-secondary mt-0.5 truncate">
                  API Key: {cfg.apiKey.slice(0, 8)}... · 模型: {cfg.model} · 模型数: {cfg.models.length}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                {!isActive && (
                  <button onClick={() => setApiProviders({ ...apiProviders!, current: cfg.id, configs: apiProviders!.configs })}
                    className="px-2 py-1 text-[10px] rounded bg-surface border border-border text-text-secondary hover:text-accent transition-colors">启用</button>
                )}
                <button onClick={() => setEditing(cfg)}
                  className="px-2 py-1 text-[10px] rounded bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors">编辑</button>
                <button onClick={() => handleDelete(cfg.id)}
                  className="px-2 py-1 text-[10px] rounded bg-surface border border-border text-text-secondary hover:text-danger transition-colors">删除</button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
