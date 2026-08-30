import { useMemo, useState, useEffect } from "react";
import { useAskStore, type AskQuestion, type AskRequest } from "../stores/ask-store";

interface Props {
  request: AskRequest;
}

/**
 * Mint 结构化提问卡片（聊天区内嵌，毛玻璃，单选单题导航）：
 * - 一次只显示一个问题，选完自动进入下一题，‹ › 可前后切换重新选
 * - 选项垂直排列、无选择框、hover 反馈；说明放选项括号里
 * - 右上角 <1/3> 导航 + ✕ 全部跳过；右下角「跳过」当前题，输入内容时变 → 前进
 * - 级联联动：depends_on 前置答案匹配才进入可见序列
 */
export function AskUserCard({ request }: Props): JSX.Element | null {
  // 当前题索引（可见问题序列）
  const [idx, setIdx] = useState(0);
  // 每题答案：选项 value 或自定义文本（跳过的题不在其中）
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // 每题自定义输入草稿（切换问题保留，返回可改）
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // 可见问题序列：depends_on 前置答案匹配才显示（单题导航按此序列）
  const order = useMemo(() => {
    const vis: AskQuestion[] = [];
    for (const q of request.questions) {
      if (!q.depends_on) {
        vis.push(q);
        continue;
      }
      const ok = Object.entries(q.depends_on).every(([pid, pv]) => answers[pid] === pv);
      if (ok) vis.push(q);
    }
    return vis;
  }, [request.questions, answers]);

  // 前置选择变化导致当前题不可见 → 落在最后一个可见题
  useEffect(() => {
    if (idx >= order.length) setIdx(Math.max(0, order.length - 1));
  }, [order.length, idx]);

  const q = order[idx];
  const total = order.length;
  const isLast = idx === total - 1;
  const draft = q ? (drafts[q.id] ?? "") : "";
  const draftNonEmpty = draft.trim().length > 0;

  const submit = (finalAnswers: Record<string, string>): void => {
    setSubmitting(true);
    const list = Object.entries(finalAnswers).map(([questionId, value]) => ({ questionId, values: [value] }));
    window.electronAPI.agent.respondAsk(request.requestId, list);
    // 主进程 respondAsk 会广播 ask-closed 兜底清除；本地立即移除防广播延迟闪烁
    useAskStore.getState().clearAsk(request.requestId);
  };

  // 点击选项：记录答案并自动进入下一题（最后一题选完即提交）；清除该题输入草稿
  const pick = (value: string): void => {
    if (!q || submitting) return;
    const next = { ...answers, [q.id]: value };
    setAnswers(next);
    setDrafts((prev) => {
      if (!(q.id in prev)) return prev;
      const clean = { ...prev };
      delete clean[q.id];
      return clean;
    });
    if (isLast) submit(next);
    else setIdx(idx + 1);
  };

  // 跳过当前题（不记录答案前进；最后一题 = 提交已有答案）
  const skip = (): void => {
    if (!q || submitting) return;
    if (isLast) { submit(answers); return; }
    setIdx(idx + 1);
  };

  // 自定义输入前进（输入内容时按钮变 →，带答案进入下一题/提交）
  const proceedWithDraft = (): void => {
    if (!q || submitting || !draftNonEmpty) return;
    const next = { ...answers, [q.id]: draft.trim() };
    setAnswers(next);
    if (isLast) submit(next);
    else setIdx(idx + 1);
  };

  // ✕ 全部跳过（空答案 = 取消语义）
  const skipAll = (): void => {
    if (submitting) return;
    setSubmitting(true);
    window.electronAPI.agent.respondAsk(request.requestId, null);
    useAskStore.getState().clearAsk(request.requestId);
  };

  if (!q) return null;

  return (
    <div
      className="rounded-[var(--radius-md)] shadow-lg animate-[card-in_160ms_ease-out] overflow-hidden"
      style={{
        background: "color-mix(in oklab, var(--color-surface-elevated) 65%, transparent)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {/* 右上角导航：<1/3> 前后切换 + ✕ 全部跳过 */}
      <div className="flex items-center justify-end gap-0.5 px-3.5 pt-2">
        <button
          type="button"
          onClick={() => setIdx(Math.max(0, idx - 1))}
          disabled={idx === 0}
          className="w-5 h-5 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-30 disabled:cursor-default"
        >‹</button>
        <span className="text-[length:var(--text-2xs)] text-text-muted font-mono px-0.5 select-none">{idx + 1}/{total}</span>
        <button
          type="button"
          onClick={skip}
          disabled={isLast}
          className="w-5 h-5 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-30 disabled:cursor-default"
        >›</button>
        <span className="w-1" />
        <button
          type="button"
          onClick={skipAll}
          title="全部跳过"
          className="w-5 h-5 flex items-center justify-center rounded-md text-text-secondary hover:text-danger hover:bg-surface-hover transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* 问题 */}
      <div className="px-3.5 pt-1.5 text-xs text-text-primary font-medium leading-relaxed">{q.question}</div>

      {/* 选项（垂直单选，无选择框，hover 反馈） */}
      {q.options && q.options.length > 0 && (
        <div className="px-3.5 pt-2 pb-0.5 space-y-1">
          {q.options.map((opt) => {
            const sel = answers[q.id] === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => pick(opt.value)}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  sel ? "bg-accent-soft text-accent font-medium" : "text-text-primary hover:bg-surface-hover"
                }`}
              >
                {opt.label}{opt.description ? `（${opt.description}）` : ""}
              </button>
            );
          })}
        </div>
      )}

      {/* 自定义输入 */}
      {request.allowCustom && (
        <div className="px-3.5 pt-1.5">
          <input
            className="em-input w-full px-2.5 py-1.5 text-xs bg-surface/50"
            placeholder="输入你的答案…"
            value={draft}
            onChange={(e) => setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
          />
        </div>
      )}

      {/* 右下角：跳过（输入内容时变 →） */}
      <div className="flex justify-end px-3.5 py-2">
        <button
          type="button"
          onClick={draftNonEmpty ? proceedWithDraft : skip}
          className={`px-3.5 py-1 rounded-[8px] text-[length:var(--text-2xs)] font-medium transition-all duration-150 ${
            draftNonEmpty
              ? "bg-accent text-text-inverse hover:bg-accent-hover"
              : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
          }`}
        >
          {draftNonEmpty ? "→" : "跳过"}
        </button>
      </div>
    </div>
  );
}
