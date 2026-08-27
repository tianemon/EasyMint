import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useIssueStore, type IssueItem } from "../stores/issue-store";

interface IssuePanelProps {
  projectPath: string;
  onCollapse: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function IssueRow({ issue, projectPath, onEdit }: { issue: IssueItem; projectPath: string; onEdit?: (issue: IssueItem) => void }): JSX.Element {
  const { setStatus, remove } = useIssueStore();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = () => {
    if (confirmDelete) {
      remove(projectPath, issue.id);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 5000);
    }
  };

  const isFixed = issue.status === "fixed";

  return (
    <div className={`rounded-lg border px-2.5 py-2 transition-colors ${isFixed ? "border-border/50 opacity-60" : "border-border hover:border-accent-border"}`}>
      {/* 模块(上方) + 右上时间 */}
      <div className="flex items-center gap-1.5">
        {issue.module ? (
          <span className="flex-1 min-w-0 text-[10px] text-accent truncate">{issue.module}</span>
        ) : (
          <span className="flex-1" />
        )}
        <span className="text-[9px] text-text-muted shrink-0">{formatTime(issue.createdAt)}</span>
      </div>
      {/* 问题现象(标题) */}
      <div className={`text-xs mt-0.5 leading-snug break-words ${isFixed ? "line-through text-text-muted" : "text-text-primary"}`}>{issue.title}</div>

      {/* 操作行:编辑(第一位) + 标记已修复 + 删除 */}
      <div className="flex items-center gap-1 mt-1.5">
        <button
          className="px-1.5 py-0.5 rounded text-[10px] text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
          onClick={() => onEdit?.(issue)}
        >
          编辑
        </button>
        <button
          className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${isFixed ? "bg-success-soft text-success" : "text-text-muted hover:bg-surface-hover hover:text-text-primary"}`}
          onClick={() => setStatus(projectPath, issue.id, isFixed ? "open" : "fixed")}
        >
          {isFixed ? "已修复" : "标记已修复"}
        </button>
        {confirmDelete ? (
          <>
            <button className="px-1.5 py-0.5 rounded text-[10px] text-danger hover:bg-danger-soft transition-colors" onClick={handleDelete}>确认删除</button>
            <button className="px-1.5 py-0.5 rounded text-[10px] text-text-muted hover:bg-surface-hover transition-colors" onClick={() => setConfirmDelete(false)}>取消</button>
          </>
        ) : (
          <button className="px-1.5 py-0.5 rounded text-[10px] text-text-muted hover:text-danger hover:bg-danger-soft transition-colors" onClick={handleDelete}>删除</button>
        )}
      </div>
    </div>
  );
}

export function IssuePanel({ projectPath }: IssuePanelProps): JSX.Element {
  const { issues, load, add, update } = useIssueStore();
  // 表单弹层:new=记录 / edit=编辑(预填)
  const [form, setForm] = useState<{ mode: "new" } | { mode: "edit"; issue: IssueItem } | null>(null);
  const [module, setModule] = useState("");
  const [symptom, setSymptom] = useState("");

  useEffect(() => { load(projectPath); }, [projectPath, load]);

  const openNew = () => { setModule(""); setSymptom(""); setForm({ mode: "new" }); };
  const openEdit = (issue: IssueItem) => {
    setModule(issue.module);
    setSymptom(issue.title);
    setForm({ mode: "edit", issue });
  };

  const handleSave = async () => {
    if (!symptom.trim() || !form) return;
    if (form.mode === "new") {
      // 无独立标题:问题现象即标题(列表主显示)
      await add(projectPath, symptom.trim(), module);
    } else {
      await update(projectPath, form.issue.id, { title: symptom.trim(), module });
    }
    setForm(null);
  };

  return (
    <div className="h-full flex flex-col bg-[var(--color-drawer-panel)]">
      {/* Header */}
      <div className="flex items-center gap-2 h-9 px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-text-secondary">问题记录</span>
        <button
          className="ml-auto w-6 h-6 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
          onClick={openNew}
          title="记录问题"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
        </button>
      </div>

      {/* Issue 列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {issues.length > 0 ? (
          <div className="space-y-1.5">
            {issues.map((issue) => (
              <IssueRow key={issue.id} issue={issue} projectPath={projectPath} onEdit={openEdit} />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-[11px] text-text-muted">暂无记录的问题</div>
        )}
      </div>

      {/* 记录/编辑弹层(createPortal 挂 body 脱离抽屉 transform 劫持,全窗口居中大尺寸) */}
      {form && createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40" onClick={() => setForm(null)}>
          <div
            className="relative bg-surface border border-border rounded-xl w-[760px] h-[600px] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-alt shrink-0">
              <span className="text-sm font-medium text-text-primary">{form.mode === "new" ? "记录问题" : "编辑问题"}</span>
              <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors" onClick={() => setForm(null)} title="关闭">✕</button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-4 py-3">
              <div>
                <label className="text-xs text-text-secondary block mb-1">功能模块（可选，如：登录页）</label>
                <input
                  className="w-full h-8 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-primary outline-none focus:border-accent/50"
                  placeholder="功能模块"
                  value={module}
                  onChange={(e) => setModule(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary block mb-1">问题现象</label>
                <textarea
                  className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent/50 resize-none"
                  placeholder="问题现象"
                  rows={10}
                  value={symptom}
                  onChange={(e) => setSymptom(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-border bg-surface-alt shrink-0">
              <button
                type="button"
                className="h-8 px-4 whitespace-nowrap rounded-lg border border-border text-text-secondary text-xs hover:bg-surface-hover transition-colors shrink-0"
                onClick={() => setForm(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="h-8 px-4 whitespace-nowrap rounded-lg bg-accent text-text-inverse text-xs font-medium hover:bg-accent-hover transition-colors disabled:opacity-40 shrink-0"
                onClick={handleSave}
                disabled={!symptom.trim()}
              >
                保存
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
