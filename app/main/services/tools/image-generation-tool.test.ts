import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "../store";
import { createImageGenerationTool } from "./image-generation-tool";
import type { AgentPermissionService } from "../permission/agent-permission-service";

const runtime = vi.hoisted(() => ({ getModelOfType: vi.fn(() => ({ provider: "fixture", id: "image", input: ["text", "image"] })), generateImages: vi.fn() }));
vi.mock("../pi-init", () => ({ getModelRuntime: async () => runtime }));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); vi.clearAllMocks(); });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-image-")); roots.push(root);
  const store = new Store(path.join(root, "settings"));
  store.saveSettings({ ...store.getSettings(), nativeAi: { imageModel: { provider: "fixture", model: "image" } } });
  const permission = vi.fn<ReturnType<AgentPermissionService["createCanUseTool"]>>(async () => ({ behavior: "allow" }));
  const tool = createImageGenerationTool(root, store, permission);
  return { root, tool, permission };
}
const response = () => ({ provider: "fixture", model: "image", stopReason: "stop", output: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }], usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0.04, cacheRead: 0, cacheWrite: 0, total: 0.04 } } });

describe("image generation assets", () => {
  it("uses native credentials API, passes references and cancellation, and returns metered output", async () => {
    const { root, tool } = setup();
    fs.writeFileSync(path.join(root, "reference.png"), png);
    runtime.generateImages.mockResolvedValue(response());
    const signal = new AbortController().signal;
    const result = await tool.execute("call", { prompt: "edit", output_path: "asset", reference_paths: ["reference.png"] }, signal, undefined, {} as never);
    expect(fs.readFileSync(path.join(root, "asset.png"))).toEqual(png);
    expect(result.usage?.cost.total).toBe(0.04);
    expect(result.details).toEqual({ generatedImagePath: path.join(fs.realpathSync(root), "asset.png"), usageProvider: "fixture", usageModel: "image" });
    expect(runtime.generateImages).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ input: [expect.objectContaining({ text: "edit" }), expect.objectContaining({ type: "image" })] }), { signal });
  });
  it("rejects existing assets before charging the provider", async () => {
    const { root, tool } = setup(); fs.writeFileSync(path.join(root, "asset.png"), "original");
    await expect(tool.execute("call", { prompt: "draw", output_path: "asset" }, undefined, undefined, {} as never)).rejects.toThrow("already exists");
    expect(runtime.generateImages).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(root, "asset.png"), "utf8")).toBe("original");
  });
  it("rejects an output directory symlink escaping the project before charging", async () => {
    const { root, tool } = setup();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "em-image-outside-")); roots.push(outside);
    fs.symlinkSync(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    await expect(tool.execute("call", { prompt: "draw", output_path: "linked/asset" }, undefined, undefined, {} as never)).rejects.toThrow("inside the project");
    expect(runtime.generateImages).not.toHaveBeenCalled();
  });
  it("rejects oversized reference files before reading or charging", async () => {
    const { root, tool } = setup();
    const file = path.join(root, "large.png");
    fs.writeFileSync(file, png); fs.truncateSync(file, 10 * 1024 * 1024 + 1);
    await expect(tool.execute("call", { prompt: "edit", output_path: "asset", reference_paths: [file] }, undefined, undefined, {} as never)).rejects.toThrow("10 MiB");
    expect(runtime.generateImages).not.toHaveBeenCalled();
  });
  it("rejects oversized returned base64 before allocating a decoded image", async () => {
    const { root, tool } = setup();
    const encoded = "A".repeat(41 * 1024 * 1024);
    runtime.generateImages.mockResolvedValueOnce({ ...response(), output: [{ type: "image", data: encoded, mimeType: "image/png" }] });
    const decode = vi.spyOn(Buffer, "from");
    try {
      const result = await tool.execute("call", { prompt: "draw", output_path: "asset" }, undefined, undefined, {} as never);
      expect(result.isError).toBe(true);
      expect(decode.mock.calls.some(call => call[0] === encoded)).toBe(false);
      expect(fs.existsSync(path.join(root, "asset.png"))).toBe(false);
    } finally { decode.mockRestore(); }
  });
  it("does not save a late cancelled result and retains charged usage", async () => {
    const { root, tool } = setup(); const controller = new AbortController();
    runtime.generateImages.mockImplementationOnce(async () => { controller.abort(); return response(); });
    const result = await tool.execute("call", { prompt: "draw", output_path: "asset" }, controller.signal, undefined, {} as never);
    expect(result.isError).toBe(true); expect(result.usage?.cost.total).toBe(0.04);
    expect(fs.existsSync(path.join(root, "asset.png"))).toBe(false);
  });
  it("rechecks permissions after reading references and before a charged request", async () => {
    const { root, tool, permission } = setup();
    fs.writeFileSync(path.join(root, "reference.png"), png);
    let allowed = true;
    permission.mockImplementation(async name => {
      if (name === "read") { allowed = false; return { behavior: "allow" }; }
      return allowed ? { behavior: "allow" } : { behavior: "deny", message: "revoked before generation" };
    });
    await expect(tool.execute("call", { prompt: "edit", output_path: "asset", reference_paths: ["reference.png"] }, undefined, undefined, {} as never)).rejects.toThrow("revoked before generation");
    expect(runtime.generateImages).not.toHaveBeenCalled();
  });
  it("rechecks live write permission after the paid request", async () => {
    const { root, tool, permission } = setup();
    runtime.generateImages.mockImplementationOnce(async () => { permission.mockResolvedValue({ behavior: "deny", message: "revoked" } as never); return response(); });
    const result = await tool.execute("call", { prompt: "draw", output_path: "asset" }, undefined, undefined, {} as never);
    expect(result.isError).toBe(true); expect(fs.existsSync(path.join(root, "asset.png"))).toBe(false);
  });
});
