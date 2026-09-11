/**
 * markdown 文件判定与相对资源路径解析（渲染层专用）。
 *
 * 为何不复用 app/shared/image-files.ts：那套的扩展名列表要主进程（file:readImage 放行）与
 * 渲染层共识，混进 markdown 判定会让主进程也背上无关语义；这里只服务渲染层的预览分流。
 */

/** markdown 扩展名（小写，不带点） */
const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(["md", "markdown"]);

/** 路径是否指向 markdown 文件（大小写不敏感；只看扩展名，不代表文件一定存在） */
export function isMarkdownPath(p: string): boolean {
  const ext = extOf(p);
  return ext !== null && MARKDOWN_EXTENSIONS.has(ext);
}

/** 取扩展名（小写，不含点）；无扩展名或形如 ".png" 的点文件返回 null */
function extOf(p: string): string | null {
  if (!p) return null;
  const base = p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  // dot <= 0：无扩展名，或文件名主干为空
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

/** 取所在目录（分隔符 / 与 \ 都认）；路径本身没有目录部分时返回 "" */
export function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : "";
}

/** 是否已是绝对路径（POSIX 的 / 开头，或 Windows 盘符） */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);
}

/** marked 会对 src 做 encodeURI，把反斜杠/空格等编码成 %5C / %20；
 *  解码失败（非法 % 序列，如路径里本就有 %）时退回原串，不让整条路径失效 */
function decodeSafe(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch (e) {
    console.warn("资源路径解码失败，按原样使用:", v, e);
    return v;
  }
}

/** 目录 + 相对路径拼接（渲染层没有 node:path；分隔符口径对齐 app/shared/image-files.ts：
 *  目录用 \ 还是 / 决定结果用哪种，Windows 反斜杠路径与 POSIX 路径都能拼对） */
function joinPath(dir: string, rel: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  // 保留首段（POSIX 根 ""、Windows 盘符 "C:"）——".." 回溯不能越过它
  const segs = dir.replace(/[\\/]+$/, "").split(/[\\/]/);
  for (const part of rel.split(/[\\/]/)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (segs.length > 1) segs.pop();
      continue;
    }
    segs.push(part);
  }
  return segs.join(sep);
}

/** 把 markdown 里的资源引用解析成磁盘绝对路径；不适用（外链、data:、锚点、已是绝对路径但缺目录信息）返回 null。
 *  返回 null 表示调用方应保持原样，不得当作解析失败处理 */
export function resolveRelativePath(baseDir: string, src: string): string | null {
  const raw = src.trim();
  if (!raw || raw.startsWith("#")) return null; // 空 src / 纯锚点：不是文件引用
  if (raw.startsWith("//")) return null; // 协议相对 → 外链
  const decoded = decodeSafe(raw);
  if (isAbsolutePath(decoded)) return decoded; // 绝对路径原样返回（主进程按绝对路径读取）
  // 带协议（http:/https:/data:/file: 等）→ 外部资源，交给渲染层自己处理。
  // 放在绝对路径判定之后：否则 Windows 的 "C:\..." 会被当成 scheme "c:"
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) return null;
  if (!baseDir) return null;
  return joinPath(baseDir, decoded);
}
