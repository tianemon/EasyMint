import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import { useSettingsStore } from "../../stores/settings-store";
import { getPreset, normalizeExtraModels } from "@shared/platform-presets";
import type { ProviderConfig, ExtraModelCapability } from "@shared/platform-presets";
import { Select } from "../Select";
import { BRAND_BY_PI_ID, providerSelectOptions } from "../../lib/provider-brands";
import { toast } from "../ui/Toast";
import { Checkbox } from "../ui/Checkbox";
import { confirmDialog } from "../ui/ConfirmDialog";
import { ModelManager, type OfficialModelInfo } from "./ModelManager";

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

/** SDK api 类型 → 展示文案(未知类型原样显示) */
function apiTypeLabel(api: string): string {
  const map: Record<string, string> = {
    "anthropic-messages": "Anthropic Messages",
    "openai-completions": "OpenAI Completions",
    "openai-responses": "OpenAI Responses",
    "google-generative-ai": "Google Gemini",
    "google-vertex": "Google Vertex",
    "mistral-conversations": "Mistral",
    "openai-codex-responses": "OpenAI Codex",
  };
  return map[api] ?? api;
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
  // SDK 预设的连接信息(官方名/官方 Base URL/接入协议)——内置供应商只读展示
  const [providerInfo, setProviderInfo] = useState<{ name: string; baseUrl?: string; apis: string[] } | null>(null);
  // 连通测试(只探端点,0 token):自定义与内置共用同一入口
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<{ ok: boolean; detail: string } | null>(null);
  // 官方目录外的自添加模型。string = 仅 ID 条目(参数未声明,需在模型管理区补填);
  // 对象 = 带显式参数声明(窗口/输出必填)。自定义供应商的模型清单也存这里。
  const [extraModels, setExtraModels] = useState<Array<string | ExtraModelCapability>>(() => {
    const list = [...(initial?.extraModels ?? [])];
    if (isCustom) {
      // 旧版自定义供应商用 textarea 存模型清单(config.models),并入 extraModels 统一管理
      const known = new Set(normalizeExtraModels(list).map((n) => n.id));
      for (const id of initial?.models ?? []) if (!known.has(id)) list.push(id);
    }
    return list;
  });
  // 官方模型的参数覆盖不再有 UI 写入点(管理区不可编辑官方模型);存量值保存时原样透传
  // 该供应商的 task 子 Agent 默认模型(per-provider)
  const [subagentDefaultModel, setSubagentDefaultModel] = useState<string>(initial?.subagentDefaultModel || "");
  // 自定义供应商字段
  const [baseUrl, setBaseUrl] = useState<string>((initial as any)?.baseUrl || "");
  const [apiType, setApiType] = useState<string>((initial as any)?.apiType || "anthropic-messages");
  const [showKey, setShowKey] = useState(false);
  // 已拉过官方目录的供应商(时序值:只影响加载去重,不进渲染)
  const loadedProviderRef = useRef<string>("");
  // 可选的模型列表(值 = SDK 请求标识):内置供应商 = 官方目录 + 自添加;自定义 = 自添加
  const extraEntries = normalizeExtraModels(extraModels);
  const extraSdkIds = extraEntries.map((n) => n.id);
  const officialIds = officialModels ? officialModels.map((m) => m.id) : (initial?.models ?? []);
  const availableModels = isCustom
    ? Array.from(new Set(extraSdkIds))
    : Array.from(new Set([...officialIds, ...extraSdkIds]));
  // 显示名一律取 name:自添加模型用其声明的名称,官方模型用官方目录的展示名(与聊天输入条同口径)
  const labelOf = (modelId: string): string => {
    const extra = extraEntries.find((n) => n.id === modelId);
    if (extra) return extra.name;
    return officialModels?.find((m) => m.id === modelId)?.name ?? modelId;
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
    // 连接信息(SDK 预设)与模型目录并行拉取
    window.electronAPI.agent.getPiProviderInfo(providerId).then(setProviderInfo).catch(() => {});
  };

  /** 测试接口:只做连通(GET base,0 token,无需 Key/模型)——任何 HTTP 状态都算连通 */
  const runTest = async () => {
    const url = (isCustom ? baseUrl.trim() : providerInfo?.baseUrl ?? "").trim();
    if (!url) { toast(isCustom ? "请先填写 Base URL" : "官方端点尚未加载，请稍后再试"); return; }
    setTesting(true);
    setProbe(null);
    try {
      const r = await window.electronAPI.settings.testProvider({ baseUrl: url });
      setProbe({ ok: r.reachability.ok, detail: r.reachability.detail });
    } catch (e) {
      setProbe({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };


  const handleSave = async (): Promise<boolean> => {
    if (!name.trim()) { toast("请输入名称"); return false; }
    if (!apiKey.trim()) { toast("请输入 API Key"); return false; }
    if (isCustom && !baseUrl.trim()) { toast("自定义供应商需填写 Base URL"); return false; }
    // 自添加模型必须显式声明参数:数据层不推断,SDK 兜底(128K/16K)与 EM 兜底都可能与实际不符,
    // 1M 窗口的模型会过早触发压缩——从入口拦住比事后排查便宜
    const pending = normalizeExtraModels(extraModels)
      .find((n) => !n.entry?.contextWindow || !n.entry?.maxTokens);
    if (pending) { toast(`模型 ${pending.id} 未填写参数，请先在下方选中它补填`); return false; }
    // 模型清单 = SDK 请求标识(id):聊天页切换与主进程解析都按它找模型
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
      modelOverrides: initial?.modelOverrides,
      subagentDefaultModel: subagentDefaultModel || undefined,
      createdAt: initial?.createdAt || Date.now(),
      baseUrl: isCustom ? baseUrl.trim() || undefined : undefined,
      apiType: isCustom ? apiType : undefined,
    };
    onSave(cfg);
    return true;
  };

  // 暴露 save 给宿主(独立弹窗底部操作栏经 ref 触发)
  useImperativeHandle(ref, () => ({ save: handleSave }));

  const SELF_PROVIDER = { value: "custom", label: "自定义供应商", icon: "" };
  const SELF_PROVIDER_OPTIONS = [SELF_PROVIDER, ...providerSelectOptions()];

  return (
    <div className="space-y-4">
      {/* 平台选择:仅添加时可选;编辑态固定(供应商身份不可改,换平台=删了重建) */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">选择平台</label>
        <Select
          block
          className="[&>button]:h-8 [&>button]:text-xs"
          disabled={!!initial}
          placeholder="请选择供应商或选自定义"
          value={presetId}
          onChange={handlePresetSelect}
          options={SELF_PROVIDER_OPTIONS}

        />
      </div>

      {/* 名称 */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">名称</label>
        <input className="em-input em-input-compact w-full h-8 px-2.5 text-text-primary text-xs transition-colors"
          placeholder="如：我的DeepSeek" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      {/* 接入信息:Base URL / API 协议 —— 单一模板。自定义=可编辑;内置=SDK 预设只读。
          测试按钮在值右端(两页一致);下方为结果区与「验证密钥」可选项 */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5 em-required">Base URL</label>
        <div className="flex items-center gap-1.5">
          {isCustom ? (
            <input
              className="em-input em-input-compact flex-1 min-w-0 h-8 px-2.5 text-xs text-text-primary"
              
              placeholder="https://api.example.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          ) : (
            <input
              readOnly
              className="em-input em-input-compact flex-1 min-w-0 h-8 px-2.5 text-xs text-text-primary"
              title={providerInfo?.baseUrl ? `${providerInfo.baseUrl}（SDK 预设，不可修改）` : undefined}
              value={providerInfo?.baseUrl ?? (providerInfo ? "—" : "加载中…")}
            />
          )}
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing || (isCustom ? !baseUrl.trim() : !providerInfo?.baseUrl)}
            className="shrink-0 h-7 px-3 rounded-[var(--radius-btn)] btn-raised text-xs font-medium disabled:opacity-40"
          >{testing ? "测试中…" : "测试连接"}</button>
        </div>
        {probe?.detail && (
          <p className={`text-[length:var(--text-2xs)] mt-1.5 ${probe.ok ? "text-success" : "text-danger"}`}>
            {probe.ok ? `连通正常 · ${probe.detail}` : `连接失败 · ${probe.detail}`}
          </p>
        )}
      </div>
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">API 协议</label>
        {isCustom ? (
          <Select
            block
            className="[&>button]:h-8 [&>button]:text-xs"
            value={apiType}
            onChange={setApiType}
            options={[
              { value: "anthropic-messages", label: "Anthropic Messages" },
              { value: "openai-completions", label: "OpenAI Completions" },
              { value: "openai-responses", label: "OpenAI Responses" },
            ]}
          />
        ) : (
          <input
            readOnly
            className="em-input em-input-compact w-full h-8 px-2.5 text-xs text-text-secondary"
            value={providerInfo ? (providerInfo.apis.length > 0 ? providerInfo.apis.map(apiTypeLabel).join(" · ") : "—") : "加载中…"}
          />
        )}
      </div>
      {/* API Key */}
      <div>
        <label className="text-xs text-text-secondary block mb-1.5">API Key</label>
        <div className="relative">
          <input type={showKey ? "text" : "password"}
            className="em-input em-input-compact w-full h-8 px-2.5 pr-9 text-text-primary text-xs transition-colors"
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

      {/* 默认模型 + 子Agent默认模型:同一行——两者都是「这个供应商用哪个模型」 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-text-secondary block mb-1.5">默认模型</label>
          <Select
            block
            className="[&>button]:h-8 [&>button]:text-xs"
            placeholder={!isCustom && officialModels === null ? "加载中…" : (availableModels.length === 0 ? "无可用模型" : "选择模型")}
            value={model}
            onChange={(v: string) => setModel(v)}
            options={availableModels.map((m) => ({ value: m, label: labelOf(m) }))}
          />
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1.5">子Agent默认模型</label>
          <Select
            block
            className="[&>button]:h-8 [&>button]:text-xs"
            placeholder={availableModels.length === 0 ? "无可用模型" : "可选"}
            value={subagentDefaultModel}
            onChange={(v: string) => setSubagentDefaultModel(v)}
            options={[{ value: "", label: "不指定（用默认模型）" }, ...availableModels.map((m) => ({ value: m, label: labelOf(m) }))]}
          />
        </div>
      </div>
      {availableModels.length > 0 && <p className="text-[length:var(--text-2xs)] text-text-muted -mt-2">共 {availableModels.length} 个模型可选</p>}

      {/* 模型管理:自添加模型(输入框添加 + 行选中编辑);官方模型不可编辑,只在上面下拉里可选 */}
      <ModelManager
        isCustom={isCustom}
        officialModels={officialModels}
        defaultModel={model}
        subagentDefaultModel={subagentDefaultModel}
        extraModels={extraModels}
        modelSupports={modelSupports}
        onDefaultModelChange={setModel}
        onSubagentDefaultModelChange={setSubagentDefaultModel}
        onChange={(next) => { setExtraModels(next.extraModels); }}
      />

      {/* 保存/取消条(仅非 bare 宿主,如 Onboarding 内联场景):sticky 底部始终可见。
          设计语言:底部分区不用横线,靠 bg-surface-alt 底色分区 */}
      {!bare && (
        <div className="sticky bottom-0 -mx-6 px-6 pt-2 pb-1 flex justify-end gap-2 bg-surface-alt">
          {onCancel && (
            <button type="button" onClick={onCancel} className="px-4 py-1.5 rounded-[var(--radius-btn)] border border-border text-text-secondary text-xs hover:bg-surface-hover transition-colors">取消配置</button>
          )}
          <button type="button" onClick={handleSave} className="px-4 py-1.5 rounded-[var(--radius-btn)] btn-accent text-xs font-medium">
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
          <button className="w-7 h-7 shrink-0 flex items-center justify-center rounded-[var(--radius-btn)] text-text-secondary hover:bg-surface-hover transition-colors" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        {/* 内容区:唯一滚动区——滚动条只存在于此,不会侵入底部操作栏。
            pb-4 与上方 pt-4 对称:滚到底时最后一块内容不贴底栏(间距靠内容区内边距,不靠底栏外边距) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-4">
          <ProviderForm ref={saveRef} bare initial={initial} onSave={onSave} onCancel={onClose} />
        </div>
        {/* 底部操作栏:滚动区外(flex 列结构),与头部同底色分区,无分隔线 */}
        <div className="flex items-center justify-end gap-2 px-4 py-1 bg-surface-alt shrink-0">
          <button onClick={onClose}
            className="h-8 px-4 whitespace-nowrap rounded-[var(--radius-btn)] border border-border text-text-secondary text-xs hover:bg-surface-hover transition-colors shrink-0">取消配置</button>
          <button onClick={() => saveRef.current?.save()}
            className="h-8 px-4 whitespace-nowrap rounded-[var(--radius-btn)] btn-accent text-xs font-medium shrink-0">保存供应商配置</button>
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
          className="px-3 py-1 rounded-[var(--radius-btn)] border border-accent text-accent text-xs font-medium hover:bg-accent-subtle transition-colors">
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
