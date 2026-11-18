import { useEffect, useLayoutEffect, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { registerOverlay } from "../../lib/overlay-stack";
import { hasOpenModal } from "./Modal";

const openedEvent = "easymint-composer-popover-opened";

/** Position the three input-card popovers against the trigger's actual viewport bounds. */
export function ComposerPopover({ anchor, panel, onDismiss, children, className = "", ...props }: {
  anchor: RefObject<HTMLButtonElement | null>;
  panel: RefObject<HTMLDivElement | null>;
  onDismiss: (reason: "escape" | "outside") => void;
  children: ReactNode;
  className?: string;
  id?: string;
  "aria-label": string;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onFocusCapture?: React.FocusEventHandler<HTMLDivElement>;
}): JSX.Element {
  useLayoutEffect(() => {
    const button = anchor.current, popup = panel.current;
    if (!button || !popup) return;
    const place = () => {
      const rect = button.getBoundingClientRect();
      const inset = 8, gap = 6;
      const above = rect.top - gap - inset;
      const below = window.innerHeight - rect.bottom - gap - inset;
      const up = popup.scrollHeight <= above || above >= below;
      popup.style.left = `${Math.max(inset, Math.min(rect.left, window.innerWidth - popup.offsetWidth - inset))}px`;
      popup.style.top = up ? "auto" : `${rect.bottom + gap}px`;
      popup.style.bottom = up ? `${window.innerHeight - rect.top + gap}px` : "auto";
      popup.style.maxHeight = `${Math.max(0, up ? above : below)}px`;
    };
    place();
    const unregister = registerOverlay(popup);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    observer?.observe(button);
    observer?.observe(popup);
    const card = button.closest(".input-card");
    if (card) observer?.observe(card);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    popup.dispatchEvent(new Event(openedEvent, { bubbles: true }));
    return () => {
      observer?.disconnect();
      unregister();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, panel]);

  useEffect(() => {
    const outside = (event: Event) => {
      if (!(event.target instanceof Node) || panel.current?.contains(event.target) || anchor.current?.contains(event.target)) return;
      onDismiss("outside");
    };
    const focusOutside = (event: FocusEvent) => { if (event.target !== document.body) outside(event); };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || hasOpenModal()) return;
      event.preventDefault();
      onDismiss("escape");
    };
    const blur = () => onDismiss("outside");
    document.addEventListener("mousedown", outside);
    document.addEventListener("focusin", focusOutside);
    document.addEventListener(openedEvent, outside);
    document.addEventListener("keydown", keyDown);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("focusin", focusOutside);
      document.removeEventListener(openedEvent, outside);
      document.removeEventListener("keydown", keyDown);
      window.removeEventListener("blur", blur);
    };
  }, [anchor, onDismiss, panel]);

  return createPortal(<div ref={panel} role="dialog" className={`composer-popover no-drag z-dropdown ${className}`} {...props}>{children}</div>, document.body);
}
