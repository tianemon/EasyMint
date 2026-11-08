import { getRandomBytes } from '../protocol/web-random';

/**
 * BroadcastChannel leader 选举：多标签页只有 leader 持有唯一一条 WebSocket。
 * 不写 localStorage（契约 C6）。不支持 BroadcastChannel 时降级为单实例（直接成为 leader）。
 */
const CHANNEL = 'easymint-web-leader';

function shortId(): string {
  const b = getRandomBytes(8);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function electLeader(onChange: (isLeader: boolean) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') {
    onChange(true);
    return () => undefined;
  }
  const id = shortId();
  const channel = new BroadcastChannel(CHANNEL);
  let isLeader = false;
  let knownLeader: string | null = null;
  let electionTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const becomeLeader = (): void => {
    if (closed) return;
    isLeader = true;
    knownLeader = id;
    onChange(true);
    channel.postMessage({ type: 'leader', id });
  };

  const startElection = (): void => {
    if (electionTimer !== null) clearTimeout(electionTimer);
    electionTimer = setTimeout(() => { if (!knownLeader && !closed) becomeLeader(); }, 350);
  };

  channel.onmessage = (event: MessageEvent) => {
    const message = (event.data ?? {}) as { type?: string; id?: string };
    if (!message.id || message.id === id || closed) return;
    if (message.type === 'who') {
      if (isLeader) channel.postMessage({ type: 'leader', id });
      return;
    }
    if (message.type === 'leader') {
      knownLeader = message.id;
      if (electionTimer !== null) { clearTimeout(electionTimer); electionTimer = null; }
      if (isLeader) {
        // 冲突时 id 小者胜，避免双 leader 各持一条 WS。
        if (message.id < id) { isLeader = false; onChange(false); }
        else channel.postMessage({ type: 'leader', id });
      } else {
        onChange(false);
      }
      return;
    }
    if (message.type === 'resign' && knownLeader === message.id) {
      knownLeader = null;
      startElection();
    }
  };

  channel.postMessage({ type: 'who', id });
  startElection();

  return () => {
    closed = true;
    if (electionTimer !== null) clearTimeout(electionTimer);
    if (isLeader) channel.postMessage({ type: 'resign', id });
    channel.close();
  };
}
