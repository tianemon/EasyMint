/**
 * PromptSettings — 系统提示词管理
 *
 * 复刻 Proma 的提示词管理功能：
 * - 左侧：提示词列表（选择/新建/删除/设为默认）
 * - 右侧：编辑区（名称 + 内容，内置只读）
 * - 底部：追加日期时间和用户名开关
 */

import { useState, useEffect, useCallback, useRef } from "react";

interface SystemPrompt {
  id: string;
  name: string;
  content: string;
  isBuiltin: boolean;
  createdAt: number;
  updatedAt: number;
}

interface PromptConfig {
  prompts: SystemPrompt[];
  defaultPromptId?: string;
  appendDateTimeAndUserName: boolean;
}

const DEBOUNCE_DELAY = 500;

export function PromptSettings(): JSX.Element {
  const [config, setConfig] = useState<PromptConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string>("builtin-default");
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load config
  useEffect(() => {
    window.electronAPI.systemPrompt.getConfig().then((cfg) => {
      setConfig(cfg);
      setSelectedId(cfg.defaultPromptId ?? "builtin-default");
    }).catch(console.error);
  }, []);

  // Sync edit fields when selection changes
  const selectedPrompt = config?.prompts.find((p) => p.id === selectedId);
  useEffect(() => {
    if (selectedPrompt) {
      setEditName(selectedPrompt.name);
      setEditContent(selectedPrompt.content);
    }
  }, [selectedPrompt]);

  // Debounced save
  const debounceSave = useCallback(
    (id: string, input: { name?: string; content?: string }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const updated = await window.electronAPI.systemPrompt.update(id, input);
          setConfig((prev) => prev ? {
            ...prev,
            prompts: prev.prompts.map((p) => (p.id === updated.id ? updated : p)),
          } : prev);
        } catch (error) {
          console.error("[提示词设置] 保存失败:", error);
        }
      }, DEBOUNCE_DELAY);
    },
    []
  );

  const handleCreate = async () => {
    try {
      const created = await window.electronAPI.systemPrompt.create({ name: "新提示词", content: "" });
      setConfig((prev) => prev ? {
        ...prev,
        prompts: [...prev.prompts, created],
      } : prev);
      setSelectedId(created.id);
    } catch (error) {
      console.error("[提示词设置] 创建失败:", error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await window.electronAPI.systemPrompt.delete(id);
      setConfig((prev) => {
        if (!prev) return prev;
        const newPrompts = prev.prompts.filter((p) => p.id !== id);
        const newDefaultId = prev.defaultPromptId === id ? "builtin-default" : prev.defaultPromptId;
        return { ...prev, prompts: newPrompts, defaultPromptId: newDefaultId };
      });
      if (selectedId === id) setSelectedId("builtin-default");
    } catch (error) {
      console.error("[提示词设置] 删除失败:", error);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await window.electronAPI.systemPrompt.setDefault(id);
      setConfig((prev) => prev ? { ...prev, defaultPromptId: id } : prev);
    } catch (error) {
      console.error("[提示词设置] 设置默认失败:", error);
    }
  };

  if (!config) {
    return <div className="text-sm text-text-secondary py-8 text-center">加载中...</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 提示词列表 + 编辑区：左右布局 */}
      <div className="flex gap-3" style={{ minHeight: 260 }}>
        {/* 左侧：列表 */}
        <div className="w-44 shrink-0 border border-border rounded-lg overflow-hidden flex flex-col">
          <div className="divide-y divide-border flex-1 overflow-y-auto">
            {config.prompts.map((prompt) => (
              <div
                key={prompt.id}
                className={`flex items-center gap-1.5 px-3 py-2 cursor-pointer transition-colors text-xs ${
                  prompt.id === selectedId ? "bg-accent/15" : "hover:bg-surface-hover"
                }`}
                onClick={() => setSelectedId(prompt.id)}
                onMouseEnter={() => setHoveredId(prompt.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <span className="flex-1 truncate">{prompt.name}</span>
                {prompt.isBuiltin && <span className="text-[10px] text-text-secondary shrink-0">内置</span>}
                {prompt.id === config.defaultPromptId && (
                  <svg className="w-3 h-3 text-warning shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                )}
                {hoveredId === prompt.id && !prompt.isBuiltin && (
                  <button
                    className="text-[10px] text-text-secondary hover:text-danger shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleDelete(prompt.id); }}
                  >
                    删除
                  </button>
                )}
                {hoveredId === prompt.id && prompt.id !== config.defaultPromptId && (
                  <button
                    className="text-[10px] text-text-secondary hover:text-accent shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleSetDefault(prompt.id); }}
                    title="设为默认"
                  >
                    默认
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            className="w-full py-1.5 text-xs border-t border-border text-accent hover:bg-accent/5 transition-colors"
            onClick={handleCreate}
          >
            + 新建
          </button>
        </div>

        {/* 右侧：编辑区 */}
        {selectedPrompt && (
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            <input
              className="w-full px-3 py-1.5 text-sm rounded-lg bg-surface border border-border text-text-primary outline-none focus:border-accent disabled:opacity-50"
              value={editName}
              onChange={(e) => { setEditName(e.target.value); if (!selectedPrompt.isBuiltin) debounceSave(selectedPrompt.id, { name: e.target.value }); }}
              disabled={selectedPrompt.isBuiltin}
              maxLength={50}
              placeholder="提示词名称"
            />
            <textarea
              className="flex-1 w-full resize-none px-3 py-2 text-sm rounded-lg bg-surface border border-border text-text-primary outline-none focus:border-accent disabled:opacity-50 font-mono"
              value={editContent}
              onChange={(e) => { setEditContent(e.target.value); if (!selectedPrompt.isBuiltin) debounceSave(selectedPrompt.id, { content: e.target.value }); }}
              disabled={selectedPrompt.isBuiltin}
              placeholder="输入系统提示词内容..."
              style={{ minHeight: 200 }}
            />
          </div>
        )}
      </div>

      {/* 增强选项 */}
      <div className="flex items-center justify-between py-2 px-3 bg-surface-alt rounded-lg">
        <div>
          <p className="text-sm text-text-primary">追加日期时间和用户名</p>
          <p className="text-xs text-text-secondary mt-0.5">在提示词末尾自动追加当前日期时间和系统用户名</p>
        </div>
        <button
          onClick={async () => {
            const v = !config.appendDateTimeAndUserName;
            await window.electronAPI.systemPrompt.updateAppend(v);
            setConfig((prev) => prev ? { ...prev, appendDateTimeAndUserName: v } : prev);
          }}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 overflow-hidden ${config.appendDateTimeAndUserName ? "bg-accent" : "bg-surface-hover border border-border"}`}
        >
          <span className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-surface-elevated shadow transition-all ${config.appendDateTimeAndUserName ? "left-[calc(100%-22px)]" : "left-0.5"}`} />
        </button>
      </div>
    </div>
  );
}
