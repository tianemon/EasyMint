import { useTranslation } from "react-i18next";
import "../../lib/i18n";
import { useEffect, useState } from "react";
import { confirmDialog } from "../ui/ConfirmDialog";
import { useThemeStore } from "../../stores/theme-store";

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface UpdateStatusState {
  status: string; version?: string; percent?: number; transferred?: number; totalSize?: number;
  /** 仅在 status === "error" 时有值：失败原因原文（供排查，不替代人话文案） */
  errorMessage?: string;
  /** 失败出在哪个阶段（主进程按是否已进过下载阶段判定） */
  errorPhase?: "check" | "download";
}

/** 关于:版本号 + 更新检测 + 开源链接 */
export function AboutTab(): JSX.Element {
  const { t } = useTranslation();
  const isDark = useThemeStore((s) => s.effective) === "dark";
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

  /** 重新运行引导：清掉两处 setupComplete 标记后重载——App 重挂载即回到引导页 */
  const handleRerunOnboarding = async () => {
    const ok = await confirmDialog({
      title: t("about.rerunOnboarding"),
      message: t("about.rerunMessage"),
      confirmText: t("about.rerun"),
    });
    if (!ok) return;
    localStorage.removeItem("easymint_setup_complete");
    await window.electronAPI.settings.set("setupComplete", false);
    window.location.reload();
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-6">
      {/* 应用图标：跟随主题取亮/暗版（与 Dock 图标同一套素材 appicon-{light,dark}.png，
          形状口径一致（自带圆角）；不再固定用亮色版的 icon.png */}
      <img src={isDark ? "./appicon-dark.png" : "./appicon-light.png"} className="w-20 h-20 mb-2" />
      <div className="text-center">
        <h2 className="text-2xl font-bold text-text-primary">EasyMint</h2>
        <p className="text-sm text-text-secondary mt-1">{t("about.tagline")}</p>
      </div>

      {/* 版本号 + 更新检测 */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-primary font-medium">v{appVersion || "..."}</span>
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center text-text-secondary hover:text-accent transition-colors"
            aria-label={t("about.checkUpdates")}
            onClick={handleCheckUpdate}
            disabled={checking}
           
          >
            <svg className={`w-4 h-4 ${checking ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>
        </div>

        {/* 更新状态文案 */}
        {updateStatus.status === "checking" && (
          <span className="text-xs text-text-secondary">{t("about.checking")}</span>
        )}
        {updateStatus.status === "available" && (
          <span className="text-xs text-accent">{t("about.available", { version: updateStatus.version })}</span>
        )}
        {updateStatus.status === "downloading" && (
          <div className="flex flex-col items-center gap-1 w-56">
            <span className="text-xs text-accent whitespace-nowrap">
              {t("about.downloading", { version: updateStatus.version, percent: updateStatus.percent ?? 0 })}
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
            className="px-4 py-1.5 rounded-[var(--radius-lg)] btn-accent text-xs font-medium"
            onClick={handleInstallUpdate}
          >
            {t("about.restart", { version: updateStatus.version })}
          </button>
        )}
        {updateStatus.status === "no-update" && (
          <span className="text-xs text-text-muted">{t("about.latest")}</span>
        )}
        {updateStatus.status === "error" && (
          // 一句人话给普通用户、原文小字给排查：更新失败此前只有固定文案，真因拿不到
          <div className="flex flex-col items-center gap-1 max-w-[22rem]">
            <span className="text-xs text-text-muted">
              {t(updateStatus.errorPhase === "download" ? "about.downloadFailed" : "about.checkFailed")}
            </span>
            {updateStatus.errorMessage && (
              <span
                className="text-[length:var(--text-2xs)] text-text-muted break-all text-center"
                title={updateStatus.errorMessage}
              >
                {updateStatus.errorMessage}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-text-secondary">{t("about.repository")}</span>
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
        <span>Pi Agent SDK</span>
      </div>

      <button
        type="button"
        className="em-hover-control px-4 py-1.5 rounded-[var(--radius-lg)] text-xs text-text-secondary transition-all"
        onClick={handleRerunOnboarding}
      >
        {t("about.rerunOnboarding")}
      </button>
    </div>
  );
}
