/**
 * 待办按钮 — 输入卡片「待办」（用户想法/计划清单 .easymint/todos.json 的面板入口）。
 * 自包含：按钮 + 弹出面板（列表/勾选完成/删除/展开详情/添加）。
 * 与 Mint 执行追踪（session-todos TodoStrip）是两套清单——本组件管理用户待办。
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";

interface UserTodo {
  id: number;
  title: string;
  note?: string;
  status: "open" | "done";
  createdAt: number;
  doneAt: number | null;
}

export const TodoButton = memo(function TodoButton({ projectPath }: { projectPath: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [todos, setTodos] = useState<UserTodo[] | null>(null);
  const [migratedNote, setMigratedNote] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await window.electronAPI.todos.list(projectPath);
    if (r.ok && r.data) {
      setTodos(r.data.todos);
      if (r.data.migrated && r.data.migratedCount !== undefined) {
        setMigratedNote(`已从旧文档导入 ${r.data.migratedCount} 条待办（原文档已归档）`);
      }
    } else if (r.error) {
      setErr(r.error);
    }
  }, [projectPath]);

  // 挂载即加载：徽标未完成数常驻显示（不等点击面板）；面板开关时刷新保持最新
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    const unsub = window.electronAPI.todos.onChanged((data) => {
      if (data.projectPath === projectPath) load();
    });
    return unsub;
  }, [projectPath, load]);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const add = useCallback(async () => {
    const title = draft.trim();
    if (!title) return;
    const r = await window.electronAPI.todos.add(projectPath, title);
    if (r.ok) {
      setDraft("");
      setErr(null);
      load();
    } else if (r.error) setErr(r.error);
  }, [draft, projectPath, load]);

  const toggle = useCallback(async (id: number) => {
    await window.electronAPI.todos.toggle(projectPath, id);
    load();
  }, [projectPath, load]);

  const remove = useCallback(async (id: number) => {
    await window.electronAPI.todos.remove(projectPath, id);
    if (expandedId === id) setExpandedId(null);
    load();
  }, [projectPath, load, expandedId]);

  const openCount = todos?.filter((t) => t.status === "open").length ?? 0;

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        className="inp-icon-btn relative"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* 用户待办图标(lucide list-todo):方框勾选清单 */}
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><rect x="3" y="4" width="6" height="6" rx="1"/></svg>
        {openCount > 0 && (
          <span className="absolute -top-[1px] -right-[5px] min-w-[12px] h-[12px] px-0.5 rounded-full bg-accent text-text-inverse text-[8px] font-semibold leading-[12px] text-center pointer-events-none ring-2 ring-[var(--color-input-field)]">
            {openCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 w-[360px] max-w-[85vw] rounded-lg border border-border bg-surface-elevated shadow-xl z-40 overflow-hidden">
          {/* 头部 */}
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-text-primary">用户待办</span>
            <span className="text-[length:var(--text-3xs)] text-text-muted">{todos === null ? "…" : `${todos.filter((t) => t.status === "open").length} 未完成 · ${todos.length} 条`}</span>
          </div>

          {migratedNote && (
            <div className="px-3 py-1.5 text-[length:var(--text-3xs)] text-info bg-info-soft border-b border-border">{migratedNote}</div>
          )}
          {err && <div className="px-3 py-1.5 text-[length:var(--text-3xs)] text-danger">{err}</div>}

          {/* 列表（容器无 padding——行 hover 面积 = 行面积，不留缝） */}
          <div className="max-h-64 overflow-y-auto">
            {todos !== null && todos.length === 0 && (
              <div className="px-3 py-3 text-xs text-text-muted text-center">暂无待办——在下方输入想法或计划</div>
            )}
            {(todos ?? []).map((t) => (
              <div key={t.id} className="group">
                <div className="flex items-start gap-2 px-3 py-1.5 hover:bg-surface-hover transition-colors">
                  <button
                    type="button"
                    className={`mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                      t.status === "done"
                        ? "bg-accent border-accent text-white"
                        : "border-border hover:border-accent text-transparent"
                    }`}
                    
                    onClick={() => toggle(t.id)}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                  </button>
                  <button
                    type="button"
                    className={`flex-1 min-w-0 text-left text-xs leading-relaxed break-words ${t.status === "done" ? "text-text-muted line-through" : "text-text-primary"}`}
                    
                    onClick={() => setExpandedId((v) => (v === t.id ? null : t.id))}
                  >
                    {t.title}
                  </button>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger transition-all shrink-0 mt-0.5"
                   
                    onClick={() => remove(t.id)}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
                {expandedId === t.id && t.note && (
                  <div className="px-3 pb-2 pl-[26px] text-[length:var(--text-3xs)] text-text-secondary whitespace-pre-wrap max-h-40 overflow-y-auto">{t.note}</div>
                )}
              </div>
            ))}
          </div>

          {/* 添加 */}
          <div className="flex items-center gap-1.5 px-3 py-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              placeholder="添加待办（回车确认）…"
              className="em-input flex-1 min-w-0 h-8 px-2.5 text-xs"
            />
            <button type="button" onClick={add} disabled={!draft.trim()} className="btn-accent h-8 px-3 rounded-lg text-xs disabled:opacity-40 disabled:cursor-not-allowed shrink-0">添加</button>
          </div>
        </div>
      )}
    </div>
  );
});
