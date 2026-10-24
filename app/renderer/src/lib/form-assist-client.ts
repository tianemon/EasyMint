import type { FormAssistKind, FormAssistRequest } from "../../../shared/form-assist";

interface FormAssistAPI {
  formAssist(request: FormAssistRequest): Promise<string>;
  cancelFormAssist(requestId: string): Promise<void>;
}

/** Serialize form requests and invalidate queued/late replies when the dialog closes. */
export function createFormAssistClient(api: FormAssistAPI, nextId: () => string = () => crypto.randomUUID()) {
  const pending = new Set<string>();
  let generation = 0;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    ask(kind: FormAssistKind, prompt: string): Promise<string> {
      const ownGeneration = generation;
      const work = queue.then(async () => {
        if (ownGeneration !== generation) return "";
        const requestId = nextId();
        pending.add(requestId);
        try {
          const reply = await api.formAssist({ requestId, kind, prompt });
          return ownGeneration === generation ? reply : "";
        } catch (error) {
          if (ownGeneration !== generation) return "";
          throw error;
        } finally { pending.delete(requestId); }
      });
      queue = work.catch(() => undefined);
      return work;
    },
    dispose(): void {
      generation++;
      for (const requestId of pending) void api.cancelFormAssist(requestId).catch(error => console.warn("[form-assist] cancellation failed:", error));
      pending.clear();
      queue = Promise.resolve();
    },
  };
}
