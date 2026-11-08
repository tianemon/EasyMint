import * as SecureStore from './idb';
import type { PcCredential } from './types';

/**
 * 已配对电脑 + 本机记住的最后在线时间。
 *
 * `lastConnectedAt` 只服务设备列表上的「上次 …」文案，不参与任何协议载荷；
 * 协议用的 `PcCredential` 保持原样（它是桌面端类型的镜像，不能加字段）。
 */
export type StoredDevice = PcCredential & { lastConnectedAt?: number };

export type DeviceBook = { devices: StoredDevice[]; activePcId: string | null };

/** 多设备：一条记录装下整个设备本（含当前选中），避免两份 key 各自写坏后对不上 */
const KEY = 'easymint.pc-devices.v1';
/** 迁移用：旧版只存单条 */
const LEGACY_KEY = 'easymint.pc-credential.v1';

const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

function isCredential(value: unknown): value is PcCredential {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PcCredential>;
  return item.version === 1 && typeof item.pcId === 'string' && !!item.pcId
    && typeof item.sharedSecret === 'string' && !!item.sharedSecret
    && Array.isArray(item.addresses);
}

/** 去重 + 丢掉坏记录：设备本一旦写坏，宁可少一台也不要每次启动都抛 */
function sanitize(value: unknown): DeviceBook {
  if (!value || typeof value !== 'object') return { devices: [], activePcId: null };
  const raw = value as { devices?: unknown; activePcId?: unknown };
  const devices = Array.isArray(raw.devices) ? raw.devices.filter(isCredential) : [];
  const activePcId = typeof raw.activePcId === 'string' && devices.some((item) => item.pcId === raw.activePcId)
    ? raw.activePcId
    : devices[0]?.pcId ?? null;
  return { devices, activePcId };
}

async function persist(book: DeviceBook): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify({ version: 1, ...book }), OPTIONS);
}

/** 首次启动：把旧版单条凭证迁进设备本，然后删掉旧 key */
async function migrateLegacy(): Promise<DeviceBook> {
  const raw = await SecureStore.getItemAsync(LEGACY_KEY);
  if (!raw) return { devices: [], activePcId: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isCredential(parsed)) return { devices: [], activePcId: null };
    const book: DeviceBook = { devices: [{ ...parsed }], activePcId: parsed.pcId };
    await persist(book);
    await SecureStore.deleteItemAsync(LEGACY_KEY);
    return book;
  } catch {
    return { devices: [], activePcId: null };
  }
}

/** 读设备本；旧数据只在这里迁移一次 */
export async function loadDevices(): Promise<DeviceBook> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return migrateLegacy();
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    // 新 key 写坏了（极少见：SecureStore 被外部改写/迁移中断）就退回旧 key 再试一次，
    // 比直接判「没有设备」好——那会让用户以为配对丢了，只能重新扫码
    return migrateLegacy();
  }
}

/**
 * 保存（新增或更新）一台设备，默认把它设为当前设备。
 * 返回整个设备本，调用方直接拿去 setState，不用二次读盘。
 */
export async function saveDevice(credential: PcCredential, options: { activate?: boolean } = {}): Promise<DeviceBook> {
  const current = await loadDevices();
  const existing = current.devices.find((item) => item.pcId === credential.pcId);
  const next: StoredDevice = { ...existing, ...credential };
  const devices = existing
    ? current.devices.map((item) => (item.pcId === credential.pcId ? next : item))
    : [...current.devices, next];
  const book: DeviceBook = {
    devices,
    activePcId: options.activate === false ? current.activePcId ?? credential.pcId : credential.pcId,
  };
  await persist(book);
  return book;
}

/** 切换当前设备（只改指针，不碰凭证） */
export async function setActiveDevice(pcId: string): Promise<DeviceBook> {
  const current = await loadDevices();
  if (!current.devices.some((item) => item.pcId === pcId)) return current;
  const book: DeviceBook = { ...current, activePcId: pcId };
  await persist(book);
  return book;
}

/** 移除一台设备；移除的是当前设备时，指针落到剩下第一台 */
export async function removeDevice(pcId: string): Promise<DeviceBook> {
  const current = await loadDevices();
  const devices = current.devices.filter((item) => item.pcId !== pcId);
  const book: DeviceBook = {
    devices,
    activePcId: current.activePcId === pcId ? devices[0]?.pcId ?? null : current.activePcId,
  };
  await persist(book);
  return book;
}

/** 连接成功后记一次在线时间（设备列表的「上次 …」要靠它） */
export async function markDeviceConnected(pcId: string): Promise<DeviceBook> {
  const current = await loadDevices();
  const target = current.devices.find((item) => item.pcId === pcId);
  if (!target) return current;
  const book: DeviceBook = {
    ...current,
    devices: current.devices.map((item) => item.pcId === pcId
      ? { ...item, lastConnectedAt: Date.now() }
      : item),
  };
  await persist(book);
  return book;
}

/**
 * PC 上报的是操作系统主机名（`xxx.local` / 带连字符），直接显示很生硬。
 * 这里只做无损整理：去掉 `.local`、把 `-`/`_` 换成空格，不做首字母美化（那是猜）。
 */
export function displayDeviceName(name: string): string {
  const cleaned = name.replace(/\.local$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || name;
}
