import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import { useSettingsStore } from "../../stores/settings-store";
import { getPreset } from "@shared/platform-presets";
import type { ProviderConfig, ExtraModelCapability, ModelParams } from "@shared/platform-presets";
import { THINKING_ORDER, THINKING_LABELS } from "@shared/thinking-levels";
import { Select, type SelectOption } from "../Select";
import { BRAND_BY_PI_ID, providerSelectOptions } from "../../lib/provider-brands";
import { toast } from "../ui/Toast";
import { confirmDialog } from "../ui/ConfirmDialog";
import { ModelManager, type OfficialModelInfo } from "./ModelManager";
import { ProviderTester } from "./ProviderTester";

export interface ProviderFormHandle {
  /** 校验并保存;成功返回 true(内部已调 onSave),失败(校验不过)返回 false */
  save: () => Promise<boolean>;
}

export interface ProviderFormProps {
  onSave: (cfg: ProviderConfig) => void;
  onCancel?: () => void;
  initial?: ProviderConfig | null;
  /** 隐藏表单自带的底部保存条(宿主自带操作栏时用,如独立弹窗) */
  bare?: boolean;
}

export const ProviderForm = forwardRef<ProviderFormHandle, ProviderFormProps>(
  function ProviderForm({ onSave, onCancel, initial, bare }: ProviderFormProps, ref) {
  const [presetId, setPresetId] = useState<string>(initial?.presetId || "custom");
  const preset = getPreset(presetId);
  const isCustom = presetId === "custom" || initial?.presetId === "custom";
  const brand = BRAND_BY_PI_ID.get(presetId);

  const [name, setName] = useState(initial?.name || "");
  const [apiKey, setApiKey] = useState(initial?.apiKey || "");
  const [model, setModel] = useState(initial?.model || "");
  // 官方目录模型(含展示名/窗口;null = 未加载,此时沿用配置里缓存的列表)
  const [officialModels, setOfficialModels] = useState<OfficialModelInfo[] | null>(null);
  // 官方目录外的自添加模型。string = 存量仅 ID 条目(参数未声明,需在模型管理区补填);
  // 对象 = 带显式参数声明(窗口/输出必填)。自定义供应商的模型清单也存这里。
  const [extraModels, setExtraModels] = useState<Array<string | ExtraModelCapability>>(() => {
    const list = [...(initial?.extraModels ?? [])];
    if (isCustom) {
      // 旧版自定义供应商用 textarea 存模型清单(config.models),并入 extraModels 统一管理
      const known = new Set(list.map((e) => (typeof e === "string" ? e : (e.alias || e.id))));
      for (const id of initial?.models ?? []) if (!known.has(id)) list.push(id);
    }
    return list;
  });
  // 官方模型的参数覆盖(key 存在即代表纳管,空对象 = 参数全跟随官方)
  const [overrides, setOverrides] = useState<Record<string, ModelParams>>(initial?.modelOverrides ?? {});
  // 该供应商的 task 子 Agent 默认模型(per-provider)
  const [subagentDefaultModel, setSubagentDefaultModel] = useState<string>(initial?.subagentDefaultModel || "");
  // 自定义供应商字段
  const [baseUrl, setBaseUrl] = useState<string>((initial as any)?.baseUrl || "");
  const [apiType, setApiType] = useState<string>((initial as any)?.apiType || "anthropic-messages");
  const [showKey, setShowKey] = useState(false);
  // 已拉过官方目录的供应商(时序值:只影响加载去重,不进渲染)
  const loadedProviderRef = useRef<string>("");
  // 按模型设置思考等级(存 Pi 全局设置,键 <provider>/<modelId>);空 = 跟随全局
  const [modelLevels, setModelLevels] = useState<Record<string, string>>({});
  const [savedModelLevels, setSavedModelLevels] = useState<Record<string, string>>({});
  // 可选的模型列表(值 = SDK 请求标识):内置供应商 = 官方目录 + 自添加;自定义 = 自添加
  const extraEntries: Array<{ id: string; alias?: string }> = extraModels.map((e) => (typeof e === "string" ? { id: e } : e));
  const extraSdkIds = extraEntries.map((e) => e.alias || e.id);
  const officialIds = officialModels ? officialModels.map((m) => m.id) : (initial?.models ?? []);
  const availableModels = isCustom
    ? Array.from(new Set(extraSdkIds))
    : Array.from(new Set([...officialIds, ...extraSdkIds]));
  // 显示名:自添加模型用名称,官方模型用官方名,查不到回落请求标识(别名不该出现在界面上)
  const labelOf = (sdkId: string): string => {
    const extra = extraEntries.find((e) => (e.alias || e.id) === sdkId);
    return extra?.id ?? officialModels?.find((m) => m.id === sdkId)?.name ?? sdkId;
  };

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

  // 初始化：编辑已有供应商时自动加载官方模型列表
  useEffect(() => {
    if (presetId && presetId !== loadedProviderRef.current && presetId !== "custom") {
      loadedProviderRef.current = presetId;
      loadModels(presetId);
    }
  }, [presetId]);

  const handlePresetSelect = async (id: string) => {
    setPresetId(id);
    if (id === "custom") return;  // 自定义供应商不拉官方目录
    // 自动填名称(用户未填写时);加载模型列表
    if (brand && !name.trim()) setName(brand.name);
    loadModels(id);
  };

  const loadModels = async (providerId: string) => {
    try {
      const piModels: OfficialModelInfo[] = [...await window.electronAPI.agent.getPiModels(providerId)];
      setOfficialModels(piModels);
      const first = piModels[0]?.id;
      if (!model && first) setModel(first);
    } catch (e) { console.error("[ProviderForm] loadModels failed:", e); }
  };


  const handleSave = async (): Promise<boolean> => {
    if (!name.trim()) { toast("请输入名称"); return false; }
    if (!apiKey.trim()) { toast("请输入 API Key"); return false; }
    if (isCustom && !baseUrl.trim()) { toast("自定义供应商需填写 Base URL"); return false; }
    // 模型清单统一为 SDK 请求标识(别名 ?? 名称):聊天页切换与主进程解析都按它找模型
    const modelList = isCustom
      ? Array.from(new Set(extraSdkIds))
      : Array.from(new Set([...officialIds, ...extraSdkIds]));
    const cfg: ProviderConfig = {
      id: initial?.id || `${(presetId || "custom")}-${Date.now()}`,
      presetId: isCustom ? "custom" : presetId,
      name: name.trim(),
      apiKey: apiKey.trim(),
      model: model || (modelList[0] ?? ""),
      models: modelList,
      extraModels: extraModels.length > 0 ? extraModels : undefined,
      modelOverrides: Object.keys(overrides).length > 0 ? overrides : undefined,
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
    return true;
  };

  // 暴露 save 给宿主(独立弹窗底部操作栏经 ref 触发)
  useImperativeHandle(ref, () => ({ save: handleSave }));

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
        <label className="text-xs text-text-secondary block mb-1.5 em-required">Base URL</label>
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

      {/* 测试接口:仅自定义供应商——内置预设的接入信息来自 Pi,不可编辑 */}
      {isCustom && (
        <ProviderTester baseUrl={baseUrl} apiKey={apiKey} model={model} apiType={apiType} />
      )}

      {/* 模型(默认):该供应商的默认模型(下拉;值 = SDK 请求标识,显示名走 labelOf) */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">模型(默认)</label>
        <Select
          block
          placeholder={!isCustom && officialModels === null ? "加载中…" : (availableModels.length === 0 ? "无可用模型" : "选择模型")}
          value={model}
          onChange={(v: string) => setModel(v)}
          options={availableModels.map((m) => ({ value: m, label: labelOf(m) }))}
         
        />
        {availableModels.length > 0 && <p className="text-[length:var(--text-2xs)] text-text-muted mt-1">共 {availableModels.length} 个模型可选</p>}
      </div>

      {/* 子 Agent 默认模型:task 工具委派子 Agent 未指定时用(per-provider)。
          与「模型(默认)」相邻——两者都是「这个供应商用哪个模型」，放一起便于对照 */}
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
          options={availableModels.map((m) => ({ value: m, label: labelOf(m) }))}
         
        />
      </div>

      {/* 模型管理:官方目录模型与自添加模型统一列表(参数编辑 / 恢复官方 / 移除) */}
      <ModelManager
        isCustom={isCustom}
        officialModels={officialModels}
        defaultModel={model}
        overrides={overrides}
        extraModels={extraModels}
        modelSupports={modelSupports}
        onDefaultModelChange={setModel}
        onChange={(next) => { setOverrides(next.overrides); setExtraModels(next.extraModels); }}
      />

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
                    <span className="flex-1 min-w-0 truncate text-xs text-text-primary" title={m}>{labelOf(m)}</span>
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

      {/* 保存/取消条(仅非 bare 宿主,如 Onboarding 内联场景):sticky 底部始终可见。
          设计语言:底部分区不用横线,靠 bg-surface-alt 底色分区 */}
      {!bare && (
        <div className="sticky bottom-0 -mx-6 px-6 pt-2 pb-1 flex justify-end gap-2 bg-surface-alt">
          {onCancel && (
            <button type="button" onClick={onCancel} className="px-4 py-1.5 rounded-lg border border-border text-text-secondary text-xs hover:bg-surface-hover transition-colors">取消配置</button>
          )}
          <button type="button" onClick={handleSave} className="px-4 py-1.5 rounded-lg btn-accent text-xs font-medium">
            保存供应商配置
          </button>
        </div>
      )}
    </div>
  );
  },
);

// ── 供应商表单独立弹窗 ────────────────────────────────────────────

/** 添加/编辑供应商的独立弹窗。视觉遵循设计语言(2026-09-06 拍板):
 *  头/尾与内容间不做分隔横线,靠 bg-surface-alt 底色 + 留白分区;头 py-1.5 / 尾 py-1
 *  收紧(仅比按钮高一点);点遮罩 / Esc / ✕ / 取消 关闭。
 *  Portal 到 body:设置弹窗面板带 transform(scale)会劫持 fixed 包含块;
 *  Esc 用捕获阶段 + stopImmediatePropagation——下层设置弹窗的 Esc( bubble 监听)
 *  不会同时触发,避免一次按键关两层。 */
export function ProviderFormDialog({ initial, onSave, onClose }: {
  initial?: ProviderConfig | null;
  onSave: (cfg: ProviderConfig) => void;
  onClose: () => void;
}): JSX.Element {
  const saveRef = useRef<ProviderFormHandle>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="relative bg-surface rounded-xl border border-border shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 580, height: "min(640px, calc(100vh - 96px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部:底色分区(无分隔线),仅比文字高一点 */}
        <div className="flex items-center gap-2 px-4 py-1.5 bg-surface-alt shrink-0">
          <span className="text-sm font-medium text-text-primary truncate flex-1 min-w-0">
            {initial ? `编辑供应商${initial.name ? ` · ${initial.name}` : ""}` : "添加供应商"}
          </span>
          <button className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        {/* 内容区:唯一滚动区——滚动条只存在于此,不会侵入底部操作栏 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4">
          <ProviderForm ref={saveRef} bare initial={initial} onSave={onSave} onCancel={onClose} />
        </div>
        {/* 底部操作栏:滚动区外(flex 列结构),与头部同底色分区,无分隔线 */}
        <div className="flex items-center justify-end gap-2 px-4 py-1 bg-surface-alt shrink-0">
          <button onClick={onClose}
            className="h-8 px-4 whitespace-nowrap rounded-lg border border-border text-text-secondary text-xs hover:bg-surface-hover transition-colors shrink-0">取消配置</button>
          <button onClick={() => saveRef.current?.save()}
            className="h-8 px-4 whitespace-nowrap rounded-lg btn-accent text-xs font-medium shrink-0">保存供应商配置</button>
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

  const handleDelete = async (id: string) => {
    const ok = await confirmDialog({
      title: "删除供应商",
      message: `将删除「${apiProviders?.configs?.[id]?.name ?? ""}」，其 API Key 与模型配置一并移除，不可恢复。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
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
