/**
 * 自添加模型管理区（供应商表单内）——输入框添加 + 列表行选中编辑。
 *
 * 数据落点（见 docs/design/模型清单架构.md、docs/design/供应商设置页统一改造.md）：
 *   自添加模型 → ProviderConfig.extraModels（string = 仅 ID 待补参数；对象 = 显式声明，窗口/输出必填）
 *   官方目录模型不进管理区（不可编辑），只在默认/子 Agent 下拉里可选；
 *   modelOverrides 不再有 UI 写入点，存量值由 ProviderSettings 原样透传。
 *
 * id / name 与 SDK Model 一一对应(2026-09-09 语义反转后):id = 请求标识、name = 显示名、
 *   无别名。界面显示一律 name(官方模型显示目录 name);请求只发 id。
 */

import { useState } from "react";
import { normalizeExtraModels } from "@shared/platform-presets";
import type { ExtraModelCapability } from "@shared/platform-presets";
import { THINKING_LABELS, THINKING_ORDER, type ThinkingLevelValue } from "@shared/thinking-levels";
import { Select, type SelectOption } from "../Select";
import { Checkbox } from "../ui/Checkbox";
import { toast } from "../ui/Toast";

/** 官方目录模型（agent:getPiModels 返回值） */
export interface OfficialModelInfo {
  id: string;
  name: string;
  contextWindow: number;
}

/** 上下文窗口预设（自添加模型必填） */
const CTX_PRESETS: SelectOption[] = [
  { value: "1000000", label: "1M" },
  { value: "131072", label: "128K" },
  { value: "200000", label: "200K" },
  { value: "262144", label: "256K" },
  { value: "400000", label: "400K" },
  { value: "custom", label: "自定义" },
];

/** 最大输出预设 */
const MAX_OUT_PRESETS: SelectOption[] = [
  { value: "4096", label: "4K" },
  { value: "8192", label: "8K" },
  { value: "16384", label: "16K" },
  { value: "32768", label: "32K" },
  { value: "65536", label: "64K" },
  { value: "custom", label: "自定义" },
];

/** 可多选的思考档位（off 是「关闭思考」，不属于档位本身） */
const LEVELS = THINKING_ORDER.filter((l) => l !== "off");

/** token 数 → 预设下拉选中项（未命中预设则走「自定义」） */
function presetOf(value: number, presets: SelectOption[]): { sel: string; custom: string } {
  const hit = presets.find((p) => p.value === String(value));
  return hit ? { sel: hit.value, custom: "" } : { sel: "custom", custom: String(value) };
}

