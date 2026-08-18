import { useState, useEffect } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { getPreset } from "@shared/platform-presets";
import type { ProviderConfig } from "@shared/platform-presets";
import { Select } from "../Select";
import { BRAND_BY_PI_ID, providerSelectOptions } from "../../lib/provider-brands";

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
  const isCustom = presetId === "custom" || initial?.presetId === "custom";
  const brand = BRAND_BY_PI_ID.get(presetId);

  const [name, setName] = useState(initial?.name || "");
  const [apiKey, setApiKey] = useState(initial?.apiKey || "");
  const [model, setModel] = useState(initial?.model || "");
  const [models, setModels] = useState<string[]>(initial?.models || []);
  // 用户手动补充的模型(内置供应商:SDK 模型外的自定义模型;如 glm-5.3 等新上线模型)
  const [extraModels, setExtraModels] = useState<string[]>(initial?.extraModels || []);
  const [extraModelInput, setExtraModelInput] = useState("");
  // 该供应商的 task 子 Agent 默认模型(per-provider)
  const [subagentDefaultModel, setSubagentDefaultModel] = useState<string>(initial?.subagentDefaultModel || "");
  // 自定义供应商字段
  const [baseUrl, setBaseUrl] = useState<string>((initial as any)?.baseUrl || "");
  const [apiType, setApiType] = useState<string>((initial as any)?.apiType || "anthropic-messages");
  const [customModelsText, setCustomModelsText] = useState<string>(initial?.models?.join("\n") || "");
  const [showKey, setShowKey] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadedProvider, setLoadedProvider] = useState<string>("");
  // 可选的模型列表:内置供应商 = SDK 模型 + 用户补充(去重);自定义从 textarea 解析
  const availableModels = isCustom
    ? customModelsText.split("\n").map((s) => s.trim()).filter(Boolean)
    : Array.from(new Set([...models, ...extraModels]));

  // 添加补充模型:去重(与 SDK 模型及已添加的合并),重复则忽略
  const addExtraModel = (raw: string) => {
    const id = raw.trim();
    if (!id) return;
    if (availableModels.includes(id)) { setExtraModelInput(""); return; } // 已存在,忽略
    setExtraModels((prev) => [...prev, id]);
    setExtraModelInput("");
    if (!model) setModel(id);
  };

  // 初始化：编辑已有供应商时自动加载模型列表
  useEffect(() => {
    if (presetId && presetId !== loadedProvider && presetId !== "custom") {
      setLoadedProvider(presetId);
      loadModels(presetId);
    }
  }, [presetId]);

  const handlePresetSelect = async (id: string) => {
    setPresetId(id);
    if (id === "custom") return;  // 自定义供应商不拉模型列表
    // 自动填名称(用户未填写时);加载模型列表
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
    if (!name.trim()) { alert("请输入名称"); return; }
    if (!apiKey.trim()) { alert("请输入 API Key"); return; }
    if (isCustom && !baseUrl.trim()) { alert("自定义供应商需填写 Base URL"); return; }
    const modelList = isCustom
      ? customModelsText.split("\n").map((s) => s.trim()).filter(Boolean)
      : Array.from(new Set([...models, ...extraModels]));
    const cfg: ProviderConfig = {
      id: initial?.id || `${(presetId || "custom")}-${Date.now()}`,
      presetId: isCustom ? "custom" : presetId,
      name: name.trim(),
      apiKey: apiKey.trim(),
      model: model || (modelList[0] ?? ""),
      models: modelList,
      extraModels: isCustom ? undefined : extraModels, // 自定义供应商用 textarea,不存 extra
      subagentDefaultModel: subagentDefaultModel || undefined,
      createdAt: initial?.createdAt || Date.now(),
      baseUrl: isCustom ? baseUrl.trim() || undefined : undefined,
      apiType: isCustom ? apiType : undefined,
    };
    onSave(cfg);
  };

  const SELF_PROVIDER = { value: "custom", label: "自定义供应商", icon: "" };
  const SELF_PROVIDER_OPTIONS = [...providerSelectOptions(), SELF_PROVIDER];

  return (
    <div className="space-y-4">
      {/* 平台选择:下拉展示全部品牌及其接入方式(图标 + 中文名) + 自定义 */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">选择平台</label>
        <Select
          block
          placeholder="请选择供应商或选自定义"
          value={presetId}
          onChange={handlePresetSelect}
          options={SELF_PROVIDER_OPTIONS}
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

      {/* 模型(默认):该供应商的默认模型(下拉,替代按钮列表,更紧凑) */}
      {!isCustom && (
        <div>
          <label className="text-xs text-text-secondary block mb-1.5">模型(默认)</label>
          <Select
            block
            placeholder={loadingModels ? "加载中…" : (availableModels.length === 0 ? "无可用模型" : "选择模型")}
            value={model}
            onChange={(v: string) => setModel(v)}
            options={availableModels.map((m) => ({ value: m, label: m }))}
            title="选择模型"
          />
          {availableModels.length > 0 && <p className="text-[10px] text-text-muted mt-1">共 {availableModels.length} 个模型可选</p>}
          {/* 添加自定义模型:SDK 列表外的模型(新上线/未收录)手动补充,合并去重 */}
          <div className="flex items-center gap-2 mt-2">
            <input
              className="flex-1 min-w-0 h-8 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-primary outline-none focus:border-accent/50"
              placeholder="添加模型 ID (如 glm-5.3)"
              value={extraModelInput}
              onChange={(e) => setExtraModelInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addExtraModel(extraModelInput); }}
            />
            <button
              type="button"
              className="shrink-0 px-3 h-8 rounded-lg bg-accent text-text-inverse text-xs font-medium hover:bg-accent-hover transition-colors disabled:opacity-40"
              onClick={() => addExtraModel(extraModelInput)}
              disabled={!extraModelInput.trim()}
            >
              添加
            </button>
          </div>
          {extraModels.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {extraModels.map((m) => (
                <span key={m} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent-subtle text-[10px] text-accent">
                  {m}
                  <button type="button" className="text-accent hover:text-danger transition-colors" onClick={() => setExtraModels((prev) => prev.filter((x) => x !== m))}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {isCustom && (<>
      {/* 自定义供应商:Base URL + API 类型 + 模型列表 */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">Base URL *</label>
        <input
          className="w-full h-8 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-primary outline-none focus:border-accent/50"
          placeholder="https://api.example.com/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">API 协议</label>
        <select
          value={apiType}
          onChange={(e) => setApiType(e.target.value)}
          className="w-full h-8 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-primary outline-none focus:border-accent/50"
        >
          <option value="anthropic-messages">Anthropic Messages</option>
          <option value="openai-completions">OpenAI Completions</option>
          <option value="openai-responses">OpenAI Responses</option>
        </select>
      </div>
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">模型列表(每行一个模型 ID)</label>
        <textarea
          className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent/50 resize-none"
          rows={5}
          placeholder={"model-1\nmodel-2\nmodel-3"}
          value={customModelsText}
          onChange={(e) => setCustomModelsText(e.target.value)}
        />
        <p className="text-[10px] text-text-muted mt-1">这些模型将注册为自定义供应商的可用模型,保存后在模型下拉中可选。</p>
      </div>
      </>)}

      {/* 子 Agent 默认模型:task 工具委派子 Agent 未指定时用(per-provider 配置) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-text-secondary">SubAgent默认模型(委派任务时使用)</label>
          {subagentDefaultModel && (
            <button type="button" onClick={() => setSubagentDefaultModel("")} className="text-[10px] text-text-secondary hover:text-text-primary transition-colors">清除</button>
          )}
        </div>
        <Select
          block
          placeholder={availableModels.length === 0 ? "无可用模型" : "可选"}
          value={subagentDefaultModel}
          onChange={(v: string) => setSubagentDefaultModel(v)}
          options={availableModels.map((m) => ({ value: m, label: m }))}
          title="选择子 Agent 默认模型"
        />
      </div>

      {/* 保存 */}

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
                </div>
                <div className="text-[11px] text-text-secondary mt-0.5 truncate">
                  <span className="font-mono">{cfg.model}</span>
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
