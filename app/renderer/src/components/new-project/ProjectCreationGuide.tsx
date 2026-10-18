import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { uiText, useUiLocale } from "../../lib/i18n";
import { registerOverlay } from "../../lib/overlay-stack";
import { hasOpenModal } from "../ui/Modal";

import { PROJECT_CREATION_GUIDE_KEY as GUIDE_KEY, PROJECT_CREATION_GUIDE_REPLAY_KEY as REPLAY_KEY, projectCreationGuideMode } from "../../lib/onboarding-progress";

function ProjectSpotlight({ target, menuOpen, onClose }: { target: RefObject<HTMLButtonElement | null>; menuOpen: boolean; onClose: () => void }): JSX.Element | null {
  const [rect, setRect] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const button = target.current;
    if (!button) return;
    const measure = () => {
      const bounds = button.getBoundingClientRect();
      setRect({ left: Math.max(0, bounds.left - 6), top: Math.max(0, bounds.top - 6), right: Math.min(window.innerWidth, bounds.right + 6), bottom: Math.min(window.innerHeight, bounds.bottom + 6) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(button);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const previous = document.activeElement;
    button.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (hasOpenModal()) { onClose(); return; }
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
      if (event.key === "Tab") {
        event.preventDefault();
        (document.activeElement === button ? closeRef.current : button)?.focus();
      }
    };
    window.addEventListener("keydown", keyboard, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("keydown", keyboard, true);
      if (previous instanceof HTMLElement && previous.isConnected && !hasOpenModal()) previous.focus();
    };
  }, [target, onClose]);
  useEffect(() => registerOverlay(rootRef.current), [rect !== null]);
  if (!rect) return null;
  const width = Math.min(320, window.innerWidth - 32);
  return createPortal(
    <div ref={rootRef} className="creation-spotlight no-drag z-dialog">
      <div className="creation-spotlight-shade" style={{ inset: `0 0 auto 0`, height: rect.top }} />
      <div className="creation-spotlight-shade" style={{ left: 0, top: rect.top, width: rect.left, height: rect.bottom - rect.top }} />
      <div className="creation-spotlight-shade" style={{ left: rect.right, right: 0, top: rect.top, height: rect.bottom - rect.top }} />
      <div className="creation-spotlight-shade" style={{ inset: `${rect.bottom}px 0 0 0` }} />
      <div className="creation-spotlight-card" role="dialog" aria-labelledby="creation-guide-title" aria-describedby="creation-guide-description" style={{ width, left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), top: Math.max(16, Math.min(rect.bottom + 16, window.innerHeight - 200)) }}>
        <span className="creation-eyebrow">{uiText("creation.guide.eyebrow")}</span>
        <h3 id="creation-guide-title">{uiText(menuOpen ? "creation.guide.title" : "creation.guide.menuTitle")}</h3>
        <p id="creation-guide-description">{uiText(menuOpen ? "creation.guide.description" : "creation.guide.menuDescription")}</p>
        <button ref={closeRef} type="button" className="creation-text-button" onClick={onClose}>{uiText("creation.guide.skip")}</button>
      </div>
    </div>, document.body,
  );
}

/** Teach the existing project menu without adding another permanent creation action. */
export function useProjectCreationGuide(projectId: string) {
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    const mode = projectCreationGuideMode(projectId, localStorage.getItem(GUIDE_KEY), sessionStorage.getItem(REPLAY_KEY) === "true");
    if (mode === "off") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!active || projectCreationGuideMode(projectId, localStorage.getItem(GUIDE_KEY), sessionStorage.getItem(REPLAY_KEY) === "true") !== mode) return;
        if (hasOpenModal()) {
          // Explicit reruns must survive dialogs shown while entering the workbench.
          if (mode === "replay") schedule();
          return;
        }
        setGuide(true);
      }, 500);
    };
    if (mode === "replay") schedule();
    else window.electronAPI.project.list().then((projects) => {
      if (active && !projects.length) schedule();
    }).catch((error: unknown) => console.error("[project-guide] Could not check existing projects", error));
    return () => { active = false; clearTimeout(timer); };
  }, [projectId]);
  const close = useCallback(() => { sessionStorage.removeItem(REPLAY_KEY); localStorage.setItem(GUIDE_KEY, "dismissed"); setGuide(false); }, []);
  return { active: guide, dismiss: close };
}

export function ProjectCreationGuide({ target, menuOpen, onClose }: { target: RefObject<HTMLButtonElement | null>; menuOpen: boolean; onClose: () => void }): JSX.Element | null {
  useUiLocale();
  return <ProjectSpotlight target={target} menuOpen={menuOpen} onClose={onClose} />;
}
