import { useState, useEffect, useCallback } from "react";

interface FileTreePanelProps {
  projectPath: string;
  onFileClick?: (filePath: string, fileName: string) => void;
  collapseAllKey?: number;
}

export function FileTreePanel({ projectPath, onFileClick, collapseAllKey }: FileTreePanelProps): JSX.Element {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTree = useCallback(() => {
    if (!projectPath) return;
    setError(null);
    window.electronAPI.file
      .readTree(projectPath)
      .then(setFiles)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "加载文件树失败");
      });
  }, [projectPath]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

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
              isSelected ? "bg-accent/20" : "hover:bg-surface-hover"
            } ${node.modified ? "text-accent" : "text-text-primary"}`}
            style={{ paddingLeft: `${14 + depth * 16}px`, fontFamily: 'var(--font-mono)', fontSize: '12px' }}
            onClick={() => {
              if (node.isDirectory) {
                toggleExpand(node.path);
              } else {
                handleFileClick(node.path, node.name);
              }
            }}
          >
            <span
              className={`inline-block w-3.5 text-[10px] text-text-secondary shrink-0 transition-transform duration-150 ${
                isExpanded ? "rotate-90" : ""
              }`}
            >
              {node.isDirectory ? "▶" : ""}
            </span>
            <span className="truncate">{node.name}</span>
            {node.modified && <span className="text-accent text-[10px] font-medium shrink-0 ml-0.5">M</span>}
          </button>
          {node.isDirectory && isExpanded && node.children && renderTree(node.children, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="h-full overflow-y-auto">
      {error ? (
        <div className="p-4 text-center">
          <p className="text-danger text-sm mb-2">{error}</p>
          <button
            className="px-3 py-1 text-xs bg-accent text-text-inverse rounded hover:bg-accent-hover transition-colors"
            onClick={loadTree}
          >
            重试
          </button>
        </div>
      ) : files.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-xs text-text-secondary">暂无项目文件</p>
        </div>
      ) : (
        renderTree(files)
      )}
    </div>
  );
}
