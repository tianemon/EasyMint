import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AskAnswer } from '../../core/types';
import type { PendingAsk } from '../../protocol/types';
import { ChevronIcon, Icon, iconSize } from './icons';

/**
 * Mint 结构化提问卡（聊天区内嵌），与 App AskCard.tsx 同构：
 * 一次一题、单选自动前进、多选勾选不跳题、‹ n/N › 前后切换、✕ 全部跳过。
 * 状态全留在组件内，提交只递交已答题。
 */
export function AskCard({ ask, onSubmit }: {
  ask: PendingAsk;
  onSubmit: (answers: AskAnswer[] | null) => void;
}): React.ReactElement | null {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const order = useMemo(
    () => ask.questions.filter((question) => {
      const depends = question.depends_on;
      if (!depends) return true;
      return Object.entries(depends).every(([key, value]) => (answers[key] ?? []).includes(value));
    }),
    [ask.questions, answers],
  );

  useEffect(() => {
    if (index >= order.length) setIndex(Math.max(0, order.length - 1));
  }, [index, order.length]);

  const question = order[index];
  const total = order.length;
  const isLast = index === total - 1;
  const multi = question?.multi_select === true;
  const draft = question ? (drafts[question.id] ?? '') : '';
  const draftNonEmpty = draft.trim().length > 0;
  const selected = question ? (answers[question.id] ?? []) : [];

  const submit = useCallback((finalAnswers: Record<string, string[]>) => {
    setSubmitting(true);
    onSubmit(ask.questions.flatMap((item) => {
      const values = finalAnswers[item.id];
      return values && values.length ? [{ questionId: item.id, values }] : [];
    }));
  }, [ask.questions, onSubmit]);

  const advance = useCallback((): void => {
    if (!question || submitting) return;
    if (isLast) submit(answers);
    else setIndex((current) => current + 1);
  }, [answers, isLast, question, submit, submitting]);

  const pick = (value: string): void => {
    if (!question || submitting) return;
    const next = { ...answers, [question.id]: [value] };
    setAnswers(next);
    setDrafts((prev) => {
      if (!(question.id in prev)) return prev;
      const clean = { ...prev };
      delete clean[question.id];
      return clean;
    });
    if (isLast) submit(next);
    else setIndex((current) => current + 1);
  };

  const toggle = (value: string): void => {
    if (!question || submitting) return;
    const current = answers[question.id] ?? [];
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    setAnswers({ ...answers, [question.id]: next });
  };

  const proceedWithDraft = (): void => {
    if (!question || submitting || !draftNonEmpty) return;
    const text = draft.trim();
    const current = answers[question.id] ?? [];
    const next = { ...answers, [question.id]: current.includes(text) ? current : [...current, text] };
    setAnswers(next);
    setDrafts((prev) => {
      const clean = { ...prev };
      delete clean[question.id];
      return clean;
    });
    if (isLast) submit(next);
    else setIndex((current) => current + 1);
  };

  const skipAll = (): void => {
    if (submitting) return;
    setSubmitting(true);
    onSubmit(null);
  };

  if (!question) return null;
  const mainLabel = draftNonEmpty ? '发送' : isLast ? '完成' : '下一题';

  return (
    <div className="ask-card">
      <div className="ask-nav-row">
        <button type="button" className="ask-nav-button" aria-label="上一题"
          disabled={index === 0} onClick={() => setIndex(Math.max(0, index - 1))}>
          <ChevronIcon size={iconSize.card} direction="left" />
        </button>
        <span className="ask-nav-count">{index + 1}/{total}</span>
        <button type="button" className="ask-nav-button" aria-label={isLast ? '已到最后一题' : '跳过此题'}
          disabled={isLast} onClick={advance}>
          <ChevronIcon size={iconSize.card} direction="right" />
        </button>
        <button type="button" className="ask-nav-button ask-skip" aria-label="全部跳过（取消提问）" onClick={skipAll}>
          <Icon name="close" size={iconSize.card} />
        </button>
      </div>

      <div className="ask-question">
        {question.question}{multi && !question.question.includes('多选') ? '（可多选）' : ''}
      </div>

      {!!question.options?.length && (
        <div className="ask-options">
          {question.options.map((option) => {
            const active = selected.includes(option.value);
            return (
              <button key={option.value} type="button" className={`ask-option${active ? ' is-selected' : ''}`}
                aria-pressed={active} onClick={() => (multi ? toggle(option.value) : pick(option.value))}>
                {multi && (
                  <span className={`ask-checkbox${active ? ' is-active' : ''}`}>
                    <Icon name="check" size={iconSize.status} />
                  </span>
                )}
                <span className="ask-option-text">
                  {option.label}{option.description ? `（${option.description}）` : ''}
                </span>
                {option.recommended && <span className={`ask-recommended${active ? ' is-active' : ''}`}>推荐</span>}
              </button>
            );
          })}
        </div>
      )}

      {ask.allowCustom && (
        <div className="ask-custom-row">
          <textarea className="ask-custom-input" rows={1} value={draft} placeholder="输入你的答案…"
            onChange={(event) => setDrafts((prev) => ({ ...prev, [question.id]: event.target.value }))} />
          <button type="button" className={`ask-main-button${draftNonEmpty ? ' is-active' : ''}`}
            aria-label={mainLabel} onClick={draftNonEmpty ? proceedWithDraft : advance}>
            {mainLabel}
          </button>
        </div>
      )}

      {!ask.allowCustom && (
        <div className="ask-actions-row">
          <button type="button" className="ask-main-button" aria-label={mainLabel} onClick={advance}>
            {mainLabel}
          </button>
        </div>
      )}
    </div>
  );
}
