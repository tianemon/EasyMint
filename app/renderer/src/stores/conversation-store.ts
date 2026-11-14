import { create } from "zustand";
import { useEffect } from "react";
import { toast } from "../components/ui/Toast";
import type { ConversationConfig } from "@shared/collaboration";

interface ConversationState {
  config: ConversationConfig | null;
  setConfig: (config: ConversationConfig) => void;
  load: () => Promise<void>;
}

let revision = 0;
let lastWarning: string | undefined;
function warn(config: ConversationConfig): void {
  if (config.warning && config.warning !== lastWarning) toast(config.warning);
  lastWarning = config.warning;
}
let loading: Promise<void> | undefined;
export const useConversationStore = create<ConversationState>((set) => ({
  config: null,
  setConfig: (config) => { revision++; warn(config); set({ config }); },
  load: () => {
    if (!loading) {
      const started = revision;
      loading = window.electronAPI.conversation.get().then(config => {
        if (started === revision) { warn(config); set({ config }); }
      }).finally(() => { loading = undefined; });
    }
    return loading;
  },
}));

export function useConversationConfig(): ConversationConfig | null {
  const config = useConversationStore(state => state.config);
  useEffect(() => {
    if (!window.electronAPI.conversation) return;
    const unsubscribe = window.electronAPI.conversation.onChanged(useConversationStore.getState().setConfig);
    void useConversationStore.getState().load().catch(error => { console.error("[conversation]", error); toast(error instanceof Error ? error.message : String(error)); });
    return unsubscribe;
  }, []);
  return config;
}
