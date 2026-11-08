import { useCallback, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Alert } from './alert';
import type { RemoteClientLike as RemoteClient } from '../transport/client-types';
import type {
  ModelCapabilities, OpenProject, PendingAsk, PermissionMode, SessionListItem, SessionSnapshot,
} from '../protocol/types';
import type { AskAnswer, ComposerControl, Page, ShellLog } from './types';
import type { DraftAttachment } from './attachments';
import { object, prependMessage } from './messages';
import { DRAFT_SESSION_ID, EMPTY_RUNTIME } from './runtime';
import type { PatchRuntime } from './runtime';

/**
 * 会话命令要写入的状态。
 * 会话级状态走 `patchRuntime(sessionId, ...)` 按会话落格；`setSession/sessions/...` 是界面导航状态，保持全局。
 */
export type SessionActionsStore = {
  patchRuntime: PatchRuntime;
  /** 新会话：`session.send` 拿到真实 id 后把草稿格状态迁过去 */
  migrateRuntime: (from: string, to: string) => void;
  /** 状态文案（按会话去重） */
  setMintStatus: (sessionId: string, value: string, icon?: string) => void;
  /** 回合标记：与 useRemoteEvents / applySnapshot 共享，清空状态栏时据此回落到「正在处理...」 */
  activeTurn: RefObject<Record<string, boolean>>;
  setPage: (page: Page) => void;
  setProject: (project: OpenProject | null) => void;
  setBusy: (value: boolean) => void;
  setChatOrigin: (origin: 'home' | 'sessions') => void;
  setComposerControl: (control: ComposerControl) => void;
  setSession: (session: SessionListItem | null) => void;
  setSessions: Dispatch<SetStateAction<SessionListItem[]>>;
  setDraft: (value: string) => void;
  setAttachments: Dispatch<SetStateAction<DraftAttachment[]>>;
  setModels: (value: ModelCapabilities | null) => void;
  setSettingsOpen: (value: boolean) => void;
  setMenuSession: (value: SessionListItem | null) => void;
  setRenameTitle: (value: string) => void;
};

export type SessionActionsOptions = {
  client: RemoteClient | null;
  project: OpenProject | null;
  session: SessionListItem | null;
  page: Page;
  running: boolean;
  draft: string;
  attachments: DraftAttachment[];
  permission: PermissionMode;
  thinking: string;
  model: string;
  menuSession: SessionListItem | null;
  renameTitle: string;
  pendingAsk: PendingAsk | null;
  fail: (error: unknown) => void;
  /** 快照落地到**该会话自己的格**（调用方给出会话 id，不做「当前会话」推断） */
  applySnapshot: (sessionId: string, snapshot: SessionSnapshot, duringRequest: unknown[]) => void;
  refreshSessions: (project: OpenProject) => Promise<void>;
  store: SessionActionsStore;
};

export type SessionActions = {
  openSession: (selected: SessionListItem, selectedProject?: OpenProject, origin?: 'home' | 'sessions') => Promise<void>;
  startNewSession: () => Promise<void>;
  send: () => Promise<void>;
  stop: () => Promise<void>;
  /** 停止单个后台命令 */
  stopShell: (shellId: string) => Promise<void>;
  /** 停止单个子 Agent（PC AgentBar 行内「停止」同一条命令：delegation.stop → stopDelegationTask） */
  stopAgent: (delegationId: string, taskIndex: number) => Promise<void>;
  /** 读后台命令日志尾部（查看完整输出） */
  readShellLog: (shellId: string) => Promise<ShellLog>;
  setRemoteSetting: (kind: 'permission' | 'thinking' | 'model', value: string) => Promise<void>;
  /** 回答提问：答案由提问卡自己收集（PC 同款），这里只负责递交；null/空列表 = 取消提问 */
  answerAsk: (answers: AskAnswer[] | null) => Promise<void>;
  renameSession: () => Promise<void>;
  setPinned: (pinned: boolean) => Promise<void>;
  archiveCurrent: (archived: boolean) => void;
};