/** 下拉 + 自定义输入 → token 数；空 / 无效 → undefined（调用方按必填拦截） */
function resolveTokens(selected: string, custom: string): number | undefined {
  if (!selected) return undefined;
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

/** 列表行（渲染用，由 extraModels 聚合，全部为自添加模型） */
interface ModelRow {
  /** 请求标识（发给供应商，SDK Model.id） */
  id: string;
  /** 界面显示名 */
  name: string;
  entry?: ExtraModelCapability;
  /** 存量 string 条目（参数未声明，需补填） */
  legacy?: boolean;
  /** 原始条目引用（写回 extraModels 时定位替换/删除） */
  raw: string | ExtraModelCapability;
}

/** 编辑表单草稿（仅自添加模型，无「跟随官方」语义，全部布尔） */
interface Draft {
  /** 被编辑行的原请求标识 */
  editingId: string;
  /** 请求标识 */
  id: string;
  /** 界面显示名 */
  name: string;
  vision: boolean;
  reasoning: boolean;
  ctx: string;
  ctxCustom: string;
  maxOut: string;
  maxOutCustom: string;
  levels: string[];
  levelsTouched: boolean;
}

export interface ModelManagerProps {
  isCustom: boolean;
  /** 官方目录（内置供应商）；null = 尚未加载。用于添加时重名拦截 */
  officialModels: OfficialModelInfo[] | null;
  /** 当前默认模型（SDK id）——仅用于改名/删除时的默认选择联动（数据层），列表展示不与它联动 */
  defaultModel: string;
  /** 当前子 Agent 默认模型（SDK id）——改名/删除时同步，避免留下失效 id */
  subagentDefaultModel: string;
  extraModels: Array<string | ExtraModelCapability>;
  /** 每行模型支持的思考档位（agent:getModelThinkingSupport）；null = 未知 */
  modelSupports: Record<string, string[] | null>;
  onDefaultModelChange: (sdkId: string) => void;
  onSubagentDefaultModelChange: (sdkId: string) => void;
  onChange: (next: { extraModels: Array<string | ExtraModelCapability> }) => void;
}

export function ModelManager({
  isCustom, officialModels, defaultModel, subagentDefaultModel, extraModels, modelSupports,
  onDefaultModelChange, onSubagentDefaultModelChange, onChange,
}: ModelManagerProps): JSX.Element {
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const officialById = new Map((officialModels ?? []).map((m) => [m.id, m]));
  /** 该模型支持的档位（未知 → null，表单按全部档位展示） */
  const supportOf = (sdkId: string): string[] | null =>
    (modelSupports[sdkId] ?? null)?.filter((l) => l !== "off") ?? null;

  const rows: ModelRow[] = normalizeExtraModels(extraModels).map((n) => ({
    id: n.id, name: n.name, entry: n.entry, raw: n.raw, legacy: !n.entry,
  }));

  /** 从列表行构建编辑草稿 */
  const draftOf = (row: ModelRow): Draft => {
    const entry = row.entry;
    const ctx = entry?.contextWindow !== undefined ? presetOf(entry.contextWindow, CTX_PRESETS) : { sel: "", custom: "" };
    const maxOut = entry?.maxTokens !== undefined ? presetOf(entry.maxTokens, MAX_OUT_PRESETS) : { sel: "", custom: "" };
    return {
      editingId: row.id, id: row.id, name: row.name,
      vision: entry?.input?.includes("image") ?? false,
      reasoning: entry?.reasoning ?? true,
      ctx: ctx.sel, ctxCustom: ctx.custom, maxOut: maxOut.sel, maxOutCustom: maxOut.custom,
      // 未声明档位时 SDK 默认全档可用（标识即档位名），按此回填
      levels: entry?.thinkingLevelMap
        ? Object.entries(entry.thinkingLevelMap).filter(([, v]) => v !== null).map(([k]) => k)
        : (supportOf(row.id) ?? [...LEVELS]),
      levelsTouched: false,
    };
  };

  /** 添加：一次一个（ID 与名称都必填）。追加 { id, name } 对象——名称当场持久化
   *  （参数/档位由编辑表单补填，未补填前保存供应商会被必填校验拦截） */
  const addModel = () => {
    const id = newId.trim();
    if (!id) { toast("请输入模型 ID"); return; }
    const nm = newName.trim();
    if (!nm) { toast("请输入模型名称"); return; }
    if (rows.some((r) => r.id === id)) { toast(`模型 ID ${id} 已存在`); return; }
    if (!isCustom && officialById.has(id)) { toast(`${id} 是官方模型，无需添加`); return; }
    // 同一对象既进数组又作 row.raw——删除时按引用匹配(e === raw)
    const entry: ExtraModelCapability = { id, name: nm };
    const row: ModelRow = { id, name: nm, raw: entry, legacy: false };
    onChange({ extraModels: [...extraModels, entry] });
    setEditingId(id);
    setDraft(draftOf(row));
    setNewId("");
    setNewName("");
  };

  const selectRow = (row: ModelRow) => {
    setEditingId(row.id);
    setDraft(draftOf(row));
  };

  const closeEdit = () => { setEditingId(null); setDraft(null); };

  /** 保存：string 条目替换为显式对象条目（ID / 名称 / 窗口 / 输出必填，数据层不推断） */
  const saveDraft = () => {
    if (!draft) return;
    const id = draft.id.trim();
    const name = draft.name.trim();
    if (!id) { toast("请输入模型 ID"); return; }
    if (!name) { toast("请输入模型名称"); return; }
    const ctx = resolveTokens(draft.ctx, draft.ctxCustom);
    const maxOut = resolveTokens(draft.maxOut, draft.maxOutCustom);
    if (!ctx) { toast("请填写上下文窗口"); return; }
    if (!maxOut) { toast("请填写最大输出"); return; }
    if (rows.some((r) => r.id === id && r.id !== draft.editingId)) {
      toast(`模型 ID ${id} 已存在`);
      return;
    }
    // 请求标识撞官方目录 id 一律拒绝:官方模型参数以 SDK 为准,官方 API 才是该 id 的真相源,
    // 不留「换个请求 id 就能自定义参数」的绕行——改官方参数应等 SDK 更新。
    if (!isCustom && officialById.has(id)) {
      toast(`${id} 是官方模型，无需添加`);
      return;
    }
    const editingRow = rows.find((r) => r.id === draft.editingId);
    const entry: ExtraModelCapability = {
      id,
      name,
      contextWindow: ctx,
      maxTokens: maxOut,
      input: draft.vision === true ? ["text", "image"] : ["text"],
      reasoning: draft.reasoning === true,
    };
    const prevEntry = editingRow?.entry;
    if (draft.levelsTouched || prevEntry?.thinkingLevelMap) {
      entry.thinkingLevelMap = buildLevelMap(draft.levels, prevEntry?.thinkingLevelMap);
    }
    onChange({
      extraModels: editingRow
        ? extraModels.map((e) => (e === editingRow.raw ? entry : e))
        : [...extraModels, entry],
    });
    if (defaultModel === draft.editingId) onDefaultModelChange(id);
    if (subagentDefaultModel === draft.editingId) onSubagentDefaultModelChange(id);
    closeEdit();
  };

  const deleteModel = () => {
    if (!draft) return;
    const removeRaws = new Set(rows.filter((r) => r.id === draft.editingId).map((r) => r.raw));
    if (removeRaws.size === 0) { closeEdit(); return; }
    onChange({ extraModels: extraModels.filter((e) => !removeRaws.has(e)) });
    const row = rows.find((r) => r.id === draft.editingId);
    if (row && defaultModel === row.id) onDefaultModelChange("");
    if (row && subagentDefaultModel === row.id) onSubagentDefaultModelChange("");
    closeEdit();
  };

  const reasoningOff = draft ? draft.reasoning === false : false;

  return (
    <div className="space-y-2">
      <label className="text-xs text-text-secondary block">自添加模型</label>

      {/* 添加：唯一入口，一次一个，追加到列表（也出现在默认/子 Agent 下拉里） */}
      <div className="flex items-center gap-2">
        <input
          className="em-input em-input-compact flex-1 min-w-0 h-8 px-2.5 text-xs text-text-primary"
          placeholder="模型 ID，如 deepseek-v4-flash"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addModel(); } }}
        />
        <input
          className="em-input em-input-compact flex-1 min-w-0 h-8 px-2.5 text-xs text-text-primary"
          placeholder="显示名称，如 DeepSeek V4"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addModel(); } }}
        />
        <button
          type="button"
          className="shrink-0 h-8 px-3 rounded-md border border-border text-text-secondary text-xs hover:bg-surface-hover transition-colors"
          onClick={addModel}
        >添加</button>
      </div>

      {/* 编辑模型选择:下拉列出全部自添加模型,选中即在下方展示参数;与默认模型选择互不联动 */}
      {rows.length === 0 ? (
        <p className="text-[length:var(--text-2xs)] text-text-muted">
          还没有自添加模型，填写 ID 与名称后点「添加」。
        </p>
      ) : (
        <Select
          block
          className="[&>button]:h-8 [&>button]:text-xs"
          placeholder="选择要编辑的模型"
          value={editingId ?? ""}
          onChange={(v: string) => {
            const row = rows.find((r) => r.id === v);
            if (row) selectRow(row); else closeEdit();
          }}
          options={rows.map((r) => ({ value: r.id, label: r.name }))}
        />
      )}

      {/* 参数编辑表单：唯一编辑入口（保存 / 取消 / 删除） */}
      {draft && (
        <div className="rounded-md bg-surface border border-border px-2.5 py-2 space-y-2">
          <span className="text-[length:var(--text-2xs)] font-medium text-text-primary">编辑模型</span>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1 em-required">模型 ID</label>
              <input
                className="em-input em-input-compact w-full h-8 px-2.5 text-xs text-text-primary"
                placeholder="如 deepseek-v4-flash"
                value={draft.id}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              />
              <p className="text-[length:var(--text-2xs)] text-text-muted mt-1">发给供应商的请求标识</p>
            </div>
            <div>
              <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1 em-required">模型名称</label>
              <input
                className="em-input em-input-compact w-full h-8 px-2.5 text-xs text-text-primary"
                placeholder="如 DeepSeek V4"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <p className="text-[length:var(--text-2xs)] text-text-muted mt-1">界面显示用</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1 em-required">上下文窗口</label>
              {/* 下拉按内容宽度(不撑满),选「自定义」时输入框占用右侧空出的位置 */}
              <div className="flex items-center gap-1.5">
                <Select
                  className="shrink-0 [&>button]:h-8 [&>button]:text-xs"
                  placeholder="请选择"
                  value={draft.ctx}
                  onChange={(v: string) => setDraft({ ...draft, ctx: v })}
                  options={CTX_PRESETS}
                />
                {draft.ctx === "custom" && (
                  <input
                    className="em-input em-input-compact flex-1 min-w-0 h-8 px-2 text-xs text-text-primary"
                    placeholder="如 512000"
                    value={draft.ctxCustom}
                    onChange={(e) => setDraft({ ...draft, ctxCustom: e.target.value })}
                  />
                )}
              </div>
            </div>
            <div>
              <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1 em-required">最大输出</label>
              <div className="flex items-center gap-1.5">
                <Select
                  className="shrink-0 [&>button]:h-8 [&>button]:text-xs"
                  placeholder="请选择"
                  value={draft.maxOut}
                  onChange={(v: string) => setDraft({ ...draft, maxOut: v })}
                  options={MAX_OUT_PRESETS}
                />
                {draft.maxOut === "custom" && (
                  <input
                    className="em-input em-input-compact flex-1 min-w-0 h-8 px-2 text-xs text-text-primary"
                    placeholder="如 384000"
                    value={draft.maxOutCustom}
                    onChange={(e) => setDraft({ ...draft, maxOutCustom: e.target.value })}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-1.5 text-[length:var(--text-2xs)] text-text-secondary cursor-pointer"
              onClick={() => setDraft({ ...draft, vision: !draft.vision })}>
              <Checkbox
                checked={draft.vision}
                onChange={(next) => setDraft({ ...draft, vision: next })}
              />
              支持识图
            </label>
            <label className="flex items-center gap-1.5 text-[length:var(--text-2xs)] text-text-secondary cursor-pointer"
              onClick={() => setDraft({ ...draft, reasoning: !draft.reasoning })}>
              <Checkbox
                checked={draft.reasoning}
                onChange={(next) => setDraft({ ...draft, reasoning: next })}
              />
              推理模型
            </label>
          </div>

          <div>
            <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1">支持思考档位</label>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {LEVELS.map((level) => (
                <label
                  key={level}
                  className={`flex items-center gap-1.5 text-[length:var(--text-2xs)] ${reasoningOff ? "text-text-muted cursor-not-allowed" : "text-text-secondary cursor-pointer"}`}
                  onClick={() => {
                    if (reasoningOff) return;
                    const next = !draft.levels.includes(level);
                    setDraft({
                      ...draft,
                      levelsTouched: true,
                      levels: next
                        ? [...draft.levels, level]
                        : draft.levels.filter((l) => l !== level),
                    });
                  }}
                >
                  <Checkbox
                    checked={draft.levels.includes(level)}
                    disabled={reasoningOff}
                    onChange={(next) => setDraft({
                      ...draft,
                      levelsTouched: true,
                      levels: next
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

          <div className="flex items-center justify-between">
            <button
              type="button"
              className="h-7 px-3 rounded-md border border-danger-border text-danger text-xs hover:bg-danger-soft transition-colors"
              onClick={deleteModel}
            >删除</button>
            <div className="flex gap-2">
              <button
                type="button"
                className="h-7 px-3 rounded-md border border-border text-text-secondary text-xs hover:bg-surface-hover transition-colors"
                onClick={closeEdit}
              >取消</button>
              <button
                type="button"
                className="h-7 px-3 rounded-md btn-accent text-xs font-medium"
                onClick={saveDraft}
              >保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
