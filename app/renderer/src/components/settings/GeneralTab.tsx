import { LanguageSelector } from "./LanguageSelector";
import { useTranslation } from "react-i18next";
import "../../lib/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { EnvPanel, type EnvPanelHandle } from "../env/EnvPanel";
import { EnvRetestButton } from "../env/EnvRetestButton";
import { PiImportSection } from "./PiImport";

// ── Git Check ─────────────────────────────────────────────────────────────────

type DetectInfo = { found: boolean; version?: string; reason?: "not-found" | "probe-error" };

function useDetect(cmd: "git" | "nodeRuntime" | "codegraph") {
  const [info, setInfo] = useState<DetectInfo | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    // IPC 层报错也是「探测失败」而非「没装」——避免把异常断言成未安装
    window.electronAPI?.[cmd]?.detect().then(setInfo).catch(() => setInfo({ found: false, reason: "probe-error" }));
  }, [cmd, nonce]);
  /** 重新检测：先置空显示「检测中...」，再触发一次 IPC——装了工具但没重启 EM 时用它重测 */
  const refresh = useCallback(() => {
    setInfo(null);
    setNonce((n) => n + 1);
  }, []);
  return { info, refresh };
}

function EnvRow({ label, info, installUrl }: {
  label: string;
  info: DetectInfo | null;
  installUrl?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-2.5 flex items-center justify-between em-hover-row transition-shadow">
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-secondary">{label}</span>
        {info === null ? (
          <span className="text-xs text-text-muted">{t("settings.detecting")}</span>
        ) : info.found ? (
          <span className="text-xs text-text-secondary">{info.version}</span>
        ) : (
          <span className="text-xs text-danger">{t("settings.notInstalled")}</span>
        )}
      </div>
      {info && !info.found && installUrl && (
        <a
          href={installUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-[var(--radius-lg)] btn-accent text-xs font-medium"
        >
          {t("settings.installTool", { name: label })}
        </a>
      )}
    </div>
  );
}

function CodegraphRow({ info }: { info: DetectInfo | null }) {
  const { t } = useTranslation();
  // Windows 无 sh：原 curl|sh 在 PowerShell/cmd 下必失败，按平台给对应安装器
  const isWin = window.electronAPI?.platform === "win32";
  const cmd = isWin
    ? "irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex"
    : "curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh";
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-4 py-2.5 flex items-start justify-between em-hover-row transition-shadow">
      <div className="flex items-center gap-2 mt-1">
        <span className="text-sm text-text-secondary">CodeGraph</span>
        {info === null ? (
          <span className="text-xs text-text-muted">{t("settings.detecting")}</span>
        ) : info.found ? (
          <span className="text-xs text-text-secondary">{info.version}</span>
        ) : info.reason === "probe-error" ? (
          <span className="text-xs text-danger">{t("settings.detectFailed")}</span>
        ) : (
          <span className="text-xs text-danger">{t("settings.notInstalled")}</span>
        )}
      </div>
      {info && !info.found && info.reason !== "probe-error" && (
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1">
            <code className="text-[length:var(--text-2xs)] text-text-secondary bg-surface px-2 py-0.5 rounded-[var(--radius-lg)] select-all">{cmd}</code>
            <button
              className="shrink-0 px-1.5 py-0.5 rounded-[var(--radius-lg)] text-[length:var(--text-2xs)] text-text-secondary hover:text-accent em-hover-control transition-all"
              onClick={handleCopy}
            >
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          <span className="text-[length:var(--text-2xs)] text-text-muted">
            {isWin ? t("settings.powerShell") : ""}https://github.com/colbymchenry/codegraph
          </span>
        </div>
      )}
    </div>
  );
}

function EnvCheckSection(): JSX.Element {
  const { t } = useTranslation();
  const git = useDetect("git");
  const nodeRt = useDetect("nodeRuntime");
  const codegraph = useDetect("codegraph");
  // 「重新检测」= 三个检测器 + 环境面板重探。按钮与动作都是共用的那一份
  // （EnvRetestButton + EnvPanelHandle.retest），本页不自己拼一套
  const envPanel = useRef<EnvPanelHandle>(null);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-text-secondary">{t("settings.environment")}</h3>
        <EnvRetestButton
          panel={envPanel}
          onBeforeRetest={() => { git.refresh(); nodeRt.refresh(); codegraph.refresh(); }}
        />
      </div>
      <div className="bg-surface-alt rounded-[var(--radius-lg)] overflow-hidden">
        <EnvRow label="Git" info={git.info} installUrl="https://git-scm.com/downloads" />
        <EnvRow label="Node.js" info={nodeRt.info} installUrl="https://nodejs.org/" />
        <CodegraphRow info={codegraph.info} />
        <EnvPanel ref={envPanel} variant="settings" />
      </div>
    </section>
  );
}

