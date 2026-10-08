import { appText } from "../../lib/i18n";
import { uiText, useUiLocale } from "../../lib/i18n";
import { useEffect, useState } from "react";
import { StepIndicator } from "./StepIndicator";
import { useSettingsStore } from "../../stores/settings-store";
import { Modal } from "../ui/Modal";

/**
 * 接收端迁移确认弹窗:收到迁移包 → 展示来源/项目/大小 → 用户选目标路径 → 接收/拒绝。
 * 目标路径:默认同项目名(用户可改),也可以浏览选择目录。
 */

interface IncomingTransfer {
  transferId: string;
  fromName: string;
  projectName: string;
  fileCount: number;
  totalSize: number;
  sessionCount: number;
}

interface MigrationIncomingModalProps {
  incoming: IncomingTransfer | null;
  onClose: () => void;
  onAccept: (transferId: string, targetPath: string) => Promise<{ ok: boolean; error?: string }>;
  onReject: (transferId: string) => Promise<void>;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MigrationIncomingModal({ incoming, onClose, onAccept, onReject }: MigrationIncomingModalProps): JSX.Element | null {
  useUiLocale();
  const [targetPath, setTargetPath] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 接收进度(接收后主进程每块广播)
  const [progressPct, setProgressPct] = useState<number | null>(null);
  // 接收端阶段(接收中 → 校验 → 解压 → 会话恢复 → 完成)
  const [stage, setStage] = useState<"receiving" | "verify" | "extract" | "session" | "done">("receiving");
  // 完成阶段:恢复的会话数(展示「已恢复 N 个会话」)
  const [sessionRestoredCount, setSessionRestoredCount] = useState(0);

  useEffect(() => {
    return window.electronAPI.migration.onProgress((d) => {
      if (incoming && d.transferId === incoming.transferId) {
        setProgressPct(incoming.totalSize > 0 ? Math.min(100, Math.round((d.received / incoming.totalSize) * 100)) : 0);
      }
    });
  }, [incoming]);

  useEffect(() => {
    return window.electronAPI.migration.onStage((d) => {
      if (incoming && d.transferId === incoming.transferId) {
        setStage(d.stage);
        if (d.stage === "done" && typeof d.sessionRestoredCount === "number") {
          setSessionRestoredCount(d.sessionRestoredCount);
        }
      }
    });
  }, [incoming]);

  // 每次新请求:默认父文件夹 = 软件默认项目目录(可改)
  const defaultProjectDir = useSettingsStore((s) => s.defaultProjectDir);
  useEffect(() => {
    if (incoming) {
      setTargetPath(defaultProjectDir || "~/EasyMintProject");
      setError(null);
      setAccepting(false);
      setAccepted(false);
      setProgressPct(null);
      setSessionRestoredCount(0);
      setStage("receiving");
    }
  }, [incoming, defaultProjectDir]);

  const handleBrowse = async () => {
    setBrowsing(true);
    try {
      const dir = await window.electronAPI.dialog.openDirectory();
      if (dir) setTargetPath(dir);
    } finally {
      setBrowsing(false);
    }
  };

  if (!incoming) return null;

  const handleAccept = async () => {
    // 父文件夹为空 → 提示
    const finalPath = targetPath.trim();
    if (!finalPath) {
      setError(uiText("ui.MigrationIncomingModal.chooseOrEnterTheParentFolderFor"));
      return;
    }
    setAccepting(true);
    setError(null);
    const r = await onAccept(incoming.transferId, finalPath);
    setAccepting(false);
    if (!r.ok) {
      setError(r.error ?? uiText("ui.MigrationIncomingModal.couldNotReceiveTransfer"));
      return;
    }
    // 接收成功:显示落位路径,短暂停留后关闭
    setAccepted(true);
    setStage("done");
    setTargetPath(finalPath);
    setTimeout(() => onClose(), 2000);
  };

  return (
    <Modal
      overlayClassName="bg-black/40 modal-overlay"
      overlayClose={false}
      onClose={() => void onReject(incoming.transferId)}
    >
      <div className="bg-[var(--modal-fill)] rounded-[var(--radius-lg)] shadow-2xl modal-card flex flex-col" style={{ width: 460 }}>
        <div className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0 bg-[var(--color-surface-alt)]">
          <h2 className="text-base font-semibold text-text-primary">{uiText("ui.MigrationIncomingModal.receiveProjectTransfer")}</h2>
          <button className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-lg)] text-text-secondary hover:bg-surface-hover transition-colors" onClick={() => void onReject(incoming.transferId)}>✕</button>
        </div>

