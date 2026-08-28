import { useEffect, useState } from "react";
import { StepIndicator } from "./StepIndicator";
import { FileTreeSelector, ScanFileItem } from "./FileTreeSelector";

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
        setError("对方拒绝了迁移");
        setTransferring(false);
      } else if (d.phase === "timeout") {
        setError("等待对方确认超时(30s)——对方可能不在线或未响应");
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
        if (scan.files.length === 0) setError("未扫描到可迁移文件");
      })
      .catch((e: Error) => setError(`扫描失败: ${e.message}`))
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
    if (overLimit) { setError(`选中内容超过 500MB 上限（当前 ${fmtSize(selectedTotalSize)}），请取消部分文件`); return; }
    setTransferring(true);
    setError(null);
    setPhase("waiting"); // 先显示等待确认(主进程广播会覆盖)
    try {
      // 统一入口:主进程内部扫描 + 按选中清单打包 zip + 传输
      const r = await window.electronAPI.migration.start(projectPath.trim(), deviceId, { files: selectedFiles, sessions: selectedSessions });
      if (!r.ok) {
        setError(r.error ?? "传输失败");
        setTransferring(false);
        return;
      }
      // 传输成功(数据已全部发出);接收端恢复完成会经回执提示(App 层),此处停留展示
      setPhase("sent");
    } catch (e) {
      setError(`传输失败: ${(e as Error).message}`);
      setTransferring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center modal-overlay" onMouseDown={(_e) => { if (!transferring) onClose(); }}>
      <div className="bg-surface-alt rounded-xl border border-border shadow-2xl modal-card flex flex-col" style={{ width: 520 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0">
          <h2 className="text-base font-semibold text-text-primary">迁移到 {deviceName}</h2>
          <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors" onClick={onClose} disabled={transferring}>✕</button>
        </div>

        <div className="px-6 py-3 space-y-3 flex-1 overflow-y-auto">
          {/* 项目:已打开的项目下拉 + 自由输入 */}
          <div>
            <label className="text-xs text-text-secondary block mb-1">选择项目</label>
            <select
              className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-border text-xs text-text-primary outline-none focus:border-accent mb-1.5"
              value={projectPath}
              onChange={(e) => { setProjectPath(e.target.value); setScanResult(null); }}
            >
              <option value="">选择已打开的项目…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.path}>{p.name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                value={projectPath}
                onChange={(e) => { setProjectPath(e.target.value); setScanResult(null); }}
                placeholder="或直接输入/选择项目目录"
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface border border-border text-xs text-text-primary outline-none focus:border-accent"
              />
              <button type="button" className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:bg-surface-hover transition-colors shrink-0" onClick={() => void browseProject()}>
                浏览
              </button>
            </div>
          </div>

          {/* 扫描状态(选择项目后自动扫描,防抖 300ms) */}
          {projectPath && !scanResult && (
            <div className="w-full px-3 py-2 rounded-lg border border-border text-xs text-text-secondary text-center">
              {scanning ? "扫描中…" : "正在扫描…"}
            </div>
          )}

          {/* 扫描结果:文件树 + 会话列表 */}
          {scanResult && (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-text-secondary">项目文件</label>
                  <span className="text-[length:var(--text-2xs)] text-text-muted tabular-nums">
                    已选择 {selectedFiles.length}/{scanResult.files.length} 个文件 · {fmtSize(selectedTotalSize)}
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
                  <label className="text-xs text-text-secondary">会话记录</label>
                  <span className="text-[length:var(--text-2xs)] text-text-muted">已选 {selectedSessions.length}/{scanResult.sessions.length} · 仅主会话（不含子会话）</span>
                </div>
                {scanResult.sessions.length === 0 ? (
                  <div className="bg-surface rounded-lg border border-border px-3 py-2.5 text-[length:var(--text-11)] text-text-muted">
                    该项目暂无会话记录
                  </div>
                ) : (
                  <div className="bg-surface rounded-lg border border-border max-h-32 overflow-y-auto py-1">
                    {scanResult.sessions.map((s) => (
                      <div
                        key={s.file}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover transition-colors cursor-pointer"
                        onClick={() => toggleSession(s.file)}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSessions.includes(s.file)}
                          onChange={(e) => {
                            // 阻止冒泡:避免行 onClick 再次 toggle(双重触发=状态不变)
                            e.stopPropagation();
                            toggleSession(s.file);
                          }}
                          // click 也会冒泡到行 onClick——必须一并拦截
                          onClick={(e) => e.stopPropagation()}
                          className="w-3.5 h-3.5 rounded accent-accent shrink-0"
                        />
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-secondary">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span className="text-xs text-text-primary truncate flex-1" title={s.file}>{s.name}</span>
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
                  { id: "scanning", label: "扫描" },
                  { id: "packing", label: "打包" },
                  { id: "waiting", label: "等待确认" },
                  { id: "transferring", label: "传输" },
                  { id: "sent", label: "已发送" },
                ]}
                current={phase ?? "scanning"}
              />
              {phase === "transferring" && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                    <div className="h-full bg-accent rounded-full transition-all duration-200" style={{ width: `${progressPct}%` }} />
                  </div>
                  <div className="text-[length:var(--text-2xs)] text-text-secondary">传输中 {progressPct}%</div>
                </div>
              )}
              {phase === "sent" && (
                <div className="text-[length:var(--text-2xs)] text-text-secondary">传输完成，等待接收端恢复（恢复结果会另行提示）</div>
              )}
            </div>
          )}
          {error && <div className="text-[length:var(--text-11)] text-danger">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <button className="px-4 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors text-sm" onClick={onClose} disabled={transferring}>
            取消
          </button>
          <button
            className="px-5 py-1.5 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors text-sm font-medium disabled:opacity-50"
            disabled={!scanResult || selectedFiles.length === 0 || transferring}
            onClick={() => void startTransfer()}
          >
            {transferring ? "传输中…" : `开始迁移${selectedFiles.length > 0 ? `（${selectedFiles.length} 个文件${selectedSessions.length > 0 ? ` · ${selectedSessions.length} 个会话` : ""}）` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
