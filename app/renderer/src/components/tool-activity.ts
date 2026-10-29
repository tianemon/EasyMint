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

/** Shared wording for the live status and completed process, without dropping search terms. */
export function toolActivity(name: string, input: unknown, state: ActivityState = "running") {
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
