import path from "node:path";
import { pathToFileURL } from "node:url";

/** 只生成原型目录 URL；HTML 元素交由编辑器中的 DOMParser 解析。 */
export function prototypeBaseUrl(baseDir: string): string {
  return pathToFileURL(path.resolve(baseDir) + path.sep).href;
}
