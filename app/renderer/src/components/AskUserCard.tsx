import { useMemo, useState, useEffect } from "react";
import { useAskStore, type AskQuestion, type AskRequest } from "../stores/ask-store";

interface Props {
  request: AskRequest;
}

/**
 * Mint 结构化提问卡片（聊天区内嵌，毛玻璃，单选/多选单题导航）：
 * - 一次只显示一个问题：单选点选项即记录并自动进入下一题；多选（multi_select）勾选不跳题，
 *   点「下一题 / 完成」显式前进
 * - 主按钮文案随位置变化：非最后一题「下一题」、最后一题「完成」（提交全部已答）——
 *   避免旧版「跳过」在最后一题静默提交的语义陷阱；未答时点「下一题」= 跳过此题不记答案
 * - 右上角 <1/3> 前后切换 + ✕ 全部跳过（取消提问）
 * - 级联联动：depends_on 前置答案匹配才进入可见序列（多选题命中任一勾选项即显示）
 */
export function AskUserCard({ request }: Props): JSX.Element | null {
  // 当前题索引（可见问题序列）
  const [idx, setIdx] = useState(0);
  // 每题答案：选项 value 数组（单选存单元素；跳过的题不在其中）
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  // 每题自定义输入草稿（切换问题保留，返回可改；发送后并入该题答案并清除）
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
      const ok = Object.entries(q.depends_on).every(([pid, pv]) => (answers[pid] ?? []).includes(pv));
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
  const multi = q?.multi_select === true;
  const draft = q ? (drafts[q.id] ?? "") : "";
  const draftNonEmpty = draft.trim().length > 0;
  const curSel = q ? (answers[q.id] ?? []) : [];

  // 提交：按题序收集已答（跳过的题不在 answers 中），无任何作答 = 空数组 → 主进程按取消处理
  const submit = (finalAnswers: Record<string, string[]>): void => {
    setSubmitting(true);
    const list: Array<{ questionId: string; values: string[] }> = [];
    for (const qq of request.questions) {
      const vals = finalAnswers[qq.id];
      if (vals && vals.length > 0) list.push({ questionId: qq.id, values: vals });
    }
    window.electronAPI.agent.respondAsk(request.requestId, list);
    // 主进程 respondAsk 会广播 ask-closed 兜底清除；本地立即移除防广播延迟闪烁
    useAskStore.getState().clearAsk(request.requestId);
  };

  // 前进：非最后一题切下一题（当前题勾选已实时写入 answers，未答则自然跳过）；
  // 最后一题 = 提交全部已答（按钮文案「完成」，行为与所见一致）
  const advance = (): void => {
    if (!q || submitting) return;
    if (isLast) submit(answers);
    else setIdx(idx + 1);
  };

  // 单选：点选项 = 记录并自动进入下一题（最后一题选完即提交）；清除该题输入草稿
  const pick = (value: string): void => {
    if (!q || submitting) return;
    const next = { ...answers, [q.id]: [value] };
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

  // 多选：点选项 = 勾选/取消切换，不跳题
  const toggle = (value: string): void => {
    if (!q || submitting) return;
    const cur = answers[q.id] ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    setAnswers({ ...answers, [q.id]: next });
  };

  // 带草稿前进：草稿文本并入该题答案（与已勾选项并列），然后前进/提交；清除草稿防重复并入
  const proceedWithDraft = (): void => {
    if (!q || submitting || !draftNonEmpty) return;
    const text = draft.trim();
    const cur = answers[q.id] ?? [];
    const vals = cur.includes(text) ? cur : [...cur, text];
    const next = { ...answers, [q.id]: vals };
    setAnswers(next);
    setDrafts((prev) => {
      const clean = { ...prev };
      delete clean[q.id];
      return clean;
    });
    if (isLast) submit(next);
    else setIdx(idx + 1);
  };

  // ✕ 全部跳过（null = 取消语义，主进程按用户取消处理）
  const skipAll = (): void => {
    if (submitting) return;
    setSubmitting(true);
    window.electronAPI.agent.respondAsk(request.requestId, null);
    useAskStore.getState().clearAsk(request.requestId);
  };

  if (!q) return null;

  const mainLabel = draftNonEmpty ? "发送" : isLast ? "完成" : "下一题";

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
          title="上一题"
          onClick={() => setIdx(Math.max(0, idx - 1))}
          disabled={idx === 0}
          className="w-5 h-5 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-30 disabled:cursor-default"
        >‹</button>
        <span className="text-[length:var(--text-2xs)] text-text-muted font-mono px-0.5 select-none">{idx + 1}/{total}</span>
        <button
          type="button"
          title={isLast ? undefined : "跳过此题"}
          onClick={advance}
          disabled={isLast}
          className="w-5 h-5 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-30 disabled:cursor-default"
        >›</button>
        <span className="w-1" />
        <button
          type="button"
          title="全部跳过（取消提问）"
          onClick={skipAll}
          className="w-5 h-5 flex items-center justify-center rounded-md text-text-secondary hover:text-danger hover:bg-surface-hover transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* 问题 */}
      <div className="px-3.5 pt-1.5 text-xs text-text-primary font-medium leading-relaxed">
        {q.question}{multi && !q.question.includes("多选") ? "（可多选）" : ""}
      </div>

      {/* 选项：单选点选即走；多选左侧勾选框、点选切换不跳题 */}
      {q.options && q.options.length > 0 && (
        <div className="px-3.5 pt-2 pb-0.5 space-y-1">
          {q.options.map((opt) => {
            const sel = curSel.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => (multi ? toggle(opt.value) : pick(opt.value))}
                className={`w-full flex items-center gap-2 text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  sel ? "bg-accent-soft text-accent font-medium" : "text-text-primary hover:bg-surface-hover"
                }`}
              >
                {multi && (
                  <span
                    className={`w-3.5 h-3.5 shrink-0 rounded-[4px] flex items-center justify-center border transition-colors ${
                      sel ? "bg-accent border-accent" : "border-border"
                    }`}
                  >
                    <svg
                      className={`w-2.5 h-2.5 ${sel ? "text-white" : "text-transparent"}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    ><path d="M5 13l4 4L19 7" /></svg>
                  </span>
                )}
                <span className="min-w-0">
                  {opt.label}{opt.description ? `（${opt.description}）` : ""}
                </span>
                {opt.recommended && (
                  <span className={`shrink-0 px-1.5 py-px rounded-[4px] text-[length:var(--text-2xs)] font-medium transition-colors ${
                    sel ? "bg-accent text-white" : "bg-accent-soft text-accent"
                  }`}>推荐</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* 自定义输入行：输入框与主按钮同一行（有草稿时按钮变「发送」，草稿并入该题答案） */}
      {request.allowCustom && (
        <div className="px-3.5 pt-1.5 pb-[9px] flex items-center gap-2">
          <input
            className="em-input flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-surface/50"
            placeholder="输入你的答案…"
            value={draft}
            onChange={(e) => setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
            onKeyDown={(e) => {
              // 回车：有草稿发送（并入该题答案前进），无草稿前进（最后一题=提交已答）
              if (e.key === "Enter") {
                e.preventDefault();
                if (draftNonEmpty) proceedWithDraft();
                else advance();
              }
            }}
          />
          <button
            type="button"
            onClick={draftNonEmpty ? proceedWithDraft : advance}
            className={`shrink-0 px-3 py-1.5 rounded-[8px] text-[length:var(--text-2xs)] font-medium transition-all duration-150 ${
              draftNonEmpty
                ? "btn-accent"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
          >
            {mainLabel}
          </button>
        </div>
      )}

      {/* 无自定义输入（纯选项）时：右下角主按钮（跳过此题/提交）独立成行 */}
      {!request.allowCustom && (
        <div className="flex justify-end px-3.5 py-2">
          <button
            type="button"
            onClick={advance}
            className="px-3.5 py-1 rounded-[8px] text-[length:var(--text-2xs)] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-all duration-150"
          >
            {mainLabel}
          </button>
        </div>
      )}
    </div>
  );
}
