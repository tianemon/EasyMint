import { AgentTemplateSettings } from "../AgentTemplateSettings";
import { useState } from "react";
import { CollaborationSettings } from "./ConversationSettings";
import { uiText, useUiLocale } from "../../lib/i18n";

/** Agent 设置:Agent 模板 */
export function AgentTab(): JSX.Element {
  useUiLocale();
  const [tab, setTab] = useState<"templates" | "modes">("templates");
  return (
    <div className="space-y-1.5">
      <div className="flex justify-center px-6">
        <div className="inline-flex rounded-[var(--radius-lg)] overflow-hidden">
          {(["templates", "modes"] as const).map(value => <button key={value} type="button" aria-pressed={tab === value}
            onClick={() => setTab(value)} className={`px-4 py-1.5 text-xs font-medium transition-colors ${tab === value
              ? "bg-[color-mix(in_oklab,var(--color-accent)_15%,transparent)] text-accent"
              : "text-text-secondary hover:bg-surface-hover"}`}>
            {uiText(value === "templates" ? "ui.AgentTemplateSettings.agentTemplates" : "collaboration.title")}
          </button>)}
        </div>
      </div>
      {tab === "templates" ? <AgentTemplateSettings /> : <CollaborationSettings />}
    </div>
  );
}
