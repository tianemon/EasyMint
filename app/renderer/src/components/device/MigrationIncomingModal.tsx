import { useEffect, useState } from "react";
import { StepIndicator } from "./StepIndicator";
import { useSettingsStore } from "../../stores/settings-store";

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
      setError("请选择或输入项目父文件夹");
      return;
    }
    setAccepting(true);
    setError(null);
    const r = await onAccept(incoming.transferId, finalPath);
    setAccepting(false);
    if (!r.ok) {
      setError(r.error ?? "接收失败");
      return;
    }
    // 接收成功:显示落位路径,短暂停留后关闭
    setAccepted(true);
    setStage("done");
    setTargetPath(finalPath);
    setTimeout(() => onClose(), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 modal-overlay">
      <div className="bg-surface-alt rounded-xl border border-border shadow-2xl modal-card flex flex-col" style={{ width: 460 }}>
        <div className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0">
          <h2 className="text-base font-semibold text-text-primary">接收迁移</h2>
          <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors" onClick={() => void onReject(incoming.transferId)}>✕</button>
        </div>

        <div className="px-6 py-3 space-y-3">
          {/* 迁移内容摘要 */}
          <div className="bg-surface rounded-lg border border-border px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-text-primary font-medium">{incoming.projectName}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-accent">来自 {incoming.fromName}</span>
            </div>
            <div className="text-xs text-text-secondary">
              {incoming.fileCount} 个文件 · {fmtSize(incoming.totalSize)}
              {incoming.sessionCount > 0 ? ` · 含 ${incoming.sessionCount} 个会话记录` : ""}
            </div>
          </div>

          {/* 项目父文件夹 */}
          <div>
            <label className="text-xs text-text-secondary block mb-1">项目父文件夹</label>
            <div className="flex gap-2">
              <input
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                placeholder="选择项目要放到的父文件夹"
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface border border-border text-xs text-text-primary outline-none focus:border-accent"
              />
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:bg-surface-hover transition-colors shrink-0 disabled:opacity-50"
                disabled={browsing}
                onClick={handleBrowse}
              >
                {browsing ? "…" : "浏览"}
              </button>
            </div>
            <p className="text-[10px] text-text-muted mt-1">将在此文件夹下创建「{incoming.projectName}」项目文件夹并恢复；会话会自动恢复到本机项目（以新路径为身份）</p>
          </div>

          {error && <div className="text-[11px] text-danger">{error}</div>}

          {/* 接收端步骤条:接收 → 校验 → 解压 → 会话恢复 → 完成 */}
          {(accepting || accepted) && (
            <div className="space-y-2">
              <StepIndicator
                steps={[
                  { id: "receiving", label: "接收" },
                  { id: "verify", label: "校验" },
                  { id: "extract", label: "解压" },
                  { id: "session", label: "会话恢复" },
                  { id: "done", label: "完成" },
                ]}
                current={stage}
              />
              {stage === "receiving" && progressPct !== null && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                    <div className="h-full bg-accent rounded-full transition-all duration-200" style={{ width: `${progressPct}%` }} />
                  </div>
                  <div className="text-[10px] text-text-secondary">接收中 {progressPct}%</div>
                </div>
              )}
            </div>
          )}

          {/* 接收成功:显示落位路径 + 会话恢复数 */}
          {accepted && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-accent">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                已恢复到：{targetPath}/{incoming.projectName.replace(/[\\/:*?"<>|]/g, "_").trim() || "migrated-project"}
              </div>
              {sessionRestoredCount > 0 && (
                <div className="text-[11px] text-text-secondary">
                  已恢复 {sessionRestoredCount} 个会话记录
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <button
            className="px-4 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors text-sm"
            onClick={() => void onReject(incoming.transferId)}
          >
            拒绝
          </button>
          <button
            className="px-5 py-1.5 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors text-sm font-medium disabled:opacity-50"
            disabled={accepting}
            onClick={handleAccept}
          >
            {accepting ? "接收中…" : "接收并恢复"}
          </button>
        </div>
      </div>
    </div>
  );
}
