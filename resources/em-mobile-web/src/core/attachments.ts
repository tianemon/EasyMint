import { getRandomBytes } from '../protocol/web-random';

/**
 * Web 版附件：用 <input type="file"> 取代 expo 的文档/相册选择器。
 * 上限与 appendAttachments 完全镜像桌面端 remote-command-router 的 attachmentSchema
 * （单文件 15 MB、单次总量 15 MB、最多 10 个），编码可注入 Worker 版（见 transport/attachment-codec）。
 */
export type AttachmentKind = 'image' | 'doc';

/** 只存在于当前进程内；不写入任何持久化存储（契约 C6）。 */
export type DraftAttachment = {
  id: string;
  name: string;
  kind: AttachmentKind;
  mimeType: string;
  size: number;
  data: string;
  /** 仅用于主线程缩略图，不随命令发送到 PC（发送时只取 name/kind/mimeType/data）。 */
  previewUrl?: string;
};

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10;
export const ATTACHMENT_LIMITS = {
  maxFileBytes: MAX_FILE_BYTES,
  maxTotalBytes: MAX_TOTAL_ATTACHMENT_BYTES,
  maxCount: MAX_ATTACHMENT_COUNT,
} as const;

const DOCUMENT_ACCEPT = [
  '.pdf', '.txt', '.md', '.json', '.xml', '.csv', '.log', '.yaml', '.yml',
  '.doc', '.docx', '.xls', '.xlsx', 'application/pdf', 'text/*', 'application/json', 'application/xml',
].join(',');

function newAttachmentId(): string {
  const b = getRandomBytes(6);
  return `${Date.now()}-${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** 按 base64 的实际内容定图片类型（与 RN 版同口径）。 */
export function sniffImageMime(data: string): string | undefined {
  if (data.startsWith('/9j/')) return 'image/jpeg';
  if (data.startsWith('iVBOR')) return 'image/png';
  if (data.startsWith('R0lG')) return 'image/gif';
  if (data.startsWith('UklGR')) return 'image/webp';
  return undefined;
}

export function validateAttachmentSize(name: string, bytes: number): void {
  if (bytes > MAX_FILE_BYTES) throw new Error(`${name} 超过 15 MB`);
}

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

export type AttachmentEncoder = (files: File[], kind: AttachmentKind) => Promise<DraftAttachment[]>;

/** 主线程默认编码器：FileReader → base64；限额校验与 Worker 版共用 validateAttachmentSize。 */
export const defaultEncoder: AttachmentEncoder = async (files, kind) => {
  const picked: DraftAttachment[] = [];
  for (const file of files) {
    validateAttachmentSize(file.name, file.size);
    const data = await readAsBase64(file);
    const bytes = Math.floor(data.length * 0.75);
    validateAttachmentSize(file.name, bytes);
    picked.push({
      id: newAttachmentId(),
      name: file.name,
      kind,
      mimeType: kind === 'image' ? (sniffImageMime(data) ?? file.type ?? 'image/jpeg') : (file.type || 'application/octet-stream'),
      size: bytes,
      data,
      previewUrl: URL.createObjectURL(file),
    });
  }
  return picked;
};

/** 打开系统文件选择器（页面不做相机、不做扫码，相机/扫码交给系统）。 */
function openFilePicker(kind: AttachmentKind): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = kind === 'image' ? 'image/*' : DOCUMENT_ACCEPT;
    input.style.display = 'none';
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(files);
    };
    const onFocus = () => setTimeout(() => finish([]), 600);
    input.onchange = () => finish(Array.from(input.files ?? []));
    document.body.appendChild(input);
    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}

export async function pickAttachments(kind: AttachmentKind, encode: AttachmentEncoder = defaultEncoder): Promise<DraftAttachment[]> {
  const files = await openFilePicker(kind);
  if (!files.length) return [];
  return encode(files, kind);
}

/**
 * 把新选中的附件并入待发列表，上限与桌面端一致（见文件头注释）。
 * 超限在「选中的那一刻」就暴露，而不是发出去被桌面端 zod 整条拒掉。
 */
export function appendAttachments(current: DraftAttachment[], picked: DraftAttachment[]): { next: DraftAttachment[]; notice?: string } {
  const room = MAX_ATTACHMENT_COUNT - current.length;
  if (room <= 0) return { next: current, notice: `单次最多发送 ${MAX_ATTACHMENT_COUNT} 个附件` };
  const dropped = Math.max(0, picked.length - room);
  const next = [...current, ...(dropped ? picked.slice(0, room) : picked)];
  if (next.reduce((sum, item) => sum + item.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
    return { next: current, notice: '单次发送的附件总量不能超过 15 MB' };
  }
  return { next, notice: dropped ? `单次最多发送 ${MAX_ATTACHMENT_COUNT} 个附件，已忽略 ${dropped} 个` : undefined };
}
