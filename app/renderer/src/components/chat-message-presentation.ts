import type { ChatMessage } from "./chat-utils";

/** Presentation only: never merge messages, entries or their context/action targets.
 * Called for visible rows, so streaming does not rescan the entire conversation.
 */
export function startsMessageIdentity(messages: readonly ChatMessage[], index: number): boolean {
  const message = messages[index];
  if (!message || message.role !== "ai" || !message.entries?.length) return true;
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const previous = messages[cursor]!;
    if (previous.role !== "ai") return true;
    // Empty streaming placeholders are not rendered and must not consume a heading.
    if (!previous.entries?.length) continue;
    return previous.agentRole !== message.agentRole
      || previous.model !== message.model
      || previous.provider !== message.provider
      || !!previous.forwarded || !!message.forwarded
      || !!previous.outOfContext || !!message.outOfContext
      || !!previous.imageStripped || !!message.imageStripped
      || previous.customType !== message.customType;
  }
  return true;
}
