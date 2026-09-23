import { useEffect, useState } from "react";
import { Modal } from "./Modal";

/**
 * 通用确认对话框（替换 window.confirm）。
 * promise-based：`confirmDialog({...})` 返回 Promise<boolean>，确认/取消后 resolve。
 * 样式复用项目弹窗 token（对齐 CompactionDialog / PermissionPrompt 的遮罩与卡片）。
 * 并发调用（如权限确认卡还开着时点编辑发送）**排队**，前一个关掉后依次弹出——曾经的「直接
 * resolve(false)」在调用方看来与「用户取消」完全一样，表现为「点了没反应」（编辑那条链路就踩过）。
 * 确认按钮三种观感：
 *  - 危险操作（删除/关闭应用等）→ `danger`，危险色线框（低强调，避免误点）
 *  - 放开权限（进入「完全访问」）→ `permissionConfirm`，权限色实心（与输入卡权限盾形图标同色，
 *    颜色/图标都在表达「危险」，故用实心强调；刻意不用危险红——那是删除类语义）
 *  - 其余 → `btn-accent`
 */

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（删除/关闭应用等）→ 确认按钮显示危险色 */
  danger?: boolean;
  /** 放开权限类确认（进入完全访问）→ 确认按钮用实心权限色（--color-permission-on），与输入卡权限图标一致 */
  permissionConfirm?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

let pendingRef: PendingConfirm | null = null;
/** 已有确认框时新来的请求排在这里（弹出顺序 = 调用顺序） */
const queueRef: PendingConfirm[] = [];
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
    // 已有未决确认框（并发调用）→ 排队，不覆盖也不静默 false（静默 false 与用户取消无法区分）
    if (pendingRef) {
      queueRef.push({ ...opts, resolve });
      return;
    }
    setPending({ ...opts, resolve });
  });
}

/** 挂载点：放在 App 根部（modal 层，高于普通弹层） */
export function ConfirmHost(): JSX.Element | null {
  const [pending, setPendingLocal] = useState<PendingConfirm | null>(null);
  useEffect(() => {
    listenerRef = (p) => setPendingLocal(p);
    return () => { listenerRef = null; };
  }, []);
  if (!pending) return null;

  const close = (v: boolean) => {
    // 同一帧的双击/遮罩与按钮事件只能结算一次；否则 queue.shift() 会跳过下一张确认框。
    if (pendingRef !== pending) return;
    // 先兑现当前这个，再把队首的接上来（顺序不能倒：setPending 会触发重渲染）
    pending.resolve(v);
    setPending(queueRef.shift() ?? null);
  };

  return (
    <Modal tier="modal" overlayClassName="bg-black/40 backdrop-blur-sm" onClose={() => close(false)}>
      <div className="bg-[var(--modal-fill)] rounded-[var(--radius-lg)] p-5 max-w-md w-full shadow-2xl mx-4">
        <div className="text-sm font-medium text-text-primary mb-1.5">{pending.title}</div>
        <p className="text-xs text-text-secondary mb-4 leading-relaxed whitespace-pre-line">{pending.message}</p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            className="px-4 py-1.5 text-xs rounded-[var(--radius-lg)] bg-surface-alt border border-border text-text-secondary hover:text-text-primary transition-colors"
            onClick={() => close(false)}
          >
            {pending.cancelText ?? "取消"}
          </button>
          <button
            type="button"
            className={`px-4 py-1.5 text-xs rounded-[var(--radius-lg)] ${
              pending.permissionConfirm
                ? // 实心权限色(与输入卡权限图标同色)。填充色 --color-permission-on 在明暗两主题同值
                  // (#ed7482)，故文字固定用深墨 #3f1017（约 5.7:1）而非 --color-text-inverse
                  // ——后者亮色是白、暗色是深，与固定填充不匹配，且白字落在玫红上仅 2.8:1 读不清
                  "bg-[var(--color-permission-on)] text-[#3f1017] font-medium hover:opacity-90 transition-opacity"
                : pending.danger
                  ? "bg-danger-soft border border-danger-border text-danger hover:bg-danger hover:text-text-inverse transition-colors"
                  : "btn-accent transition-colors"
            }`}
            onClick={() => close(true)}
          >
            {pending.confirmText ?? "确认"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
