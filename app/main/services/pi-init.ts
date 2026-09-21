/** Runtime and UI read the same pi-native configuration. No startup file generation. */
import { Store } from "./store";
import { getSettingsManagerClass } from "./pi-sdk";
import { getNativeConfig } from "./native-config";
import type { Model } from "@earendil-works/pi-ai";

export async function getModelRuntime(store: Store) {
  return (await getNativeConfig(store)).getRuntime();
}

export async function getSettingsManager(cwd: string, agentDir: string) {
  const SM = await getSettingsManagerClass();
  const mgr = await SM.create(cwd, agentDir);
  // EM's explicit compaction policy; does not rewrite imported settings.
  mgr.applyOverrides({ compaction: { enabled: true, reserveTokens: 4096 } });
  return mgr;
}

export async function getActiveModel(store: Store): Promise<Model<any> | null> {
  const repo = await getNativeConfig(store);
  await repo.getRuntime();
  return repo.getDefaultModel();
}

export async function getPiProviders(store = new Store()): Promise<Array<{ id: string; name: string; baseUrl?: string }>> {
  const rt = await getModelRuntime(store);
  return rt.getProviders().map(p => ({ id: p.id, name: p.name, baseUrl: rt.getModels(p.id)[0]?.baseUrl }));
}
export async function getPiModels(providerId: string, store = new Store()) {
  const rt = await getModelRuntime(store);
  return rt.getModels(providerId).map(m => ({ id: m.id, name: m.name, contextWindow: m.contextWindow }));
}
export async function getPiProviderInfo(providerId: string, store = new Store()) {
  const rt = await getModelRuntime(store);
  const provider = rt.getProvider(providerId);
  if (!provider) return null;
  const models = rt.getModels(providerId);
  return { name: provider.name, baseUrl: models[0]?.baseUrl, apis: [...new Set(models.map(m => m.api))] };
}
