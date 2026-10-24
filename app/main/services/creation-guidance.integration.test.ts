import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentSession, DefaultResourceLoader, loadSkillsFromDir, ModelRuntime,
  SessionManager, SettingsManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import type { Message } from '@earendil-works/pi-ai';
import { MINT_SYSTEM_PROMPT, CREATION_COLLABORATION, buildInitTriggerPrompt,
  buildDirectCreatePrompt, systemMessage } from '../../shared/prompts';

const roots: string[] = [], sessions: AgentSession[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const text = (messages: Message[]) => JSON.stringify(messages);
const count = (value: string, phrase: string) => value.split(phrase).length - 1;

// Real SDK resource loading, tool execution, transcript conversion and disk restore.
// The provider is scripted and offline: this tests transport, not model judgment.
async function setup(base: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'em-creation-context-')); roots.push(root);
  const agentDir = path.join(root, 'agent'); fs.mkdirSync(agentDir);
  const skillRoot = path.join(agentDir, 'skills', 'creation-guide'); fs.mkdirSync(skillRoot, { recursive: true });
  const guide = fs.readFileSync(path.resolve('resources/skills/creation-guide/SKILL.md'), 'utf8');
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), guide);
  const runtime = await ModelRuntime.create({ modelsPath: null, authPath: path.join(root, 'auth.json'), allowModelNetwork: false });
  const faux = fauxProvider({ provider: 'creation-fixture', models: [{ id: 'fixture' }], tokensPerSecond: 0 });
  runtime.registerNativeProvider(faux.provider); await runtime.refresh({ allowNetwork: false });
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, cacheWarming: 'off' });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings,
    noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    systemPromptOverride: () => base,
    skillsOverride: () => loadSkillsFromDir({ dir: path.join(agentDir, 'skills'), source: 'fixture' }),
  });
  await loader.reload();
  let reads = 0;
  const create = async (manager: SessionManager) => {
    const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime,
      model: runtime.getModel('creation-fixture', 'fixture'), resourceLoader: loader,
      settingsManager: settings, sessionManager: manager, noTools: 'builtin', customTools: [{
        name: 'use_skill', label: 'Use skill', description: 'Read one fixture skill',
        parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        execute: async (_id, args: { name: string }) => {
          if (args.name !== 'creation-guide') throw Error('Unknown fixture skill');
          reads++; return { content: [{ type: 'text' as const, text: guide }], details: undefined };
        },
      }, {
        name: 'read', label: 'Read fixture', description: 'Read only the isolated fixture skill',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        execute: async (_id, args: { path: string }) => {
          if (args.path !== path.join(skillRoot, 'SKILL.md')) throw Error('Outside fixture');
          return { content: [{ type: 'text' as const, text: guide }], details: undefined };
        },
      }] });
    sessions.push(session); return session;
  };
  return { root, create, faux, guide, readCount: () => reads };
}

