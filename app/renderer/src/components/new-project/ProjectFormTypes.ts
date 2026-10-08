import { uiText } from "../../lib/i18n";
import type { AIIntegration } from "../../../../shared/prompts";
import { useSettingsStore } from "../../stores/settings-store";

export type BudgetChoice = "充足" | "少量" | "免费";
export type DeployChoice = "云端" | "本地" | "混合";
export type CompletenessChoice = "full" | "mvp" | "demo";
export type SceneChoice = "practical" | "commercial" | "validation" | "interest" | "learning" | "experiment" | "unknown";

export interface FeatureItem {
  name: string;
}

export interface ProjectFormData {
  name: string;
  description: string;
  scene: SceneChoice;
  targets: string[];
  dir: string;
  completeness: CompletenessChoice;
  features: FeatureItem[];
  uiStyle: string;
  techBudget: BudgetChoice;
  deployPlatform: DeployChoice;
  aiIntegration: AIIntegration;
}

export const TARGET_OPTIONS = [
  { value: "web", get label() { return uiText("ui.ProjectFormTypes.webApp"); }, get desc() { return uiText("ui.ProjectFormTypes.accessibleInABrowserOnAnyDevice"); } },
  { value: "wechat-miniprogram", get label() { return uiText("ui.ProjectFormTypes.wechatMiniProgram"); }, get desc() { return uiText("ui.ProjectFormTypes.runsInsideWechatWithoutInstallation"); } },
  { value: "ios-mobile", get label() { return uiText("ui.ProjectFormTypes.iosApp"); }, get desc() { return uiText("ui.ProjectFormTypes.nativeIphoneIpadApp"); } },
  { value: "android-mobile", get label() { return uiText("ui.ProjectFormTypes.androidApp"); }, get desc() { return uiText("ui.ProjectFormTypes.nativeAndroidPhoneTabletApp"); } },
  { value: "windows-desktop", get label() { return uiText("ui.ProjectFormTypes.windowsDesktopApp"); }, get desc() { return uiText("ui.ProjectFormTypes.nativeWindowsDesktopApp"); } },
  { value: "macos-desktop", get label() { return uiText("ui.ProjectFormTypes.macosDesktopApp"); }, get desc() { return uiText("ui.ProjectFormTypes.nativeMacDesktopApp"); } },
  { value: "linux-desktop", get label() { return uiText("ui.ProjectFormTypes.linuxDesktopApp"); }, get desc() { return uiText("ui.ProjectFormTypes.nativeLinuxDesktopApp"); } },
  { value: "cli", get label() { return uiText("ui.ProjectFormTypes.commandLineTool"); }, get desc() { return uiText("ui.ProjectFormTypes.crossPlatformTerminalTool"); } },
] as const;

export const SCENE_OPTIONS = [
  { value: "practical", get label() { return uiText("ui.ProjectFormTypes.forMyselfOrMyTeamReadyFor"); }, get desc() { return uiText("ui.ProjectFormTypes.practicalUse"); } },
  { value: "commercial", get label() { return uiText("ui.ProjectFormTypes.launchOrSellAProduct"); }, get desc() { return uiText("ui.ProjectFormTypes.commercialDelivery"); } },
  { value: "validation", get label() { return uiText("ui.ProjectFormTypes.buildSomethingToValidateAnIdea"); }, get desc() { return uiText("ui.ProjectFormTypes.ideaValidation"); } },
  { value: "interest", get label() { return uiText("ui.ProjectFormTypes.createForFunOrExploreAnInterest"); }, get desc() { return uiText("ui.ProjectFormTypes.personalInterest"); } },
  { value: "learning", get label() { return uiText("ui.ProjectFormTypes.learnAiCodingAsIBuild"); }, get desc() { return uiText("ui.ProjectFormTypes.learningByDoing"); } },
  { value: "experiment", get label() { return uiText("ui.ProjectFormTypes.testWhetherATechnologyWorks"); }, get desc() { return uiText("ui.ProjectFormTypes.technicalExperiment"); } },
  { value: "unknown", get label() { return uiText("ui.ProjectFormTypes.notSureLetAiDecide"); }, get desc() { return uiText("ui.ProjectFormTypes.mintWillClarifyInConversation"); } },
] as const;

export const COMPLETENESS_OPTIONS = [
  { value: "full", get label() { return uiText("ui.ProjectFormTypes.fullVersion"); }, get desc() { return uiText("ui.ProjectFormTypes.completeFeaturesReadyToLaunch"); } },
  { value: "mvp", label: "MVP", get desc() { return uiText("ui.ProjectFormTypes.minimumViableProductToValidateTheCore"); } },
  { value: "demo", get label() { return uiText("ui.ProjectFormTypes.demo"); }, get desc() { return uiText("ui.ProjectFormTypes.prototypeWithWorkingCoreFlows"); } },
] as const;

