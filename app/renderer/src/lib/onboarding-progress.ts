export const PROJECT_CREATION_GUIDE_KEY = "easymint_new_project_guide_v1";
export const PROJECT_CREATION_GUIDE_REPLAY_KEY = "easymint_new_project_guide_replay_v1";

type ProgressStorage = Pick<Storage, "setItem" | "removeItem">;

/** The main setting must succeed before changing local progress or requesting a replay. */
export async function resetOnboardingProgress(setSetupComplete: (value: boolean) => Promise<unknown>, storage: ProgressStorage = localStorage, session: Pick<Storage, "setItem"> = sessionStorage): Promise<void> {
  await setSetupComplete(false);
  storage.removeItem("easymint_setup_complete");
  session.setItem(PROJECT_CREATION_GUIDE_REPLAY_KEY, "true");
}

export function projectCreationGuideMode(projectId: string, progress: string | null, replayRequested = false): "replay" | "automatic" | "off" {
  if (replayRequested) return "replay";
  return !projectId && !progress ? "automatic" : "off";
}
