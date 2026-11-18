export interface MainChatProfile {
  nickname: string;
  userAddress: string;
  avatar: string;
  personality: string;
  rules: string;
}

export interface CollaborationMode {
  id: string;
  name: string;
  scenario: string;
  prompt: string;
  defaultEnabled: boolean;
  builtin: boolean;
  revision?: string;
  customizedFields?: Array<"name" | "scenario">;
}

export interface ConversationConfig {
  main: MainChatProfile;
  modes: CollaborationMode[];
  mainRevision?: string;
  warning?: string;
}

export const CONVERSATION_CONFIG_FILE = "system-prompts-v2.json";
export const UI_DESIGN_MODE_ID = "ui-design";
export const DOMAIN_GUIDANCE_MODE_ID = "domain-guidance";
export const CONVERSATION_SETTINGS_MESSAGE_TYPE = "easymint_conversation_settings";

export const BUILTIN_MODE_KEYS: Record<string, { name: string; scenario: string }> = {
  [UI_DESIGN_MODE_ID]: { name: "collaboration.uiDesign", scenario: "collaboration.uiDesignScenario" },
  [DOMAIN_GUIDANCE_MODE_ID]: { name: "collaboration.domainGuidance", scenario: "collaboration.domainGuidanceScenario" },
};
