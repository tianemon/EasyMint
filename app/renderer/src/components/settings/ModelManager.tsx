/**
 * 模型管理区（供应商表单内）——官方目录模型与自添加模型统一列表 + 参数编辑。
 *
 * 数据落点（见 docs/design/模型参数统一管理设计.md）：
 *   官方目录模型 → ProviderConfig.modelOverrides（key 存在即代表纳管，空对象 = 参数全跟随官方）
 *   官方目录外模型 → ProviderConfig.extraModels（对象形态显式声明参数，窗口 / 输出必填）
 *
 * 别名语义：ExtraModelCapability.id = 界面显示名，alias = 发给供应商的请求标识（SDK Model.id）。
 * 官方模型按「逐字段覆盖」写：表单里留「跟随官方」的字段不写入 modelOverrides——
 * 只有用户改过的字段被钉住，SDK 升级更新官方数据时其余字段自动跟随。
 */

import { useEffect, useRef, useState } from "react";
import type { ExtraModelCapability, ModelParams } from "@shared/platform-presets";
import { THINKING_LABELS, THINKING_ORDER, type ThinkingLevelValue } from "@shared/thinking-levels";
import { Select, type SelectOption } from "../Select";
import { toast } from "../ui/Toast";

/** 官方目录模型（agent:getPiModels 返回值） */
export interface OfficialModelInfo {
  id: string;
  name: string;
  contextWindow: number;
}

/** 模型来源标签（列表行展示） */
type ModelSource = "official" | "extra" | "custom";

const SOURCE_LABELS: Record<ModelSource, string> = {
  official: "官方",
  extra: "补充",
  custom: "自定义",
};

const SOURCE_CLASSES: Record<ModelSource, string> = {
  official: "bg-accent-soft text-accent",
  extra: "bg-info-soft text-info",
  custom: "bg-warning-soft text-warning",
};

/** 上下文窗口预设（官方模型多一项「跟随官方」，自添加模型必填） */
const CTX_PRESETS: SelectOption[] = [
  { value: "131072", label: "128K" },
  { value: "200000", label: "200K" },
  { value: "1000000", label: "1M" },
  { value: "custom", label: "自定义" },
];

/** 最大输出预设 */
const MAX_OUT_PRESETS: SelectOption[] = [
  { value: "8192", label: "8K" },
  { value: "16384", label: "16K" },
  { value: "32768", label: "32K" },
  { value: "65536", label: "64K" },
  { value: "custom", label: "自定义" },
];

const INHERIT = "inherit";

/** 可多选的思考档位（off 是「关闭思考」，不属于档位本身） */
const LEVELS = THINKING_ORDER.filter((l) => l !== "off");

/** token 数 → 标签文案（1000000 → 1M；向下取整避免 32768 显示成 33K） */
function formatTokens(tokens: number): string {
  return tokens >= 1000000 ? `${tokens / 1000000}M` : `${Math.floor(tokens / 1000)}K`;
}

/** token 数 → 预设下拉选中项（未命中预设则走「自定义」） */
function presetOf(value: number, presets: SelectOption[]): { sel: string; custom: string } {
  const hit = presets.find((p) => p.value === String(value));
  return hit ? { sel: hit.value, custom: "" } : { sel: "custom", custom: String(value) };
}

