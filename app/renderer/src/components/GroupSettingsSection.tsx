import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settings-store";

interface GroupPreset {
  id: string;
  name: string;
  templateIds: string[];
}

/** 设置→群聊:最大 Agent 数/转发策略/注入方式/转发深度 + 预设组合管理(需求 4) */
export function GroupSettingsSection(): JSX.Element {
  const {
    maxGroupAgents, groupForwardStrategy, groupInjectMode, maxForwardDepth, groupPresets,
    setMaxGroupAgents, setGroupForwardStrategy, setGroupInjectMode, setMaxForwardDepth, setGroupPresets,
  } = useSettingsStore();

  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplateIds, setNewTemplateIds] = useState<string[]>([]);

  useEffect(() => {
    window.electronAPI.agentTemplates.list().then((ts) => {
      setTemplates(ts.map((t) => ({ id: t.id, name: t.name })));
    }).catch(() => {});
  }, []);

  const templateName = (id: string) => templates.find((t) => t.id === id)?.name ?? id;

  const toggleNewTemplate = (id: string) => {
    setNewTemplateIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const addPreset = () => {
    if (!newName.trim() || newTemplateIds.length === 0) return;
    const preset: GroupPreset = { id: `preset-${Date.now()}`, name: newName.trim(), templateIds: newTemplateIds };
    setGroupPresets([...(groupPresets || []), preset]);
    setAdding(false); setNewName(""); setNewTemplateIds([]);
  };

  const removePreset = (id: string) => {
    setGroupPresets((groupPresets || []).filter((p) => p.id !== id));
  };

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-info/30 bg-info-bg/10 px-3 py-2 text-[11px] text-text-secondary/80 leading-relaxed">
        群聊为实验性功能,后续将由 Agent 模板模块 + task 动态委派替代。当前参数仅对群聊模式生效。
      </div>
      {/* 基础参数 */}
      <section>
        <h3 className="text-sm font-medium text-text-secondary mb-2">群聊基础参数</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-text-primary">最大 Agent 数</div>
              <div className="text-[11px] text-text-secondary/70">群聊最多同时参与的 Agent 数量</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setMaxGroupAgents(Math.max(1, maxGroupAgents - 1))} className="w-7 h-7 rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover">−</button>
              <span className="w-8 text-center text-sm tabular-nums">{maxGroupAgents}</span>
              <button onClick={() => setMaxGroupAgents(Math.min(8, maxGroupAgents + 1))} className="w-7 h-7 rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover">+</button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-text-primary">转发策略</div>
              <div className="text-[11px] text-text-secondary/70">已由"显式激活"取代:背景注入不回话,只有 @ / assign_to_agent 才回话</div>
            </div>
            <select
              value={groupForwardStrategy}
              onChange={(e) => setGroupForwardStrategy(e.target.value as "all" | "conclusion")}
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary outline-none focus:border-accent/50"
            >
              <option value="conclusion">只转发结论(推荐)</option>
              <option value="all">全广播</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-text-primary">注入方式</div>
              <div className="text-[11px] text-text-secondary/70">已由"显式激活"取代:目标空闲时直接开回合,不排队不打断</div>
            </div>
            <select
              value={groupInjectMode}
              onChange={(e) => setGroupInjectMode(e.target.value as "steer" | "followUp")}
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary outline-none focus:border-accent/50"
            >
              <option value="followUp">等空闲(followUp)</option>
              <option value="steer">打断(steer)</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-text-primary">最大转发深度</div>
              <div className="text-[11px] text-text-secondary/70">已由"显式激活"取代:无自动转发链,无需深度限制</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setMaxForwardDepth(Math.max(1, maxForwardDepth - 1))} className="w-7 h-7 rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover">−</button>
              <span className="w-8 text-center text-sm tabular-nums">{maxForwardDepth}</span>
              <button onClick={() => setMaxForwardDepth(Math.min(6, maxForwardDepth + 1))} className="w-7 h-7 rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover">+</button>
            </div>
          </div>
        </div>
      </section>

      {/* 预设组合 */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-secondary">预设组合</h3>
          <button
            onClick={() => { setAdding(true); setNewName(""); setNewTemplateIds([]); }}
            className="text-[11px] text-accent hover:text-accent-high"
          >
            + 新建组合
          </button>
        </div>

        {/* 新建表单 */}
        {adding && (
          <div className="mb-3 p-3 rounded-lg border border-accent/30 bg-accent-bg space-y-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="组合名称,如「设计协作」"
              className="w-full h-8 rounded-md border border-border bg-surface px-2.5 text-xs text-text-primary outline-none focus:border-accent/50"
            />
            <div className="flex flex-wrap gap-1.5">
              {templates.map((t) => {
                const on = newTemplateIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleNewTemplate(t.id)}
                    className={`px-2 py-0.5 rounded-md border text-[11px] transition-colors ${on ? "border-accent text-accent bg-accent-soft" : "border-border text-text-secondary hover:border-accent/40"}`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setAdding(false)} className="px-2.5 py-1 rounded-md text-[11px] text-text-secondary hover:text-text-primary hover:bg-surface-hover">取消</button>
              <button onClick={addPreset} disabled={!newName.trim() || newTemplateIds.length === 0} className={`px-3 py-1 rounded-md text-[11px] font-medium ${newName.trim() && newTemplateIds.length ? "bg-accent text-white hover:bg-accent-high" : "opacity-40 cursor-not-allowed bg-surface text-text-secondary"}`}>保存</button>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {(groupPresets || []).map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border bg-surface-elevated">
              <span className="flex-1 min-w-0">
                <span className="block text-xs text-text-primary">{p.name}</span>
                <span className="block text-[10px] text-text-secondary/70 truncate mt-0.5">
                  {p.templateIds.map((id) => templateName(id)).join(" + ")}
                </span>
              </span>
              <button
                onClick={() => removePreset(p.id)}
                title="删除组合"
                className="flex items-center justify-center w-6 h-6 rounded-md text-text-secondary hover:text-fail hover:bg-surface-hover transition-colors shrink-0"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 5h10M6.5 5V3.5h3V5M5 5l.5 8h5l.5-8M6.5 7.5v3M9.5 7.5v3"/></svg>
              </button>
            </div>
          ))}
          {(groupPresets || []).length === 0 && (
            <div className="text-xs text-text-secondary/60 py-3 text-center">暂无预设组合</div>
          )}
        </div>
      </section>
    </div>
  );
}
