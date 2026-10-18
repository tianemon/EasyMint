import { useLayoutEffect, type RefObject } from "react";

interface ScrollPosition { anchor: string | null; offset: number; top: number }
export type PreviewScrollMemory = Map<string, ScrollPosition>;

/** Follow the same specimen across different material spacing, screen sizes and modal hosts. */
export function usePreviewScroll(ref: RefObject<HTMLElement | null>, memory: PreviewScrollMemory | undefined, key: string, version: string): void {
  useLayoutEffect(() => {
    const main = ref.current;
    if (!main || !memory) return;
    let restoredTop: number | undefined;
    const anchors = () => Array.from(main.querySelectorAll<HTMLElement>("[data-preview-anchor]"));
    const scale = () => main.offsetHeight ? main.getBoundingClientRect().height / main.offsetHeight : 0;
    const restore = () => {
      const saved = memory.get(key);
      const factor = scale();
      if (!saved || !factor) return;
      const target = anchors().find((node) => node.dataset.previewAnchor === saved.anchor);
      main.scrollTop = saved.top <= 1 ? 0 : target ? main.scrollTop + (target.getBoundingClientRect().top - main.getBoundingClientRect().top) / factor + saved.offset : saved.top;
      // A clamped restoration must not replace the semantic bookmark with a different section.
      restoredTop = main.scrollTop;
    };
    const remember = () => {
      if (restoredTop !== undefined && Math.abs(main.scrollTop - restoredTop) < 1) { restoredTop = undefined; return; }
      restoredTop = undefined;
      const factor = scale();
      if (!factor) return;
      const top = main.getBoundingClientRect().top;
      const nodes = anchors();
      const target = nodes.filter((node) => node.getBoundingClientRect().top <= top + 24 * factor).at(-1) ?? nodes[0];
      memory.set(key, { anchor: target?.dataset.previewAnchor ?? null, offset: target ? (top - target.getBoundingClientRect().top) / factor : 0, top: main.scrollTop });
    };
    restore();
    const observer = new ResizeObserver(restore);
    observer.observe(main);
    const display = main.closest<HTMLElement>(".creation-device-display");
    if (display) observer.observe(display);
    main.addEventListener("scroll", remember);
    return () => { main.removeEventListener("scroll", remember); observer.disconnect(); };
  }, [ref, memory, key, version]);
}
