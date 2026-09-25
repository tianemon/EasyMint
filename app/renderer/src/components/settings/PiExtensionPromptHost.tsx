import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";

type Request = Parameters<Parameters<typeof window.electronAPI.piExtension.onPrompt>[0]>[0];

export function PiExtensionPromptHost(): JSX.Element | null {
  const [queue, setQueue] = useState<Request[]>([]);
  const [value, setValue] = useState("");
  useEffect(() => window.electronAPI.piExtension.onPrompt((request) => {
    setQueue((current) => [...current, request]);
  }), []);
  useEffect(() => window.electronAPI.piExtension.onPromptExpired((id) => {
    setQueue((current) => current.filter((request) => request.id !== id));
  }), []);
  const request = queue[0];
  useEffect(() => setValue(""), [request?.id]);
  if (!request) return null;

  const answer = (result?: string | boolean) => {
    void window.electronAPI.piExtension.answerPrompt(request.id, result);
    setQueue((current) => current.filter((item) => item.id !== request.id));
  };

  return (
    <Modal tier="modal" overlayClassName="bg-black/40 flex items-center justify-center" onClose={() => answer()}>
      <div className="modal-card bg-surface-elevated shadow-xl rounded-[var(--radius-xl)] w-[min(420px,calc(100vw-32px))] p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-text-primary">{request.title}</h3>
          {request.kind === "confirm" && <p className="text-xs text-text-secondary mt-2 whitespace-pre-wrap">{request.message}</p>}
          <p className="text-[length:var(--text-3xs)] text-text-muted mt-2">Pi 扩展请求交互</p>
        </div>
        {request.kind === "input" && (
          <input autoFocus className="w-full rounded-[var(--radius-lg)] bg-surface px-3 py-2 text-sm text-text-primary outline-none" placeholder={request.message} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") answer(value); }} />
        )}
        {request.kind === "select" && (
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {(request.options ?? []).map((option) => (
              <button type="button" key={option} className="block w-full text-left px-3 py-2 text-xs text-text-primary rounded-[var(--radius-lg)] hover:bg-surface-hover" onClick={() => answer(option)}>{option}</button>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="px-4 py-2 text-xs text-text-secondary hover:bg-surface-hover rounded-[var(--radius-lg)]" onClick={() => answer()}>取消</button>
          {request.kind !== "select" && <button type="button" className="btn-accent px-4 py-2 text-xs" onClick={() => answer(request.kind === "confirm" ? true : value)}>确定</button>}
        </div>
      </div>
    </Modal>
  );
}
