import assert from 'node:assert/strict';
import test from 'node:test';
import { listRemoteProjects } from '../src/core/project-access.ts';

test('旧桌面只收到它支持的命令，已打开项目可直接进入', async () => {
  const calls = [];
  const client = { async command(name) {
    calls.push(name);
    if (name === 'capability.models') return { currentProvider: null, providers: [] };
    if (name === 'project.listOpen') return [{ id: 'p', name: 'P', status: 'development' }];
    throw new Error(`旧桌面不支持 ${name}`);
  } };
  assert.deepEqual(await listRemoteProjects(client), [{ id: 'p', name: 'P', status: 'development', open: true }]);
  assert.deepEqual(calls, ['capability.models', 'project.listOpen']);
});

test('新桌面使用全部项目命令，保留窗口状态', async () => {
  const calls = [];
  const client = { async command(name) {
    calls.push(name);
    if (name === 'capability.models') return { features: { projectBrowse: true } };
    if (name === 'project.list') return [{ id: 'p', open: false }];
    throw new Error(`意外命令 ${name}`);
  } };
  assert.deepEqual(await listRemoteProjects(client), [{ id: 'p', open: false }]);
  assert.deepEqual(calls, ['capability.models', 'project.list']);
});
