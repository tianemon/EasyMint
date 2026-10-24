import { useState, useRef, useCallback, useLayoutEffect, useEffect } from "react";

/** 折叠展开区内容挂载控制(通用,供工具块等手动折叠用):
 *  折叠(bodyMounted=false)时内容不渲染——不参与气泡宽度计算(0fr 只藏高度,不可断行长行仍撑宽);
 *  展开:先挂载(0fr 隐藏),下一帧切 open 播 grid-rows 0fr→1fr 动画;
 *  收起:先播 1fr→0fr 动画,结束后卸载 body(宽度随即收回,不遮挡收起过程)。
 *  返回 { bodyMounted, contentReady, toggle }——contentReady=动画态(用于箭头/网格类) */
export function useFoldBody(open: boolean, setOpen: (v: boolean) => void): {
  bodyMounted: boolean;
  contentReady: boolean;
  toggle: () => void;
} {
  const [bodyMounted, setBodyMounted] = useState(open);
  const requestedOpen = useRef(open);
  const rafRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPending = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);
  const hideBody = useCallback(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setBodyMounted(false);
    else hideTimerRef.current = setTimeout(() => {
      if (!requestedOpen.current) setBodyMounted(false);
    }, 230);
  }, []);
  // Also handles automatic thinking expansion/collapse, not just pointer toggles.
  useLayoutEffect(() => {
    // A close followed by reopen can commit the intermediate false state in the
    // same batch. Keep the latest open request instead of cancelling its frames.
    if (!open && requestedOpen.current && rafRef.current) return;
    clearPending();
    requestedOpen.current = open;
    if (open) setBodyMounted(true);
    else hideBody();
  }, [open, clearPending, hideBody]);
  const toggle = useCallback(() => {
    clearPending();
    const next = !requestedOpen.current;
    requestedOpen.current = next;
    if (!next) { setOpen(false); hideBody(); return; }
    setBodyMounted(true);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setOpen(true);
      return;
    }
    // Paint the mounted, closed grid before opening. A second click cancels either frame.
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        if (requestedOpen.current) setOpen(true);
      });
    });
  }, [setOpen, clearPending, hideBody]);
  useEffect(() => clearPending, [clearPending]);
  return { bodyMounted, contentReady: open, toggle };
}
