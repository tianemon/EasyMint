import { toolPresentation, type ToolPresentation } from "@shared/tool-presentation";
import { appText, uiText, uiI18n } from "./i18n";

export function toolResultText(content: string, presentation?: ToolPresentation, isError = false): string {
  const block = presentation ?? toolPresentation(content, undefined, isError);
  if (block?.kind !== "permission_denied") return content;
  const mode = block.mode === "readonly" ? uiText("ui.ChatInput.readOnly")
    : block.mode === "full" ? uiText("ui.ChatInput.fullAccess")
    : block.mode === "standard" ? uiText("ui.ChatInput.standard") : appText(block.mode) || "—";
  const detail = appText(block.detail);
  const explanation = uiI18n.language === "en" && /\p{Script=Han}/u.test(detail)
    ? uiText("permission.denied") : detail;
  return [
    uiText("permission.blocked", { detail: explanation }),
    uiText("permission.mode", { value: mode }),
    uiText("permission.operation", { value: block.operation }),
    uiText("permission.target", { value: block.target }),
    uiText("permission.rule", { value: block.rule }),
    uiText("permission.phase"),
  ].join("\n");
}
