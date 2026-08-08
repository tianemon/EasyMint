import { create } from "zustand";

/** 已配对设备（含在线状态） */
export interface PairedDevice {
  id: string;
  name: string;
  pairedAt: number;
  lastSeen: number;
  online: boolean;
}

/** 发现的可用设备（配对模式） */
export interface DiscoveredDevice {
  id: string;
  name: string;
  address: string;
  port: number;
}

/** 配对请求（B 端弹窗确认） */
export interface PairRequest {
  id: string;
  name: string;
  address: string;
  port: number;
}

interface DeviceState {
  self: { id: string; name: string; discoverable: boolean };
  paired: PairedDevice[];
  discovered: DiscoveredDevice[];
  pairRequest: PairRequest | null;
  pairMode: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setName: (name: string) => Promise<void>;
  startPair: () => Promise<void>;
  stopPair: () => Promise<void>;
  manualScan: () => Promise<void>;
  requestPair: (peer: DiscoveredDevice) => Promise<{ ok: boolean; error?: string }>;
  acceptPair: (req: PairRequest) => Promise<{ ok: boolean; error?: string }>;
  rejectPair: () => void;
  unpair: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  self: { id: "", name: "", discoverable: false },
  paired: [],
  discovered: [],
  pairRequest: null,
  pairMode: false,
  loaded: false,

  load: async () => {
    const [self, paired, discovered] = await Promise.all([
      window.electronAPI.device.getSelf(),
      window.electronAPI.device.listPaired(),
      window.electronAPI.device.listDiscovered(),
    ]);
    set({
      self,
      paired,
      discovered,
      pairMode: self.discoverable,
      loaded: true,
    });
    // 订阅事件
    window.electronAPI.device.onPairRequest((req) => set({ pairRequest: req }));
    window.electronAPI.device.onChanged(() => get().refresh());
    window.electronAPI.device.onOnline((d) => {
      set({ paired: get().paired.map((p) => (p.id === d.id ? { ...p, online: true } : p)) });
    });
    window.electronAPI.device.onOffline((d) => {
      set({ paired: get().paired.map((p) => (p.id === d.id ? { ...p, online: false } : p)) });
    });
  },

  setName: async (name) => {
    await window.electronAPI.device.setName(name);
    const self = await window.electronAPI.device.getSelf();
    set({ self });
  },

  startPair: async () => {
    await window.electronAPI.device.startPair();
    set({ pairMode: true });
    await get().refresh();
  },

  stopPair: async () => {
    await window.electronAPI.device.stopPair();
    set({ pairMode: false });
    await get().refresh();
  },

  manualScan: async () => {
    await window.electronAPI.device.manualScan();
    await get().refresh();
  },

  requestPair: async (peer) => {
    return window.electronAPI.device.requestPair(peer);
  },

  acceptPair: async (req) => {
    const peer = { id: req.id, name: req.name, address: req.address, port: req.port };
    const result = await window.electronAPI.device.acceptPair(peer);
    if (result.ok) set({ pairRequest: null });
    await get().refresh();
    return result;
  },

  rejectPair: () => set({ pairRequest: null }),

  unpair: async (id) => {
    await window.electronAPI.device.unpair(id);
    await get().refresh();
  },

  refresh: async () => {
    const [self, paired, discovered] = await Promise.all([
      window.electronAPI.device.getSelf(),
      window.electronAPI.device.listPaired(),
      window.electronAPI.device.listDiscovered(),
    ]);
    set({ self, paired, discovered, pairMode: self.discoverable });
  },
}));
