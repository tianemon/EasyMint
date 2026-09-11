import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { registerOverlay } from "../../lib/overlay-stack";

/**
 * 弹窗基础组件 —— 统一键盘 / 焦点行为（各弹窗原有视觉与遮罩样式经 overlayClassName 传入，保持不变）。
 * 提供三件事：
 *  1. Esc 关闭：capture 阶段监听 + stopImmediatePropagation —— 嵌套弹窗只关最上层（后打开者先注册）
 *  2. 焦点陷阱：Tab/Shift+Tab 在弹窗面板内循环，不穿透到背后页面
 *  3. 关闭后焦点归还触发元素（打开前 document.activeElement，卸载时若仍存活则聚焦回去）
 * 此外自动注册到全局弹窗栈（registerOverlay）：点击本弹窗不关闭下层抽屉等 document 级关闭监听。
 * 遮罩点击关闭有三种模式（click / press-release / false），press-release = 按下与松开都在遮罩才算
 * （OutputWindow 拖拽选中移出边缘不误关）。
 * 本组件以 createPortal 挂到 body：弹窗宿主常在带 transform 的容器内（侧边抽屉/输入卡片），
 * 不脱离会把 fixed 定位劫持到 transform 祖先上导致无法在窗口内居中。
 * 遮罩带 no-drag：它 fixed inset-0 压在窗口顶部拖拽区(TabBar/侧栏 drag)之上，不声明 no-drag
 * 时 Electron 的拖拽区会吞掉点击——弹窗顶部的关闭按钮等控件点不动。
 */

export type ModalTier = "dialog" | "modal";

const TIER_CLASS: Record<ModalTier, string> = {
  dialog: "z-dialog", // 抽屉 / 普通模态弹窗
  modal: "z-modal", // 强模态：须压过普通弹窗（全局确认框、会话删除确认等）
};

let openModalCount = 0;

/**
 * 是否有 Modal 层弹窗开着。
 *
 * 给不走本组件的自定义弹窗用：它们同样在 window capture 注册 Esc，且因先挂载而先收到按键——
 * 不判断就会在 Modal 开着时先关掉自己（把上层留在屏幕上）。
 */
export function hasOpenModal(): boolean {
  return openModalCount > 0;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(", ");

interface ModalProps {
  /** Esc / 遮罩点击 / 卸载统一入口（父组件通常用它卸载弹窗） */
  onClose: () => void;
  children: ReactNode;
  /** 层 token：dialog（默认）| modal */
  tier?: ModalTier;
  /** 遮罩根元素追加类（背景色/圆角透出等——各弹窗原有遮罩样式原样迁移到这里） */
  overlayClassName?: string;
  /** 点遮罩关闭模式：click（默认）/ mousedown（按下即关）/ press-release（按下+松开都在遮罩才算）/ false（不响应） */
  overlayClose?: "click" | "mousedown" | "press-release" | false;
  /** 遮罩关闭触发前的守卫（如传输进行中禁止误关），返回 false 则不关 */
  canOverlayClose?: () => boolean;
}

export function Modal({
  onClose,
  children,
  tier = "dialog",
  overlayClassName = "",
  overlayClose = "click",
  canOverlayClose,
}: ModalProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // 打开瞬间的触发元素：卸载时归还焦点（isConnected 守卫——触发按钮可能随列表刷新消失）
  const restoreRef = useRef<HTMLElement | null>(null);

  // Esc(顶层优先) + 焦点陷阱 + 遮罩按下判断 共用挂载期副作用
  const downOnOverlayRef = useRef(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    openModalCount++;
    const unregisterOverlay = registerOverlay(root);

    // 面板 = 遮罩根的第一个子元素（各调用方保持「遮罩 > 面板」两层结构）
    const panel = root.firstElementChild as HTMLElement | null;

    const collectFocusable = (): HTMLElement[] => {
      if (!panel) return [];
      return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    };

    const activeInside = (): boolean => {
      const a = document.activeElement;
      return !!a && !!panel && (panel === a || panel.contains(a));
    };

    // 初始焦点进面板：面板内已有 autoFocus 元素（React 提交期已聚焦）则不抢
    if (!activeInside()) {
      const list = collectFocusable();
      if (list.length > 0) list[0]?.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // capture + stopImmediatePropagation：嵌套弹窗各自在 window capture 注册，
        // 后打开者先注册先执行并拦截——一次 Esc 只关最上层
        e.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = collectFocusable();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      // 焦点跑出面板（点击遮罩/被抢）时 Tab 拉回；Shift+Tab 在第一项或外部时回绕到末项
      if (e.shiftKey) {
        if (!activeInside() || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!activeInside() || active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      openModalCount--;
      unregisterOverlay();
      const prev = restoreRef.current;
      if (prev && prev.isConnected && document.contains(prev)) prev.focus();
    };
  }, []);

  // 触发元素快照要在挂载副作用前取到——render 期记录即可（首帧 activeElement 即打开前的焦点）
  if (restoreRef.current === null) {
    const a = document.activeElement;
    restoreRef.current = a instanceof HTMLElement ? a : null;
  }

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    const onOverlay = e.target === e.currentTarget;
    downOnOverlayRef.current = onOverlay;
    if (overlayClose === "mousedown" && onOverlay && (!canOverlayClose || canOverlayClose())) {
      onCloseRef.current();
    }
  };
  const handleOverlayMouseUp = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (overlayClose !== "press-release") return;
    if (downOnOverlayRef.current && e.target === e.currentTarget && (!canOverlayClose || canOverlayClose())) {
      onCloseRef.current();
    }
  };
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (overlayClose !== "click") return;
    if (e.target !== e.currentTarget) return;
    // 完整点击才算“点外部”:mousedown 也必须落在遮罩上(拖选文字从弹窗内拖到遮罩松开,click 也会在遮罩派发,不应关闭)
    if (!downOnOverlayRef.current) return;
    if (canOverlayClose && !canOverlayClose()) return;
    onCloseRef.current();
  };

  return createPortal(
    <div
      ref={rootRef}
      className={`no-drag fixed inset-0 flex items-center justify-center ${TIER_CLASS[tier]} ${overlayClassName}`}
      onMouseDown={
        overlayClose === "press-release" || overlayClose === "mousedown" || overlayClose === "click"
          ? handleOverlayMouseDown
          : undefined
      }
      onMouseUp={overlayClose === "press-release" ? handleOverlayMouseUp : undefined}
      onClick={overlayClose === "click" ? handleOverlayClick : undefined}
    >
      {children}
    </div>,
    document.body,
  );
}
