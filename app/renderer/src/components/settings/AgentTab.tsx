import { AgentTemplateSettings } from "../AgentTemplateSettings";
import { useState } from "react";
import { CollaborationSettings } from "./ConversationSettings";
import { uiText, useUiLocale } from "../../lib/i18n";

/** Agent 设置:Agent 模板 */
export function AgentTab(): JSX.Element {
  useUiLocale();
  const [tab, setTab] = useState<"templates" | "modes">("templates");
  return (
    <div className="space-y-5">
      <div className="flex gap-4 border-b border-border pb-2">
        <button onClick={() => setTab("templates")} className={`text-xs ${tab === "templates" ? "text-accent" : "text-text-secondary"}`}>{uiText("ui.AgentTemplateSettings.agentTemplates")}</button>
        <button onClick={() => setTab("modes")} className={`text-xs ${tab === "modes" ? "text-accent" : "text-text-secondary"}`}>{uiText("collaboration.title")}</button>
      </div>
      {tab === "templates" ? <AgentTemplateSettings /> : <CollaborationSettings />}
    </div>
  );
}
