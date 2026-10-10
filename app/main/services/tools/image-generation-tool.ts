import { promises as fs, constants } from "node:fs";
import path from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "../pi-sdk";
import type { AgentPermissionService } from "../permission/agent-permission-service";
import { getModelRuntime } from "../pi-init";
import { Store } from "../store";

function imageMime(data: Buffer): string | undefined {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return undefined;
}

/** Bound allocation even if a reference grows after stat; reject a replaced inode before reading. */
async function readReference(file: string, signal: AbortSignal): Promise<Buffer> {
  const limit = 10 * 1024 * 1024;
  const expected = await fs.lstat(file);
  if (!expected.isFile() || expected.size > limit) throw new Error("Reference must be a regular image file of at most 10 MiB");
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.ino !== expected.ino || opened.dev !== expected.dev) throw new Error("Reference image changed while opening");
    const buffer = Buffer.alloc(expected.size + 1);
    let size = 0;
    while (size < buffer.length) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const after = await handle.stat();
    if (size !== expected.size || after.size !== expected.size || after.mtimeMs !== expected.mtimeMs || after.ctimeMs !== expected.ctimeMs) throw new Error("Reference image changed while reading");
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

/** The selected image model uses Pi auth; model calls remain outside the shell sandbox. */
export function createImageGenerationTool(cwd: string, store: Store, canUseTool: ReturnType<AgentPermissionService["createCanUseTool"]>): ToolDefinition {
  return {
    name: "generate_image", label: "Generate image",
    description: "Generate an image or edit reference images with the configured image model. Requires a model selected in Settings. output_path is a file stem WITHOUT an extension, in an existing directory inside this project (relative or absolute). The tool saves the first returned image, adds its actual png/jpg/webp extension and never overwrites a file. reference_paths accepts up to four PNG/JPEG/WebP files. Uses the provider's paid image API; returns the saved asset path.",
    promptSnippet: "生成或编辑图像并保存为项目素材",
    parameters: { type: "object", properties: {
      prompt: { type: "string", minLength: 1 }, output_path: { type: "string", minLength: 1 },
      reference_paths: { type: "array", maxItems: 4, items: { type: "string" } },
    }, required: ["prompt", "output_path"] },
    async execute(id, raw, signal) {
      const input = raw as { prompt: string; output_path: string; reference_paths?: string[] };
      const cancellation = signal ?? new AbortController().signal;
      const check = async (name: string, file: string) => {
        cancellation.throwIfAborted();
        const result = await canUseTool(name, { path: file }, { signal: cancellation, toolUseID: id });
        if (result.behavior === "deny") throw new Error(result.message || "Image access denied");
      };
      const selected = store.getSettings().nativeAi?.imageModel;
      if (!selected) throw new Error("Select an image model in Settings → Models first");
      const requested = path.resolve(cwd, input.output_path);
      if (path.extname(requested)) throw new Error("output_path must be a file stem without an extension");
      await check("write", requested);
      const parent = await fs.realpath(path.dirname(requested));
      const workspace = await fs.realpath(cwd);
      const relative = path.relative(workspace, parent);
      if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Generated assets must stay inside the project");
      const stem = path.join(parent, path.basename(requested));
      await check("write", stem);
      for (const suffix of [".png", ".jpg", ".webp"]) {
        if (await fs.lstat(stem + suffix).then(() => true, error => {
          if (error.code === "ENOENT") return false;
          throw error;
        })) throw new Error("Image output already exists; choose another file stem");
      }
      const references: ImageContent[] = [];
      const referenceFiles: string[] = [];
      if ((input.reference_paths?.length ?? 0) > 4) throw new Error("At most four reference images are allowed");
      for (const name of input.reference_paths ?? []) {
        const file = await fs.realpath(path.resolve(cwd, name));
        await check("read", file);
        const data = await readReference(file, cancellation);
        const mimeType = imageMime(data);
        if (!mimeType) throw new Error("Reference must be PNG, JPEG or WebP");
        referenceFiles.push(file);
        references.push({ type: "image", data: data.toString("base64"), mimeType });
      }
      const runtime = await getModelRuntime(store);
      const model = runtime.getModelOfType("image", selected.provider, selected.model);
      if (!model) throw new Error("The selected image model is unavailable");
      if (references.length && !model.input.includes("image")) throw new Error("The selected image model does not accept reference images");
      // Authentication/setup can yield; recheck tightened permissions before uploading or charging.
      for (const file of referenceFiles) await check("read", file);
      await check("write", stem);
      cancellation.throwIfAborted();
      const result = await runtime.generateImages(model, { input: [{ type: "text", text: input.prompt }, ...references] }, { signal: cancellation });
      // Pi persists tool-result usage in session totals, including failed charged work.
      try {
        cancellation.throwIfAborted();
        if (result.stopReason !== "stop") throw new Error(result.errorMessage || "Image generation failed");
        const image = result.output.find(block => block.type === "image");
        if (!image) throw new Error("The provider returned no image");
        if (image.data.length > 40 * 1024 * 1024) throw new Error("Generated image exceeds 30 MiB");
        const data = Buffer.from(image.data, "base64");
        const mimeType = imageMime(data);
        if (!mimeType || mimeType !== image.mimeType || data.length > 30 * 1024 * 1024) throw new Error("Invalid generated image");
        const file = stem + (mimeType === "image/png" ? ".png" : mimeType === "image/jpeg" ? ".jpg" : ".webp");
        await check("write", file);
        if (await fs.realpath(parent) !== parent || await fs.realpath(cwd) !== workspace) throw new Error("Image output directory changed during generation");
        cancellation.throwIfAborted();
        const handle = await fs.open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
        try {
          cancellation.throwIfAborted();
          await handle.writeFile(data);
          cancellation.throwIfAborted();
        } catch (error) {
          const own = await handle.stat();
          const current = await fs.lstat(file).catch(() => undefined);
          if (current?.ino === own.ino && current.dev === own.dev) await fs.unlink(file);
          throw error;
        } finally { await handle.close(); }
        return { content: [{ type: "text", text: `Saved image: ${file}\nModel: ${result.provider}/${result.model}` }],
          details: { generatedImagePath: file, usageProvider: result.provider, usageModel: result.model }, usage: result.usage };
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], details: { usageProvider: result.provider, usageModel: result.model }, isError: true, usage: result.usage };
      }
    },
  };
}
