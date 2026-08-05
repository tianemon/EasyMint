import { useEffect, useState } from "react";

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface UpdateStatusState {
  status: string; version?: string; percent?: number; transferred?: number; totalSize?: number;
}

/** 关于:版本号 + 更新检测 + 开源链接 */
export function AboutTab(): JSX.Element {
  const [appVersion, setAppVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusState>({ status: "idle" });
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    window.electronAPI?.app?.getVersion?.().then((v) => setAppVersion(v)).catch(() => {});
    window.electronAPI?.app?.hasUpdate?.().then(({ hasUpdate, version }) => {
      if (hasUpdate && version) setUpdateStatus({ status: "downloaded", version });
    }).catch(() => {});
  }, []);

  // 监听更新状态广播
  useEffect(() => {
    const off = window.electronAPI?.app?.onUpdateStatus?.((data) => {
      setUpdateStatus(data);
      setChecking(data.status === "checking");
    });
    return () => { off?.(); };
  }, []);

  const handleCheckUpdate = () => {
    setChecking(true);
    window.electronAPI?.app?.checkUpdate?.().catch(() => setChecking(false));
  };

  const handleInstallUpdate = () => {
    window.electronAPI?.app?.installUpdate?.();
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-6">
      <img src="./icon.png" className="w-20 h-20 mb-2" />
      <div className="text-center">
        <h2 className="text-2xl font-bold text-text-primary">EasyMint</h2>
        <p className="text-sm text-text-secondary mt-1">AI 驱动开发，简单的操作让想法变为现实</p>
      </div>

      {/* 版本号 + 更新检测 */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-primary font-medium">v{appVersion || "..."}</span>
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center text-text-secondary hover:text-accent transition-colors"
            onClick={handleCheckUpdate}
            disabled={checking}
            title="检查更新"
          >
            <svg className={`w-4 h-4 ${checking ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>
        </div>

        {/* 更新状态文案 */}
        {updateStatus.status === "checking" && (
          <span className="text-xs text-text-secondary">正在检查更新...</span>
        )}
        {updateStatus.status === "available" && (
          <span className="text-xs text-accent">发现新版本 v{updateStatus.version}，准备下载...</span>
        )}
        {updateStatus.status === "downloading" && (
          <div className="flex flex-col items-center gap-1 w-56">
            <span className="text-xs text-accent whitespace-nowrap">
              正在下载 v{updateStatus.version}... {updateStatus.percent ?? 0}%
              {updateStatus.transferred != null && updateStatus.totalSize
                ? `（${formatMB(updateStatus.transferred)} / ${formatMB(updateStatus.totalSize)}）`
                : ""}
            </span>
            <div className="w-full h-1 rounded-full bg-surface-hover overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${updateStatus.percent ?? 0}%` }} />
            </div>
          </div>
        )}
        {updateStatus.status === "downloaded" && (
          <button
            type="button"
            className="px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors"
            onClick={handleInstallUpdate}
          >
            重启并更新到 v{updateStatus.version}
          </button>
        )}
        {updateStatus.status === "no-update" && (
          <span className="text-xs text-text-muted">当前已是最新版本</span>
        )}
        {updateStatus.status === "error" && (
          <span className="text-xs text-text-muted">检查更新失败，请稍后再试</span>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-text-secondary">开源项目地址</span>
        <a
          href="https://github.com/tianemon/EasyMint"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          github.com/tianemon/EasyMint
        </a>
      </div>
      <div className="text-xs text-text-muted space-x-4">
        <span>Electron · React · TypeScript</span>
        <span>pi-coding-agent</span>
      </div>
    </div>
  );
}
