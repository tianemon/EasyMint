import type { ConfirmDevelopmentRequest } from "../../../shared/creation-flow";

export function matchesConfirmDevelopment(request: ConfirmDevelopmentRequest | null | undefined, projectPath: string, sessionId: string | null): boolean {
  return !!request && request.projectPath === projectPath && request.sessionId === sessionId;
}
export interface ConfirmationEntry { kind: string; id?: string; name?: string; toolUseId?: string; isError?: boolean; content?: string }
export function confirmationStart(messages: Array<{ role: string }>): number {
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index]!.role === "user") return index + 1;
  return 0;
}
export function confirmationEntries(messages: Array<{ role: string; entries?: ConfirmationEntry[] }>): ConfirmationEntry[] {
  const start = confirmationStart(messages);
  return messages.slice(start).filter(message => message.role === "ai").flatMap(message => message.entries ?? []);
}
/** Restore only completed, successful tool requests, never a pending or failed call. */
export function hasConfirmDevelopment(entries: ConfirmationEntry[]): boolean {
  return entries.some(entry => entry.kind === "tool_use" && entry.name === "show_confirm_dev" && !!entry.id && entries.some(result => result.kind === "tool_result" && result.toolUseId === entry.id && !result.isError && ["ok", "Development confirmation ready"].includes(result.content ?? "")));
}
