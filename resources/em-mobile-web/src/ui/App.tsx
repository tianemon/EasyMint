import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  ModelCapabilities, OpenProject, PermissionMode, SessionListItem, SessionSnapshot,
} from '../protocol/types';
import type { PcCredential, PairingOffer } from '../protocol/types';
import type { StoredDevice } from '../protocol/credential-store';
import {
  loadDevices, markDeviceConnected, removeDevice, saveDevice, setActiveDevice,
} from '../protocol/credential-store';
import { createPairingAttempt, pairWithPc } from '../protocol/remote-client';
import type { PairingAttempt } from '../protocol/remote-client';
import { fetchPairingPayload, requestPairingPayload } from '../protocol/pairing';
import { browserDeviceName } from '../core/device-name';
import type { AskAnswer, ComposerControl, ConnectionStatus, Page } from '../core/types';
import type { ShellLog } from '../core/types';
import type { DisplayMessage } from '../core/messages';
import { snapshotMessagesWithBuffer } from '../core/messages';
import { DRAFT_SESSION_ID, EMPTY_RUNTIME } from '../core/runtime';
import type { PatchRuntime, SessionRuntime } from '../core/runtime';
import { appendAttachments, pickAttachments } from '../core/attachments';
import type { AttachmentKind, DraftAttachment } from '../core/attachments';
import { THINKING_ORDER, resolveThinkingLevel } from '../core/thinking';
import { endCompacting } from '../core/compacting';
import { Alert } from '../core/alert';
import { useRemoteEvents } from '../core/useRemoteEvents';
import type { RemoteEventsStore } from '../core/useRemoteEvents';
import { useSessionActions } from '../core/useSessionActions';
import type { SessionActionsStore } from '../core/useSessionActions';
import { createTransportClient } from '../transport/client-proxy';
import type { TransportClient } from '../transport/client-proxy';
import { electLeader } from '../transport/leader';
import { AmbientBackground } from './components/AmbientBackground';
import { Header } from './components/Header';
import { Icon } from './components/icons';
import { HomeScreen } from './screens/HomeScreen';
import { PairGuideScreen } from './screens/PairGuideScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { SessionsScreen } from './screens/SessionsScreen';
import { ChatScreen } from './screens/ChatScreen';
import type { ChatShell } from './screens/ChatScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ArchiveSheet } from './screens/ArchiveSheet';
import { SessionMenuModal } from './screens/SessionMenuModal';
import { ShellOutputSheet } from './screens/ShellOutputSheet';
import { useTheme } from './theme';
import { t } from './i18n';

const HEALTH_PATH = 'health';

