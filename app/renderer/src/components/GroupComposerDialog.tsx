import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { useChatStore } from "../stores/chat-store";

interface GroupComposerDialogProps {
  projectPath: string;
  onClose: () => void;
  onCreated: (group: { groupId: string; chatId: string; title: string }) => void;
}

interface TemplateOption {
  id: string;
  name: string;
  description: string;
  agentType: string;
}

/** 新建群聊:选预设或自由组合角色模板(受 maxGroupAgents 限制),可带首条消息 */
export function GroupComposerDialog({ projectPath, onClose, onCreated }: GroupComposerDialogProps): JSX.Element {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [presets, setPresets] = useState<Array<{ id: string; name: string; templateIds: string[] }>>([]);
  const [maxAgents, setMaxAgents] = useState(3);
  const [selected, setSelected] = useState<string[]>([]);
  const [activePreset, setActivePreset] = useState<string | undefined>();
  const [firstMessage, setFirstMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.agentTemplates.list().then((ts) => {
      setTemplates(ts.map((t) => ({ id: t.id, name: t.name, description: t.description, agentType: t.agentType })));
    }).catch(() => {});
    // 预设与上限从设置读取
    const st = useSettingsStore.getState();
    setPresets(st.groupPresets || []);
    setMaxAgents(st.maxGroupAgents || 3);
    // 默认选第一个预设
    const first = (st.groupPresets || [])[0];
    if (first) { setActivePreset(first.id); setSelected(first.templateIds.slice()); }
  }, []);

  const applyPreset = (preset: { id: string; name: string; templateIds: string[] }) => {
    setActivePreset(preset.id);
    setSelected(preset.templateIds.filter((id) => templates.some((t) => t.id === id)));
  };

  const toggleTemplate = (id: string) => {
    setActivePreset(undefined);
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= maxAgents) return prev; // 达上限
      return [...prev, id];
    });
  };

  const handleCreate = async () => {
    if (selected.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await window.electronAPI.group.create(projectPath, selected, {
        presetId: activePreset,
        message: firstMessage.trim() || undefined,
      });
      // 首条消息主进程不广播 user_message(与单会话一致靠前端本地 append),
      // 这里按 groupId 预写,群聊 ChatPanel 挂载即显示
      const firstMsg = firstMessage.trim();
      if (firstMsg) {
        useChatStore.getState().appendUserMsg(res.groupId, { role: "user", text: firstMsg, timestamp: Date.now() });
      }
      const names = templates.filter((t) => selected.includes(t.id)).map((t) => t.name).join(" + ");
      onCreated({ groupId: res.groupId, chatId: res.chatId, title: names ? `${names} 群聊` : "群聊会话" });
    } catch (e) {
      setError((e as Error).message || "创建失败");
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-[520px] max-h-[80vh] flex flex-col rounded-xl border border-border bg-surface-elevated shadow-2xl overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <h2 className="text-sm font-medium text-text-primary">新建群聊会话</h2>
          <button onClick={onClose} className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors" title="关闭">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {/* 预设组合 */}
          <div>
            <div className="text-[11px] text-text-secondary mb-1.5">预设组合(点击填充角色)</div>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p)}
                  className={`px-2.5 py-1 rounded-md border text-[11px] transition-colors ${activePreset === p.id ? "border-accent text-accent bg-accent-soft" : "border-border text-text-secondary hover:border-accent/40 hover:text-text-primary"}`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* 角色模板 */}
          <div>
            <div className="text-[11px] text-text-secondary mb-1.5">
              参与角色 <span className="text-text-secondary/60">(已选 {selected.length}/{maxAgents})</span>
            </div>
            <div className="space-y-1.5">
              {templates.map((t) => {
                const on = selected.includes(t.id);
                const disabled = !on && selected.length >= maxAgents;
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTemplate(t.id)}
                    disabled={disabled}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors ${on ? "border-accent/50 bg-accent-bg" : disabled ? "border-border opacity-40 cursor-not-allowed" : "border-border hover:border-accent/30"}`}
                  >
                    <span className={`flex items-center justify-center w-4 h-4 rounded border shrink-0 ${on ? "border-accent bg-accent text-white" : "border-border"}`}>
                      {on && <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.5 3.5L13 5.5"/></svg>}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs text-text-primary truncate">{t.name}</span>
                      <span className="block text-[10px] text-text-secondary/70 truncate">{t.description}</span>
                    </span>
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-secondary/70">{t.agentType}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 首条消息 */}
          <div>
            <div className="text-[11px] text-text-secondary mb-1.5">首条消息(可选,发给主 Agent;@角色名 可指定)</div>
            <textarea
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              placeholder="例如:分析一下当前项目的技术栈,并提出优化建议"
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary/50 outline-none focus:border-accent/50"
            />
          </div>

          {error && <div className="text-xs text-fail">{error}</div>}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors">取消</button>
          <button
            onClick={handleCreate}
            disabled={selected.length === 0 || creating}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${selected.length === 0 ? "opacity-40 cursor-not-allowed" : ""} bg-accent text-white hover:bg-accent-high`}
          >
            {creating ? "创建中..." : "创建群聊"}
          </button>
        </div>
      </div>
    </div>
  );
}