export const UI_STYLE_OPTIONS = [
  { value: "minimalism", get label() { return uiText("ui.ProjectFormTypes.minimalism"); }, get desc() { return uiText("ui.ProjectFormTypes.cleanLayoutsAndGenerousWhitespaceForA"); } },
  { value: "flat", get label() { return uiText("ui.ProjectFormTypes.flatDesign"); }, get desc() { return uiText("ui.ProjectFormTypes.solidColorsAndClearHierarchyForSaas"); } },
  { value: "glass", get label() { return uiText("ui.ProjectFormTypes.glassmorphism"); }, get desc() { return uiText("ui.ProjectFormTypes.frostedTranslucentSurfacesForOverlaysAndDialogs"); } },
  { value: "liquid-glass", get label() { return uiText("ui.ProjectFormTypes.liquidGlass"); }, get desc() { return uiText("ui.ProjectFormTypes.dynamicRefractionAndLightingInspiredByIos"); } },
  { value: "material", label: "Material Design", get desc() { return uiText("ui.ProjectFormTypes.googleSDesignLanguageWithLayeredSurfaces"); } },
  { value: "neumorphism", get label() { return uiText("ui.ProjectFormTypes.neumorphism"); }, get desc() { return uiText("ui.ProjectFormTypes.softDimensionalSurfacesForSwitchesAndCards"); } },
  { value: "claymorphism", get label() { return uiText("ui.ProjectFormTypes.claymorphism"); }, get desc() { return uiText("ui.ProjectFormTypes.roundedJellyLikeFormsInPlayfulPastel"); } },
  { value: "skeuomorphism", get label() { return uiText("ui.ProjectFormTypes.skeuomorphism"); }, get desc() { return uiText("ui.ProjectFormTypes.familiarRealWorldTexturesLeatherMetalAnd"); } },
  { value: "business", get label() { return uiText("ui.ProjectFormTypes.professional"); }, get desc() { return uiText("ui.ProjectFormTypes.whiteAndBlueOrderlyGridsForB2b"); } },
  { value: "luxury", get label() { return uiText("ui.ProjectFormTypes.luxury"); }, get desc() { return uiText("ui.ProjectFormTypes.blackWhiteAndGoldWithFineLines"); } },
  { value: "bento", get label() { return uiText("ui.ProjectFormTypes.bentoGrid"); }, get desc() { return uiText("ui.ProjectFormTypes.roundedModularCardsForDashboards"); } },
  { value: "colorful", get label() { return uiText("ui.ProjectFormTypes.vibrantColors"); }, get desc() { return uiText("ui.ProjectFormTypes.brightSaturatedColorsWithYouthfulEnergy"); } },
  { value: "retro", get label() { return uiText("ui.ProjectFormTypes.retro"); }, get desc() { return uiText("ui.ProjectFormTypes.boldContrastingColorsAndThickBordersY2k"); } },
  { value: "soft", get label() { return uiText("ui.ProjectFormTypes.softAndCalm"); }, get desc() { return uiText("ui.ProjectFormTypes.mutedEarthyColorsForAGentleRelaxed"); } },
  { value: "editorial", get label() { return uiText("ui.ProjectFormTypes.editorial"); }, get desc() { return uiText("ui.ProjectFormTypes.largeHeadlinesAndImagesWithGenerousWhitespace"); } },
  { value: "dark", get label() { return uiText("ui.ProjectFormTypes.dark"); }, get desc() { return uiText("ui.ProjectFormTypes.darkBackgroundsForAnImmersiveAtmosphere"); } },
  { value: "tech", get label() { return uiText("ui.ProjectFormTypes.futuristic"); }, get desc() { return uiText("ui.ProjectFormTypes.darkLightingEffectsAnd3dSpace"); } },
  { value: "custom", get label() { return uiText("ui.ProjectFormTypes.custom"); }, get desc() { return uiText("ui.ProjectFormTypes.describeTheLookYouWant"); } },
] as const;

export const BUDGET_OPTIONS = [
  { value: "充足", get label() { return uiText("ui.ProjectFormTypes.flexible"); }, get desc() { return uiText("ui.ProjectFormTypes.prioritizeResultsAndExperience"); } },
  { value: "少量", get label() { return uiText("ui.ProjectFormTypes.limited"); }, get desc() { return uiText("ui.ProjectFormTypes.controlCostsWithModestPaidServices"); } },
  { value: "免费", get label() { return uiText("ui.ProjectFormTypes.free"); }, get desc() { return uiText("ui.ProjectFormTypes.useOnlyFreeAndOpenSourceOptions"); } },
] as const;

export const ALL_STEPS = [
  { number: 1, get title() { return uiText("ui.ProjectFormTypes.basicInformation"); }, get desc() { return uiText("ui.ProjectFormTypes.nameDescriptionUseCaseAndUsers"); } },
  { number: 2, get title() { return uiText("ui.ProjectFormTypes.features"); }, get desc() { return uiText("ui.ProjectFormTypes.coreFeaturesMintCanSuggestThem"); } },
  { number: 3, get title() { return uiText("ui.ProjectFormTypes.uiStyle"); }, get desc() { return uiText("ui.ProjectFormTypes.chooseAVisualStyleOrAskMint"); } },
  { number: 4, get title() { return uiText("ui.ProjectFormTypes.delivery"); }, get desc() { return uiText("ui.ProjectFormTypes.completenessDeploymentAiAndCost"); } },
];

export const DEFAULT_DATA: ProjectFormData = {
  name: "",
  description: "",
  scene: "unknown",
  targets: ["web"],
  dir: useSettingsStore.getState().defaultProjectDir || "~/EasyMintProject",
  completeness: "mvp",
  features: [],
  uiStyle: "",
  techBudget: "少量",
  deployPlatform: "本地",
  aiIntegration: "none",
};
