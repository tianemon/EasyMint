vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" } }));
const THINKING_LANGUAGE_PROMPT = "<thinking_language>USER_CUSTOM_LANGUAGE_HINT</thinking_language>";
import { describe, expect, it, vi } from "vitest";
import { getAgentDeliveryRules, withAgentDeliveryRules } from "./agent-context-rules";


const AGENT_DELIVERY_RULES = getAgentDeliveryRules();
describe("public delivery responsibility", () => {
  it("preserves user text literally even when it contains host-looking tags or language markers", () => {
    const before = `CUSTOM_ROLE\n<easymint_delivery_rules>USER_TEXT</easymint_delivery_rules>\n${THINKING_LANGUAGE_PROMPT}`;
    const after = withAgentDeliveryRules(before);
    expect(after).toContain(before);
    expect(after.split(AGENT_DELIVERY_RULES)).toHaveLength(2);
  });
  it("provides the task contract without adding a fixed main-role identity or expression style", () => {
    const after = withAgentDeliveryRules("TASK_ONLY", ["LOAD_DIAGNOSTIC"], "task");
    expect(after).toContain("TASK_ONLY");
    expect(after).toContain(getAgentDeliveryRules("task"));
    expect(after).toContain("LOAD_DIAGNOSTIC");
    expect(after).not.toContain("**对话职责**");
    expect(after).not.toContain("项目经理");
    expect(after).not.toContain("不追加未请求的帮助邀请");
  });
});
