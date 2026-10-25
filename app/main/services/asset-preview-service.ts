import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import http, { type Server } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".pdf": "application/pdf",
};

interface PreviewServer { server: Server; origin: string }
const previews = new Map<string, Promise<PreviewServer>>();

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function publicPath(root: string, target: string): boolean {
  if (!inside(root, target)) return false;
  const parts = path.relative(root, target).split(path.sep);
  // The generated design gallery is a preview asset; other hidden configuration stays private.
  return parts.every((part, index) => !part.startsWith(".") ||
    (index === 0 && part === ".easymint" && parts[1] === "design"));
}

async function previewFile(root: string, file: string): Promise<string> {
  if (!publicPath(root, file)) throw new Error("预览路径必须位于项目内，且不能指向隐藏配置");
  const resolved = await realpath(file);
  if (!publicPath(root, resolved) || !(await stat(resolved)).isFile()) throw new Error("预览文件不可访问");
  if (!MIME[path.extname(resolved).toLowerCase()]) throw new Error("不支持预览此文件类型");
  return resolved;
}

async function startServer(root: string): Promise<PreviewServer> {
  const server = http.createServer((request, response) => {
    void (async () => {
      const address = server.address();
      if (!address || typeof address === "string") { response.writeHead(503).end(); return; }
      const host = `127.0.0.1:${address.port}`;
      const origin = `http://${host}`;
      // Keep project assets local, including against DNS rebinding and cross-site fetches.
      if (request.headers.host !== host || (request.headers.origin && request.headers.origin !== origin)
        || request.headers["sec-fetch-site"] === "cross-site") { response.writeHead(403).end(); return; }
      if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, { Allow: "GET, HEAD" }).end(); return; }
      const pathname = decodeURIComponent(new URL(request.url ?? "/", origin).pathname);
      if (pathname.includes("\\") || pathname.includes("\0")) { response.writeHead(400).end(); return; }
      const target = path.resolve(root, `.${pathname}`);
      const file = await previewFile(root, pathname.endsWith("/") ? path.join(target, "index.html") : target);
      response.writeHead(200, {
        "Content-Type": MIME[path.extname(file).toLowerCase()]!,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Content-Security-Policy": "frame-ancestors 'self'",
      });
      if (request.method === "HEAD") response.end();
      else await pipeline(createReadStream(file), response);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(404).end();
      else response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => { reject(error); };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => { server.off("error", onError); resolve(); });
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法创建本地预览地址");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

/** Serve saved HTML without running project code or requiring an external runtime. */
export async function createAssetPreview(projectPath: string, filePath: string): Promise<{ url: string; filePath: string }> {
  const root = await realpath(projectPath);
  const project = path.resolve(projectPath);
  const input = path.resolve(project, filePath);
  if (!inside(project, input)) throw new Error("预览路径必须位于项目内");
  const requested = path.resolve(root, path.relative(project, input));
  const file = await previewFile(root, requested);
  if (![".html", ".htm"].includes(path.extname(file).toLowerCase())) throw new Error("请选择静态 HTML 页面；框架应用请使用其开发服务地址");
  let pending = previews.get(root);
  if (!pending) {
    pending = startServer(root);
    previews.set(root, pending);
    void pending.catch(() => { if (previews.get(root) === pending) previews.delete(root); });
  }
  const { origin } = await pending;
  const relative = path.relative(root, requested).split(path.sep).map(encodeURIComponent).join("/");
  return { url: `${origin}/${relative}`, filePath: requested };
}

export async function closeAssetPreviews(): Promise<void> {
  const pending = [...previews.values()];
  previews.clear();
  await Promise.all(pending.map(async item => {
    const preview = await item.catch(() => undefined);
    if (!preview) return;
    await new Promise<void>((resolve, reject) => {
      preview.server.close(error => { if (error) reject(error); else resolve(); });
      preview.server.closeAllConnections();
    });
  }));
}
