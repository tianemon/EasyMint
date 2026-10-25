import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { broadcast } = vi.hoisted(() => ({ broadcast: vi.fn() }));
vi.mock("./ipc-broadcast", () => ({ broadcast }));
vi.mock("./pi-sdk", () => ({ getDefineToolFn: async () => (tool: unknown) => tool }));
vi.mock("./project-design-tool", () => ({ createProjectDesignTool: async () => ({ name: "set_project_design" }) }));
import { createProductTools } from "./builtin-mcp";
import { closeAssetPreviews } from "./asset-preview-service";

let root: string;
beforeEach(() => {
  fs.mkdirSync("temp/tests", { recursive: true });
  root = fs.mkdtempSync(path.resolve("temp/tests/prototype-tool-"));
});
afterEach(async () => {
  await closeAssetPreviews();
  fs.rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
});
function write(relative: string, text: string): string {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
  return file;
}
async function preview(input: { path?: string } = {}) {
  const tool = (await createProductTools(root)).find(tool => tool.name === "show_prototype")!;
  return tool.execute("preview", input, new AbortController().signal, undefined, {} as never);
}
it.each(["prototype/index.html", ".easymint/design/gallery.html"])("returns a working default link for %s and preserves the editor", async file => {
  const filePath = write(file, "default preview");
  const result = await preview();
  const text = result.content.find(item => item.type === "text");
  expect(text?.type).toBe("text");
  const url = text?.type === "text" ? /\]\((http[^)]+)\)/.exec(text.text)?.[1] : undefined;
  expect(url).toBeDefined();
  expect(await (await fetch(url!)).text()).toBe("default preview");
  expect(broadcast).toHaveBeenCalledExactlyOnceWith("editor:open-prototype", { projectPath: root, filePath });
});
it("uses the supplied HTML page instead of an unrelated default prototype", async () => {
  write("prototype/index.html", "old");
  const filePath = write("app/index.html", "actual preview");
  const result = await preview({ path: "app/index.html" });
  expect(result.details).toMatchObject({ filePath });
  const details = result.details as { url: string };
  expect(await (await fetch(details.url)).text()).toBe("actual preview");
});
it("does not claim to open a missing page or fabricate a link", async () => {
  await expect(preview({ path: "missing.html" })).rejects.toThrow();
  expect(broadcast).not.toHaveBeenCalled();
});
