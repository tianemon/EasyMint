import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { previewText, readSessionPreview, readSessionPreviews } from './session-preview';

const dirs: string[] = [];
async function fixture(entries: unknown[]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'em-preview-'));
  dirs.push(dir);
  const file = path.join(dir, 'session.jsonl');
  await writeFile(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return file;
}
const msg = (id: string, parentId: string | null, role: string, content: unknown) => ({ type: 'message', id, parentId, message: { role, content } });
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('session list preview', () => {
  it('uses the beginning of the latest assistant body, skipping thinking, tools and later user input', async () => {
    const file = await fixture([
      { type: 'session', id: 'session' },
      msg('1', null, 'user', 'first question'),
      msg('2', '1', 'assistant', [{ type: 'text', text: 'older answer' }]),
      msg('3', '2', 'assistant', [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: '**新的结论**\n\n从这里开始。' }]),
      msg('4', '3', 'toolResult', 'not the preview'),
      msg('5', '4', 'assistant', [{ type: 'toolCall', name: 'bash' }]),
      msg('6', '5', 'user', 'latest user input'),
    ]);
    expect(await readSessionPreview(file)).toBe('新的结论 从这里开始。');
  });
  it('selects the current branch instead of a discarded later-written answer', async () => {
    const file = await fixture([
      msg('1', null, 'user', 'question'),
      msg('2', '1', 'assistant', 'current answer'),
      msg('3', '1', 'assistant', 'discarded answer'),
      { type: 'custom', id: '4', parentId: '2' },
    ]);
    expect(await readSessionPreview(file)).toBe('current answer');
  });
  it('falls back to the last user text only when there is no assistant body', async () => {
    const file = await fixture([msg('1', null, 'user', 'first'), msg('2', '1', 'user', 'last\n\nquestion')]);
    expect(await readSessionPreview(file)).toBe('last question');
  });
  it('invalidates cached previews after an append and ignores an incomplete trailing record', async () => {
    const file = await fixture([msg('1', null, 'assistant', 'old')]);
    expect(await readSessionPreview(file)).toBe('old');
    await appendFile(file, JSON.stringify(msg('2', '1', 'assistant', 'new answer')) + '\n{"type":');
    expect(await readSessionPreview(file)).toBe('new answer');
    expect(await readSessionPreview(file)).toBe('new answer');
  });
  it('normalizes headings, lists, links, images, code and tables into compact readable text', () => {
    expect(previewText('# **结论**\n\n- [文档](https://example.com)\n- `a_b.ts` &amp; C++\n\n![图](data:image/png;base64,AAAA)'))
      .toBe('结论 文档 a_b.ts & C++');
    expect(previewText('| 名称 | 结果 |\n|---|---|\n| A | 完成 |')).toBe('名称 结果 A 完成');
    expect(previewText('> 一段\n>\n> 下一段')).toBe('一段 下一段');
    expect(previewText('```ts\nconst ok = true;\n```')).toBe('const ok = true;');
  });
  it('limits length without splitting emoji or appending a standalone ellipsis', () => {
    const text = previewText('😀'.repeat(250));
    expect(Array.from(text)).toHaveLength(240);
    expect(text.endsWith('😀')).toBe(true);
    expect(text).not.toContain('…');
  });
  it('does not break the list for an unreadable or empty transcript', async () => {
    const file = await fixture([]);
    const previews = await readSessionPreviews([{ path: file }, { path: '/nonexistent/em-session.jsonl' }]);
    expect([...previews.values()]).toEqual(['', '']);
  });
});
