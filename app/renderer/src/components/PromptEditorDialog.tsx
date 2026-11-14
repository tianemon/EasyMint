import { useId, type ReactNode } from "react";
import { uiText } from "../lib/i18n";
import { Modal } from "./ui/Modal";

export function PromptEditorDialog({ title, onClose, children, busy = false }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
}): JSX.Element {
  const titleId = useId();
  const requestClose = () => { if (!busy) onClose(); };
  return <Modal tier="modal" overlayClassName="bg-black/40 backdrop-blur-sm" overlayClose="press-release" onClose={requestClose} canOverlayClose={() => !busy}>
    <section role="dialog" aria-modal="true" aria-labelledby={titleId}
      className="relative bg-[var(--modal-fill)] rounded-[var(--radius-lg)] shadow-2xl flex flex-col overflow-hidden [&_textarea]:resize-none"
      style={{ width: 640, maxWidth: "calc(100vw - 32px)", height: "min(680px, calc(100vh - 96px))" }}>
      <div className="flex items-center gap-2 px-4 py-1.5 shrink-0">
        <h3 id={titleId} className="text-sm font-medium text-text-secondary truncate flex-1 min-w-0">{title}</h3>
        <button type="button" onClick={requestClose} disabled={busy} aria-label={uiText("common.close")}
          className="w-7 h-7 shrink-0 flex items-center justify-center rounded-[var(--radius-lg)] text-text-secondary hover:bg-surface-hover transition-colors">✕</button>
      </div>
      {children}
    </section>
  </Modal>;
}
