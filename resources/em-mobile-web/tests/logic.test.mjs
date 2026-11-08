// 状态逻辑回归：直接 import 复制并适配后的纯 TS 模块（Node 22 类型剥离）。
// 用例思路复用手机 App tests/*.test.mjs，防止 Web 适配过程改坏纯逻辑。
import assert from 'node:assert/strict';
import test from 'node:test';

import { formatLastSeen, formatSessionTime } from '../src/core/session-time.ts';
import { resolveThinkingLevel, THINKING_ORDER } from '../src/core/thinking.ts';
import { object, contentText, prependMessage, upsertMessage, markToolDone, formatTokenCount, truncateToolOutput, snapshotMessages } from '../src/core/messages.ts';
import { groupByExecution, turnMode, formatTurnDuration, buildRows } from '../src/core/turns.ts';
import { streamingHint, resolveStatusHint, COMPACTING_HINT } from '../src/core/status-hints.ts';
import { toolLabel, toolStatus, isCommandTool, toolActivityIcon, describeProcessItem } from '../src/core/tools.ts';
import { diffStats, visibleDiffRange, numberLines } from '../src/core/diff.ts';
import { parseAnsi } from '../src/core/ansi.ts';
import { statusTone, RESULT_KINDS } from '../src/core/system-status.ts';
import { classifyApiError } from '../src/core/api-errors.ts';
import { resolveSettingsRevision } from '../src/core/settings-revision.ts';
import { createStreamFrameQueue } from '../src/core/stream-frames.ts';
import { beginCompacting, endCompacting, isCompacting } from '../src/core/compacting.ts';
import { splitMarkdownParts, languageLabel, safeHref } from '../src/core/markdown/parse.ts';

const now = new Date(2026, 10, 5, 16, 30).getTime();

test('session-time：今天给时分 / 昨天 / 更早按日历（与手机 App 同用例）', () => {
  assert.equal(formatSessionTime(new Date(2026, 10, 5, 9, 5).getTime(), now), '09:05');
  assert.equal(formatSessionTime(new Date(2026, 10, 4, 23, 59).getTime(), now), '昨天');
  assert.equal(formatSessionTime(new Date(2026, 10, 3, 12, 0).getTime(), now), '11月3日');
  assert.equal(formatSessionTime(undefined, now), '');
  assert.equal(formatLastSeen(now - 20_000, now), '刚刚');
  assert.equal(formatLastSeen(now - 12 * 60_000, now), '12 分钟前');
  assert.equal(formatLastSeen(new Date(2026, 10, 1, 8, 0).getTime(), now), '11月1日');
});

test('thinking：当前档位不可用时优先向下取最近档位', () => {
  assert.equal(resolveThinkingLevel('high', ['off', 'low', 'medium']), 'medium');
  assert.equal(resolveThinkingLevel('high', ['high', 'max']), 'high');
  assert.equal(resolveThinkingLevel('low', []), 'low');
  assert.ok(THINKING_ORDER.includes('medium'));
});

test('messages：object / contentText / 头插 / upsert / 工具完成 / 截断', () => {
  assert.deepEqual(object({ a: 1 }), { a: 1 });
  assert.deepEqual(object('not-object'), {});
  assert.equal(typeof contentText([{ type: 'text', text: 'hi' }]), 'string');
  const list = [{ id: 'a', role: 'user', text: 'A' }];
  const prepended = prependMessage(list, { id: 'b', role: 'user', text: 'B' });
  assert.equal(prepended[0].id, 'b');
  const upserted = upsertMessage(prepended, { id: 'b', role: 'user', text: 'B2' });
  assert.equal(upserted.find((item) => item.id === 'b').text, 'B2');
  const withTool = [{ id: 'm', role: 'assistant', blocks: [{ kind: 'tool', id: 't1', name: 'read', output: '', state: 'running' }] }];
  assert.equal(markToolDone(withTool, 't1')[0].blocks[0].state, 'done');
  assert.equal(typeof formatTokenCount(1234), 'string');
  assert.ok(truncateToolOutput(Array.from({ length: 80 }, (_, i) => `line${i}`).join('\n')).split('\n').length <= 32);
  assert.deepEqual(snapshotMessages({ messages: [], pendingAsks: [], bufferedEvents: [], session: {}, status: 'idle' }), []);
});

