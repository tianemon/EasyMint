import { useLayoutEffect, useRef } from "react";

/** Moves only the selected surface; button geometry, colours and keyboard behaviour stay intact. */
export function SelectionIndicator({ value }: { value: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const indicator = ref.current;
    const host = indicator?.parentElement;
    if (!indicator || !host) return;
    const update = () => {
      const selected = host.querySelector<HTMLElement>('button[aria-pressed="true"]');
      if (!selected) { indicator.hidden = true; return; }
      indicator.hidden = false;
      indicator.style.width = `${selected.offsetWidth}px`;
      indicator.style.height = `${selected.offsetHeight}px`;
      indicator.style.transform = `translate(${selected.offsetLeft}px, ${selected.offsetTop}px)`;
    };
    update();
    // Do not animate the initial measurement; subsequent selections are interruptible CSS transitions.
    const frame = requestAnimationFrame(() => { indicator.dataset.positioned = "true"; });
    const observer = new ResizeObserver(update);
    observer.observe(host);
    host.querySelectorAll('button').forEach(button => observer.observe(button));
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [value]);
  return <span ref={ref} className="selection-indicator" aria-hidden="true" />;
}