        <div className="px-6 py-3 space-y-3">
          {/* 迁移内容摘要 */}
          <div className="bg-surface rounded-[var(--radius-lg)] border border-border px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-text-primary font-medium">{incoming.projectName}</span>
              <span className="text-[length:var(--text-2xs)] px-1.5 py-0.5 rounded-[var(--radius-lg)] bg-accent-soft text-accent">{uiText("ui.MigrationIncomingModal.from")}{incoming.fromName}</span>
            </div>
            <div className="text-xs text-text-secondary">
              {uiText("counts.files", { count: incoming.fileCount })}{" · "}{fmtSize(incoming.totalSize)}
              {incoming.sessionCount > 0 ? uiText("ui.MigrationIncomingModal.includesSessions", { v0: incoming.sessionCount }) : ""}
            </div>
          </div>

          {/* 项目父文件夹 */}
          <div>
            <label className="text-xs text-text-secondary block mb-1">{uiText("ui.MigrationIncomingModal.projectParentFolder")}</label>
            <div className="flex gap-2">
              <input
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                placeholder={uiText("ui.MigrationIncomingModal.chooseTheParentFolderForThisProject")}
                className="em-input flex-1 px-2.5 py-1.5 text-xs text-text-primary"
              />
              <button
                type="button"
                className="px-3 py-1.5 rounded-[var(--radius-lg)] border border-border text-xs text-text-secondary hover:bg-surface-hover transition-colors shrink-0 disabled:opacity-50"
                disabled={browsing}
                onClick={handleBrowse}
              >
                {browsing ? "…" : uiText("ui.AgentTemplateSettings.browse")}
              </button>
            </div>
            <p className="text-[length:var(--text-2xs)] text-text-muted mt-1">{uiText("ui.MigrationIncomingModal.aProjectFolderNamed")}{incoming.projectName}{uiText("ui.MigrationIncomingModal.willBeCreatedHereSessionsWillBe")}</p>
          </div>

          {error && <div className="text-[length:var(--text-11)] text-danger">{appText(error)}</div>}

          {/* 接收端步骤条:接收 → 校验 → 解压 → 会话恢复 → 完成 */}
          {(accepting || accepted) && (
            <div className="space-y-2">
              <StepIndicator
                steps={[
                  { id: "receiving", label: uiText("ui.MigrationIncomingModal.receive") },
                  { id: "verify", label: uiText("ui.MigrationIncomingModal.verify") },
                  { id: "extract", label: uiText("ui.MigrationIncomingModal.extract") },
                  { id: "session", label: uiText("ui.MigrationIncomingModal.restoreSessions") },
                  { id: "done", label: uiText("common.done") },
                ]}
                current={stage}
              />
              {stage === "receiving" && progressPct !== null && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                    <div className="h-full bg-accent rounded-full transition-all duration-200" style={{ width: `${progressPct}%` }} />
                  </div>
                  <div className="text-[length:var(--text-2xs)] text-text-secondary">{uiText("ui.MigrationIncomingModal.receiving")}{progressPct}%</div>
                </div>
              )}
            </div>
          )}

          {/* 接收成功:显示落位路径 + 会话恢复数 */}
          {accepted && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-accent">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                {uiText("ui.MigrationIncomingModal.restoredTo")}{targetPath}/{incoming.projectName.replace(/[\\/:*?"<>|]/g, "_").trim() || "migrated-project"}
              </div>
              {sessionRestoredCount > 0 && (
                <div className="text-[length:var(--text-11)] text-text-secondary">
                  {uiText("counts.sessionsRestored", { count: sessionRestoredCount })}</div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <button
            className="px-4 py-1.5 rounded-[var(--radius-lg)] text-text-secondary hover:bg-surface-hover transition-colors text-sm"
            onClick={() => void onReject(incoming.transferId)}
          >
            {uiText("ui.MigrationIncomingModal.reject")}</button>
          <button
            className="px-5 py-1.5 rounded-[var(--radius-lg)] btn-accent text-sm font-medium"
            disabled={accepting}
            onClick={handleAccept}
          >
            {accepting ? uiText("ui.MigrationIncomingModal.receiving2") : uiText("ui.MigrationIncomingModal.receiveAndRestore")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
