import { useEffect, useState } from "react";

/**
 * 迁移对话框(发送端,用户直接触发入口):
 * ① 选项目(浏览目录) → ② 系统扫描生成清单(默认排除构建产物) → ③ 确认 → ④ 传输进度
 * Mint 入口走 MCP 工具(list_devices/prepare_migration/start_transfer),此 UI 是手动入口。
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
  const [files, setFiles] = useState<ScanFile[] | null>(null);
  const [totalSize, setTotalSize] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // 重置状态
  useEffect(() => {
    if (open) {
      setProjectPath("");
      setFiles(null);
      setTotalSize(0);
      setError(null);
      setTransferring(false);
      setProgress("");
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
      // 借用主进程文件树扫描 + 客户端排除过滤(默认排除与 Mint 工具一致)
      const tree = await window.electronAPI.file.readTree(projectPath.trim());
      const out: ScanFile[] = [];
      // 与主进程 prepare_migration 一致的排除规则(按完整相对路径前缀匹配):
      // 构建产物/缓存 + .easymint 可重建子项(保留 state.json/run.json/issues.json 项目状态)
      const DEFAULT_EXCLUDE = [
        ".git", "node_modules", "dist", "build", "temp", ".idea", ".vscode", ".DS_Store",
        ".easymint/shell-logs", ".easymint/templates", ".easymint/brand-tokens", ".easymint/group-sessions", ".easymint/group-sessions.json",
      ];
      // 通配符排除(与主进程一致):构建产物文件 *.apk/*.exe/*.dmg/*.zip
      const WILDCARD_EXCLUDE = [".apk", ".exe", ".dmg", ".zip"];
      const isExcluded = (rel: string) =>
        DEFAULT_EXCLUDE.some((x) => rel === x || rel.startsWith(x + "/")) ||
        WILDCARD_EXCLUDE.some((ext) => rel.endsWith(ext));
      const walk = (nodes: FileNode[], prefix: string) => {
        for (const n of nodes) {
          const rel = prefix ? `${prefix}/${n.name}` : n.name;
          if (isExcluded(rel)) continue;
          if (n.isDirectory) walk(n.children ?? [], rel);
          else out.push({ relPath: rel, absPath: n.path });
        }
      };
      walk(tree, "");
      setFiles(out);
      setTotalSize(out.length); // 文件数展示;大小由主进程传输时统计
      if (out.length === 0) setError("未扫描到可迁移文件");
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
    setProgress("打包并传输中…");
    try {
      const r = await window.electronAPI.migration.start({
        projectPath: projectPath.trim(),
        deviceId,
        files: files.map((f) => ({ relPath: f.relPath, absPath: f.absPath })),
      });
      if (!r.ok) {
        setError(r.error ?? "传输失败");
        setTransferring(false);
        return;
      }
      setProgress("传输完成，等待接收端恢复…");
      // 短暂展示后关闭
      setTimeout(() => { onSent(); onClose(); }, 1200);
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
          {/* 项目路径 */}
          <div>
            <label className="text-xs text-text-secondary block mb-1">项目路径</label>
            <div className="flex gap-2">
              <input
                value={projectPath}
                onChange={(e) => { setProjectPath(e.target.value); setFiles(null); }}
                placeholder="选择要迁移的项目目录"
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
                待迁移 {files.length} 个文件
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

          {progress && <div className="text-xs text-accent">{progress}</div>}
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
