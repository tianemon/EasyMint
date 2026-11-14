export interface MainChatProfile {
  nickname: string;
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
}

export interface ConversationConfig {
  main: MainChatProfile;
  modes: CollaborationMode[];
}

export const DEFAULT_MAIN_CHAT: MainChatProfile = {
  nickname: "Mint",
  avatar: "",
  personality: "直接、务实、不啰嗦，把复杂问题讲简单；用户不确定时帮用户选，但让用户知道为什么这么选。",
  rules: "",
};

export const UI_DESIGN_MODE_ID = "ui-design";
export const DOMAIN_GUIDANCE_MODE_ID = "domain-guidance";

export const BUILTIN_MODE_DISPLAY: Record<string, { name: string; scenario: string; nameKey: string; scenarioKey: string }> = {
  [UI_DESIGN_MODE_ID]: {
    name: "UI 设计",
    scenario: "设计新界面、制作交互原型，或调整现有页面的视觉与布局时。",
    nameKey: "collaboration.uiDesign",
    scenarioKey: "collaboration.uiDesignScenario",
  },
  [DOMAIN_GUIDANCE_MODE_ID]: {
    name: "领域引导",
    scenario: "进入陌生或不熟悉的领域，希望边推进任务边理解准备、路径与取舍时。",
    nameKey: "collaboration.domainGuidance",
    scenarioKey: "collaboration.domainGuidanceScenario",
  },
};