/** 会话级命令（打开/新建/发送/中止/设置/问答/重命名/置顶/归档），全部走 RemoteClient.command */
export function useSessionActions(options: SessionActionsOptions): SessionActions {
  const {
    client, project, session, page, running, draft, attachments, permission, thinking, model,
    menuSession, renameTitle, pendingAsk, fail, applySnapshot, refreshSessions, store,
  } = options;

  /** 切换会话的请求序号：只有最新一次切换的快照允许落地（老快照回来晚会把新会话盖掉） */
  const openSeq = useRef(0);

  const openSession = useCallback(async (selected: SessionListItem, selectedProject = project, origin: 'home' | 'sessions' = page === 'sessions' ? 'sessions' : 'home') => {
    if (!client || !selectedProject) return;
    const sessionId = selected.sessionId;
    const seq = ++openSeq.current;
    // 请求在途时先收集实时事件；快照带应用事件游标，落地时只补游标之后的帧。
    const duringRequest: unknown[] = [];
    const off = client.onEvent((event, envelope) => {
      if (event.channel === 'agent:stream' && envelope.sessionId === sessionId) {
        duringRequest.push({ ...object(event.data), eventSequence: event.eventSequence });
      }
    });
    try {
      store.setBusy(true);
      store.setComposerControl(null);
      store.setAttachments([]);
      // 先把该会话**自己的格**清成空：不残留上次打开它时的消息/运行态/提问卡。
      // 清的是它自己，别的会话的格不动——这正是「每会话一份」的意义。
      store.setMintStatus(sessionId, '');
      store.activeTurn.current[sessionId] = false;
      store.patchRuntime(sessionId, {
        messages: [], running: false, pendingAsk: null,
        backgroundShells: [], backgroundAgents: [], contextUsage: { percent: null },
      });
      const [snapshot, capabilities] = await Promise.all([
        client.command<SessionSnapshot>('session.snapshot', { projectId: selectedProject.id, sessionId }),
        client.command<ModelCapabilities>('capability.models'),
      ]);
      // 期间又切了别的会话：这次快照作废（否则旧快照会把当前会话的内容盖成上一个会话的）
      if (seq !== openSeq.current) return;
      store.setProject(selectedProject); store.setSession(selected); store.setChatOrigin(origin);
      applySnapshot(sessionId, snapshot, duringRequest);
      store.setModels(capabilities); store.setPage('chat');
    } catch (e) { if (seq === openSeq.current) fail(e); } finally { off(); if (seq === openSeq.current) store.setBusy(false); }
  }, [applySnapshot, client, fail, page, project, store]);

  const startNewSession = useCallback(async () => {
    if (!client || !project) return;
    try {
      const [defaults, capabilities] = await Promise.all([
        client.command<{ permissionMode: PermissionMode; thinkingLevel: string; model?: string }>('session.create', { projectId: project.id }),
        client.command<ModelCapabilities>('capability.models'),
      ]);
      // 新会话写进草稿格（真实 id 要等 send 才知道）；重置干净，别的会话的格不动
      store.setMintStatus(DRAFT_SESSION_ID, '');
      store.patchRuntime(DRAFT_SESSION_ID, {
        ...EMPTY_RUNTIME,
        permission: defaults.permissionMode,
        thinking: defaults.thinkingLevel,
        model: defaults.model ?? '',
      });
      store.setComposerControl(null); store.setAttachments([]);
      store.setChatOrigin(page === 'home' ? 'home' : 'sessions'); store.setSession(null);
      store.setModels(capabilities); store.setPage('chat');
      // 作废在途的会话切换请求（新会话优先）
      openSeq.current += 1;
    } catch (e) { fail(e); }
  }, [client, fail, page, project, store]);

  const send = useCallback(async () => {
    if (!client || !project || (!draft.trim() && attachments.length === 0)) return;
    const text = draft.trim();
    const outgoingAttachments = attachments;
    // 未创建的新会话先写草稿格；send 拿到真实 id 后再迁过去
    const sessionId = session?.sessionId ?? DRAFT_SESSION_ID;
    store.setDraft('');
    store.setAttachments([]);
    store.setMintStatus(sessionId, '等待模型响应...');
    store.activeTurn.current[sessionId] = true;
    store.patchRuntime(sessionId, (current) => ({
      // running 与桌面端一样**乐观置位**（ChatPanel.tsx:2383 发送即 setBusy(true)）：
      // 状态栏与发送区的「停止」都要按 running 显示，等 session.send 回来才置位，
      // 这段网络往返里「等待模型响应...」和停止按钮都是不可见的。失败时在 catch 里回滚。
      running: true,
      // sentAt：本地回显拿不到 PC 时间戳（桌面端不会再把它广播回来），但回合「用时」要算上
      // 等待模型响应的那一段，所以用本机时钟做走秒锚点。它不参与 insertMessageByTime 的跨机排序。
      messages: prependMessage(current.messages, {
        id: `local-${Date.now()}`, role: 'user', text, attachments: outgoingAttachments, sentAt: Date.now(),
      }),
    }));
    try {
      const remoteAttachments = outgoingAttachments.map(({ name, kind, mimeType, data }) => ({ name, kind, mimeType, data }));
      if (session && running) {
        await client.command('session.steer', { projectId: project.id, sessionId: session.sessionId, data: { text, attachments: remoteAttachments } });
      } else {
        const result = await client.command<{ sessionId: string }>('session.send', {
          projectId: project.id, sessionId: session?.sessionId,
          data: { text, attachments: remoteAttachments, permissionMode: permission, thinkingLevel: thinking,
            ...(model ? { model } : {}) },
        });
        if (!session) {
          const created = { sessionId: result.sessionId, title: text.slice(0, 30) || outgoingAttachments[0]?.name || '附件', createdAt: Date.now(), updatedAt: Date.now() };
          store.migrateRuntime(DRAFT_SESSION_ID, result.sessionId);
          store.setSession(created);
          store.setSessions((current) => current.some((item) => item.sessionId === result.sessionId) ? current : [created, ...current]);
        }
        store.patchRuntime(result.sessionId, { running: true });
        store.activeTurn.current[result.sessionId] = true;
      }
    } catch (e) {
      // 乐观置位要回滚，否则发送失败后界面停在「运行中」：状态栏一直转、停止按钮按不动
      store.activeTurn.current[sessionId] = false;
      store.setMintStatus(sessionId, '');
      store.patchRuntime(sessionId, { running: false });
      fail(e);
    }
  }, [attachments, client, draft, fail, model, permission, project, running, session, store, thinking]);

  const stop = useCallback(async () => {
    if (!client || !project || !session) return;
    try {
      // 与桌面端同款：点停止先给「正在停止」（ChatPanel.tsx:2884 的 stopping 信号），
      // 否则等待 PC 确认的这几秒里状态栏还写着「正在回复」，用户会以为没点上而重复点。
      store.setMintStatus(session.sessionId, '正在停止');
      await client.command('session.abort', { projectId: project.id, sessionId: session.sessionId });
      store.setMintStatus(session.sessionId, '');
      store.activeTurn.current[session.sessionId] = false;
      store.patchRuntime(session.sessionId, { running: false });
    } catch (e) {
      // 桌面端在 SDK 停止超时会抛 ABORT_TIMEOUT（remote-command-router.ts 的 session.abort）。
      // 那不是「操作失败」而是「尚未确认停止」：会话可能仍在跑，保持 running、状态栏给可重试提示，
      // 不弹错误框。await 抛错时上面的 running:false 本就不会执行，这里不要再补一次。
      // 文案直接沿用桌面端那句（ChatPanel.tsx:2242），两边说的是同一件事、同样的建议。
      if ((e as { code?: string }).code === 'ABORT_TIMEOUT') {
        store.setMintStatus(session.sessionId, '停止尚未完成，当前会话仍在处理，请稍后重试');
      } else fail(e);
    }
  }, [client, fail, project, session, store]);

  /**
   * 停止单个后台命令（PC 的 ShellBar 行内「停止」同一条命令）。
   * 后台任务清单由 agent:shell-count 事件回写（PC 侧 registry 状态变化会广播），所以不必本地改列表。
   */
  const stopShell = useCallback(async (shellId: string) => {
    if (!client || !project || !session) return;
    try {
      await client.command('shell.stop', { projectId: project.id, sessionId: session.sessionId, data: { shellId } });
      // 乐观置 stopping：让按钮立刻变「停止中…」（PC 靠 registry 广播回写，链路上慢一拍）
      store.patchRuntime(session.sessionId, (current) => ({
        backgroundShells: current.backgroundShells.map((item) => item.id === shellId ? { ...item, status: 'stopping' as const } : item),
      }));
    } catch (e) { fail(e); }
  }, [client, fail, project, session, store]);

  /**
   * 停止单个子 Agent（PC AgentBar 行内「停止」同一条命令：delegation.stop）。
   * 载荷只递交 delegationId + taskIndex，能不能停由 PC 判定（归属校验见桌面端 remote-command-router 的 stopDelegation）；
   * 运行中清单由 agent:delegation-count 回写（PC 侧 abortTask 后立即广播），所以不必本地删行。
   */
  const stopAgent = useCallback(async (delegationId: string, taskIndex: number) => {
    if (!client || !project || !session) return;
    try {
      await client.command('delegation.stop', {
        projectId: project.id, sessionId: session.sessionId, data: { delegationId, taskIndex },
      });
      // 乐观置 stopping：让按钮立刻变「停止中…」（PC 靠 registry 广播回写，链路上慢一拍）。
      // 写在条目自己的 status 上而不是另存一份标记——syncBackground 是整表覆盖，回写到达即自然对账
      // （停止失败/未生效时任务仍在表里，状态会被 PC 的真值改回来，不会卡在「停止中…」）。
      store.patchRuntime(session.sessionId, (current) => ({
        backgroundAgents: current.backgroundAgents.map((item) => item.delegationId === delegationId && item.index === taskIndex ? { ...item, status: 'stopping' as const } : item),
      }));
    } catch (e) { fail(e); }
  }, [client, fail, project, session, store]);

  /**
   * 读后台命令日志尾部（「查看完整输出」的首屏数据）。
   * 与 PC 同口径：只传 shellId，本机日志路径由 PC 侧自己解析、不回传（见桌面端 remote-command-router）。
   */
  const readShellLog = useCallback(async (shellId: string): Promise<ShellLog> => {
    if (!client || !project || !session) return { content: '', truncated: false };
    return await client.command<ShellLog>('shell.readLog', {
      projectId: project.id, sessionId: session.sessionId, data: { shellId },
    });
  }, [client, project, session]);

  /** 会话级设置。供应商恒为桌面端全局当前供应商，故只传模型/等级/权限，不再带 provider */
  const setRemoteSetting = useCallback(async (kind: 'permission' | 'thinking' | 'model', value: string) => {
    const sessionId = session?.sessionId ?? DRAFT_SESSION_ID;
    if (kind === 'permission') store.patchRuntime(sessionId, { permission: value as PermissionMode });
    if (kind === 'thinking') store.patchRuntime(sessionId, { thinking: value });
    if (kind === 'model') store.patchRuntime(sessionId, { model: value });
    if (!client || !project || !session) return;
    try {
      const command = kind === 'permission' ? 'session.setPermission' : kind === 'thinking' ? 'session.setThinking' : 'session.setModel';
      const data = kind === 'permission' ? { mode: value } : kind === 'thinking' ? { level: value } : { model: value };
      await client.command(command, { projectId: project.id, sessionId: session.sessionId, data });
    } catch (e) { fail(e); }
  }, [client, fail, project, session, store]);

  const answerAsk = useCallback(async (answers: AskAnswer[] | null) => {
    if (!client || !project || !session || !pendingAsk) return;
    try {
      await client.command('session.answerAsk', { projectId: project.id, sessionId: session.sessionId,
        data: { requestId: pendingAsk.requestId, answers } });
      store.patchRuntime(session.sessionId, { pendingAsk: null });
    } catch (e) { fail(e); }
  }, [client, fail, pendingAsk, project, session, store]);

  const renameSession = useCallback(async () => {
    const target = menuSession ?? session;
    if (!client || !project || !target || !renameTitle.trim()) return;
    try {
      await client.command('session.rename', { projectId: project.id, sessionId: target.sessionId, data: { title: renameTitle.trim() } });
      const renamed = { ...target, title: renameTitle.trim() };
      store.setSessions((current) => current.map((item) => item.sessionId === target.sessionId ? renamed : item));
      if (session?.sessionId === target.sessionId) store.setSession(renamed);
      store.setMenuSession(renamed);
    } catch (e) { fail(e); }
  }, [client, fail, menuSession, project, renameTitle, session, store]);

  const setPinned = useCallback(async (pinned: boolean) => {
    const target = menuSession ?? session;
    if (!client || !project || !target) return;
    try {
      await client.command('session.pin', { projectId: project.id, sessionId: target.sessionId, data: { pinned } });
      const updated = { ...target, pinnedAt: pinned ? Date.now() : undefined };
      store.setSessions((current) => current.map((item) => item.sessionId === target.sessionId ? updated : item));
      if (session?.sessionId === target.sessionId) store.setSession(updated);
      store.setMenuSession(updated);
    } catch (e) { fail(e); }
  }, [client, fail, menuSession, project, session, store]);

  const archiveCurrent = useCallback((archived: boolean) => {
    const target = menuSession ?? session;
    if (!client || !project || !target) return;
    const perform = () => void client.command('session.archive', {
      projectId: project.id, sessionId: target.sessionId, data: { archived },
    }).then(() => { store.setSettingsOpen(false); store.setMenuSession(null); void refreshSessions(project); }).catch(fail);
    if (!archived) { perform(); return; }
    Alert.alert('归档会话？', target.title, [{ text: '取消', style: 'cancel' }, {
      text: '归档', style: 'destructive', onPress: perform,
    }]);
  }, [client, fail, menuSession, project, refreshSessions, session, store]);

  return { openSession, startNewSession, send, stop, stopShell, stopAgent, readShellLog, setRemoteSetting, answerAsk, renameSession, setPinned, archiveCurrent };
}
