import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { marked, type Token } from 'marked';

const PREVIEW_LENGTH = 240;
const cache = new Map<string, { revision: string; value: Promise<string> }>();

/** Plain text for a compact list row. Never preserve Markdown layout/newlines. */
export function previewText(markdown: string): string {
  const plain = (token: Token): string => {
    switch (token.type) {
      case 'space': case 'hr': case 'def': case 'image': return '';
      case 'html': return token.text.replace(/<[^>]*>/g, '');
      case 'table': return [...token.header, ...token.rows.flat()].map(cell => cell.tokens.map(plain).join('')).join(' ');
      case 'blockquote': return (token.tokens ?? []).map(plain).join(' ');
      case 'list': return token.items.map((item: { tokens: Token[] }) => item.tokens.map(plain).join(' ')).join(' ');
      default:
        if ('tokens' in token && Array.isArray(token.tokens)) return token.tokens.map(plain).join('');
        return 'text' in token && typeof token.text === 'string' ? token.text : '';
    }
  };
  return Array.from(marked.lexer(markdown.slice(0, 12_000)).map(plain).join(' ')
    .replace(/&#(x[\da-f]+|\d+);/gi, (match, code: string) => {
      const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name]!)
    .replace(/\s+/g, ' ').trim()).slice(0, PREVIEW_LENGTH).join('');
}

type PreviewNode = { parent: string | null; role?: 'assistant' | 'user'; text: string };

async function scanPreview(file: string): Promise<string> {
  const nodes = new Map<string, PreviewNode>();
  let leaf: string | undefined;
  const linear: PreviewNode[] = [];
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; } // Ignore a partially written trailing line.
      if (!entry || typeof entry !== 'object' || entry.type === 'session') continue;
      const message = entry.type === 'message' ? entry.message : null;
      const role = message?.role === 'assistant' || message?.role === 'user' ? message.role as 'assistant' | 'user' : undefined;
      const content = role ? message.content : undefined;
      const text = typeof content === 'string' ? content : Array.isArray(content)
        ? content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n') : '';
      const node: PreviewNode = { parent: typeof entry.parentId === 'string' ? entry.parentId : null, role, text: text.slice(0, 12_000) };
      linear.push(node);
      if (typeof entry.id === 'string') { nodes.set(entry.id, node); leaf = entry.id; }
    }
  } finally { lines.close(); }
  // Match session-service's currentBranchEntries: the file tail selects the active branch.
  const branch: PreviewNode[] = [];
  const visited = new Set<string>();
  while (leaf && !visited.has(leaf)) {
    visited.add(leaf);
    const node = nodes.get(leaf);
    if (!node) break;
    branch.push(node);
    leaf = node.parent ?? undefined;
  }
  const newestFirst = branch.length ? branch : linear.reverse();
  for (const role of ['assistant', 'user'] as const) {
    for (const node of newestFirst) {
      if (node.role !== role || !node.text) continue;
      const preview = previewText(node.text);
      if (preview) return preview;
    }
  }
  return '';
}

/** Metadata cache avoids rereading long transcripts on every refresh; no business data is persisted. */
export async function readSessionPreview(file: string): Promise<string> {
  try {
    const info = await stat(file);
    const revision = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    const cached = cache.get(file);
    if (cached?.revision === revision) return await cached.value;
    const value = scanPreview(file);
    cache.delete(file);
    cache.set(file, { revision, value });
    if (cache.size > 256) cache.delete(cache.keys().next().value!);
    try { return await value; } catch (error) {
      if (cache.get(file)?.value === value) cache.delete(file);
      throw error;
    }
  } catch { return ''; } // One unreadable/deleted session must not break the list.
}

export async function readSessionPreviews(infos: Array<{ path: string }>): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, infos.length) }, async () => {
    while (next < infos.length) {
      const info = infos[next++];
      result.set(info.path, await readSessionPreview(info.path));
    }
  }));
  return result;
}
