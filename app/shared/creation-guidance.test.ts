import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  MINT_SYSTEM_PROMPT, BUILDER_AGENT_PROMPT, EVALUATOR_AGENT_PROMPT,
  CREATION_COLLABORATION, buildInitTriggerPrompt, buildDirectCreatePrompt,
  buildFeatureRecommendPrompt, buildDirectoryTranslationPrompt,
  buildInitInstruction, detectProfile, systemMessage,
} from './prompts';

const skills = ['creation-guide', 'creation-flow-intent', 'creation-flow-features',
  'creation-flow-prototype', 'creation-flow-techspec', 'creation-flow-cost'];
const files = skills.map(name => fs.readFileSync(path.resolve('resources/skills', name, 'SKILL.md'), 'utf8'));
const chars = (text: string) => [...text].length;
const occurrences = (text: string, value: string) => text.split(value).length - 1;

describe('creation guidance transport and context budget', () => {
  it.each(['web', 'cli', 'ios-mobile'])('preserves %s facts and carries collaboration once at the real entry', target => {
    const ctx = '用户事实标记：本人离线使用；功能=分类；风格=glass；预算尚未确认';
    const profile = detectProfile([target]);
    for (const [kind, text] of [
      ['project-created', buildInitTriggerPrompt('/projects/user-app', ctx, buildInitInstruction(profile), [target], profile)],
      ['direct-create', buildDirectCreatePrompt('个人应用', ctx)],
    ] as const) {
      const payload = systemMessage(kind, text);
      expect(payload.details.kind).toBe(kind);
      expect(payload.content).toBe(text);
      expect(text.startsWith('[系统消息]')).toBe(true);
      expect(occurrences(text, ctx)).toBe(1);
      expect(occurrences(text, CREATION_COLLABORATION)).toBe(1);
      expect(text).not.toContain('全部信息需在对话中收集');
    }
  });

  it('does not add creation coaching to the base, workers or single-shot form helpers', () => {
    for (const text of [MINT_SYSTEM_PROMPT, BUILDER_AGENT_PROMPT, EVALUATOR_AGENT_PROMPT,
      buildFeatureRecommendPrompt('用户功能'), buildDirectoryTranslationPrompt('目录')]) {
      expect(text).not.toContain(CREATION_COLLABORATION);
    }
    expect(buildDirectCreatePrompt('新项目', '')).toContain('已采集的结构化信息：无');
  });

  it('does not duplicate profile constraints already included by the caller', () => {
    const profile = detectProfile(['web']);
    const instruction = buildInitInstruction(profile);
    const prompt = buildInitTriggerPrompt('/project', '输入', instruction, ['web'], profile);
    for (const line of instruction.split('\n').map(line => line.trim()).filter(line => line.startsWith('-'))) {
      expect(occurrences(prompt, line), line).toBe(1);
    }
    const customInstruction = '调用方额外约束';
    const fallback = buildInitTriggerPrompt('/project', '输入', customInstruction, ['web'], profile);
    expect(fallback).toContain(customInstruction);
    for (const line of profile.initSteps.split('\n').map(line => line.trim()).filter(line => line.startsWith('-') && !line.includes('无需'))) {
      expect(fallback).toContain(line);
    }
  });

  it('keeps startup and conservative cumulative instruction payload below the pre-change baseline', () => {
    // 2026-10-25: Unicode code points / UTF-8 bytes, not tokens or provider billing.
    const beforeSkills = [3814, 474, 601, 2461, 1278, 851];
    const beforeSkillBytes = [8590, 1147, 1334, 5456, 2271, 1998];
    const entry = buildInitTriggerPrompt('/project', '已采集内容', '初始化约束');
    const direct = buildDirectCreatePrompt('测试项目', '已采集内容');
    const entryChars = Math.max(chars(entry), chars(direct));
    const entryBytes = Math.max(Buffer.byteLength(entry), Buffer.byteLength(direct));
    expect(chars(MINT_SYSTEM_PROMPT)).toBeLessThanOrEqual(19331);
    expect(chars(MINT_SYSTEM_PROMPT) + entryChars + chars(files[0]!)).toBeLessThanOrEqual(19331 + 219 + 3814);
    expect(chars(MINT_SYSTEM_PROMPT) + entryChars + files.reduce((n, s) => n + chars(s), 0))
      .toBeLessThanOrEqual(19331 + 219 + beforeSkills.reduce((n, s) => n + s, 0));
    expect(Buffer.byteLength(MINT_SYSTEM_PROMPT) + entryBytes + files.reduce((n, s) => n + Buffer.byteLength(s), 0))
      .toBeLessThanOrEqual(46625 + 473 + beforeSkillBytes.reduce((n, s) => n + s, 0));
  });

  it('keeps existing skill discovery identities and removes the retired collection instruction', () => {
    files.forEach((text, index) => {
      const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatter).not.toBeNull();
      expect(parse(frontmatter![1]!).name).toBe(skills[index]);
      expect(text).not.toContain('只回复"已确认"');
    });
  });
});
