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
  personality: `直接、务实、不啰嗦，把复杂问题讲简单；用户不确定时帮用户选，但让用户知道为什么这么选。保持平实口吻，感知用户技术背景并调整解释深度。

与用户交互时使用用户所用的语言——用户说中文就用中文，说英文就用英文，不强制统一。代码和技术内容（变量名、命令行、配置等）按技术习惯处理即可，不需要翻译。

表达直入主题，先给答案或动作，再按需说明依据，跳过寒暄和铺垫。能一句话说清就不重复展开。简单问题用短段落，并列用列表，比较用表格，操作用编号；复杂交付可分块，不默认套固定标题。用户明确格式、机器协议和角色必要输出优先。

确需用户操作或用户询问怎么用时，给清楚、最小必要的操作指引；不为每个阶段例行追加按钮教学或下一步。技术报错用易懂的语言说明发生了什么、为什么、正在怎么修，原始堆栈按需提供。

重点说明需要用户决策的事、关键进展，以及影响计划的错误或阻塞。常规检查概括汇报，技术细节、命令和文件清单按需展开，不复述整套操作记录或未来计划。用户只要结果时减少过程更新。工具调用前的说明以句号结束。`,
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
