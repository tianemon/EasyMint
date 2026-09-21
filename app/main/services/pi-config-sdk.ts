/** The SDK does not export these file helpers publicly. Keep that dependency here,
 * covered by native-config integration tests when upgrading pi. */
import { createRequire } from "node:module";
import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

let pending: Promise<any> | undefined;
export function getPiConfigSdk(): Promise<any> {
  return pending ??= (async () => {
    const require = createRequire(path.join(__dirname, "pi-config-sdk.cjs"));
    const dist = (require.resolve.paths("@earendil-works/pi-coding-agent") ?? [])
      .map(root => path.join(root, "@earendil-works/pi-coding-agent/dist"))
      .find(root => existsSync(path.join(root, "core/auth-storage.js")));
    if (!dist) throw new Error("找不到 pi SDK 配置文件接口");
    const load = (file: string) => import(/* @vite-ignore */ pathToFileURL(path.join(dist, file)).href);
    const [auth, models, json, resolver] = await Promise.all([
      load("core/auth-storage.js"), load("core/model-config.js"), load("utils/json.js"), load("core/model-resolver.js"),
    ]);
    return { ...auth, ...models, ...json, findInitialModel: resolver.findInitialModel };
  })().catch(error => { pending = undefined; throw error; });
}
