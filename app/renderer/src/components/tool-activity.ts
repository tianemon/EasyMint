import { uiText } from "../lib/i18n";

export type ActivityState = "running" | "done" | "failed" | "cancelled" | "unfinished";
export type ToolAction = "read" | "edit" | "write" | "search" | "list" | "find" | "command" | "fetch" | "webSearch" | "skill" | "delegate" | "ask" | "image" | "script" | "external";

const aliases: Record<string, ToolAction> = {
  read: "read", edit: "edit", write: "write", grep: "search", ls: "list", find: "find", glob: "find",
  bash: "command", powershell: "command", web_fetch: "fetch", webfetch: "fetch", web_search: "webSearch", websearch: "webSearch",
  use_skill: "skill", task: "delegate", ask_user: "ask", generate_image: "image", describe_image: "image", codemode: "script",
};
const icons: Record<ToolAction, string> = { read: "read", edit: "edit", write: "write", search: "grep", list: "ls", find: "find", command: "bash", fetch: "web_fetch", webSearch: "web_search", skill: "use_skill", delegate: "task", ask: "ask_user", image: "generate_image", script: "bash", external: "call_mcp_tool" };
const rawText = (value: unknown): string => typeof value === "string" ? value : "";
const oneLine = (value: unknown): string => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path;
export const toolArguments = (input: unknown): Record<string, unknown> => input !== null && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};

/** Retired names still describe historical calls; both current families share action semantics. */
export function knowledgeToolLabel(name: string, input: unknown): string | null {
  const family = name.toLowerCase();
  if (!["memory", "experience", "learn", "search_experiences"].includes(family)) return null;
  const experience = family !== "memory";
  const action = family === "learn" ? "save" : family === "search_experiences" ? "search" : String(toolArguments(input).action ?? "");
  const keys: Record<string, string> = experience
    ? { save: "experience.save", search: "experience.search", read: "experience.read", update: "experience.update", forget: "experience.forget", archive: "experience.invalidate", invalidate: "experience.invalidate", restore: "experience.restore" }
    : { save: "memory.add", search: "memory.search", read: "ui.ChatBlocks.view", update: "memory.edit", forget: "memory.forget", edit: "memory.edit", archive: "memory.archive", restore: "memory.restore", accept: "memory.accept", reject: "memory.reject", merge: "memory.merge", cancel: "memory.cancelScheduled", read_summary: "memory.readSummary", write_summary: "memory.writeSummary" };
  return uiText(keys[action] ?? (experience ? "experience.title" : "memory.title"));
}

/** Shared wording for the live status and completed process, without dropping search terms. */
export function toolActivity(name: string, input: unknown, state: ActivityState = "running") {
  if (name === "offer_domain_guidance") {
    const label = uiText("collaboration.offer");
    const text = ["failed", "cancelled", "unfinished"].includes(state) ? uiText(`ui.ToolActivity.${state}`, { action: label }) : label;
    return { text, fullText: text, icon: "ask_user", action: "ask" as const, label };
  }
  const knowledge = knowledgeToolLabel(name, input);
  if (knowledge) {
    const verb = ["failed", "cancelled", "unfinished"].includes(state)
      ? uiText(`ui.ToolActivity.${state}`, { action: knowledge })
      : uiText(`ui.ToolActivity.knowledge.${state === "running" ? "running" : "done"}`, { action: knowledge });
    const query = rawText(toolArguments(input).query);
    const text = oneLine([verb, query].filter(Boolean).join(" "));
    return { text, fullText: text, icon: name.toLowerCase() === "memory" ? "memory" : "experience", action: "external" as const, label: knowledge };
  }
  const args = toolArguments(input);
  const action = aliases[name.toLowerCase()] ?? "external";
  const path = rawText(args.path ?? args.file_path ?? args.directory);
  const query = rawText(args.pattern ?? args.query ?? args.search_pattern);
  let target = "", fullTarget = "";
  if (["read", "edit", "write", "list", "find"].includes(action)) {
    fullTarget = path || rawText(args.pattern ?? args.glob);
    target = basename(fullTarget);
  } else if (action === "search") {
    target = query ? uiText("ui.ToolActivity.searchTarget", { query, path: basename(path) || "." }) : basename(path);
    fullTarget = query ? uiText("ui.ToolActivity.searchTarget", { query, path: path || "." }) : path;
  } else if (action === "command") target = fullTarget = rawText(args.command ?? args.cmd ?? args.script);
  else if (action === "fetch") target = fullTarget = rawText(args.url);
  else if (action === "webSearch") target = fullTarget = query;
  else if (action === "skill") target = fullTarget = rawText(args.name ?? args.skill);
  else if (action === "delegate") target = fullTarget = rawText(args.description ?? args.title ?? args.agent);
  else if (action === "external") target = fullTarget = rawText(args.toolName ?? args.tool_name ?? args.name) || name;
  const label = uiText(`ui.ToolActivity.${action}.label`);
  const verb = state === "failed" || state === "cancelled" || state === "unfinished"
    ? uiText(`ui.ToolActivity.${state}`, { action: label })
    : uiText(`ui.ToolActivity.${action}.${state === "running" ? "running" : "done"}`);
  const format = (value: string) => [verb, value].filter(Boolean).join(" ");
  return { text: oneLine(format(target)), fullText: format(fullTarget), icon: icons[action], action, label };
}