test('turns：空列表 / 三态 / 用时 / buildRows 最新在前', () => {
  assert.deepEqual(groupByExecution([]), []);
  assert.equal(turnMode({ active: true, conclusion: [], processCount: 1 }), 'running');
  assert.equal(turnMode({ active: false, conclusion: [{ key: 'k', text: 'x', messageId: 'm' }], processCount: 2 }), 'folded');
  assert.equal(turnMode({ active: false, conclusion: [], processCount: 0 }), 'flat');
  assert.equal(typeof formatTurnDuration(65_000), 'string');
  const rows = buildRows([{ id: 'u', role: 'user', text: 'hi' }], false, describeProcessItem);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'message');
});

test('status-hints / tools / diff 文案口径与桌面端同源', () => {
  assert.match(streamingHint('text'), /正在回复/);
  assert.match(streamingHint('thinking'), /思考/);
  assert.equal(typeof resolveStatusHint(true, ''), 'string');
  assert.match(COMPACTING_HINT, /整理/);
  assert.equal(toolLabel('bash'), '命令');
  assert.equal(toolStatus('read'), '正在读取文件');
  assert.equal(isCommandTool('bash'), true);
  assert.equal(typeof toolActivityIcon('edit'), 'string');
  assert.deepEqual(diffStats('+++ f\n+a\n-b\n ctx'), { added: 1, removed: 1 });
  assert.deepEqual(visibleDiffRange(['ctx', '+a', 'ctx']), { from: 0, to: 2 });
  assert.match(numberLines('a\nb'), /1\s+a/);
});

test('ansi / system-status / api-errors / settings-revision', () => {
  const segments = parseAnsi('\x1b[31mred\x1b[0m');
  assert.ok(segments.some((item) => item.text === 'red'));
  assert.equal(statusTone('失败'), 'failed');
  assert.equal(statusTone('完成'), 'done');
  assert.ok(RESULT_KINDS.has('shell'));
  assert.ok(classifyApiError('context length exceeded').code);
  assert.equal(resolveSettingsRevision(5, 6).stale, false);
  assert.equal(resolveSettingsRevision(6, 5).stale, true);
});

test('stream-frames：同 key 连续帧只留最后一帧，flush 保序', () => {
  const applied = [];
  let scheduled = null;
  const queue = createStreamFrameQueue((frame) => applied.push(frame), (flush) => { scheduled = flush; return () => { scheduled = null; }; });
  queue.defer('runA', { n: 1 });
  queue.defer('runA', { n: 2 });
  assert.equal(applied.length, 0, '未到帧边界不应用');
  scheduled();
  assert.deepEqual(applied, [{ n: 2 }]);
  queue.defer('runA', { n: 3 });
  queue.flush();
  assert.deepEqual(applied, [{ n: 2 }, { n: 3 }]);
});

test('compacting：置位 / 清除', () => {
  assert.equal(isCompacting('s1'), false);
  beginCompacting('s1', () => undefined);
  assert.equal(isCompacting('s1'), true);
  endCompacting('s1');
  assert.equal(isCompacting('s1'), false);
});

test('markdown parse：围栏切分 / 语言标签 / 安全链接', () => {
  const parts = splitMarkdownParts('hello\n```ts\nconst a = 1;\n```\nbye', false);
  assert.equal(parts.length, 3);
  assert.equal(parts[1].kind, 'code');
  assert.equal(typeof languageLabel('typescript'), 'string');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('https://example.com'), 'https://example.com');
});