// ── Cache Management ──────────────────────────────────────────────────────────

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CacheManagementSection(): JSX.Element {
  const { t } = useTranslation();
  const [clearing, setClearing] = useState(false);
  const [updateSize, setUpdateSize] = useState<number | null>(null);
  const [uploadSize, setUploadSize] = useState<number | null>(null);

  const scan = () => {
    window.electronAPI?.app?.updateCacheSize?.().then(setUpdateSize).catch(() => {});
    window.electronAPI?.upload?.stats?.().then((s) => setUploadSize(s.totalSize)).catch(() => {});
  };
  useEffect(() => { scan(); }, []);

  const handleClear = async () => {
    setClearing(true);
    await window.electronAPI?.app?.clearUpdateCache?.();
    await scan();
    setClearing(false);
  };

  return (
    <section>
      <h3 className="text-sm font-medium text-text-secondary mb-2">{t("settings.cache")}</h3>
      <div className="bg-surface-alt rounded-[var(--radius-lg)] overflow-hidden">

        <div className="px-4 py-3 flex items-center justify-between em-hover-row transition-shadow">
          <div>
            <h4 className="text-xs font-medium text-text-secondary">{t("settings.installerCache")}</h4>
            {updateSize === null ? (
              <p className="text-[length:var(--text-11)] text-text-muted">{t("settings.scanning")}</p>
            ) : updateSize > 0 ? (
              <p className="text-[length:var(--text-11)] text-text-secondary">{formatMB(updateSize)}</p>
            ) : (
              <p className="text-[length:var(--text-11)] text-text-muted">{t("settings.noCache")}</p>
            )}
          </div>
          {updateSize !== null && updateSize > 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                className="px-3 py-1.5 rounded-[var(--radius-lg)] text-xs text-text-secondary em-hover-control transition-shadow"
                onClick={handleClear}
                disabled={clearing}
              >
                {clearing ? t("settings.clearing") : t("settings.clearCache")}
              </button>
              <button
                className="px-3 py-1.5 rounded-[var(--radius-lg)] text-xs text-text-secondary em-hover-control transition-shadow"
                onClick={() => window.electronAPI?.app?.openUpdateCache?.()}
              >
                {t("common.folder")}
              </button>
            </div>
          )}
        </div>

        <div className="px-4 py-3 flex items-center justify-between em-hover-row transition-shadow">
          <div>
            <h4 className="text-xs font-medium text-text-secondary">{t("settings.uploadCache")}</h4>
            {uploadSize === null ? (
              <p className="text-[length:var(--text-11)] text-text-muted">{t("settings.scanning")}</p>
            ) : uploadSize > 0 ? (
              <p className="text-[length:var(--text-11)] text-text-secondary">{formatMB(uploadSize)}</p>
            ) : (
              <p className="text-[length:var(--text-11)] text-text-muted">{t("settings.noCache")}</p>
            )}
          </div>
          {uploadSize !== null && uploadSize > 0 && (
            <button
              className="px-3 py-1.5 rounded-[var(--radius-lg)] text-xs text-text-secondary em-hover-control transition-shadow"
              onClick={() => window.electronAPI?.upload?.openDir?.()}
            >
              {t("common.openFolder")}
            </button>
          )}
        </div>

      </div>
    </section>
  );
}

/** 通用设置:默认项目路径 / 压缩阈值 / 缓存 / 环境检测 / 原生 pi 配置导入 */
export function GeneralTab(): JSX.Element {
  const { t } = useTranslation();
  const {
    defaultProjectDir,
    contextThreshold,
    setDefaultProjectDir,
    setContextThreshold,
  } = useSettingsStore();

  return (
    <div className="space-y-5">
      <section>
        <LanguageSelector />
      </section>
      {/* 路径 */}
      <section>
        <h3 className="text-sm font-medium text-text-secondary mb-2">{t("settings.defaultProjectDir")}</h3>
        <div className="bg-surface-alt rounded-[var(--radius-lg)] px-4 py-3">
          <input
            className="em-input w-full px-3 py-2 text-text-primary text-sm"
            placeholder="~/EasyMintProject"
            value={defaultProjectDir}
            onChange={(e) => setDefaultProjectDir(e.target.value)}
          />
          <p className="text-[length:var(--text-2xs)] text-text-secondary mt-0.5">{t("settings.defaultProjectDirHint")}</p>
        </div>
      </section>

      {/* Context threshold */}
      <section>
        <h3 className="text-sm font-medium text-text-secondary mb-2">{t("settings.contextThreshold")}</h3>
        <div className="bg-surface-alt rounded-[var(--radius-lg)] px-4 py-3">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="60"
              max="80"
              step="5"
              value={contextThreshold}
              onChange={(e) => setContextThreshold(Number(e.target.value))}
              className="flex-1 accent-accent"
            />
            <span className="text-sm text-text-primary font-medium w-10 text-right">{contextThreshold}%</span>
          </div>
          <p className="text-[length:var(--text-11)] text-text-secondary mt-1">{t("settings.contextThresholdHint")}</p>
        </div>
      </section>

      {/* 更新缓存 */}
      <CacheManagementSection />

      {/* 环境检测 */}
      <EnvCheckSection />

      {/* 原生 pi 配置导入（手动触发；引导页 Step 2 是同一份流程的自动探测形态） */}
      <PiImportSection />
    </div>
  );
}
