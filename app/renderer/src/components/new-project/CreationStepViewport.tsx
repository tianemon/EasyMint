import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Visited steps retain their forms and preview state. Only the active pane accepts input. */
export function CreationStepViewport({ step, pages, onTransitionChange }: {
  step: number;
  onTransitionChange?: (transitioning: boolean) => void;
  pages: Array<{ id: number; content: ReactNode }>;
}): JSX.Element {
  const visited = useRef(new Set<number>());
  const panes = useRef(new Map<number, HTMLDivElement>());
  const previous = useRef(step);
  const current = useRef(step);
  current.current = step;
  visited.current.add(step);

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = step;
    if (from === step) return;
    const outgoing = panes.current.get(from), incoming = panes.current.get(step);
    if (!outgoing || !incoming) return;
    const restoreFocus = outgoing.contains(document.activeElement);
    const focusHeading = () => {
      if (restoreFocus) incoming.closest('.creation-wizard-main')?.querySelector<HTMLElement>('.creation-wizard-step-title')?.focus({ preventScroll: true });
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !incoming.animate) {
      outgoing.hidden = true;
      focusHeading();
      return;
    }
    onTransitionChange?.(true);
    outgoing.hidden = false;
    const direction = step > from ? 1 : -1;
    const timing = { duration: 260, easing: 'cubic-bezier(.22,.8,.2,1)', fill: 'both' as const };
    const exit = outgoing.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-direction * 14}px)` }], { ...timing, duration: 150 });
    const enter = incoming.animate([{ opacity: 0, transform: `translateX(${direction * 18}px)` }, { opacity: 1, transform: 'translateX(0)' }], timing);
    let cancelled = false;
    void Promise.allSettled([exit.finished, enter.finished]).then(() => {
      if (cancelled) return;
      outgoing.hidden = true;
      exit.cancel(); enter.cancel();
      focusHeading();
      onTransitionChange?.(false);
    });
    return () => {
      cancelled = true;
      exit.cancel(); enter.cancel();
      outgoing.hidden = Number(outgoing.dataset.step) !== current.current;
      onTransitionChange?.(false);
    };
  }, [step, onTransitionChange]);

  return <div className="creation-step-viewport">
    {pages.filter(page => visited.current.has(page.id)).map(page => <div
      key={page.id}
      ref={node => { if (node) panes.current.set(page.id, node); else panes.current.delete(page.id); }}
      data-step={page.id}
      className="creation-wizard-pane settings-body"
      hidden={page.id !== step}
      inert={page.id !== step}
      aria-hidden={page.id !== step}
    >{page.content}</div>)}
  </div>;
}
