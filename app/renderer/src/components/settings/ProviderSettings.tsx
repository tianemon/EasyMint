import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useSettingsStore } from "../../stores/settings-store";
import { getPreset } from "@shared/platform-presets";
import type { ProviderConfig } from "@shared/platform-presets";
import { THINKING_ORDER, THINKING_LABELS } from "@shared/thinking-levels";
import { Select, type SelectOption } from "../Select";
import { BRAND_BY_PI_ID, providerSelectOptions } from "../../lib/provider-brands";
import { toast } from "../ui/Toast";

interface PiModelInfo {
  id: string; name: string; contextWindow: number;
}

export interface ProviderFormProps {
  onSave: (cfg: ProviderConfig) => void;
  onCancel?: () => void;
  initial?: ProviderConfig | null;
}

export function ProviderForm({ onSave, onCancel, initial }: ProviderFormProps) {
  const [presetId, setPresetId] = useState<string>(initial?.presetId || "custom");
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
  // 按模型设置思考等级(存 Pi 全局设置,键 <provider>/<modelId>);空 = 跟随全局
  const [modelLevels, setModelLevels] = useState<Record<string, string>>({});
  const [savedModelLevels, setSavedModelLevels] = useState<Record<string, string>>({});
  // 可选的模型列表:内置供应商 = SDK 模型 + 用户补充(去重);自定义从 textarea 解析
  const availableModels = isCustom
    ? customModelsText.split("\n").map((s) => s.trim()).filter(Boolean)
    : Array.from(new Set([...models, ...extraModels]));

  // 每个模型支持的思考等级(静态模型规格查表,经 agent:getModelThinkingSupport);
  // 值 undefined = 未拉到,null = 规格未知 → 下拉按全部档位展示(与聊天页行为一致)
  const [modelSupports, setModelSupports] = useState<Record<string, string[] | null>>({});
  const modelListKey = availableModels.join("\n");
  useEffect(() => {
    if (!modelListKey) return;
    let cancelled = false;
    Promise.all(
      modelListKey.split("\n").filter(Boolean).map(async (id) =>
        [id, await window.electronAPI.agent.getModelThinkingSupport(id).catch(() => null)] as const
      )
    ).then((pairs) => {
      if (cancelled) return;
      setModelSupports((prev) => {
        const next = { ...prev };
        for (const [id, levels] of pairs) next[id] = levels;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [modelListKey]);

  // 读取该供应商已保存的「按模型思考等级」
  // 自定义供应商在运行时里按 config.id 注册,键随之(新建未保存时拿不到 id,故仅编辑态可用)
  const levelProviderKey = isCustom ? (initial?.id || "") : presetId;
  useEffect(() => {
    if (!levelProviderKey) return;
    window.electronAPI.agent.getModelThinkingLevels().then((all) => {
      const map: Record<string, string> = {};
      for (const [k, v] of Object.entries(all ?? {})) {
        if (k.startsWith(`${levelProviderKey}/`)) map[k.slice(levelProviderKey.length + 1)] = v;
      }
      setModelLevels(map);
      setSavedModelLevels(map);
    }).catch(() => {});
  }, [levelProviderKey]);

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


  const handleSave = async () => {
    if (!name.trim()) { toast("请输入名称"); return; }
    if (!apiKey.trim()) { toast("请输入 API Key"); return; }
    if (isCustom && !baseUrl.trim()) { toast("自定义供应商需填写 Base URL"); return; }
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
    // 按模型思考等级:只提交与已保存值不同的项(清空 = 删除设置,恢复跟随全局)
    if (levelProviderKey) {
      const keys = new Set([...Object.keys(modelLevels), ...Object.keys(savedModelLevels)]);
      for (const k of keys) {
        const next = modelLevels[k] || "";
        const prev = savedModelLevels[k] || "";
        if (next === prev) continue;
        try { await window.electronAPI.agent.setModelThinkingLevel(levelProviderKey, k, next || null); }
        catch { /* 单项失败不阻断保存 */ }
      }
    }
    onSave(cfg);
  };

  const SELF_PROVIDER = { value: "custom", label: "自定义供应商", icon: "" };
  const SELF_PROVIDER_OPTIONS = [SELF_PROVIDER, ...providerSelectOptions()];

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
         
        />
      </div>

      {/* 名称 */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">名称</label>
        <input className="em-input w-full px-3 py-2 text-text-primary text-sm transition-colors"
          placeholder="如：我的DeepSeek" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      {/* 自定义供应商:Base URL + API 协议(在 API Key 前——新增默认选自定义,先填接入信息) */}
      {isCustom && (<>
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">Base URL *</label>
        <input
          className="em-input w-full h-8 px-2.5 text-xs text-text-primary"
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
          className="em-input w-full h-8 px-2.5 text-xs text-text-primary"
        >
          <option value="anthropic-messages">Anthropic Messages</option>
          <option value="openai-completions">OpenAI Completions</option>
          <option value="openai-responses">OpenAI Responses</option>
        </select>
      </div>
      </>)}

      {/* API Key */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">API Key</label>
        <div className="relative">
          <input type={showKey ? "text" : "password"}
            className="em-input w-full px-3 py-2 pr-9 text-text-primary text-sm transition-colors"
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

      {/* 模型(默认):该供应商的默认模型(下拉,替代按钮列表,更紧凑;内置/自定义通用) */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">模型(默认)</label>
        <Select
          block
          placeholder={loadingModels ? "加载中…" : (availableModels.length === 0 ? "无可用模型" : "选择模型")}
          value={model}
          onChange={(v: string) => setModel(v)}
          options={availableModels.map((m) => ({ value: m, label: m }))}
         
        />
        {availableModels.length > 0 && <p className="text-[length:var(--text-2xs)] text-text-muted mt-1">共 {availableModels.length} 个模型可选</p>}
      </div>

      {/* 添加自定义模型:SDK 列表外的模型(新上线/未收录)手动补充,合并去重(仅内置供应商) */}
      {!isCustom && (
        <div>
          <div className="flex items-center gap-2 mt-2">
            <input
              className="em-input flex-1 min-w-0 h-8 px-2.5 text-xs text-text-primary"
              placeholder="添加模型 ID (如 glm-5.3)"
              value={extraModelInput}
              onChange={(e) => setExtraModelInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addExtraModel(extraModelInput); }}
            />
            <button
              type="button"
              className="shrink-0 px-3 h-8 rounded-lg btn-accent text-xs font-medium"
              onClick={() => addExtraModel(extraModelInput)}
              disabled={!extraModelInput.trim()}
            >
              添加
            </button>
          </div>
          {extraModels.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {extraModels.map((m) => (
                <span key={m} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent-subtle text-[length:var(--text-2xs)] text-accent">
                  {m}
                  <button type="button" className="text-accent hover:text-danger transition-colors" onClick={() => setExtraModels((prev) => prev.filter((x) => x !== m))}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 按模型设置思考等级:不同模型支持的等级不同,全局等级会被裁到该模型支持的最近档位;
          这里可给单个模型固定等级,优先于全局设置(自定义供应商需已保存过,要用到其供应商 id) */}
      {(!isCustom || levelProviderKey) && availableModels.length > 0 && (() => {
        const setCount = availableModels.filter((m) => modelLevels[m]).length;
        return (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-text-secondary">按模型设置思考等级（可选）</label>
              {setCount > 0 && (
                <span className="text-[length:var(--text-2xs)] text-text-muted">已为 {setCount} 个模型固定等级</span>
              )}
            </div>
            <div className="bg-surface-alt rounded-lg border border-border px-2.5 py-2 max-h-52 overflow-y-auto space-y-1">
              {availableModels.map((m) => {
                const supported = modelSupports[m];
                // 规格未知(null/未拉到)时展示全部档位;已知则只列出该模型支持的档位(按档位顺序)
                const levels = supported && supported.length > 0
                  ? THINKING_ORDER.filter((l) => supported.includes(l))
                  : [...THINKING_ORDER];
                const cur = modelLevels[m] || "";
                const options: SelectOption[] = [
                  { value: "", label: "跟随全局" },
                  ...levels.map((l) => ({ value: l, label: THINKING_LABELS[l] || l })),
                ];
                // 旧数据/模型规格变化导致所选档位已不被支持:兜底展示原值,避免下拉显示空值
                if (cur && !options.some((o) => o.value === cur)) {
                  options.push({ value: cur, label: `原设置：${THINKING_LABELS[cur] || cur}（不再支持）` });
                }
                return (
                  <div key={m} className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate text-xs font-mono text-text-primary" title={m}>{m}</span>
                    <Select
                      className="shrink-0 w-[112px] [&>button]:w-full [&>button]:text-xs"
                      value={cur}
                      onChange={(v: string) => setModelLevels((prev) => ({ ...prev, [m]: v }))}
                      options={options}
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-[length:var(--text-2xs)] text-text-muted mt-1">下拉仅列出该模型支持的档位；固定等级优先于全局思考等级</p>
          </div>
        );
      })()}

      {isCustom && (<>
      {/* 自定义供应商:模型列表 */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">模型列表(每行一个模型 ID)</label>
        <textarea
          className="em-input w-full px-2.5 py-1.5 text-xs text-text-primary resize-none"
          rows={5}
          placeholder={"model-1\nmodel-2\nmodel-3"}
          value={customModelsText}
          onChange={(e) => setCustomModelsText(e.target.value)}
        />
        <p className="text-[length:var(--text-2xs)] text-text-muted mt-1">保存后在模型下拉中可选</p>
      </div>
      </>)}

      {/* 子 Agent 默认模型:task 工具委派子 Agent 未指定时用(per-provider 配置) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-text-secondary">子 Agent 默认模型（委派任务时使用）</label>
          {subagentDefaultModel && (
            <button type="button" onClick={() => setSubagentDefaultModel("")} className="text-[length:var(--text-2xs)] text-text-secondary hover:text-text-primary transition-colors">清除</button>
          )}
        </div>
        <Select
          block
          placeholder={availableModels.length === 0 ? "无可用模型" : "可选"}
          value={subagentDefaultModel}
          onChange={(v: string) => setSubagentDefaultModel(v)}
          options={availableModels.map((m) => ({ value: m, label: m }))}
         
        />
      </div>

      {/* 保存/取消:sticky 底部始终可见(表单较长需滚动)。宿主须保证表单是滚动区
          最后内容且滚动区自身无底部 padding——bottom-0 即贴滚动区底缘(独立弹窗 /
          Onboarding 均满足)。-mx-6 px-6:条背景横向通栏(抵消滚动区 px-6) */}
      <div className="sticky bottom-0 -mx-6 px-6 pt-2 pb-1 flex justify-end gap-2" style={{ background: "var(--color-input-card)", borderTop: "1px solid var(--color-border)" }}>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-4 py-1.5 rounded-lg border border-border text-text-secondary text-xs hover:bg-surface-hover transition-colors">取消配置</button>
        )}
        <button type="button" onClick={handleSave} className="px-4 py-1.5 rounded-lg btn-accent text-xs font-medium">
          保存供应商配置
        </button>
      </div>
    </div>
  );
}

// ── 供应商表单独立弹窗 ────────────────────────────────────────────

/** 添加/编辑供应商的独立弹窗:滚动区即弹窗本体(无外部 Footer),表单的 sticky
 *  保存条 bottom-0 直接贴滚动区底缘,无需任何 padding hack。Esc / ✕ / 取消 关闭。
 *  必须 Portal 到 body:设置弹窗面板带 transform(scale),会变成 fixed 后代的包含块,
 *  直接内联渲染会把遮罩与面板锁在 760×600 的设置窗口里,上下被裁剪。 */
export function ProviderFormDialog({ initial, onSave, onClose }: {
  initial?: ProviderConfig | null;
  onSave: (cfg: ProviderConfig) => void;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="settings-overlay-v3 open">
      <div className="settings-panel-v3" style={{ width: 580, height: "min(640px, calc(100vh - 96px))" }}>
        {/* 标题行:供应商名 + ✕(与设置弹窗 header 同风格) */}
        <div className="flex items-center gap-3 px-6 h-11 shrink-0 border-b border-border">
          <span className="text-sm font-medium text-text-primary truncate">
            {initial ? `编辑供应商${initial.name ? ` · ${initial.name}` : ""}` : "添加供应商"}
          </span>
          <button className="settings-close ml-auto" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pt-4">
          <ProviderForm initial={initial} onSave={onSave} onCancel={onClose} />
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Provider 列表管理器 ──────────────────────────────────────────

export function ProvidersManager() {
  const { apiProviders, setApiProviders } = useSettingsStore();
  // null = 未打开;{ mode: "add" } = 新增;{ mode: "edit", cfg } = 编辑
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; cfg: ProviderConfig } | null>(null);
  const configs = Object.values(apiProviders?.configs ?? {});

  const handleSave = (cfg: ProviderConfig) => {
    const current = apiProviders?.current;
    const updated = { ...(apiProviders?.configs ?? {}), [cfg.id]: cfg };
    setApiProviders({ current: current ?? cfg.id, configs: updated });
    setDialog(null);
  };

  const handleDelete = (id: string) => {
    const next = { ...(apiProviders?.configs ?? {}) };
    delete next[id];
    const current: string | null = apiProviders?.current === id ? (Object.keys(next)[0] ?? null) : (apiProviders?.current ?? null);
    setApiProviders({ current, configs: next });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">API 供应商</h3>
        <button onClick={() => setDialog({ mode: "add" })}
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
                  {isActive && <span className="text-[length:var(--text-3xs)] px-1.5 py-0.5 rounded-full bg-accent text-text-inverse shrink-0">当前</span>}
                </div>
                <div className="text-[length:var(--text-11)] text-text-secondary mt-0.5 truncate">
                  <span className="font-mono">{cfg.model}</span>
                </div>
              </div>
              <div className="flex gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                {!isActive && (
                  <button onClick={() => setApiProviders({ ...apiProviders!, current: cfg.id, configs: apiProviders!.configs })}
                    className="px-2 py-1 text-[length:var(--text-2xs)] rounded bg-surface border border-border text-text-secondary hover:text-accent hover:border-accent-border-strong transition-colors">启用</button>
                )}
                <button onClick={() => setDialog({ mode: "edit", cfg })}
                  className="px-2 py-1 text-[length:var(--text-2xs)] rounded bg-surface border border-border text-text-secondary hover:text-text-primary hover:border-accent-border-strong transition-colors">编辑</button>
                <button onClick={() => handleDelete(cfg.id)}
                  className="px-2 py-1 text-[length:var(--text-2xs)] rounded bg-surface border border-border text-text-secondary hover:text-danger hover:border-danger/40 transition-colors">删除</button>
              </div>
            </div>
          );
        })
      )}
      {/* 添加/编辑供应商:独立弹窗(悬浮于设置弹窗之上) */}
      {dialog && (
        <ProviderFormDialog
          initial={dialog.mode === "edit" ? dialog.cfg : null}
          onSave={handleSave}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
