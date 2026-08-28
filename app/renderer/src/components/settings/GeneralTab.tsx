import { useEffect, useState } from "react";
import { useSettingsStore } from "../../stores/settings-store";

// ── Git Check ─────────────────────────────────────────────────────────────────

function useDetect(cmd: "git" | "nodeRuntime" | "codegraph") {
  const [info, setInfo] = useState<{ found: boolean; version?: string } | null>(null);
  useEffect(() => {
    window.electronAPI?.[cmd]?.detect().then(setInfo).catch(() => setInfo({ found: false }));
  }, [cmd]);
  return info;
}

function EnvRow({ label, info, installUrl }: {
  label: string;
  info: { found: boolean; version?: string } | null;
  installUrl?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-primary">{label}</span>
        {info === null ? (
          <span className="text-xs text-text-muted">检测中...</span>
        ) : info.found ? (
          <span className="text-xs text-text-secondary">{info.version}</span>
        ) : (
          <span className="text-xs text-danger">未安装</span>
        )}
      </div>
      {info && !info.found && installUrl && (
        <a
          href={installUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-lg bg-accent text-text-inverse text-xs font-medium hover:bg-accent-hover transition-colors"
        >
          点击安装 {label}
        </a>
      )}
    </div>
  );
}

function CodegraphRow({ info }: { info: { found: boolean; version?: string } | null }) {
  const cmd = "curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh";
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-2 mt-1">
        <span className="text-sm text-text-primary">CodeGraph</span>
        {info === null ? (
          <span className="text-xs text-text-muted">检测中...</span>
        ) : info.found ? (
          <span className="text-xs text-text-secondary">{info.version}</span>
        ) : (
          <span className="text-xs text-danger">未安装</span>
        )}
      </div>
      {info && !info.found && (
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1">
            <code className="text-[length:var(--text-2xs)] text-text-secondary bg-surface px-2 py-0.5 rounded select-all">{cmd}</code>
            <button
              className="shrink-0 px-1.5 py-0.5 rounded text-[length:var(--text-2xs)] text-text-secondary hover:text-accent hover:bg-surface-hover transition-colors"
              onClick={handleCopy}
            >
              {copied ? "已复制" : "复制"}
            </button>
          </div>
          <span className="text-[length:var(--text-2xs)] text-text-muted">
            https://github.com/colbymchenry/codegraph
          </span>
        </div>
      )}
    </div>
  );
}

function EnvCheckSection(): JSX.Element {
  const gitInfo = useDetect("git");
  const nodeInfo = useDetect("nodeRuntime");
  const codegraphInfo = useDetect("codegraph");

  return (
    <section>
      <h3 className="text-sm font-medium text-text-secondary mb-2">环境检测</h3>
      <div className="bg-surface-alt rounded-lg border border-border px-4 py-3 space-y-3">
        <EnvRow label="Git" info={gitInfo} installUrl="https://git-scm.com/downloads" />
        <EnvRow label="Node.js" info={nodeInfo} installUrl="https://nodejs.org/" />
        <CodegraphRow info={codegraphInfo} />
      </div>
    </section>
  );
}

// ── Cache Management ──────────────────────────────────────────────────────────

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CacheManagementSection(): JSX.Element {
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
      <h3 className="text-sm font-medium text-text-secondary mb-2">缓存管理</h3>
      <div className="bg-surface-alt rounded-lg border border-border divide-y divide-border">

        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h4 className="text-xs font-medium text-text-primary">安装包缓存</h4>
            {updateSize === null ? (
              <p className="text-[length:var(--text-11)] text-text-muted">扫描中...</p>
            ) : updateSize > 0 ? (
              <p className="text-[length:var(--text-11)] text-text-secondary">{formatMB(updateSize)}</p>
            ) : (
              <p className="text-[length:var(--text-11)] text-text-muted">暂无缓存</p>
            )}
          </div>
          {updateSize !== null && updateSize > 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:border-accent-border-strong transition-colors"
                onClick={handleClear}
                disabled={clearing}
              >
                {clearing ? "清除中..." : "清除缓存"}
              </button>
              <button
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:border-accent-border-strong transition-colors"
                onClick={() => window.electronAPI?.app?.openUpdateCache?.()}
              >
                文件夹
              </button>
            </div>
          )}
        </div>

        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h4 className="text-xs font-medium text-text-primary">上传缓存</h4>
            {uploadSize === null ? (
              <p className="text-[length:var(--text-11)] text-text-muted">扫描中...</p>
            ) : uploadSize > 0 ? (
              <p className="text-[length:var(--text-11)] text-text-secondary">{formatMB(uploadSize)}</p>
            ) : (
              <p className="text-[length:var(--text-11)] text-text-muted">暂无缓存</p>
            )}
          </div>
          {uploadSize !== null && uploadSize > 0 && (
            <button
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:border-accent-border-strong transition-colors"
              onClick={() => window.electronAPI?.upload?.openDir?.()}
            >
              打开文件夹
            </button>
          )}
        </div>

      </div>
    </section>
  );
}

/** 通用设置:默认项目路径 / 聊天开关 / 压缩阈值 / 缓存 / 环境检测 */
export function GeneralTab(): JSX.Element {
  const {
    defaultProjectDir,
    contextThreshold,
    showThinking,
    showToolUse,
    setDefaultProjectDir,
    setContextThreshold,
    setShowThinking,
    setShowToolUse,
  } = useSettingsStore();

  return (
    <div className="space-y-5">
      {/* 路径 */}
      <section>
        <h3 className="text-sm font-medium text-text-secondary mb-2">默认项目路径</h3>
        <div className="bg-surface-alt rounded-lg border border-border px-4 py-3">
          <input
            className="em-input w-full px-3 py-2 text-text-primary text-sm"
            placeholder="~/EasyMintProject"
            value={defaultProjectDir}
            onChange={(e) => setDefaultProjectDir(e.target.value)}
          />
          <p className="text-[length:var(--text-2xs)] text-text-secondary mt-0.5">新建项目时的默认父目录，workspace 会话也存放于此路径下</p>
        </div>
      </section>

      {/* 聊天 */}
      <section>
        <h3 className="text-sm font-medium text-text-secondary mb-2">聊天</h3>
        <div className="bg-surface-alt rounded-lg border border-border px-4 py-3 space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showThinking}
              onChange={(e) => setShowThinking(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-accent"
            />
            <span className="text-xs text-text-primary">思考过程</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showToolUse}
              onChange={(e) => setShowToolUse(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-accent"
            />
            <span className="text-xs text-text-primary">工具调用（Bash、Read、Edit、Task 等）</span>
          </div>
        </div>
      </section>

      {/* Context threshold */}
      <section>
        <h3 className="text-sm font-medium text-text-secondary mb-2">上下文压缩阈值</h3>
        <div className="bg-surface-alt rounded-lg border border-border px-4 py-3">
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
          <p className="text-[length:var(--text-11)] text-text-secondary mt-1">达到阈值时询问是否压缩（可跳过或输入压缩命令），SDK 自动压缩在接近满时兜底。范围 60%-80%，建议 75%。</p>
        </div>
      </section>

      {/* 更新缓存 */}
      <CacheManagementSection />

      {/* 环境检测 */}
      <EnvCheckSection />
    </div>
  );
}