describe('creation guidance actual SDK request projection', () => {
  it.each(['default', 'custom'])('%s base: loads a skill on demand and preserves one creation event across reopen', async mode => {
    const base = mode === 'default' ? MINT_SYSTEM_PROMPT : 'CUSTOM_BASE_SENTINEL：保留用户自己的规则';
    const env = await setup(base), requests: Message[][] = [];
    env.faux.setResponses([
      ctx => { requests.push(structuredClone(ctx.messages)); return fauxAssistantMessage(fauxToolCall('use_skill', { name: 'creation-guide' }), { stopReason: 'toolUse' }); },
      ctx => { requests.push(structuredClone(ctx.messages)); return fauxAssistantMessage('fixture completed'); },
      ctx => { requests.push(structuredClone(ctx.messages)); return fauxAssistantMessage('fixture follow-up'); },
    ]);
    const manager = SessionManager.create(env.root, path.join(env.root, 'sessions'));
    const first = await env.create(manager);
    const content = mode === 'default'
      ? buildInitTriggerPrompt(env.root, 'FACTS_SENTINEL：自己用；数据离线；保留深色', '')
      : buildDirectCreatePrompt('个人工具', 'FACTS_SENTINEL：自己用；数据离线；保留深色');
    await first.sendCustomMessage(systemMessage(mode === 'default' ? 'project-created' : 'direct-create', content,
      { fixturePrivateMetadata: 'PRIVATE_METADATA_SENTINEL' }), { triggerTurn: true });
    expect(env.readCount()).toBe(1);
    expect(requests).toHaveLength(2); // skill call + completion; no extra explanatory run
    const initial = text(requests[0]!);
    expect(initial).toContain('FACTS_SENTINEL');
    expect(initial).not.toContain('PRIVATE_METADATA_SENTINEL');
    expect(count(initial, CREATION_COLLABORATION)).toBe(1);
    expect(initial.includes('<available_skills>')).toBe(true);
    expect(count(initial, '<name>creation-guide</name>')).toBe(1);
    expect(initial).not.toContain(JSON.stringify(env.guide).slice(1, -1));
    const loaded = requests[1]!.filter(message => message.role === 'toolResult');
    expect(loaded).toHaveLength(1);
    expect(text(loaded)).toContain(JSON.stringify(env.guide).slice(1, -1));
    if (mode === 'custom') {
      expect(initial).toContain('CUSTOM_BASE_SENTINEL');
      expect(initial).not.toContain('你叫 Mint');
    }
    first.dispose();
    const reopened = SessionManager.open(manager.getSessionFile()!, env.root, path.join(env.root, 'sessions'));
    const resumed = await env.create(reopened);
    await resumed.prompt('继续调整间距，保留深色');
    expect(env.readCount()).toBe(1);
    expect(requests).toHaveLength(3);
    expect(count(text(requests[2]!), CREATION_COLLABORATION)).toBe(1);
    expect(text(requests[2]!)).toContain('FACTS_SENTINEL');
    expect(count(text(requests[2]!), JSON.stringify(env.guide).slice(1, -1))).toBe(1);
    expect(reopened.getBranch().filter(entry => entry.type === 'custom_message' && entry.customType === 'system_message')).toHaveLength(1);
  });

  it('does not inject a creation message into free chat', async () => {
    const env = await setup(MINT_SYSTEM_PROMPT), requests: Message[][] = [];
    env.faux.setResponses([ctx => { requests.push(structuredClone(ctx.messages)); return fauxAssistantMessage('fixture'); }]);
    const session = await env.create(SessionManager.inMemory(env.root));
    await session.prompt('帮我做一个整理文件的脚本');
    expect(requests).toHaveLength(1);
    expect(text(requests[0]!)).not.toContain(CREATION_COLLABORATION);
    expect(text(requests[0]!)).not.toContain(JSON.stringify(env.guide).slice(1, -1));
    expect(env.readCount()).toBe(0);
  });

  it('resumes a compacted branch without re-injecting old creation or canceled approval messages', async () => {
    const env = await setup(MINT_SYSTEM_PROMPT), requests: Message[][] = [];
    const manager = SessionManager.create(env.root, path.join(env.root, 'sessions'));
    manager.appendCustomMessageEntry('system_message', buildDirectCreatePrompt('相册', '个人离线'), true);
    manager.appendMessage({ role: 'user', content: 'CANCELED_APPROVAL_SENTINEL：先别开发', timestamp: Date.now() });
    manager.appendMessage(fauxAssistantMessage('fixture previous result'));
    const kept = manager.appendMessage({ role: 'user', content: '调整间距，保留深色', timestamp: Date.now() });
    // Controlled SDK compaction fixture, not a model-generated summary quality test.
    const summary = 'SUMMARY_FACTS_SENTINEL：个人离线相册，保留深色；原型尚待用户验收；没有正式开发批准。';
    manager.appendCompaction(summary, kept, 1000);
    const reopened = SessionManager.open(manager.getSessionFile()!, env.root, path.join(env.root, 'sessions'));
    env.faux.setResponses([ctx => { requests.push(structuredClone(ctx.messages)); return fauxAssistantMessage('fixture resumed'); }]);
    const session = await env.create(reopened);
    await session.prompt('继续');
    expect(requests).toHaveLength(1);
    expect(count(text(requests[0]!), summary)).toBe(1);
    expect(text(requests[0]!)).toContain('调整间距，保留深色');
    expect(text(requests[0]!)).not.toContain('CANCELED_APPROVAL_SENTINEL');
    expect(text(requests[0]!)).not.toContain(CREATION_COLLABORATION);
    expect(env.readCount()).toBe(0);
  });
});