export default function App(): React.ReactElement {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [page, setPage] = useState<Page>('scanner');
  const [devices, setDevices] = useState<StoredDevice[]>([]);
  const [activePcId, setActivePcId] = useState<string | null>(null);
  const [client, setClient] = useState<TransportClient | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>('disconnected');
  const [bootReady, setBootReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingPcId, setPendingPcId] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [pairError, setPairError] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<OpenProject[]>([]);
  const [project, setProject] = useState<OpenProject | null>(null);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [session, setSession] = useState<SessionListItem | null>(null);
  const viewerId = useRef(`web-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const viewCapabilityClient = useRef<TransportClient | null>(null);
  const [viewSupported, setViewSupported] = useState(false);
  const [chatOrigin, setChatOrigin] = useState<'home' | 'sessions'>('home');
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [models, setModels] = useState<ModelCapabilities | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composerControl, setComposerControl] = useState<ComposerControl>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [menuSession, setMenuSession] = useState<SessionListItem | null>(null);
  const [viewingShell, setViewingShell] = useState<ChatShell | null>(null);
  useEffect(() => {
    viewCapabilityClient.current = null;
    setViewSupported(false);
    if (!client || connection !== 'connected') return;
    let cancelled = false;
    let pending = false;
    const probe = () => {
      if (pending) return;
      pending = true;
      void client.command<ModelCapabilities>('capability.models').then((capabilities) => {
        if (!cancelled) {
          window.clearInterval(timer);
          if (capabilities.features?.sessionView) { viewCapabilityClient.current = client; setViewSupported(true); }
        }
      }).catch(() => {}).finally(() => { pending = false; });
    };
    const timer = window.setInterval(probe, 20_000);
    probe();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [client, connection]);
  useEffect(() => {
    if (!client || connection !== 'connected' || !viewSupported || viewCapabilityClient.current !== client) return;
    const announce = () => {
      const visible = page === 'chat' && document.visibilityState === 'visible' && session?.sessionId && session.sessionId !== DRAFT_SESSION_ID && project?.id;
      void client.command('session.view', visible
        ? { projectId: project.id, sessionId: session.sessionId, data: { viewerId: viewerId.current } }
        : { data: { viewerId: viewerId.current } }).catch(() => {});
    };
    announce();
    const timer = page === 'chat' ? window.setInterval(announce, 20_000) : undefined;
    document.addEventListener('visibilitychange', announce);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', announce);
      void client.command('session.view', { data: { viewerId: viewerId.current } }).catch(() => {});
    };
  }, [client, connection, viewSupported, page, project?.id, session?.sessionId]);
  const [isLeader, setIsLeader] = useState<boolean | null>(null);

  const [runtime, setRuntime] = useState<Record<string, SessionRuntime>>({});
  const patchRuntime = useCallback<PatchRuntime>((sessionId, patch) => {
    setRuntime((current) => {
      const base = current[sessionId] ?? EMPTY_RUNTIME;
      const next = typeof patch === 'function' ? patch(base) : patch;
      return { ...current, [sessionId]: { ...base, ...next } };
    });
  }, []);
  const migrateRuntime = useCallback((from: string, to: string): void => {
    setRuntime((current) => {
      const moved = current[from];
      if (!moved || from === to) return current;
      const { [from]: _discard, ...rest } = current;
      return { ...rest, [to]: { ...(current[to] ?? EMPTY_RUNTIME), ...moved } };
    });
  }, []);
  const syncBackground = useCallback((kind: 'shell' | 'delegation', items: { sessionId?: string }[]): void => {
    setRuntime((current) => {
      const grouped: Record<string, unknown[]> = {};
      for (const item of items) {
        if (!item.sessionId) continue;
        (grouped[item.sessionId] ??= []).push(item);
      }
      const next: Record<string, SessionRuntime> = {};
      for (const [sid, rt] of Object.entries(current)) {
        next[sid] = kind === 'shell'
          ? { ...rt, backgroundShells: (grouped[sid] ?? []) as SessionRuntime['backgroundShells'] }
          : { ...rt, backgroundAgents: (grouped[sid] ?? []) as SessionRuntime['backgroundAgents'] };
      }
      return next;
    });
  }, []);

  const shellChunkListeners = useRef(new Set<(shellId: string, chunk: string) => void>());
  const emitShellChunk = useCallback((shellId: string, chunk: string): void => {
    for (const listener of shellChunkListeners.current) listener(shellId, chunk);
  }, []);
  const subscribeShellChunks = useCallback((listener: (shellId: string, chunk: string) => void): (() => void) => {
    shellChunkListeners.current.add(listener);
    return () => { shellChunkListeners.current.delete(listener); };
  }, []);

  const credential = useMemo(() => devices.find((item) => item.pcId === activePcId) ?? null, [activePcId, devices]);
  const activeSessionId = session?.sessionId ?? DRAFT_SESSION_ID;
  const active = runtime[activeSessionId] ?? EMPTY_RUNTIME;
  const {
    messages, running, mintStatus, mintIcon, compacting, pendingAsk, backgroundShells, backgroundAgents,
    contextUsage, permission, thinking, thinkingOptions, model,
  } = active;

  const mintStatusRef = useRef<Record<string, string>>({});
  const updateMintStatus = useCallback((sessionId: string, value: string, icon?: string) => {
    const key = `${icon ?? ''}|${value}`;
    if ((mintStatusRef.current[sessionId] ?? '') === key) return;
    mintStatusRef.current[sessionId] = key;
    patchRuntime(sessionId, { mintStatus: value, mintIcon: icon ?? '' });
  }, [patchRuntime]);

  const fail = useCallback((value: unknown) => {
    setError(value instanceof Error ? value.message : String(value));
  }, []);

  // ── 启动：读凭证、处理 #p= 短码 ──────────────────────────────────────────
  useEffect(() => {
    let alive = true;

    // 首帧兜底：IndexedDB 被节流、Worker 未就绪等都可能让 loadDevices 迟迟不返回，
    // 而 bootReady=false 的渲染是空白 div —— 用户看到的就是「打开什么都没有」。
    // 2.5 秒还没就绪就先放行到配对页（那时再读不出凭证，也至少有个入口）。
    const guard = window.setTimeout(() => {
      if (!alive) return;
      setBootReady(true);
    }, 2_500);

    const boot = async (): Promise<void> => {
      try {
        // 不再从 URL 收凭证：iOS 的主屏 web app 有独立存储分区，唯一可靠的做法是
        // **先添加到主屏、再从主屏打开配对**，让凭证一开始就落在主屏容器里。
        // （之前把凭证压进 manifest 的 start_url，iOS 添加时并不接受这个 Blob manifest。）
        const book = await loadDevices();
        if (!alive) return;
        setDevices(book.devices);
        setActivePcId(book.activePcId);
        if (book.activePcId) setConnection('connecting');
        setPage(book.activePcId ? 'home' : 'scanner');
        setBootReady(true);
      } catch (e) {
        // 凭证读取失败也必须放行首帧，否则页面永远停在空白 boot 态（与 RN 版 .finally 同口径）。
        fail(e);
        if (alive) setBootReady(true);
      } finally {
        window.clearTimeout(guard);
      }
    };
    void boot();
    return () => { alive = false; window.clearTimeout(guard); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // leader 选举：多标签只有一条 WS。
  useEffect(() => electLeader(setIsLeader), []);

  // /health 探活（契约 C5：只依赖同源静态资源与探活）。
  useEffect(() => {
    const probe = (): void => {
      void fetch(HEALTH_PATH, { method: 'GET', cache: 'no-store' }).catch(() => undefined);
    };
    probe();
    const timer = setInterval(probe, 30_000);
    return () => clearInterval(timer);
  }, []);

  // 配对材料（密钥对 / deviceId / 验证码）跨重试复用：桌面端 handlePairInit 用 offer 私钥 + 手机公钥
  // 算同一个 6 位码，重试时若重新生成密钥对或换 deviceId，PC 上那串数字就与手机对不上了。
  const pairOfferRef = useRef<PairingOffer | null>(null);
  const pairAttemptRef = useRef<PairingAttempt | null>(null);

  const runPair = useCallback(async (offer: PairingOffer, attempt: PairingAttempt): Promise<void> => {
    setPairError('');
    if (offer.expiresAt <= Date.now()) {
      setPairError('配对二维码已过期，请在电脑上重新生成');
      return;
    }
    setPairingBusy(true);
    try {
      const stored: PcCredential = await pairWithPc(offer, browserDeviceName(), (code) => setPairCode(code), attempt);
      const book = await saveDevice(stored);
      setDevices(book.devices);
      setActivePcId(book.activePcId);
      // 配对成功后才清除短码 fragment：失败/过期时保留，刷新可重试。
      history.replaceState(null, '', location.pathname + location.search);
      pairOfferRef.current = null;
      pairAttemptRef.current = null;
      setPairCode('');
      setPage('home');
    } catch (e) {
      // 保留 pairCode：PC 端需要用户人工比对同一个码。WS 不可达 / 被拒绝时不能把码清掉，
      // 否则用户只能重新扫码；retryPair 复用同一 attempt，验证码恒定、可反复重试。
      setPairError(e instanceof Error ? e.message : String(e));
      setPage('scanner');
    } finally {
      setPairingBusy(false);
    }
  }, []);

  const handlePair = useCallback(async (code: string): Promise<void> => {
    setPairCode('');
    setPairError('');
    setPage('scanner');
    let offer: PairingOffer;
    let attempt: PairingAttempt;
    try {
      offer = await fetchPairingPayload(code);
      attempt = createPairingAttempt(offer);
    } catch (e) {
      setPairError(e instanceof Error ? e.message : String(e));
      return;
    }
    pairOfferRef.current = offer;
    pairAttemptRef.current = attempt;
    // 建立连接之前先把 6 位验证码显示出来（pairWithPc 内部会再回调一次，值相同、幂等）。
    setPairCode(attempt.code);
    await runPair(offer, attempt);
  }, [runPair]);

  /**
   * 用户点「开始配对」：让电脑端现场签发一份配对材料。
   *
   * **不看 URL 里的短码**。扫码只负责「打开页面 + 添加到主屏幕」；iOS 从主屏启动会把
   * `#p=` 丢掉，如果配对依赖它，主屏那一次就永远配不上。页面既然已经访问到电脑端，
   * 直接要一份材料就行。凭证落在**当前这个容器**里，所以从主屏配出来能一直用。
   */
  const startPendingPair = useCallback(async (): Promise<void> => {
    setPairCode('');
    setPairError('');
    setPage('scanner');
    setPairingBusy(true);
    try {
      const offer = await requestPairingPayload();
      const attempt = createPairingAttempt(offer);
      pairOfferRef.current = offer;
      pairAttemptRef.current = attempt;
      setPairCode(attempt.code);
      await runPair(offer, attempt);
    } catch (e) {
      setPairError(e instanceof Error ? e.message : String(e));
    } finally {
      setPairingBusy(false);
    }
  }, [runPair]);

  const retryPair = useCallback(() => {
    const offer = pairOfferRef.current;
    const attempt = pairAttemptRef.current;
    if (!offer || !attempt) return;
    void runPair(offer, attempt);
  }, [runPair]);

  // ── 连接：credential 变化时建/拆传输客户端 ─────────────────────────────
  useEffect(() => {
    if (!credential || isLeader !== true) { setClient(null); return; }
    const next = createTransportClient(credential);
    setClient(next);
    setConnection('connecting');
    const offStatus = next.onStatus(setConnection);
    const offResume = next.onResume(() => {
      void refreshHomeSessionsRef.current?.();
    });
    // 电脑端撤销了这台设备：清掉本地凭证并回到配对页。
    // 不清的话，页面会一直认为「已配对」，进设备列表却什么都连不上（电脑上也没有这条记录了）。
    const offRevoked = next.onPairingRevoked(() => {
      void (async () => {
        try {
          const book = await removeDevice(credential.pcId);
          setDevices(book.devices);
          setActivePcId(book.activePcId);
          setProject(null);
          setSessions([]);
          // 还有别的电脑就回设备列表，一台都不剩才去配对页
          setPage(book.activePcId ? 'home' : 'scanner');
          setError('这台电脑上的配对已失效，请重新扫码配对');
        } catch (e) {
          fail(e);
        }
      })();
    });
    return () => { offStatus(); offResume(); offRevoked(); next.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credential, isLeader]);

  const openingProjectRef = useRef(false);

  const refreshProjects = useCallback(async () => {
    if (!client) return;
    // 开窗 inflight 时 project:open-windows-changed 也会触发本刷新：只更新列表，
    // 不切页、不抢 busy，否则会把正在进入会话页的流程拽回项目列表。
    const opening = openingProjectRef.current;
    try {
      if (!opening) setBusy(true);
      setProjects(await client.command<OpenProject[]>('project.list'));
      if (!opening) setPage('projects');
    } catch (e) { fail(e); } finally { if (!opening) setBusy(false); }
  }, [client, fail]);

  const refreshSessions = useCallback(async (selected: OpenProject | null = project) => {
    if (!client || !selected) return;
    try {
      setBusy(true);
      let target = selected;
      // 未打开的项目先让桌面端开窗口；project.open 会等窗口登记完成才返回
      if (!target.open) {
        openingProjectRef.current = true;
        await client.command('project.open', { projectId: target.id });
        target = { ...target, open: true };
        setProjects((prev) => prev.map((item) => (item.id === target.id ? target : item)));
      }
      setSessions(await client.command<SessionListItem[]>('session.list', { projectId: target.id }));
      setProject(target);
      setPage('sessions');
    } catch (e) { fail(e); } finally { openingProjectRef.current = false; setBusy(false); }
  }, [client, fail, project]);

  const projectIdRef = useRef<string | null>(project?.id ?? null);
  projectIdRef.current = project?.id ?? null;

  const refreshHomeSessions = useCallback(async (revealProjects = false) => {
    if (!client) return;
    try {
      const projects = await client.command<OpenProject[]>('project.list');
      // 首页只拉已打开项目的会话；未打开的从项目列表点进去时会先开窗
      const selected = projects.find((item) => item.id === projectIdRef.current && item.open)
        ?? projects.find((item) => item.open) ?? null;
      setProjects(projects);
      setProject(selected);
      setSessions(selected ? await client.command<SessionListItem[]>('session.list', { projectId: selected.id }) : []);
      // 桌面端没有任何已打开项目时，别把用户丢在空白会话页
      if (revealProjects && !selected) setPage('projects');
    } catch (e) { fail(e); }
  }, [client, fail]);
  const refreshHomeSessionsRef = useRef(refreshHomeSessions);
  refreshHomeSessionsRef.current = refreshHomeSessions;

  const reloadSessions = useCallback(async () => {
    if (!client || !project) return;
    try { setSessions(await client.command<SessionListItem[]>('session.list', { projectId: project.id })); }
    catch (e) { fail(e); }
  }, [client, fail, project]);

  useEffect(() => {
    if (connection !== 'connected' || !credential) return;
    void refreshHomeSessions(true);
    void markDeviceConnected(credential.pcId).catch(() => undefined);
  }, [connection, credential, refreshHomeSessions]);

  const streamMessageIds = useRef<Record<string, string | null>>({});
  const activeTurn = useRef<Record<string, boolean>>({});
  const applySnapshot = useCallback((sessionId: string, snapshot: SessionSnapshot, duringRequest: unknown[]) => {
    const recovered = snapshotMessagesWithBuffer(snapshot, duringRequest);
    streamMessageIds.current[sessionId] = recovered.messages.find((item) => item.streaming)?.id ?? null;
    activeTurn.current[sessionId] = recovered.running;
    const available = snapshot.thinking?.available;
    updateMintStatus(sessionId, '');
    endCompacting(sessionId);
    patchRuntime(sessionId, {
      messages: recovered.messages,
      running: recovered.running,
      compacting: false,
      permission: snapshot.cache?.permissionMode ?? 'standard',
      thinking: snapshot.thinking?.level ?? snapshot.cache?.thinkingLevel ?? 'medium',
      thinkingOptions: available?.length ? THINKING_ORDER.filter((level) => available.includes(level)) : [...THINKING_ORDER],
      model: snapshot.cache?.model ?? '',
      pendingAsk: snapshot.pendingAsks[0] ?? null,
      backgroundShells: snapshot.background?.shells ?? [],
      backgroundAgents: snapshot.background?.agents ?? [],
      contextUsage: { percent: null },
    });
    setRenameTitle(snapshot.session.title);
  }, [patchRuntime, updateMintStatus]);

  const sessionStore = useMemo<SessionActionsStore>(() => ({
    patchRuntime, migrateRuntime, setMintStatus: updateMintStatus, activeTurn,
    setPage, setProject, setBusy, setChatOrigin, setComposerControl, setSession, setSessions, setDraft, setAttachments,
    setModels, setSettingsOpen, setMenuSession, setRenameTitle,
  }), [activeTurn, migrateRuntime, patchRuntime, updateMintStatus]);

  const remoteStore = useMemo<RemoteEventsStore>(() => ({
    patchRuntime, setMintStatus: updateMintStatus, syncBackground, emitShellChunk,
  }), [emitShellChunk, patchRuntime, syncBackground, updateMintStatus]);

  const actions = useSessionActions({
    client, project, session, page, running, draft, attachments, permission, thinking, model,
    menuSession, renameTitle, pendingAsk, fail, applySnapshot, refreshSessions, store: sessionStore,
  });
  const submitAsk = useCallback((answers: AskAnswer[] | null) => { void actions.answerAsk(answers); }, [actions.answerAsk]);

  useRemoteEvents({
    client, deviceId: credential?.deviceId, page, project, session, streamMessageIds, activeTurn,
    refreshHome: refreshHomeSessions, refreshProjects, refreshSessions, store: remoteStore,
  });

  const openSessionMenu = useCallback((item: SessionListItem) => {
    setMenuSession(item); setRenameTitle(item.title); setSettingsOpen(true);
  }, []);

  const resetDeviceState = useCallback(() => {
    setProject(null); setSessions([]); setSession(null); setRuntime({});
    streamMessageIds.current = {}; activeTurn.current = {};
  }, []);

  const openDevice = useCallback(async (device: StoredDevice) => {
    if (device.pcId === activePcId) {
      if (connection === 'connected') setPage('sessions');
      else if (connection === 'connecting') setPendingPcId(device.pcId);
      else void client?.connect().catch(fail);
      return;
    }
    try {
      setConnection('connecting');
      resetDeviceState();
      const book = await setActiveDevice(device.pcId);
      setDevices(book.devices);
      setActivePcId(book.activePcId);
      setPendingPcId(device.pcId);
    } catch (e) { setConnection('disconnected'); fail(e); }
  }, [activePcId, client, connection, fail, resetDeviceState]);

  useEffect(() => {
    if (connection === 'connected' && project && pendingPcId && pendingPcId === activePcId) {
      setPendingPcId(null);
      setPage('sessions');
    }
  }, [activePcId, connection, pendingPcId, project]);

  const forgetPc = useCallback(() => {
    if (!credential) return;
    Alert.alert('移除此电脑？', `将删除与「${credential.pcName}」的配对凭证。会话数据从未保存在手机上。`, [
      { text: '取消', style: 'cancel' },
      { text: '移除', style: 'destructive', onPress: () => void removeDevice(credential.pcId).then((book) => {
        setDevices(book.devices); setActivePcId(book.activePcId);
        resetDeviceState(); setConnection(book.activePcId ? 'connecting' : 'disconnected');
        setPage(book.activePcId ? 'home' : 'scanner'); setArchiveOpen(false);
        if (!book.activePcId) { client?.dispose(); setClient(null); setConnection('disconnected'); }
      }).catch(fail) },
    ]);
  }, [client, credential, fail, resetDeviceState]);

  const restoreArchived = useCallback(async (item: SessionListItem): Promise<boolean> => {
    if (!client || !project) return false;
    try {
      await client.command('session.archive', { projectId: project.id, sessionId: item.sessionId, data: { archived: false } });
      await reloadSessions();
      return true;
    } catch (e) { fail(e); return false; }
  }, [client, fail, project, reloadSessions]);

  const goBack = useCallback(() => {
    if (settingsOpen) { setSettingsOpen(false); setMenuSession(null); return; }
    if (page === 'scanner') { if (devices.length) setPage('home'); return; }
    if (page === 'chat') {
      if (chatOrigin === 'sessions') { setPage('sessions'); void refreshSessions(project); }
      else { setPage('home'); void refreshHomeSessions(); }
      return;
    }
    if (page === 'sessions' || page === 'projects' || page === 'settings') setPage('home');
  }, [chatOrigin, devices.length, page, project, refreshHomeSessions, refreshSessions, settingsOpen]);

  const statusLabel = connection === 'connected' ? t('app.connected') : connection === 'connecting' ? t('app.connecting') : t('app.disconnected');
  const activeModelProvider = useMemo(() => models?.providers.find((item) => item.id === models.currentProvider) ?? null, [models]);
  const activeModelCapabilities = useMemo(() => {
    const selected = model || activeModelProvider?.currentModel;
    return activeModelProvider?.models.find((item) => item.id === selected) ?? null;
  }, [activeModelProvider, model]);
  useEffect(() => {
    const declared = activeModelCapabilities?.thinkingLevels;
    const available = declared?.length ? THINKING_ORDER.filter((level) => declared.includes(level)) : [...THINKING_ORDER];
    patchRuntime(activeSessionId, (current) => ({
      thinkingOptions: available,
      thinking: resolveThinkingLevel(current.thinking, available),
    }));
  }, [activeModelCapabilities, activeSessionId, patchRuntime]);
  const permissionLabel = permission === 'readonly' ? '只读' : permission === 'full' ? '完全访问' : '标准';

  const composerHandlers = useMemo(() => ({
    onDraftChange: setDraft,
    onControlChange: setComposerControl,
    onSend: () => void actions.send(),
    onStop: () => void actions.stop(),
    onSelectModel: (modelId: string) => void actions.setRemoteSetting('model', modelId),
    onSelectPermission: (mode: PermissionMode) => void actions.setRemoteSetting('permission', mode),
    onSelectThinking: (level: string) => void actions.setRemoteSetting('thinking', level),
    onPickAttachments: (kind: AttachmentKind) => void pickAttachments(kind, client?.encodeFiles).then((items) => {
      if (!items.length) return;
      const result = appendAttachments(attachments, items);
      setAttachments(result.next);
      if (result.notice) setError(result.notice);
    }).catch(fail),
    onRemoveAttachment: (id: string) => setAttachments((current: DraftAttachment[]) => current.filter((item) => item.id !== id)),
  }), [actions.send, actions.stop, actions.setRemoteSetting, attachments, client, fail]);

  const composer = useMemo(() => ({
    draft, attachments, running, compacting, hasSession: !!session, permission, permissionLabel, thinking,
    thinkingOptions, model, provider: activeModelProvider, contextPercent: contextUsage.percent,
    contextWindow: contextUsage.maxTokens ?? null, control: composerControl, ...composerHandlers,
  }), [activeModelProvider, attachments, compacting, composerControl, composerHandlers, contextUsage.maxTokens,
    contextUsage.percent, draft, model, permission, permissionLabel, running, session, thinking, thinkingOptions]);

  if (!bootReady) return <div className="boot loading">正在打开 EasyMint…</div>;
  if (isLeader === false) return (
    <div className="screen leader-blocked">
      <AmbientBackground />
      <div className="leader-inner">
        <Icon name="plusChat" size={36} />
        <h1>{t('app.leaderBlocked')}</h1>
        <p>{t('app.leaderHint')}</p>
      </div>
    </div>
  );

  let content: React.ReactNode;
  if (page === 'scanner') content = <PairGuideScreen pairCode={pairCode} error={pairError || error}
    onStartPair={() => void startPendingPair()}
    onCancel={devices.length ? goBack : undefined}
    onRetry={pairError && pairCode ? retryPair : undefined} retrying={pairingBusy}
    onSubmitCode={(code) => void handlePair(code)} />;
  else if (busy) content = <div className="screen"><Header title="EasyMint" /><div className="boot loading">正在加载 EasyMint…</div></div>;
  else if (page === 'home') content = <HomeScreen
    devices={devices} activePcId={activePcId} connection={connection}
    pairCode={pairCode} error={error}
    onOpenDevice={(device) => void openDevice(device)}
    onAddDevice={() => setPage('scanner')}
    onOpenSettings={() => setPage('settings')} />;
  else if (page === 'settings') content = <SettingsScreen device={credential} connection={connection}
    themeMode={themeMode} onThemeMode={setThemeMode}
    onBack={() => setPage('home')} onRepair={() => setPage('scanner')} onForget={forgetPc} />;
  else if (page === 'projects') content = <ProjectsScreen projects={projects} statusLabel={statusLabel}
    onBack={() => setPage('home')} onOpenProject={(item) => void refreshSessions(item)} />;
  else if (page === 'sessions') content = <SessionsScreen project={project} sessions={sessions}
    onOpenArchive={() => setArchiveOpen(true)} onBack={goBack} onSwitchProject={() => void refreshProjects()}
    onOpenSession={(item) => void actions.openSession(item)} onLongPressSession={openSessionMenu}
    onNewSession={() => void actions.startNewSession()} />;
  else content = <ChatScreen key={activeSessionId} title={session?.title ?? t('app.newSession')} connection={connection} messages={messages as DisplayMessage[]}
    pendingAsk={pendingAsk} onAnswerSubmit={submitAsk}
    backgroundShells={backgroundShells} backgroundAgents={backgroundAgents}
    onOpenShellOutput={(shell) => setViewingShell({ id: shell.id, command: shell.command })}
    onStopShell={(shellId) => void actions.stopShell(shellId)}
    onStopAgent={(delegationId, taskIndex) => void actions.stopAgent(delegationId, taskIndex)}
    running={running} mintStatus={mintStatus} mintIcon={mintIcon} composer={composer} onBack={goBack} />;

  return (
    <div className="app">
      <AmbientBackground />
      <div className="app-shell">
        {content}
        {error && !busy && page !== 'scanner' && page !== 'home' && (
          <div className="remote-error-banner" role="alert" onClick={() => setError('')}>{error}</div>
        )}
        <SessionMenuModal visible={settingsOpen} session={menuSession} renameTitle={renameTitle}
          onRenameTitleChange={setRenameTitle}
          onDismiss={() => { setSettingsOpen(false); setMenuSession(null); }}
          onRequestClose={() => setSettingsOpen(false)}
          onRename={() => void actions.renameSession()}
          onTogglePin={() => { if (menuSession) void actions.setPinned(!menuSession.pinnedAt); }}
          onToggleArchive={() => { if (menuSession) actions.archiveCurrent(!menuSession.archivedAt); }} />
        <ShellOutputSheet visible={!!viewingShell}
          shell={viewingShell ? { id: viewingShell.id, command: viewingShell.command,
            running: backgroundShells.some((item) => item.id === viewingShell.id) } : null}
          loadLog={actions.readShellLog as (shellId: string) => Promise<ShellLog>}
          subscribeChunks={subscribeShellChunks}
          onStop={(shellId) => void actions.stopShell(shellId)} onClose={() => setViewingShell(null)} />
        <ArchiveSheet visible={archiveOpen} sessions={sessions.filter((item) => item.archivedAt)}
          onClose={() => setArchiveOpen(false)}
          onRestore={(item) => { void restoreArchived(item).then((ok) => { if (ok) setArchiveOpen(false); }); }} />
      </div>
    </div>
  );
}
