import { AgentTemplateSettings } from "../AgentTemplateSettings";

/** Agent 设置:Agent 模板 */
export function AgentTab(): JSX.Element {
  return (
    <div className="space-y-5">
      <AgentTemplateSettings />
    </div>
  );
}
