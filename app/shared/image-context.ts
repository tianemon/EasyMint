/** Only the model-visible projection is measured. Raw upload cache size is not a request size. */
export const IMAGE_PATH_ONLY_NOTE = "本次图片只提供文件路径；如需查看原图，请读取上述文件。";

export interface ContextImageEntry {
  entryId: string;
  imageCount: number;
  encodedBytes: number;
  preview: string;
  timestamp: number;
}

/** Composer attachments have not been resized by Pi yet, so this is an upper bound. */
export function pendingImageBase64Bytes(dataUrl: string | undefined): number {
  if (!dataUrl?.startsWith("data:image/")) return 0;
  const marker = ";base64,";
  const index = dataUrl.indexOf(marker);
  return index < 0 ? 0 : dataUrl.length - index - marker.length;
}

type ContentBlock = { type?: string; data?: string; text?: string };
type ProjectedMessage = { content?: unknown; timestamp?: number };
type ProjectedEntry = { sourceEntry: { id: string }; messages: ProjectedMessage[] };

function blocks(content: unknown): ContentBlock[] {
  return Array.isArray(content) ? content.filter((block): block is ContentBlock => !!block && typeof block === "object") : [];
}

export function contextImageEntries(entries: readonly ProjectedEntry[]): ContextImageEntry[] {
  const result: ContextImageEntry[] = [];
  for (const entry of entries) {
    if (entry.messages.length !== 1) continue;
    const message = entry.messages[0]!;
    const content = blocks(message.content);
    const images = content.filter((block) => block.type === "image" && typeof block.data === "string");
    if (images.length === 0) continue;
    result.push({
      entryId: entry.sourceEntry.id,
      imageCount: images.length,
      encodedBytes: images.reduce((total, image) => total + image.data!.length, 0),
      preview: content.filter((block) => block.type === "text").map((block) => block.text ?? "").join(" ").replace(/\s+/g, " ").slice(0, 110),
      timestamp: message.timestamp ?? 0,
    });
  }
  return result;
}

/** Keep every non-image block (including text and tool metadata) in the model context. */
export function contentWithoutImages(content: unknown): unknown[] {
  return blocks(content).filter((block) => block.type !== "image");
}
