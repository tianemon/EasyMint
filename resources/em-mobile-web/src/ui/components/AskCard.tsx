import { useMemo, useState } from 'react';
import type { AskAnswer } from '../../core/types';
import type { PendingAsk } from '../../protocol/types';
import { Icon } from './icons';
import { t } from '../i18n';

/** 提问卡：答案状态完全留在组件内（PC 同款单题导航 + 多选 + depends_on 级联 + 自定义输入）。 */
export function AskCard({ ask, onSubmit }: {
  ask: PendingAsk;
  onSubmit: (answers: AskAnswer[] | null) => void;
}): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState('');

  const visible = useMemo(
    () => ask.questions.filter((question) => {
      const depends = question.depends_on;
      if (!depends) return true;
      return Object.entries(depends).every(([key, value]) => (answers[key] ?? []).includes(value));
    }),
    [ask.questions, answers],
  );
  const question = visible[Math.min(index, visible.length - 1)];

  if (!question) return (
    <div className="ask-card">
      <div className="ask-title">等待你的回复</div>
      <button type="button" className="ask-primary" onClick={() => onSubmit(null)}>{t('app.cancel')}</button>
    </div>
  );

  const selected = answers[question.id] ?? [];
  const multi = Boolean(question.multi_select);
  const isLast = index >= visible.length - 1;

  const choose = (value: string): void => {
    setAnswers((current) => {
      const prev = current[question.id] ?? [];
      const next = multi
        ? (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value])
        : [value];
      return { ...current, [question.id]: next };
    });
    if (!multi && !isLast) setIndex((value) => value + 1);
  };

  const submit = (): void => {
    const customValues = ask.allowCustom && custom.trim() ? [custom.trim()] : [];
    const result: AskAnswer[] = Object.entries(answers)
      .map(([questionId, values]) => ({ questionId, values: [...values, ...(questionId === question.id ? customValues : [])] }))
      .filter((item) => item.values.length > 0);
    if (!result.some((item) => item.questionId === question.id) && customValues.length) {
      result.push({ questionId: question.id, values: customValues });
    }
    onSubmit(result.length ? result : null);
  };

  return (
    <div className="ask-card">
      <div className="ask-head">
        <Icon name="think" size={14} />
        <span className="ask-title">{t('pi.waitingUser')}</span>
        {visible.length > 1 && <span className="ask-progress">{index + 1} / {visible.length}</span>}
      </div>
      <div className="ask-question">{question.question}</div>
      <div className="ask-options">
        {(question.options ?? []).map((option) => (
          <button
            key={option.value}
            type="button"
            className={`ask-option${selected.includes(option.value) ? ' is-selected' : ''}`}
            onClick={() => choose(option.value)}
          >
            <span className="ask-option-mark">{selected.includes(option.value) ? <Icon name="check" size={12} /> : null}</span>
            <span className="ask-option-body">
              <span className="ask-option-label">{option.label}{option.recommended && <span className="ask-recommended">推荐</span>}</span>
              {option.description && <span className="ask-option-desc">{option.description}</span>}
            </span>
          </button>
        ))}
      </div>
      {ask.allowCustom && (
        <input
          className="ask-custom"
          value={custom}
          placeholder="自定义回答…"
          onChange={(event) => setCustom(event.target.value)}
        />
      )}
      <div className="ask-actions">
        <button type="button" className="ask-ghost" onClick={() => onSubmit(null)}>{t('app.cancel')}</button>
        {index > 0 && <button type="button" className="ask-ghost" onClick={() => setIndex((value) => value - 1)}>上一题</button>}
        <button type="button" className="ask-primary" onClick={isLast ? submit : () => setIndex((value) => value + 1)}>
          {isLast ? t('app.confirm') : t('common.next')}
        </button>
      </div>
    </div>
  );
}
