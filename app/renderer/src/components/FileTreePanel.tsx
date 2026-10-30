import { appText } from "../lib/i18n";
import { uiText, useUiLocale } from "../lib/i18n";
import { useState, useEffect, useCallback, useRef } from "react";

interface FileTreePanelProps {
  projectPath: string;
  onFileClick?: (filePath: string, fileName: string) => void;
  collapseAllKey?: number;
  /**
   * 静默刷新令牌：值变化即重新读树，但**不清空现有列表**。
   *
   * 侧栏切 tab 不再卸载本组件（切走只是隐藏），原来"切回就等于重新加载"的语义
   * 改由这个令牌补上——否则用户会看到旧的文件列表。
   */
  refreshToken?: number;
}

export function FileTreePanel({ projectPath, onFileClick, collapseAllKey, refreshToken }: FileTreePanelProps): JSX.Element {
  useUiLocale();
  const [files, setFiles] = useState<FileNode[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTree = useCallback(() => {
    if (!projectPath) return;
    setError(null);
    window.electronAPI.file
      .readTree(projectPath)
      .then(({ nodes, truncated: cut }) => { setFiles(nodes); setTruncated(cut); })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : uiText("ui.FileTreePanel.couldNotLoadFileTree"));
      });
  }, [projectPath]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // 切回「文件」页时的静默刷新：只替换数据，不动 expanded/selected，界面不闪。
  // 依赖只写令牌——之前把 loadTree 也放进依赖，projectPath 变化时会和上面的 effect
  // 各触发一次，等于每次切项目都读两遍树（第二遍纯浪费）。
  const loadRef = useRef(loadTree);
  loadRef.current = loadTree;
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) { firstRefresh.current = false; return; }
    loadRef.current();
  }, [refreshToken]);

  useEffect(() => {
    if (collapseAllKey && collapseAllKey > 0) {
      setExpanded(new Set());
    }
  }, [collapseAllKey]);

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleFileClick = (filePath: string, fileName: string) => {
    setSelectedFile(filePath);
    onFileClick?.(filePath, fileName);
  };

  const renderTree = (nodes: FileNode[], depth = 0): JSX.Element[] => {
    return nodes.map((node) => {
      const isExpanded = expanded.has(node.path);
      const isSelected = selectedFile === node.path;
      return (
        <div key={node.path}>
          <button
            className={`w-full text-left py-1 flex items-center gap-1.5 transition-colors ${
              isSelected ? "bg-accent-high" : "hover:bg-surface-hover"
            } ${node.modified ? "text-accent" : "text-text-primary"}`}
            style={{ paddingLeft: `${14 + depth * 16}px`, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
            onClick={() => {
              if (node.isDirectory) {
                toggleExpand(node.path);
              } else {
                handleFileClick(node.path, node.name);
              }
            }}
          >
            {node.isDirectory ? (
              /* 文件夹：收起 = folder，展开 = folder-open（Lucide） */
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-text-secondary">
                {isExpanded
                  ? <path d="m6 14 1.5-2.9A2 2 0 019.24 10H20a2 2 0 011.94 2.5l-1.54 6a2 2 0 01-1.95 1.5H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2h2"/>
                  : <path d="M20 20a2 2 0 002-2V8a2 2 0 00-2-2h-7.9a2 2 0 01-1.69-.9L9.6 3.9A2 2 0 007.93 3H4a2 2 0 00-2 2v13a2 2 0 002 2z"/>}
              </svg>
            ) : (
              /* 文件：file 图标（颜色跟随文本，modified 时随 accent） */
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-text-muted">
                <path d="M15 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7z"/><path d="M15 2v5h5"/>
              </svg>
            )}
            <span className="truncate">{node.name}</span>
            {node.modified && <span className="text-accent text-[length:var(--text-2xs)] font-medium shrink-0 ml-0.5">M</span>}
          </button>
          {node.isDirectory && isExpanded && node.children && renderTree(node.children, depth + 1)}
        </div>
      );
    });
  };

  return (
    // 不在这里自建滚动：外层 .sb-content 已经是 overflow-y:auto + scrollbar-gutter: stable，
    // 内层再滚一次会让滚动条落在 `.sb-content` 的右内边距里面，比会话列表的滚动条左 6px。
    <div>
      {error ? (
        <div className="p-4 text-center">
          <p className="text-danger text-sm mb-2">{appText(error)}</p>
          <button
            className="px-3 py-1 text-xs btn-accent rounded-[var(--radius-lg)]"
            onClick={loadTree}
          >
            {uiText("ui.ChatPanel.retry")}</button>
        </div>
      ) : files.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <p className="text-xs text-text-secondary">{uiText("ui.FileTreePanel.noProjectFiles")}</p>
        </div>
      ) : (
        <>
          {renderTree(files)}
          {truncated && (
            <div className="px-3 py-2 text-[length:var(--text-2xs)] text-text-secondary">
              {uiText("ui.FileTreePanel.treeTruncated")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
