import { useEffect, useState } from "react";

/** Windows 自绘窗口按钮（最小化/最大化/关闭）——仅 win32 渲染，主题跟随 CSS 变量；
    位置与 TabBar 右侧预留（padding-right 132px）对齐 */
export function WindowControls(): JSX.Element | null {
  const isWin = window.electronAPI?.platform === "win32";
  const [isMaximized, setIsMaximized] = useState(false);

  // 最大化状态：初始化查询 + 订阅广播；只在状态实际变化时 setState
  // （Proma 注释的坑：频繁重渲染会让 Chromium 重算拖拽区域，期间点击按钮会被 OS 误判为标题栏点击）
  useEffect(() => {
    if (!isWin) return;
    let alive = true;
    window.electronAPI.win.isMaximized()
      .then((m) => { if (alive) setIsMaximized(m); })
      .catch((e: unknown) => console.error("[window] isMaximized failed", e));
    const unsub = window.electronAPI.win.onMaximizedChanged((m) => {
      setIsMaximized((prev) => (prev === m ? prev : m));
    });
    return () => { alive = false; unsub(); };
  }, [isWin]);

  if (!isWin) return null;

  const btnCls = "w-11 h-10 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors";
  return (
    <div
      className="fixed top-0 right-0 z-50 flex select-none"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button type="button" className={btnCls} title="最小化" onClick={() => { window.electronAPI.win.minimize(); }}>
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="5.5" width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button type="button" className={btnCls} title={isMaximized ? "还原" : "最大化"} onClick={() => { window.electronAPI.win.maximize(); }}>
        {isMaximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3.5" y="3.5" width="6" height="6" /><path d="M4.5 3.5v-1h5v5h-1" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="2" y="2" width="8" height="8" /></svg>
        )}
      </button>
      <button type="button" className={`${btnCls} hover:bg-danger hover:text-white`} title="关闭" onClick={() => { window.electronAPI.win.close(); }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
      </button>
    </div>
  );
}
