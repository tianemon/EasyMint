import { useEffect, useState } from "react";
import { StepIndicator } from "./StepIndicator";

/**
 * 迁移对话框(发送端,用户直接触发入口):
 * ① 选项目(浏览目录) → ② 系统扫描生成清单(默认排除构建产物) → ③ 确认 → ④ 传输进度
 * 手动迁移入口(纯手动模式):选项目 → 扫描清单 → 确认 → 传输。
 */

interface TransferModalProps {
  open: boolean;
  deviceId: string;
  deviceName: string;
  onClose: () => void;
  onSent: () => void;
}

/** 与主进程默认排除规则一致的客户端镜像(展示用;真正过滤在主进程 startTransfer 前的 prepare 扫描) */
interface ScanFile {
  relPath: string;
  absPath: string;
}

export function TransferModal({ open, deviceId, deviceName, onClose, onSent }: TransferModalProps): JSX.Element | null {
  const [projectPath, setProjectPath] = useState("");
  // 已打开过的项目(下拉选择,免手动找路径)
  const [projects, setProjects] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [files, setFiles] = useState<ScanFile[] | null>(null);
  const [totalSize, setTotalSize] = useState(0);
  const [scanning, setScanning] = useState(false);
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
      setFiles(null);
      setTotalSize(0);
      setError(null);
      setTransferring(false);
      setPhase(null);
      setProgressPct(0);
      window.electronAPI.project.list().then((ps) => {
        setProjects(ps.filter((p) => p.exists).map((p) => ({ id: p.id, name: p.name, path: p.path })));
      }).catch(() => {});
    }
  }, [open]);

  if (!open) return null;

  const browseProject = async () => {
    const dir = await window.electronAPI.dialog.openDirectory();
    if (dir) {
      setProjectPath(dir);
      setFiles(null);
      setError(null);
    }
  };

  const scanProject = async () => {
    if (!projectPath.trim()) { setError("请先选择项目目录"); return; }
    setScanning(true);
    setError(null);
    try {
      // 统一扫描(主进程 migration-service.scanProject,单一实现)
      const scan = await window.electronAPI.migration.scan(projectPath.trim());
      setFiles(scan.files);
      setTotalSize(scan.totalSize);
      if (scan.files.length === 0) setError("未扫描到可迁移文件");
    } catch (e) {
      setError(`扫描失败: ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  };

  const startTransfer = async () => {
    if (!files || files.length === 0) return;
    setTransferring(true);
    setError(null);
    setPhase("waiting"); // 先显示等待确认(主进程广播会覆盖)
    try {
      // 统一入口:主进程内部扫描 + 打包 zip + 传输
      const r = await window.electronAPI.migration.start(projectPath.trim(), deviceId);
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
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center modal-overlay" onMouseDown={(e) => { if (!transferring) onClose(); }}>
      <div className="bg-surface-alt rounded-xl border border-border shadow-2xl modal-card flex flex-col" style={{ width: 480 }} onMouseDown={(e) => e.stopPropagation()}>
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
              onChange={(e) => { setProjectPath(e.target.value); setFiles(null); }}
            >
              <option value="">选择已打开的项目…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.path}>{p.name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                value={projectPath}
                onChange={(e) => { setProjectPath(e.target.value); setFiles(null); }}
                placeholder="或直接输入/选择项目目录"
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface border border-border text-xs text-text-primary outline-none focus:border-accent"
              />
              <button type="button" className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:bg-surface-hover transition-colors shrink-0" onClick={browseProject}>
                浏览
              </button>
            </div>
          </div>

          {/* 扫描清单 */}
          {projectPath && !files && (
            <button
              type="button"
              className="w-full px-3 py-2 rounded-lg border border-border text-xs text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
              disabled={scanning}
              onClick={scanProject}
            >
              {scanning ? "扫描中…" : "扫描迁移清单（排除构建产物）"}
            </button>
          )}

          {files && (
            <div className="bg-surface rounded-lg border border-border px-3 py-2.5">
              <div className="text-xs font-medium text-text-primary mb-1.5">
                待迁移 {files.length} 个文件 · {(totalSize / 1024 / 1024).toFixed(1)}MB
                <span className="text-[10px] text-text-muted ml-2">已排除 .git/node_modules/dist/build 等</span>
              </div>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {files.slice(0, 15).map((f) => (
                  <div key={f.relPath} className="text-[10px] text-text-secondary truncate">{f.relPath}</div>
                ))}
                {files.length > 15 && <div className="text-[10px] text-text-muted">… 等 {files.length - 15} 个文件</div>}
              </div>
            </div>
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
                  <div className="text-[10px] text-text-secondary">传输中 {progressPct}%</div>
                </div>
              )}
              {phase === "sent" && (
                <div className="text-[10px] text-text-secondary">传输完成，等待接收端恢复（恢复结果会另行提示）</div>
              )}
            </div>
          )}
          {error && <div className="text-[11px] text-danger">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <button className="px-4 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors text-sm" onClick={onClose} disabled={transferring}>
            取消
          </button>
          <button
            className="px-5 py-1.5 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors text-sm font-medium disabled:opacity-50"
            disabled={!files || files.length === 0 || transferring}
            onClick={startTransfer}
          >
            {transferring ? "传输中…" : "开始迁移"}
          </button>
        </div>
      </div>
    </div>
  );
}
