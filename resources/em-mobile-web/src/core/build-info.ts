/**
 * 构建标记：用来回答「手机加载的到底是哪一次构建」。
 *
 * 网页由桌面端主进程静态托管，改完重新 `npm run build` 就换包；但主屏 web app 是
 * 恢复式启动（不重新加载文档），看起来就像「改了没生效」。设置页显示构建时刻，只能说明
 * 「我这一份是几点打的」，看不出服务端有没有更新的包 —— 所以再加一次自检：
 * 用 no-store 拉一次 `./`（当前托管目录的 index.html），比对入口脚本 URL。
 * 不一致 = 手机手里的是旧文档，重开页面即可。
 */
declare const __EM_BUILD__: string;

export const BUILD_STAMP: string = typeof __EM_BUILD__ === 'string' ? __EM_BUILD__ : 'dev';

/** 从 index.html 文本里取入口脚本地址；取不到返回 null（不认识的结构就当没有结论）。 */
export function entryScriptFromHtml(html: string): string | null {
  const match = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/i)
    ?? html.match(/<script[^>]*src="([^"]+)"[^>]*type="module"/i);
  return match ? match[1] : null;
}

/** 当前文档实际加载的入口脚本地址（由浏览器给出，通常是 ./assets/index-<hash>.js）。 */
export function currentEntryScript(): string | null {
  if (typeof document === 'undefined') return null;
  const script = document.querySelector('script[type="module"][src]');
  return script?.getAttribute('src') ?? null;
}

/**
 * 手机手里的文档是否落后于服务端。任何一步失败都返回 false：
 * 自检不可用不该在设置页里报「有新版本」这种吓人的结论。
 */
export async function isStaleBundle(fetchImpl: typeof fetch | undefined = globalThis.fetch): Promise<boolean> {
  if (!fetchImpl) return false;
  try {
    const own = currentEntryScript();
    if (!own) return false;
    const response = await fetchImpl('./', { cache: 'no-store' });
    if (!response.ok) return false;
    const fresh = entryScriptFromHtml(await response.text());
    return !!fresh && fresh !== own;
  } catch {
    return false;
  }
}
