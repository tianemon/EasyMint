import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeAssetPreviews, createAssetPreview } from "./asset-preview-service";

let fixture: string;
let project: string;
function write(relative: string, content: string): string {
  const file = path.join(project, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}
beforeEach(() => {
  const parent = path.resolve("temp/tests");
  fs.mkdirSync(parent, { recursive: true });
  fixture = fs.mkdtempSync(path.join(parent, "asset-preview-"));
  project = path.join(fixture, "project");
  fs.mkdirSync(project);
});
afterEach(async () => {
  await closeAssetPreviews();
  fs.rmSync(fixture, { recursive: true, force: true });
});

describe("local asset previews", () => {
  it("serves the actual page, relative and root-relative assets, and live edits", async () => {
    write("app/index.html", '<link rel="stylesheet" href="../style.css"><script src="/app/main.js"></script>prototype');
    write("style.css", "body { color: red }");
    write("app/main.js", "console.log('preview')");
    const { url } = await createAssetPreview(project, "app/index.html");
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/app\/index.html$/);
    const response = await fetch(url);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("prototype");
    expect(await (await fetch(new URL("./", url))).text()).toContain("prototype");
    expect(await (await fetch(new URL("../style.css", url))).text()).toContain("color: red");
    expect(await (await fetch(new URL("/app/main.js", url))).text()).toContain("console.log");
    write("app/index.html", "updated");
    expect(await (await fetch(url)).text()).toBe("updated");
    const head = await fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("encodes spaces, Unicode and fragment characters in file names", async () => {
    write("原型/#预览 页面.html", "encoded page");
    const { url } = await createAssetPreview(project, "原型/#预览 页面.html");
    expect(await (await fetch(url)).text()).toBe("encoded page");
  });

  it("accepts a project opened through a directory symlink", async () => {
    const file = write("app/index.html", "linked project");
    const alias = path.join(fixture, "alias");
    fs.symlinkSync(project, alias, process.platform === "win32" ? "junction" : "dir");
    const { url } = await createAssetPreview(alias, path.join(alias, "app/index.html"));
    expect(await (await fetch(url)).text()).toBe("linked project");
    expect((await createAssetPreview(project, file)).url).toBe(url);
  });

  it("reuses a server for concurrent previews and isolates different projects", async () => {
    write("one.html", "one"); write("two.html", "two");
    const [first, second] = await Promise.all([createAssetPreview(project, "one.html"), createAssetPreview(project, "two.html")]);
    expect(new URL(first.url).origin).toBe(new URL(second.url).origin);
    const other = path.join(fixture, "other");
    fs.mkdirSync(other); fs.writeFileSync(path.join(other, "one.html"), "other");
    const third = await createAssetPreview(other, "one.html");
    expect(new URL(third.url).origin).not.toBe(new URL(first.url).origin);
    expect(await (await fetch(third.url)).text()).toBe("other");
  });

  it("rejects missing pages, non-HTML entry points, hidden files and paths outside the project", async () => {
    write("data.json", "{}"); write(".private/page.html", "private");
    fs.writeFileSync(path.join(fixture, "outside.html"), "outside");
    for (const entry of ["missing.html", "data.json", ".private/page.html", "../outside.html"]) {
      await expect(createAssetPreview(project, entry)).rejects.toThrow();
    }
  });

  it("blocks hidden files, traversal and escaping symlinks over HTTP", async () => {
    write("index.html", "public"); write(".env.json", '{"secret":"hidden"}');
    write(".git/config.txt", "private"); write("script.sh", "secret script");
    const external = path.join(fixture, "external"); fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, "outside.html"), "outside");
    fs.symlinkSync(external, path.join(project, "escape"), process.platform === "win32" ? "junction" : "dir");
    await expect(createAssetPreview(project, "escape/outside.html")).rejects.toThrow();
    const { url } = await createAssetPreview(project, "index.html");
    for (const suffix of ["/.env.json", "/.git/config.txt", "/script.sh", "/escape/outside.html", "/%2e%2e%2fexternal/outside.html", "/unindexed/"]) {
      const response = await fetch(new URL(suffix, url));
      expect(response.status, suffix).toBe(404);
      expect(await response.text()).not.toContain("outside");
    }
  });

  it("serves the generated design gallery without exposing other app configuration", async () => {
    write(".easymint/design/gallery.html", "gallery");
    write(".easymint/design/theme.css", "body{}");
    write(".easymint/settings.json", "private");
    const { url } = await createAssetPreview(project, ".easymint/design/gallery.html");
    expect(await (await fetch(url)).text()).toBe("gallery");
    expect((await fetch(new URL("theme.css", url))).status).toBe(200);
    expect((await fetch(new URL("../settings.json", url))).status).toBe(404);
  });

  it("rejects foreign hosts, cross-site reads and mutations", async () => {
    write("index.html", "public");
    const { url } = await createAssetPreview(project, "index.html");
    // fetch can normalize Host; use the HTTP client to send the actual foreign header.
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      http.get(url, { headers: { Host: "attacker.test" } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on("error", reject);
    });
    expect(foreignHostStatus).toBe(403);
    expect((await fetch(url, { headers: { Origin: "https://attacker.test" } })).status).toBe(403);
    expect((await fetch(url, { headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
    expect((await fetch(url, { method: "POST" })).status).toBe(405);
  });

  it("closes listening servers and can start a new preview afterwards", async () => {
    write("index.html", "preview");
    const { url } = await createAssetPreview(project, "index.html");
    await closeAssetPreviews();
    await expect(fetch(url)).rejects.toThrow();
    const next = await createAssetPreview(project, "index.html");
    expect(await (await fetch(next.url)).text()).toBe("preview");
  });
});