/** 下拉 + 自定义输入 → token 数；空 / 无效 → undefined（调用方按必填拦截） */
function resolveTokens(selected: string, custom: string): number | undefined {
  if (!selected || selected === INHERIT) return undefined;
  const value = Number(selected === "custom" ? custom : selected);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

/** 勾选的档位 → thinkingLevelMap（未勾选写 null = 该档不可用；已勾选沿用原有标识，缺省用档位名） */
function buildLevelMap(
  selected: string[],
  prev?: Partial<Record<ThinkingLevelValue, string | null>>,
): Partial<Record<ThinkingLevelValue, string | null>> {
  const map: Partial<Record<ThinkingLevelValue, string | null>> = {};
  for (const level of LEVELS) {
    map[level] = selected.includes(level) ? (prev?.[level] ?? level) : null;
  }
  return map;
}

/** 三态复选框：indeterminate（横杠）= 未覆盖（跟随官方）——官方模型专用。
 *  每点击一次前进一态：跟随官方（横杠）→ 是（勾）→ 否（空）→ 跟随官方。
 *  必须完全受控、不读 e.target.checked：原生 checkbox 的 indeterminate 只由 JS 设置，
 *  用户点击时浏览器会先清掉它再 toggle checked，读事件值就永远回不到「跟随官方」
 *  （横杠点一下直接变勾，此后只能 是↔否 往返）。
 *  tristate=false（自添加模型：窗口/输出必填，无「跟随官方」语义）时只在 是 ↔ 否 间切换。 */
function TriCheckbox({ value, tristate, disabled, onChange }: {
  value: "inherit" | boolean;
  tristate: boolean;
  disabled?: boolean;
  onChange: (next: "inherit" | boolean) => void;
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  const indeterminate = value === INHERIT;
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  const next: "inherit" | boolean = indeterminate ? true : value === true ? false : tristate ? INHERIT : true;
  return (
    <input
      ref={ref}
      type="checkbox"
      className="w-3.5 h-3.5 rounded accent-accent shrink-0 disabled:opacity-50"
      checked={value === true}
      disabled={disabled}
      onChange={() => onChange(next)}
    />
  );
}

/** 列表行（渲染用，由 overrides / extraModels / 默认模型聚合） */
interface ModelRow {
  /** 请求标识（自添加模型 = 别名 ?? 名称） */
  sdkId: string;
  /** 界面显示名 */
  name: string;
  source: ModelSource;
  isDefault: boolean;
  override?: ModelParams;
  entry?: ExtraModelCapability;
  /** 存量 string 条目（参数未声明，需补填） */
  legacy?: boolean;
  officialCtx?: number;
}

interface Draft {
  /** 编辑既有行时的原请求标识；新增时为 null */
  editingId: string | null;
  source: ModelSource;
  name: string;
  alias: string;
  vision: "inherit" | boolean;
  reasoning: "inherit" | boolean;
  ctx: string;
  ctxCustom: string;
  maxOut: string;
  maxOutCustom: string;
  levels: string[];
  levelsTouched: boolean;
}

export interface ModelManagerProps {
  isCustom: boolean;
  /** 官方目录（内置供应商）；null = 尚未加载 */
  officialModels: OfficialModelInfo[] | null;
  /** 当前默认模型（SDK id） */
  defaultModel: string;
  overrides: Record<string, ModelParams>;
  extraModels: Array<string | ExtraModelCapability>;
  /** 每行模型支持的思考档位（agent:getModelThinkingSupport）；null = 未知 */
  modelSupports: Record<string, string[] | null>;
  onDefaultModelChange: (sdkId: string) => void;
  onChange: (next: {
    overrides: Record<string, ModelParams>;
    extraModels: Array<string | ExtraModelCapability>;
  }) => void;
}

export function ModelManager({
  isCustom, officialModels, defaultModel, overrides, extraModels, modelSupports,
  onDefaultModelChange, onChange,
}: ModelManagerProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const officialById = new Map((officialModels ?? []).map((m) => [m.id, m]));
  /** 该模型支持的档位（未知 → null，界面按全部档位展示） */
  const supportOf = (sdkId: string): string[] | null =>
    (modelSupports[sdkId] ?? null)?.filter((l) => l !== "off") ?? null;

  // ── 行聚合：已纳管的官方模型 + 自添加模型 + 默认模型（未被上面两类覆盖时补一行）──
  const rows: ModelRow[] = [];
  const seen = new Set<string>();
  for (const [id, params] of Object.entries(overrides)) {
    rows.push({
      sdkId: id, name: officialById.get(id)?.name ?? id, source: "official",
      isDefault: id === defaultModel, override: params, officialCtx: officialById.get(id)?.contextWindow,
    });
    seen.add(id);
  }
  for (const item of extraModels) {
    const entry = typeof item === "string" ? undefined : item;
    const name = typeof item === "string" ? item : item.id;
    const sdkId = entry ? (entry.alias || entry.id) : name;
    if (seen.has(sdkId)) continue;
    seen.add(sdkId);
    rows.push({
      sdkId, name, source: isCustom ? "custom" : "extra", entry, legacy: !entry,
      isDefault: sdkId === defaultModel || name === defaultModel,
    });
  }
  // 默认模型未纳管也没列在自添加里（如存量缓存里的模型）:补一行,让它也能直接调参
  if (defaultModel && !seen.has(defaultModel)) {
    rows.push({
      sdkId: defaultModel, name: officialById.get(defaultModel)?.name ?? defaultModel,
      source: isCustom ? "custom" : "official", isDefault: true,
      officialCtx: officialById.get(defaultModel)?.contextWindow,
    });
    seen.add(defaultModel);
  }

  // ── 搜索：官方目录匹配 + 直接输入新 ID ──
  const keyword = query.trim();
  const lower = keyword.toLowerCase();
  const suggestions = !isCustom && keyword
    ? (officialModels ?? [])
      .filter((m) => !seen.has(m.id) && (m.id.toLowerCase().includes(lower) || m.name.toLowerCase().includes(lower)))
      .slice(0, 5)
    : [];
  const exactOfficial = !isCustom ? (officialModels ?? []).find((m) => m.id === keyword) : undefined;

  const commit = (next: { overrides?: Record<string, ModelParams>; extraModels?: Array<string | ExtraModelCapability> }) => {
    onChange({ overrides: next.overrides ?? overrides, extraModels: next.extraModels ?? extraModels });
  };

  /** 加入官方模型：建一条空覆盖记录（参数跟随官方，可在列表里逐项调） */
  const addOfficial = (id: string) => {
    commit({ overrides: { ...overrides, [id]: overrides[id] ?? {} } });
    if (!defaultModel) onDefaultModelChange(id);
    setQuery("");
  };

  const openAdd = (name: string) => {
    setDraft({
      editingId: null, source: isCustom ? "custom" : "extra", name, alias: "",
      vision: false, reasoning: true, ctx: "", ctxCustom: "", maxOut: "", maxOutCustom: "",
      levels: [...LEVELS], levelsTouched: false,
    });
    setQuery("");
  };

  const handleAdd = () => {
    if (!keyword) return;
    if (exactOfficial) addOfficial(exactOfficial.id);
    else openAdd(keyword);
  };

  const openEdit = (row: ModelRow) => {
    const support = supportOf(row.sdkId);
    if (row.source === "official") {
      const ov = row.override ?? {};
      const ctx = ov.contextWindow !== undefined ? presetOf(ov.contextWindow, CTX_PRESETS) : { sel: INHERIT, custom: "" };
      const maxOut = ov.maxTokens !== undefined ? presetOf(ov.maxTokens, MAX_OUT_PRESETS) : { sel: INHERIT, custom: "" };
      setDraft({
        editingId: row.sdkId, source: "official", name: row.name, alias: "",
        vision: ov.input ? ov.input.includes("image") : INHERIT,
        reasoning: ov.reasoning === undefined ? INHERIT : ov.reasoning,
        ctx: ctx.sel, ctxCustom: ctx.custom, maxOut: maxOut.sel, maxOutCustom: maxOut.custom,
        // 未覆盖档位时按官方支持的档位展示（未知则全列）
        levels: ov.thinkingLevelMap
          ? Object.entries(ov.thinkingLevelMap).filter(([, v]) => v !== null).map(([k]) => k)
          : (support ?? [...LEVELS]),
        levelsTouched: false,
      });
      return;
    }
    const entry = row.entry;
    const ctx = entry?.contextWindow !== undefined ? presetOf(entry.contextWindow, CTX_PRESETS) : { sel: "", custom: "" };
    const maxOut = entry?.maxTokens !== undefined ? presetOf(entry.maxTokens, MAX_OUT_PRESETS) : { sel: "", custom: "" };
    setDraft({
      editingId: row.sdkId, source: row.source, name: row.name, alias: entry?.alias ?? "",
      vision: entry?.input?.includes("image") ?? false,
      reasoning: entry?.reasoning ?? true,
      ctx: ctx.sel, ctxCustom: ctx.custom, maxOut: maxOut.sel, maxOutCustom: maxOut.custom,
      // 未声明档位时 SDK 默认全档可用（标识即档位名），按此回填
      levels: entry?.thinkingLevelMap
        ? Object.entries(entry.thinkingLevelMap).filter(([, v]) => v !== null).map(([k]) => k)
        : (support ?? [...LEVELS]),
      levelsTouched: false,
    });
  };

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { toast("请输入模型名称"); return; }
    const ctx = resolveTokens(draft.ctx, draft.ctxCustom);
    const maxOut = resolveTokens(draft.maxOut, draft.maxOutCustom);

    if (draft.source === "official") {
      const sdkId = draft.editingId ?? name;
      const params: ModelParams = {};
      if (draft.vision !== INHERIT) params.input = draft.vision ? ["text", "image"] : ["text"];
      if (draft.reasoning !== INHERIT) params.reasoning = draft.reasoning;
      if (draft.ctx !== INHERIT) {
        if (!ctx) { toast("请填写上下文窗口"); return; }
        params.contextWindow = ctx;
      }
      if (draft.maxOut !== INHERIT) {
        if (!maxOut) { toast("请填写最大输出"); return; }
        params.maxTokens = maxOut;
      }
      // 档位：触碰过就按勾选重建；没碰但有既有覆盖时原样保留——
      // 下方 commit 是整对象替换，不写回等于把用户之前钉住的档位覆盖静默丢弃（与自添加分支语义对齐）。
      // 未触碰时不调 buildLevelMap：它会把原 map 里省略的档位写成 null，改变语义。
      const prevOv = overrides[sdkId];
      if (draft.levelsTouched) params.thinkingLevelMap = buildLevelMap(draft.levels, prevOv?.thinkingLevelMap);
      else if (prevOv?.thinkingLevelMap) params.thinkingLevelMap = prevOv.thinkingLevelMap;
      commit({ overrides: { ...overrides, [sdkId]: params } });
      setDraft(null);
      return;
    }

    // 自添加模型：窗口 / 输出必填（数据层不再推断）
    if (!ctx) { toast("请填写上下文窗口"); return; }
    if (!maxOut) { toast("请填写最大输出"); return; }
    const alias = draft.alias.trim();
    const sdkId = alias || name;
    const prevEntry = draft.editingId
      ? extraModels.map((e) => (typeof e === "string" ? undefined : e)).find((e) => e && (e.alias || e.id) === draft.editingId)
      : undefined;
    if (sdkId !== draft.editingId && rows.some((r) => r.sdkId === sdkId)) {
      toast(`模型 ID ${sdkId} 已存在`);
      return;
    }
    // 别名/名称撞官方目录 id：数据层会把该条目当作官方模型跳过（models[] 不遮蔽内置 spec），参数声明会静默失效
    if (!isCustom && officialById.has(sdkId)) {
      toast(`${sdkId} 在官方目录中，请从搜索结果里添加`);
      return;
    }
    const entry: ExtraModelCapability = {
      id: name,
      contextWindow: ctx,
      maxTokens: maxOut,
      input: draft.vision === true ? ["text", "image"] : ["text"],
      reasoning: draft.reasoning === true,
    };
    if (alias) entry.alias = alias;
    if (draft.levelsTouched || prevEntry?.thinkingLevelMap) {
      entry.thinkingLevelMap = buildLevelMap(draft.levels, prevEntry?.thinkingLevelMap);
    }
    // 编辑既有条目则原地替换;新增、或编辑的是未落入 extraModels 的兜底行(如自定义供应商默认模型)→ 追加
    const editing = !!draft.editingId
      && extraModels.some((e) => (typeof e === "string" ? e : (e.alias || e.id)) === draft.editingId);
    const nextExtras = editing
      ? extraModels.map((e) => {
        const cur = typeof e === "string" ? e : (e.alias || e.id);
        return cur === draft.editingId ? entry : e;
      })
      : [...extraModels, entry];
    commit({ extraModels: nextExtras });
    if (!defaultModel || (draft.editingId && defaultModel === draft.editingId)) onDefaultModelChange(sdkId);
    setDraft(null);
  };

  /** 恢复官方：清空该模型的覆盖记录（参数回落官方，条目保留在列表）——与「移除」区分：
   *  保留空对象 = 仍在管理列表里；删 key 才是移出列表（removeRow） */
  const restoreOfficial = (sdkId: string) => {
    commit({ overrides: { ...overrides, [sdkId]: {} } });
  };

  const removeRow = (row: ModelRow) => {
    if (row.source === "official") {
      // 移出管理列表 = 删掉覆盖条目；未纳管的默认模型兜底行没有条目可删
      if (row.override === undefined) return;
      const next = { ...overrides };
      delete next[row.sdkId];
      commit({ overrides: next });
      return;
    }
    commit({
      extraModels: extraModels.filter((e) => (typeof e === "string" ? e : (e.alias || e.id)) !== row.sdkId),
    });
    if (defaultModel === row.sdkId || defaultModel === row.name) onDefaultModelChange("");
  };

  const isOfficialDraft = draft?.source === "official";
  const reasoningOff = draft ? draft.reasoning === false : false;

  return (
    <div>
      <label className="text-xs text-text-secondary block mb-1.5">模型管理</label>
      <div className="bg-surface-alt rounded-lg border border-border px-3 py-2.5 space-y-2.5">
        {/* 搜索 / 直接输入新 ID */}
        <div className="relative flex items-center gap-2">
          <input
            className="em-input flex-1 min-w-0 h-8 px-2.5 text-xs text-text-primary"
            placeholder={isCustom ? "输入模型 ID" : "搜索官方模型 ID 或名称，或直接输入新 ID"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <button
            type="button"
            className="shrink-0 px-3 h-8 rounded-lg btn-accent text-xs font-medium disabled:opacity-50"
            onClick={handleAdd}
            disabled={!keyword}
          >
            添加
          </button>
          {!isCustom && keyword && (suggestions.length > 0 || !exactOfficial) && (
            <div className="absolute left-0 right-[68px] top-full mt-1 z-dropdown rounded-lg border border-border bg-surface-elevated shadow-xl overflow-hidden">
              {suggestions.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-hover"
                  onClick={() => addOfficial(m.id)}
                >
                  <span className="flex-1 min-w-0 truncate text-xs text-text-primary">{m.name}</span>
                  <span className="shrink-0 text-[length:var(--text-2xs)] text-text-muted font-mono truncate max-w-[140px]">{m.id}</span>
                  <span className="shrink-0 text-[length:var(--text-3xs)] px-1.5 py-0.5 rounded-full bg-surface-hover text-text-secondary tabular-nums">{formatTokens(m.contextWindow)}</span>
                </button>
              ))}
              {!exactOfficial && (
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-hover"
                  onClick={() => openAdd(keyword)}
                >
                  <span className="flex-1 min-w-0 truncate text-xs text-text-primary">添加自定义模型「{keyword}」</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* 参数编辑表单 */}
        {draft && (
          <div className="rounded-md bg-surface border border-border px-2.5 py-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[length:var(--text-2xs)] font-medium text-text-primary">
                {draft.editingId ? "编辑模型" : "添加模型"}
              </span>
              <button
                type="button"
                className="w-5 h-5 shrink-0 flex items-center justify-center rounded text-text-secondary hover:bg-surface-hover transition-colors"
                onClick={() => setDraft(null)}
                aria-label="关闭"
              >✕</button>
            </div>

            {isOfficialDraft ? (
              <div>
                <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1">模型名称</label>
                <div className="flex items-center gap-2 h-8 px-2.5 rounded-lg bg-surface-alt border border-border">
                  <span className="text-xs text-text-primary truncate">{draft.name}</span>
                  <span className="text-[length:var(--text-2xs)] text-text-muted font-mono truncate">{draft.editingId}</span>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1">模型名称 *</label>
                    <input
                      className="em-input w-full h-8 px-2.5 text-xs text-text-primary"
                      placeholder="界面显示用"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1">别名</label>
                    <input
                      className="em-input w-full h-8 px-2.5 text-xs text-text-primary"
                      placeholder="请求标识（选填）"
                      value={draft.alias}
                      onChange={(e) => setDraft({ ...draft, alias: e.target.value })}
                    />
                  </div>
                </div>
                <p className="text-[length:var(--text-2xs)] text-text-muted -mt-1">填写后请求使用别名，界面仍显示名称</p>
              </>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1">上下文窗口{isOfficialDraft ? "" : " *"}</label>
                <div className="flex items-center gap-1.5">
                  <Select
                    className="flex-1 min-w-0 [&>button]:w-full [&>button]:h-8 [&>button]:text-xs"
                    placeholder="必填"
                    value={draft.ctx}
                    onChange={(v: string) => setDraft({ ...draft, ctx: v })}
                    options={isOfficialDraft ? [{ value: INHERIT, label: "跟随官方" }, ...CTX_PRESETS] : CTX_PRESETS}
                  />
                  {draft.ctx === "custom" && (
                    <input
                      className="em-input w-[86px] h-8 px-2 text-xs text-text-primary"
                      placeholder="如 512000"
                      value={draft.ctxCustom}
                      onChange={(e) => setDraft({ ...draft, ctxCustom: e.target.value })}
                    />
                  )}
                </div>
              </div>
              <div>
                <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1">最大输出{isOfficialDraft ? "" : " *"}</label>
                <div className="flex items-center gap-1.5">
                  <Select
                    className="flex-1 min-w-0 [&>button]:w-full [&>button]:h-8 [&>button]:text-xs"
                    placeholder="必填"
                    value={draft.maxOut}
                    onChange={(v: string) => setDraft({ ...draft, maxOut: v })}
                    options={isOfficialDraft ? [{ value: INHERIT, label: "跟随官方" }, ...MAX_OUT_PRESETS] : MAX_OUT_PRESETS}
                  />
                  {draft.maxOut === "custom" && (
                    <input
                      className="em-input w-[86px] h-8 px-2 text-xs text-text-primary"
                      placeholder="如 384000"
                      value={draft.maxOutCustom}
                      onChange={(e) => setDraft({ ...draft, maxOutCustom: e.target.value })}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-1.5 text-[length:var(--text-2xs)] text-text-secondary cursor-pointer">
                <TriCheckbox
                  value={draft.vision}
                  tristate={isOfficialDraft}
                  onChange={(next) => setDraft({ ...draft, vision: next })}
                />
                支持识图{draft.vision === INHERIT && <span className="text-text-muted">（跟随官方）</span>}
              </label>
              <label className="flex items-center gap-1.5 text-[length:var(--text-2xs)] text-text-secondary cursor-pointer">
                <TriCheckbox
                  value={draft.reasoning}
                  tristate={isOfficialDraft}
                  onChange={(next) => setDraft({ ...draft, reasoning: next })}
                />
                推理模型{draft.reasoning === INHERIT && <span className="text-text-muted">（跟随官方）</span>}
              </label>
            </div>

            <div>
              <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1">支持思考档位</label>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {LEVELS.map((level) => (
                  <label
                    key={level}
                    className={`flex items-center gap-1.5 text-[length:var(--text-2xs)] ${reasoningOff ? "text-text-muted cursor-not-allowed" : "text-text-secondary cursor-pointer"}`}
                  >
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 rounded accent-accent shrink-0 disabled:opacity-50"
                      checked={draft.levels.includes(level)}
                      disabled={reasoningOff}
                      onChange={(e) => setDraft({
                        ...draft,
                        levelsTouched: true,
                        levels: e.target.checked
                          ? [...draft.levels, level]
                          : draft.levels.filter((l) => l !== level),
                      })}
                    />
                    {THINKING_LABELS[level] ?? level}
                  </label>
                ))}
              </div>
              <p className="text-[length:var(--text-2xs)] text-text-muted mt-1">
                {reasoningOff ? "推理模型已关闭，档位不生效" : "档位标识因供应商而异，改错可能导致请求失败"}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="h-8 px-3 rounded-lg border border-border text-text-secondary text-xs hover:bg-surface-hover transition-colors"
                onClick={() => setDraft(null)}
              >取消</button>
              <button
                type="button"
                className="h-8 px-3 rounded-lg btn-accent text-xs font-medium"
                onClick={saveDraft}
              >保存</button>
            </div>
          </div>
        )}

        {/* 模型列表 */}
        {rows.length === 0 ? (
          <p className="text-[length:var(--text-2xs)] text-text-muted">
            {isCustom ? "还没有模型，输入模型 ID 添加。" : "还没有纳管的模型，从上方搜索添加。"}
          </p>
        ) : (
          <div>
            {rows.map((row) => {
              const ov = row.override;
              const overridden = !!ov && Object.values(ov).some((v) => v !== undefined);
              const chips: Array<{ text: string; warn?: boolean }> = [];
              if (row.legacy) chips.push({ text: "参数未填，点击编辑补填", warn: true });
              else if (row.entry) {
                chips.push({ text: row.entry.input?.includes("image") ? "识图" : "纯文本" });
                // 存量对象条目可能缺参数(迁移只覆盖内置供应商),缺则提示补填
                chips.push(row.entry.contextWindow
                  ? { text: `窗口 ${formatTokens(row.entry.contextWindow)}` }
                  : { text: "窗口未填", warn: true });
                chips.push(row.entry.maxTokens
                  ? { text: `输出 ${formatTokens(row.entry.maxTokens)}` }
                  : { text: "输出未填", warn: true });
                chips.push({ text: row.entry.reasoning === false ? "非推理" : "推理" });
              } else if (row.source === "official") {
                if (ov?.input) chips.push({ text: ov.input.includes("image") ? "识图" : "纯文本" });
                const ctx = ov?.contextWindow ?? row.officialCtx;
                if (ctx) chips.push({ text: `窗口 ${formatTokens(ctx)}` });
                if (ov?.maxTokens) chips.push({ text: `输出 ${formatTokens(ov.maxTokens)}` });
                if (ov?.reasoning !== undefined) chips.push({ text: ov.reasoning ? "推理" : "非推理" });
                if (!overridden) chips.push({ text: "参数跟随官方" });
              } else {
                // 自定义供应商默认模型兜底行(无参数声明)
                chips.push({ text: "参数未填，点击编辑补填", warn: true });
              }
              return (
                <div
                  key={row.sdkId}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-hover"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs text-text-primary truncate">{row.name}</span>
                      {row.sdkId !== row.name && (
                        <span className="shrink-0 text-[length:var(--text-2xs)] text-text-muted font-mono truncate max-w-[150px]">→ {row.sdkId}</span>
                      )}
                      <span className={`shrink-0 text-[length:var(--text-3xs)] px-1.5 py-0.5 rounded-full ${SOURCE_CLASSES[row.source]}`}>
                        {SOURCE_LABELS[row.source]}
                      </span>
                      {overridden && (
                        <span className="shrink-0 text-[length:var(--text-3xs)] px-1.5 py-0.5 rounded-full bg-accent-high text-accent">已覆盖</span>
                      )}
                      {row.isDefault && (
                        <span className="shrink-0 text-[length:var(--text-3xs)] px-1.5 py-0.5 rounded-full bg-accent text-text-inverse">默认</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                      {chips.map((c) => (
                        <span
                          key={c.text}
                          className={`text-[length:var(--text-3xs)] px-1.5 py-0.5 rounded-full tabular-nums ${c.warn ? "bg-warning-soft text-warning" : "bg-surface text-text-secondary"}`}
                        >{c.text}</span>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      className="px-2 py-1 text-[length:var(--text-2xs)] rounded bg-surface border border-border text-text-secondary hover:text-accent hover:border-accent-border-strong transition-colors"
                      onClick={() => openEdit(row)}
                    >编辑</button>
                    {row.source === "official" && overridden && (
                      <button
                        type="button"
                        className="px-2 py-1 text-[length:var(--text-2xs)] rounded bg-surface border border-border text-text-secondary hover:text-accent hover:border-accent-border-strong transition-colors"
                        onClick={() => restoreOfficial(row.sdkId)}
                      >恢复官方</button>
                    )}
                    {(row.source !== "official" || row.override !== undefined) && (
                      <button
                        type="button"
                        className="px-2 py-1 text-[length:var(--text-2xs)] rounded bg-surface border border-border text-text-secondary hover:text-danger hover:border-danger-border transition-colors"
                        onClick={() => removeRow(row)}
                      >移除</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
