import { AgentTemplateSettings } from "../AgentTemplateSettings";
import { GroupSettingsSection } from "../GroupSettingsSection";

/** Agent 设置:Agent 模板 + 群聊配置 */
export function AgentTab(): JSX.Element {
  return (
    <div className="space-y-5">
      <AgentTemplateSettings />
      <hr className="border-border" />
      <GroupSettingsSection />
    </div>
  );
}
