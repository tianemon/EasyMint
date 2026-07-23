import { useState, useEffect } from "react";
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

function IssueRow({ issue, projectPath }: { issue: IssueItem; projectPath: string }): JSX.Element {
  const { setStatus, appendNote, remove } = useIssueStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState("");

  const handleDelete = () => {
    if (confirmDelete) {
      remove(projectPath, issue.id);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 5000);
    }
  };

  const saveNote = async () => {
    if (!noteText.trim()) return;
    await appendNote(projectPath, issue.id, noteText);
    setNoteText("");
    setShowNoteInput(false);
  };

  const isFixed = issue.status === "fixed";

  return (
    <div className={`rounded-lg border px-2.5 py-2 transition-colors ${isFixed ? "border-border/50 opacity-60" : "border-border hover:border-accent-border"}`}>
      <div className="flex items-start gap-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-xs truncate ${isFixed ? "line-through text-text-muted" : "text-text-primary"}`}>{issue.title}</span>
            <span className="text-[9px] text-text-muted shrink-0">{formatTime(issue.createdAt)}</span>
          </div>
          {issue.module && (
            <p className="text-[10px] text-accent mt-0.5">模块: {issue.module}</p>
          )}
          {issue.symptom && (
            <p className="text-[10px] text-text-secondary mt-0.5 leading-relaxed whitespace-pre-wrap">{issue.symptom}</p>
          )}
          {issue.notes.map((n, i) => (
            <p key={i} className="text-[10px] text-text-secondary mt-0.5 leading-relaxed whitespace-pre-wrap">
              <span className="text-text-muted">补充 {formatTime(n.createdAt)}:</span> {n.content}
            </p>
          ))}
        </div>
        {confirmDelete ? (
          <span className="flex items-center gap-1 shrink-0">
            <button className="px-1.5 py-0.5 rounded text-[10px] text-danger hover:bg-danger-soft transition-colors" onClick={handleDelete}>确认删除</button>
            <button className="px-1.5 py-0.5 rounded text-[10px] text-text-muted hover:bg-surface-hover transition-colors" onClick={() => setConfirmDelete(false)}>取消</button>
          </span>
        ) : (
          <button className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-danger transition-colors" onClick={handleDelete} title="删除">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><path d="M3 4h10M6 4V2.5h4V4M5 4l.5 8a1 1 0 001 1h3a1 1 0 001-1L11 4"/></svg>
          </button>
        )}
      </div>

      {/* 操作行 */}
      <div className="flex items-center gap-1 mt-1.5">
        <button
          className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${isFixed ? "bg-success-soft text-success" : "text-text-muted hover:bg-surface-hover"}`}
          onClick={() => setStatus(projectPath, issue.id, isFixed ? "open" : "fixed")}
        >
          {isFixed ? "已修复" : "标记已修复"}
        </button>
        {!isFixed && (
          <button
            className="px-1.5 py-0.5 rounded text-[10px] text-text-muted hover:bg-surface-hover transition-colors"
            onClick={() => { setNoteText(""); setShowNoteInput(!showNoteInput); }}
          >
            追加
          </button>
        )}
      </div>

      {/* 追加输入 */}
      {showNoteInput && (
        <div className="mt-1.5 space-y-1.5">
          <textarea
            className="w-full px-2 py-1.5 rounded bg-surface border border-border text-text-primary text-xs outline-none focus:border-accent resize-none"
            placeholder="补充新的现象或信息"
            rows={2}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-1.5">
            <button className="px-2 py-0.5 rounded border border-border text-text-secondary text-[10px] hover:bg-surface-hover transition-colors" onClick={() => setShowNoteInput(false)}>取消</button>
            <button className="px-2 py-0.5 rounded bg-accent text-white text-[10px] hover:bg-accent-hover transition-colors disabled:opacity-40" onClick={saveNote} disabled={!noteText.trim()}>保存</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function IssuePanel({ projectPath, onCollapse }: IssuePanelProps): JSX.Element {
  const { issues, load, add } = useIssueStore();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [module, setModule] = useState("");
  const [symptom, setSymptom] = useState("");

  useEffect(() => { load(projectPath); }, [projectPath, load]);

  const resetForm = () => {
    setTitle(""); setModule(""); setSymptom(""); setShowForm(false);
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    await add(projectPath, title, module, symptom);
    resetForm();
  };

  const openCount = issues.filter((i) => i.status !== "fixed").length;

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 h-9 px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-text-secondary">问题记录</span>
        {issues.length > 0 && <span className="text-[10px] text-text-muted">{openCount} 待处理</span>}
        <div className="flex-1" />
        <button className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors text-xs" onClick={onCollapse} title="收起面板">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M4.5 3l3 3-3 3" /></svg>
        </button>
      </div>

      {/* 记录按钮 / 表单 */}
      <div className="shrink-0 px-3 pt-2">
        {showForm ? (
          <div className="rounded-xl bg-accent-subtle border border-accent-border-light p-2.5 space-y-2">
            <input
              className="w-full px-2 py-1.5 rounded bg-surface border border-border text-text-primary text-xs outline-none focus:border-accent"
              placeholder="问题标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSave(); }}
            />
            <input
              className="w-full px-2 py-1.5 rounded bg-surface border border-border text-text-primary text-xs outline-none focus:border-accent"
              placeholder="功能模块"
              value={module}
              onChange={(e) => setModule(e.target.value)}
            />
            <textarea
              className="w-full px-2 py-1.5 rounded bg-surface border border-border text-text-primary text-xs outline-none focus:border-accent resize-none"
              placeholder="问题现象"
              rows={3}
              value={symptom}
              onChange={(e) => setSymptom(e.target.value)}
            />
            <div className="flex justify-end gap-1.5">
              <button className="px-3 py-1 rounded border border-border text-text-secondary text-[11px] hover:bg-surface-hover transition-colors" onClick={resetForm}>取消</button>
              <button className="px-3 py-1 rounded bg-accent text-white text-[11px] hover:bg-accent-hover transition-colors disabled:opacity-40" onClick={handleSave} disabled={!title.trim()}>保存</button>
            </div>
          </div>
        ) : (
          <button className="w-full px-3 py-2 rounded-xl border-2 border-dashed border-border text-text-secondary text-xs hover:border-accent-border-strong hover:text-accent transition-colors" onClick={() => setShowForm(true)}>+ 记录问题</button>
        )}
      </div>

      {/* Issue 列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {issues.length > 0 ? (
          <div className="space-y-1.5">
            {issues.map((issue) => (
              <IssueRow key={issue.id} issue={issue} projectPath={projectPath} />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-[11px] text-text-muted">
            {showForm ? null : "暂无记录的问题"}
          </div>
        )}
      </div>
    </div>
  );
}
