import { useEffect, useState } from "react";

/**
 * 通用确认对话框（替换 window.confirm）。
 * promise-based：`confirmDialog({...})` 返回 Promise<boolean>，确认/取消后 resolve。
 * 样式复用项目弹窗 token（对齐 CompactionDialog / PermissionPrompt 的遮罩与卡片）。
 * 危险操作确认按钮用 danger 色（text-danger + border-danger），普通操作用 btn-accent。
 */

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（删除/关闭应用等）→ 确认按钮显示危险色 */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

let pendingRef: PendingConfirm | null = null;
let listenerRef: ((p: PendingConfirm | null) => void) | null = null;

function setPending(p: PendingConfirm | null): void {
  pendingRef = p;
  listenerRef?.(p);
}

/** 调用方：await confirmDialog({...}) —— true 确认 / false 取消 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // 宿主未挂载（ConfirmHost 未渲染）时无法展示，立即回落 false 避免 Promise 永久挂起
    if (!listenerRef) {
      resolve(false);
      return;
    }
    // 若已有未决确认框（并发调用），直接拒绝新请求（避免覆盖）
    if (pendingRef) {
      resolve(false);
      return;
    }
    setPending({ ...opts, resolve });
  });
}

/** 挂载点：放在 App 根部（z-[130]，高于普通弹层） */
export function ConfirmHost(): JSX.Element | null {
  const [pending, setPendingLocal] = useState<PendingConfirm | null>(null);
  useEffect(() => {
    listenerRef = (p) => setPendingLocal(p);
    return () => { listenerRef = null; };
  }, []);
  if (!pending) return null;

  const close = (v: boolean) => {
    setPending(null);
    pending.resolve(v);
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => close(false)}>
      <div
        className="bg-surface border border-border rounded-xl p-5 max-w-md w-full shadow-2xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium text-text-primary mb-1.5">{pending.title}</div>
        <p className="text-xs text-text-secondary mb-4 leading-relaxed whitespace-pre-line">{pending.message}</p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            className="px-4 py-1.5 text-xs rounded-md bg-surface-alt border border-border text-text-secondary hover:text-text-primary transition-colors"
            onClick={() => close(false)}
          >
            {pending.cancelText ?? "取消"}
          </button>
          <button
            type="button"
            className={`px-4 py-1.5 text-xs rounded-md transition-colors ${
              pending.danger
                ? "bg-danger/10 border border-danger/60 text-danger hover:bg-danger/20"
                : "btn-accent"
            }`}
            onClick={() => close(true)}
          >
            {pending.confirmText ?? "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}
