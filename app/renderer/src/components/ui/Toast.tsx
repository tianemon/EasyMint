import { useEffect, useState } from "react";

/**
 * 全局轻提示（替换 window.alert）。
 * 模块级调用：toast("消息") —— 顶部居中浮出，2.5s 自动消失。
 * 样式复用 ChatPanel 便签 toast 的 token（bg-surface-elevated + border + shadow）。
 */

interface ToastState {
  id: number;
  message: string;
}

let listenerRef: ((t: ToastState | null) => void) | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string): void {
  if (timer) { clearTimeout(timer); timer = null; }
  listenerRef?.({ id: ++seq, message });
  timer = setTimeout(() => listenerRef?.(null), 2500);
}

/** 挂载点：放在 App 根部（z-[140] 高于确认框） */
export function ToastHost(): JSX.Element | null {
  const [t, setToastLocal] = useState<ToastState | null>(null);
  useEffect(() => {
    listenerRef = (v) => setToastLocal(v);
    return () => { listenerRef = null; };
  }, []);
  if (!t) return null;

  return (
    <div
      key={t.id}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[140] px-4 py-2 rounded-lg bg-surface-elevated border border-border shadow-lg text-xs text-text-primary pointer-events-none animate-[fadeIn_150ms_ease]"
    >
      {t.message}
    </div>
  );
}
