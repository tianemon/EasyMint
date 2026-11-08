import type { AttachmentKind, DraftAttachment } from '../core/attachments';
import { ATTACHMENT_LIMITS, sniffImageMime, validateAttachmentSize } from '../core/attachments';
import { getRandomBytes } from '../protocol/web-random';

/** Worker 内可用的附件编码：FileReader → base64 + 与桌面端一致的限额校验。不创建 objectURL（Worker 无 URL.createObjectURL）。 */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error(`${file.name} 读取失败`));
    reader.readAsDataURL(file);
  });
}

function newId(): string {
  const b = getRandomBytes(6);
  return `${Date.now()}-${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export async function encodeFiles(files: File[], kind: AttachmentKind): Promise<DraftAttachment[]> {
  const picked: DraftAttachment[] = [];
  let total = 0;
  for (const file of files) {
    if (picked.length >= ATTACHMENT_LIMITS.maxCount) break;
    validateAttachmentSize(file.name, file.size);
    const data = await readAsBase64(file);
    const bytes = Math.floor(data.length * 0.75);
    validateAttachmentSize(file.name, bytes);
    total += bytes;
    if (total > ATTACHMENT_LIMITS.maxTotalBytes) throw new Error('单次发送的附件总量不能超过 15 MB');
    picked.push({
      id: newId(),
      name: file.name,
      kind,
      mimeType: kind === 'image' ? (sniffImageMime(data) ?? file.type ?? 'image/jpeg') : (file.type || 'application/octet-stream'),
      size: bytes,
      data,
    });
  }
  return picked;
}
