/**
 * 本机客户端标识：让「同一台设备」在电脑端只留一条配对记录。
 *
 * 桌面端 `acceptPair` 按 deviceId 覆盖（先 filter 再 push），所以只要手机每次报同一个
 * deviceId，重复配对就只会刷新那条记录的 sharedSecret，而不会堆出一串 `web-xxxx`。
 *
 * 读取顺序：本机 localStorage → 内存。localStorage 被禁用时退到内存（本次会话内仍稳定）。
 * iOS「添加到主屏幕」的独立 web app 与 Safari 分属不同的存储分区，所以在那边这里通常是空的；
 * 那种情况由 `install-link.ts` 把 deviceId 随 start_url 带过去并回填。
 */
const KEY = 'easymint.web.client.v1';

let memory: string | null = null;

function randomKey(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 本机稳定的客户端 key（不含 `web-` 前缀），首次调用时生成并落盘。 */
export function clientKey(): string {
  if (memory) return memory;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && /^[a-z0-9]{8,32}$/.test(stored)) { memory = stored; return stored; }
  } catch {
    // 隐私模式 / 存储被禁：继续走生成 + 内存
  }
  const created = randomKey();
  memory = created;
  try { localStorage.setItem(KEY, created); } catch { /* 只留内存 */ }
  return created;
}

/** 把外部带进来的 key 收下（主屏启动时从 start_url 回填），保证与浏览器端是同一条设备记录。 */
export function adoptClientKey(value: string): void {
  if (!/^[a-z0-9]{8,32}$/.test(value)) return;
  if (memory === value) return;
  memory = value;
  try { localStorage.setItem(KEY, value); } catch { /* 只留内存 */ }
}

/** 电脑端看到的设备 id（`web-` 前缀用于单独撤销浏览器设备）。 */
export function webDeviceId(): string {
  return `web-${clientKey()}`;
}
