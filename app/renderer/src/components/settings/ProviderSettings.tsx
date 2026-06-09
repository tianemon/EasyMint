import { useState } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { PLATFORM_PRESETS, getPreset } from "@shared/platform-presets";
import type { ProviderConfig, ApiProvidersData } from "@shared/platform-presets";

// ── 添加/编辑供应商表单 ─────────────────────────────────────────────────────

export interface ProviderFormProps {
  onSave: (cfg: ProviderConfig) => void;
  onCancel?: () => void;  // undefined = hide cancel button (onboarding mode)
  initial?: ProviderConfig | null;  // null = add mode
}

export function ProviderForm({ onSave, onCancel, initial }: ProviderFormProps) {
  const editMode = initial != null;
  const [presetId, setPresetId] = useState<string>(initial?.presetId || "");
  const preset = presetId ? getPreset(presetId) : undefined;
  const [name, setName] = useState(initial?.name || "");
  const [apiKey, setApiKey] = useState(initial?.apiKey || "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl || preset?.env.ANTHROPIC_BASE_URL || "");
  const [model, setModel] = useState(initial?.model || "");
  const [models, setModels] = useState<string[]>(initial?.models || []);
  const [context1M, setContext1M] = useState(initial?.context1M ?? false);
  const [showKey, setShowKey] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [newModel, setNewModel] = useState("");

  const handlePresetSelect = (id: string) => {
    setPresetId(id);
    const p = getPreset(id);
    if (p) {
      setBaseUrl(p.env.ANTHROPIC_BASE_URL || "");
      const defaultModel = p.env.ANTHROPIC_MODEL || "";
      setModel(defaultModel);
      // 确保默认模型在列表中（api 获取前至少有默认模型可用）
      const baseModels = p.models.length > 0 ? p.models : (defaultModel ? [defaultModel] : []);
      setModels(baseModels);
      setContext1M(p.supportsContext1M ? context1M : false);
    }
  };

  const handleFetchModels = async () => {
    if (!apiKey.trim()) { alert("请先填写 API Key"); return; }
    if (!preset?.modelsUrl) { alert("该平台未配置模型列表地址"); return; }
    try {
      setFetchingModels(true);
      const fetchedModels: string[] = await window.electronAPI.settings.fetchModels(
        preset.modelsUrl,
        apiKey,
      );
      if (fetchedModels.length > 0) {
        setModels(fetchedModels);
        if (!model && fetchedModels.length > 0 && fetchedModels[0]) setModel(fetchedModels[0]);
      }
    } catch (e) {
      console.error("[ProviderForm] fetchModels error:", e);
      alert(`获取模型列表失败: ${e}`);
    } finally {
      setFetchingModels(false);
    }
  };

  const handleAddModel = () => {
    const m = newModel.trim();
    if (m && !models.includes(m)) {
      setModels([...models, m]);
      setNewModel("");
    }
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
      baseUrl: baseUrl.trim() || undefined,
      model: model || (models[0] ?? ""),
      models,
      context1M,
      createdAt: initial?.createdAt || Date.now(),
    });
  };

  const presetButtons = PLATFORM_PRESETS.map((p) => (
    <button
      key={p.id}
      type="button"
      onClick={() => handlePresetSelect(p.id)}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        presetId === p.id
          ? "bg-accent text-white"
          : "bg-surface border border-border text-text-secondary hover:border-accent/50"
      }`}
    >
      {p.name}
    </button>
  ));

  return (
    <div className="bg-surface-alt rounded-lg p-4 space-y-4">
      <h4 className="text-sm font-medium text-text-primary">
        {editMode ? "编辑供应商" : "添加供应商"}
      </h4>

      {/* 预设选择 */}
      <div>
        <label className="text-xs text-text-secondary block mb-2">选择平台</label>
        <div className="flex flex-wrap gap-1.5">
          {presetButtons}
          <button
            type="button"
            onClick={() => handlePresetSelect("")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              !presetId
                ? "bg-accent text-white"
                : "bg-surface border border-border text-text-secondary hover:border-accent/50"
            }`}
          >
            自定义
          </button>
        </div>
        {preset && (
          <div className="mt-2 flex items-center gap-2">
            <a
              href={preset.apiKeyUrl || preset.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-accent hover:underline"
            >
              获取 API Key →
            </a>
            <span className="text-[10px] text-text-muted">
              {preset.category === "official" ? "官方" : "国产官方"}
            </span>
          </div>
        )}
      </div>

      {/* 名称 */}
      <div>
        <label className="text-xs text-text-secondary block mb-1">名称</label>
        <input
          className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
          placeholder="如：我的DeepSeek"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* API Key */}
      <div>
        <label className="text-xs text-text-secondary block mb-1">API Key</label>
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            className="w-full px-3 py-2 pr-8 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
            placeholder={preset?.keyPlaceholder || "sk-..."}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            )}
          </button>
        </div>
      </div>

      {/* Base URL */}
      <div>
        <label className="text-xs text-text-secondary block mb-1">API 地址</label>
        <input
          className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent"
          placeholder="https://api.xxx.com/anthropic"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>

      {/* 模型管理 */}
      <div>
        <label className="text-xs text-text-secondary block mb-1">
          模型列表
          {preset?.supportsModelList && (
            <button
              type="button"
              className="ml-2 text-[10px] text-accent hover:underline disabled:text-text-muted"
              disabled={fetchingModels || !apiKey.trim()}
              onClick={handleFetchModels}
            >
              {fetchingModels ? "获取中..." : "获取模型列表"}
            </button>
          )}
        </label>
        <div className="space-y-1 mb-2">
          {models.map((m, i) => (
            <div key={i} className={`flex items-center gap-1 ${m === model ? "bg-accent/5 rounded" : ""}`}>
              <button
                type="button"
                className="flex-1 px-2 py-1.5 rounded bg-surface border border-border text-text-primary text-xs text-left hover:border-accent/50"
                onClick={() => setModel(m)}
                title="点击设为默认模型"
              >
                {m}
                {m === model && (
                  <span className="text-[10px] text-accent ml-1.5">默认</span>
                )}
              </button>
              <button
                className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-danger transition-colors text-xs"
                onClick={() => {
                  setModels(models.filter((_, j) => j !== i));
                  if (m === model) setModel(models.filter((_, j) => j !== i)[0] ?? "");
                }}
              >✕</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 px-2 py-1.5 rounded bg-surface border border-border text-text-primary text-xs outline-none focus:border-accent"
            placeholder="输入模型名..."
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddModel()}
          />
          <button
            className="px-3 py-1 rounded border border-accent/50 text-accent text-xs hover:border-accent hover:bg-accent/5 transition-colors shrink-0"
            onClick={handleAddModel}
          >+ 添加模型</button>
        </div>
      </div>

      {/* context1M toggle — 仅 DeepSeek 等支持平台显示 */}
      {(preset?.supportsContext1M || (!preset && initial?.context1M !== undefined)) && (
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={context1M}
              onChange={(e) => setContext1M(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-accent"
            />
            <span className="text-xs text-text-primary">启用 1M 上下文（模型名自动加 [1M] 后缀）</span>
          </label>
        </div>
      )}

      {/* 按钮 */}
      <div className="flex gap-2 justify-end">
        {onCancel && (
          <button
            className="px-4 py-2 rounded-lg border border-border text-text-secondary text-xs hover:border-accent/50 transition-colors"
            onClick={onCancel}
          >取消</button>
        )}
        <button
          className="px-4 py-2 rounded-lg bg-accent text-white text-xs hover:bg-accent/90 transition-colors"
          onClick={handleSave}
        >保存</button>
      </div>
    </div>
  );
}

// ── 供应商列表项 ──────────────────────────────────────────────────────────

interface ProviderItemProps {
  cfg: ProviderConfig;
  isActive: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ProviderItem({ cfg, isActive, onActivate, onEdit, onDelete }: ProviderItemProps) {
  const preset = getPreset(cfg.presetId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
        isActive
          ? "bg-accent/10 border-accent/30"
          : "bg-surface border-border hover:border-accent/20"
      }`}
    >
      {/* 状态指示 */}
      <div className="shrink-0">
        <div className={`w-2 h-2 rounded-full ${isActive ? "bg-accent" : "bg-text-muted"}`} />
      </div>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-primary font-medium truncate">{cfg.name}</span>
          {isActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent shrink-0">
              使用中
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-text-muted mt-0.5">
          <span>{preset?.name || "自定义"}</span>
          {cfg.baseUrl && <span>· {cfg.baseUrl}</span>}
          <span>· 模型: {cfg.model || cfg.models[0] || "未设置"}</span>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1 shrink-0">
        {!isActive && (
          <button
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs hover:bg-accent/90 transition-colors"
            onClick={onActivate}
          >激活</button>
        )}
        <button
          className="px-2 py-1.5 rounded text-text-secondary hover:text-text-primary text-xs transition-colors"
          onClick={onEdit}
          title="编辑"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        {!isActive && (
          confirmDelete ? (
            <span className="flex items-center gap-1">
              <button
                className="px-2 py-1 rounded text-danger text-xs hover:bg-danger/10 transition-colors"
                onClick={onDelete}
              >确认</button>
              <button
                className="px-2 py-1 rounded text-text-secondary text-xs hover:text-text-primary transition-colors"
                onClick={() => setConfirmDelete(false)}
              >取消</button>
            </span>
          ) : (
            <button
              className="px-2 py-1.5 rounded text-text-secondary hover:text-danger text-xs transition-colors"
              onClick={() => setConfirmDelete(true)}
              title="删除"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          )
        )}
      </div>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────

export function ProviderSettings() {
  const { apiProviders, setApiProviders, activateProvider } = useSettingsStore();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const configs: Record<string, ProviderConfig> = apiProviders?.configs ?? {};
  const activeId = apiProviders?.current;
  const configList = Object.values(configs).sort((a: ProviderConfig, b: ProviderConfig) => b.createdAt - a.createdAt);
  const editingCfg: ProviderConfig | null = editingId ? configs[editingId] ?? null : null;

  const handleSave = (cfg: ProviderConfig) => {
    const nextConfigs = { ...configs, [cfg.id]: cfg };
    const nextData: ApiProvidersData = {
      current: editingId ? (activeId ?? null) : (activeId || cfg.id), // add mode: auto-activate
      configs: nextConfigs,
    };
    setApiProviders(nextData);
    setShowForm(false);
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    const nextConfigs = { ...configs };
    delete nextConfigs[id];
    const nextData: ApiProvidersData = {
      current: activeId === id ? null : (activeId ?? null),
      configs: nextConfigs,
    };
    setApiProviders(nextData);
  };

  const handleActivate = (id: string) => {
    activateProvider(id);
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
    setShowForm(true);
  };

  const handleAddNew = () => {
    setEditingId(null);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
  };

  return (
    <div className="space-y-4">
      {/* 添加供应商按钮 */}
      {!showForm && (
        <button
          className="w-full px-4 py-3 rounded-lg border-2 border-dashed border-border text-text-secondary text-sm hover:border-accent/50 hover:text-accent transition-colors"
          onClick={handleAddNew}
        >
          + 添加供应商
        </button>
      )}

      {/* 已保存的供应商列表 */}
      {configList.length > 0 && (
        <div className="space-y-2">
          {configList.map((cfg) => (
            <ProviderItem
              key={cfg.id}
              cfg={cfg}
              isActive={cfg.id === activeId}
              onActivate={() => handleActivate(cfg.id)}
              onEdit={() => handleEdit(cfg.id)}
              onDelete={() => handleDelete(cfg.id)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <ProviderForm
          onSave={handleSave}
          onCancel={handleCancel}
          initial={editingCfg}
        />
      )}
    </div>
  );
}
