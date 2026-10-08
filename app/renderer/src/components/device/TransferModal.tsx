import { appMessage } from "../../lib/i18n";
import { appText } from "../../lib/i18n";
import { uiText, useUiLocale } from "../../lib/i18n";
import { useEffect, useState } from "react";
import { StepIndicator } from "./StepIndicator";
import { FileTreeSelector, ScanFileItem } from "./FileTreeSelector";
import { Modal } from "../ui/Modal";
import { Checkbox } from "../ui/Checkbox";

/**
 * 迁移对话框(发送端,用户直接触发入口):
 * ① 选项目(浏览目录) → ② 自动扫描:文件树(默认选中未排除文件)+ 会话列表(默认选中最新)
 * → ③ 勾选调整(树多选/会话多选) → ④ 传输进度
 * 手动迁移入口(纯手动模式):选项目 → 扫描清单 → 确认 → 传输。
 */

interface TransferModalProps {
  open: boolean;
  deviceId: string;
  deviceName: string;
  onClose: () => void;
  onSent: () => void;
}

interface SessionItem {
  file: string;
  name: string;
  mtime: number;
}

interface ScanResult {
  files: ScanFileItem[];
  sessions: SessionItem[];
  totalSize: number;
  excludedCount: number;
}

/** 单次传输上限(与主进程 MAX_TRANSFER_SIZE 一致) */
const MAX_TRANSFER_SIZE = 500 * 1024 * 1024;

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TransferModal({ open, deviceId, deviceName, onClose, onSent: _onSent }: TransferModalProps): JSX.Element | null {
  useUiLocale();
  const [projectPath, setProjectPath] = useState("");
  // 已打开过的项目(下拉选择,免手动找路径)
  const [projects, setProjects] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [transferring, setTransferring] = useState(false);
  const [phase, setPhase] = useState<"scanning" | "packing" | "waiting" | "transferring" | "sent" | "rejected" | "timeout" | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // 发送端传输进度(主进程广播阶段:等待确认 → 传输中 → 已发送/被拒/超时)
  useEffect(() => {
    return window.electronAPI.migration.onSendProgress((d) => {
      setPhase(d.phase ?? "transferring");
      setProgressPct(d.total > 0 ? Math.min(100, Math.round((d.sent / d.total) * 100)) : 0);
      if (d.phase === "rejected") {
        setError(uiText("ui.TransferModal.theOtherDeviceDeclinedTheTransfer"));
        setTransferring(false);
      } else if (d.phase === "timeout") {
        setError(uiText("ui.TransferModal.confirmationTimedOut30sTheOtherDevice"));
        setTransferring(false);
      } else if (d.phase === "sent") {
        // 传输完成 → 解除禁用,可关闭(恢复结果由回执另行提示)
        setTransferring(false);
      }
    });
  }, []);

  // 打开时:加载已打开过的项目 + 重置状态
  useEffect(() => {
    if (open) {
      setProjectPath("");
      setScanResult(null);
      setSelectedFiles([]);
      setSelectedSessions([]);
      setError(null);
      setTransferring(false);
      setPhase(null);
      setProgressPct(0);
      window.electronAPI.project.list().then((ps) => {
        setProjects(ps.filter((p) => p.exists).map((p) => ({ id: p.id, name: p.name, path: p.path })));
      }).catch(() => {});
    }
  }, [open]);

  // 选择项目后自动扫描(防抖 300ms,覆盖下拉/浏览/手动输入)
  useEffect(() => {
    const p = projectPath.trim();
    if (!p) { setScanResult(null); return; }
    const timer = setTimeout(() => { doScan(p); }, 300);
    return () => clearTimeout(timer);
  }, [projectPath]);

  if (!open) return null;

  /** 扫描(自动扫描与忽略项变更后共用) */
  const doScan = (p: string): void => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    window.electronAPI.migration.scan(p)
      .then((scan) => {
        setScanResult(scan);
        // 默认选中:最新会话(列表已按时间倒序,第一个即最新)
        setSelectedSessions(scan.sessions.length > 0 ? [scan.sessions[0]!.file] : []);
        if (scan.files.length === 0) setError(uiText("ui.TransferModal.noTransferableFilesFound"));
      })
      .catch((e: Error) => setError(uiText("ui.TransferModal.scanFailed", { v0: appMessage(e.message) })))
      .finally(() => setScanning(false));
  };

  const browseProject = async (): Promise<void> => {
    const dir = await window.electronAPI.dialog.openDirectory();
    if (dir) {
      setProjectPath(dir);
      setScanResult(null);
      setError(null);
    }
  };

  const toggleSession = (file: string): void => {
    setSelectedSessions((prev) => (prev.includes(file) ? prev.filter((f) => f !== file) : [...prev, file]));
  };

  // 选中文件总大小(500MB 上限拦截,与主进程一致)
  const selectedTotalSize = scanResult
    ? scanResult.files.filter((f) => selectedFiles.includes(f.relPath)).reduce((s, f) => s + f.size, 0)
    : 0;
  const overLimit = selectedTotalSize > MAX_TRANSFER_SIZE;

  const startTransfer = async (): Promise<void> => {
    if (!scanResult || selectedFiles.length === 0) return;
    if (overLimit) { setError(uiText("ui.TransferModal.selectionExceedsThe500MbLimitCurrently", { v0: fmtSize(selectedTotalSize) })); return; }
    setTransferring(true);
    setError(null);
    setPhase("waiting"); // 先显示等待确认(主进程广播会覆盖)
    try {
      // 统一入口:主进程内部扫描 + 按选中清单打包 zip + 传输
      const r = await window.electronAPI.migration.start(projectPath.trim(), deviceId, { files: selectedFiles, sessions: selectedSessions });
      if (!r.ok) {
        setError(r.error ?? uiText("ui.TransferModal.transferFailed"));
        setTransferring(false);
        return;
      }
      // 传输成功(数据已全部发出);接收端恢复完成会经回执提示(App 层),此处停留展示
      setPhase("sent");
    } catch (e) {
      setError(uiText("ui.TransferModal.transferFailed2", { v0: appMessage((e as Error).message) }));
      setTransferring(false);
    }
  };

  return (
    <Modal
      overlayClose="mousedown"
      canOverlayClose={() => !transferring}
      overlayClassName="bg-black/40 modal-overlay"
      onClose={onClose}
    >
      <div className="bg-[var(--modal-fill)] rounded-[var(--radius-lg)] shadow-2xl modal-card flex flex-col" style={{ width: 520 }}>
        <div className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0 bg-[var(--color-surface-alt)]">
          <h2 className="text-base font-semibold text-text-primary">{uiText("ui.TransferModal.transferTo")}{deviceName}</h2>
          <button className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-lg)] text-text-secondary hover:bg-surface-hover transition-colors" onClick={onClose} disabled={transferring}>✕</button>
        </div>

        <div className="px-6 py-3 space-y-3 flex-1 overflow-y-auto">
          {/* 项目:已打开的项目下拉 + 自由输入 */}
          <div>
            <label className="text-xs text-text-secondary block mb-1">{uiText("ui.TransferModal.chooseProject")}</label>
            <select
              className="em-input w-full px-2.5 py-1.5 text-xs text-text-primary mb-1.5"
              value={projectPath}
              onChange={(e) => { setProjectPath(e.target.value); setScanResult(null); }}
            >
              <option value="">{uiText("ui.TransferModal.chooseAnOpenProject")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.path}>{p.name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                value={projectPath}
                onChange={(e) => { setProjectPath(e.target.value); setScanResult(null); }}
                placeholder={uiText("ui.TransferModal.orEnterOrSelectAProjectDirectory")}
                className="em-input flex-1 px-2.5 py-1.5 text-xs text-text-primary"
              />
              <button type="button" className="px-3 py-1.5 rounded-[var(--radius-lg)] border border-border text-xs text-text-secondary hover:bg-surface-hover transition-colors shrink-0" onClick={() => void browseProject()}>
                {uiText("ui.AgentTemplateSettings.browse")}</button>
            </div>
          </div>

          {/* 扫描状态(选择项目后自动扫描,防抖 300ms) */}
          {projectPath && !scanResult && (
            <div className="w-full px-3 py-2 rounded-[var(--radius-lg)] border border-border text-xs text-text-secondary text-center">
              {scanning ? uiText("ui.DevicePanel.scanning") : uiText("ui.TransferModal.scanning")}
            </div>
          )}

          {/* 扫描结果:文件树 + 会话列表 */}
          {scanResult && (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-text-secondary">{uiText("ui.TransferModal.projectFiles")}</label>
                  <span className="text-[length:var(--text-2xs)] text-text-muted tabular-nums">
                    {uiText("ui.TransferModal.selected")}{selectedFiles.length}/{scanResult.files.length} {uiText("ui.MigrationIncomingModal.files")}{fmtSize(selectedTotalSize)}
                  </span>
                </div>
                <FileTreeSelector
                  files={scanResult.files}
                  onChange={setSelectedFiles}
                />
              </div>

              {/* 会话记录:仅主会话,默认勾选最新 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-text-secondary">{uiText("ui.TransferModal.sessionRecords")}</label>
                  <span className="text-[length:var(--text-2xs)] text-text-muted">{uiText("ui.TransferModal.selected2")}{selectedSessions.length}/{scanResult.sessions.length} {uiText("ui.TransferModal.mainSessionsOnlyNoSubsessions")}</span>
                </div>
                {scanResult.sessions.length === 0 ? (
                  <div className="bg-surface rounded-[var(--radius-lg)] border border-border px-3 py-2.5 text-[length:var(--text-11)] text-text-muted">
                    {uiText("ui.TransferModal.noSessionsInThisProject")}</div>
                ) : (
                  <div className="bg-surface rounded-[var(--radius-lg)] border border-border max-h-32 overflow-y-auto py-1">
                    {scanResult.sessions.map((s) => (
                      <div
                        key={s.file}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover transition-colors cursor-pointer"
                        onClick={() => toggleSession(s.file)}
                      >
                        <Checkbox
                          checked={selectedSessions.includes(s.file)}
                          onChange={() => toggleSession(s.file)}
                        />
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-secondary">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span className="text-xs text-text-primary truncate flex-1" >{s.name}</span>
                        <span className="text-[length:var(--text-2xs)] text-text-muted shrink-0 tabular-nums">{fmtTime(s.mtime)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* 发送端步骤条:扫描 → 打包 → 等待确认 → 传输 → 已发送 */}
          {transferring && (
            <div className="space-y-2">
              <StepIndicator
                steps={[
                  { id: "scanning", label: uiText("ui.DevicePanel.scan") },
                  { id: "packing", label: uiText("ui.TransferModal.package") },
                  { id: "waiting", label: uiText("ui.TransferModal.awaitConfirmation") },
                  { id: "transferring", label: uiText("ui.TransferModal.transfer") },
                  { id: "sent", label: uiText("ui.TransferModal.sent") },
                ]}
                current={phase ?? "scanning"}
              />
              {phase === "transferring" && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                    <div className="h-full bg-accent rounded-full transition-all duration-200" style={{ width: `${progressPct}%` }} />
                  </div>
                  <div className="text-[length:var(--text-2xs)] text-text-secondary">{uiText("ui.TransferModal.transferring")}{progressPct}%</div>
                </div>
              )}
              {phase === "sent" && (
                <div className="text-[length:var(--text-2xs)] text-text-secondary">{uiText("ui.TransferModal.transferCompleteWaitingForTheReceivingDevice")}</div>
              )}
            </div>
          )}
          {error && <div className="text-[length:var(--text-11)] text-danger">{appText(error)}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <button className="px-4 py-1.5 rounded-[var(--radius-lg)] text-text-secondary hover:bg-surface-hover transition-colors text-sm" onClick={onClose} disabled={transferring}>
            {uiText("common.cancel")}</button>
          <button
            className="px-5 py-1.5 rounded-[var(--radius-lg)] btn-accent text-sm font-medium"
            disabled={!scanResult || selectedFiles.length === 0 || transferring}
            onClick={() => void startTransfer()}
          >
            {transferring ? uiText("ui.TransferModal.transferring2") : uiText("ui.TransferModal.startTransfer", { v0: selectedFiles.length > 0 ? uiText("ui.extra.fileSelection", { files: selectedFiles.length, count: selectedFiles.length, sessions: selectedSessions.length > 0 ? uiText("ui.MigrationIncomingModal.includesSessions", { v0: selectedSessions.length }) : "" }) : "" })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
