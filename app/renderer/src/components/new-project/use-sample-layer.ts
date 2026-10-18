import { useLayoutEffect, useRef, useState } from "react";
import { placeSampleMenu, type SampleMenuPosition } from "./sample-menu-position";

/** Shared by authored menus, tooltips and anchored gallery layers. */
export function useSampleLayer(open: boolean, onDismiss: () => void, contentKey: string | number = "", minimumWidth = 0) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<SampleMenuPosition | null>(null);
  useLayoutEffect(() => {
    if (open) { setHost(anchorRef.current?.closest<HTMLElement>(".sample-app") ?? null); setPosition(null); }
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !host) return;
    const anchor = anchorRef.current;
    const layer = layerRef.current;
    const main = host.querySelector<HTMLElement>(".sample-main");
    if (!anchor || !layer || !main) return;
    const measure = () => {
      const frame = host.getBoundingClientRect();
      const rect = anchor.getBoundingClientRect();
      const width = Math.max(rect.width, minimumWidth * frame.width / host.offsetWidth);
      const next = placeSampleMenu({ left: rect.left, top: rect.top, bottom: rect.bottom, height: rect.height, width, right: rect.left + width }, frame, main.getBoundingClientRect(), { width: host.offsetWidth, height: host.offsetHeight }, layer.scrollHeight);
      if (!next) { if (layer.contains(document.activeElement)) anchor.focus({ preventScroll: true }); dismissRef.current(); return; }
      setPosition((current) => current && Object.keys(next).every((key) => current[key as keyof SampleMenuPosition] === next[key as keyof SampleMenuPosition]) ? current : next);
    };
    const outside = (event: Event) => {
      if (event.target instanceof Node && !anchor.contains(event.target) && !layer.contains(event.target)) dismissRef.current();
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [host, anchor, layer]) observer.observe(element);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
    };
  }, [open, host, contentKey, minimumWidth]);
  return { anchorRef, layerRef, host, position };
}
