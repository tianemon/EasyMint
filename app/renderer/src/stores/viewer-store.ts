import { create } from "zustand";
import type { ImageViewerState } from "../components/ImageViewer";
import { toast } from "../components/ui/Toast";

/**
 * 图片查看器状态（全局唯一）。
 *
 * 入口有三条：聊天里的文件链接、左侧文件树的图片、输入框附件缩略图——共用同一个查看器，
 * 所以状态必须放 store。挂在某个组件的局部 state 上时，只有该组件里的入口能驱动它，
 * 且多个聊天 tab 同时挂载会各自渲染一份遮罩。
 */
interface ViewerState {
  image: ImageViewerState | null;
  openImage: (src: string, name?: string) => void;
  closeImage: () => void;
  openImageFile: (path: string) => Promise<void>;
}

/** 从路径取文件名（查看器底部信息条与打开源码 tab 的标题共用） */
export function baseName(p: string): string {
  const seg = p.split(/[\\/]/).pop();
  return seg || p;
}

export const useViewerStore = create<ViewerState>((set) => ({
  image: null,
  openImage: (src, name) => set({ image: { src, name } }),
  closeImage: () => set({ image: null }),
  // 磁盘图片必须先经主进程读成 dataUrl：dev 下页面源是 http，Chromium 会拦 file:// 资源。
  // 读不到（非图片 / 不在项目内 / 文件不存在 / 过大）时给可见反馈并退回，用户点了没反应等于功能坏了。
  openImageFile: async (path) => {
    try {
      const dataUrl = await window.electronAPI.file.readImage(path);
      if (!dataUrl) {
        toast("无法读取图片");
        return;
      }
      // 带上 path：「看源码」（svg）需要知道原文件路径，此调用的入参本就来自它
      set({ image: { src: dataUrl, name: baseName(path), path } });
    } catch (e) {
      console.error("读取图片失败:", path, e);
      toast("无法读取图片");
    }
  },
}));
