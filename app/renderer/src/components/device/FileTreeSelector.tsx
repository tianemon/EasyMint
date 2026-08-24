import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 迁移文件树选择器:标准文件树——文件夹可展开、勾选联动(半选)、
 * 每个节点显示大小、文件夹显示「N 个文件 · X MB」、排除项可见但默认不勾选。
 */

export interface ScanFileItem {
  relPath: string;
  absPath: string;
  size: number;
  excluded: boolean;
}

interface TreeNode {
  name: string;
  relPath: string;      // 文件夹=前缀(不含尾 /),文件=完整相对路径
  type: "dir" | "file";
  size: number;         // 文件大小 / 目录汇总
  fileCount: number;    // 目录下文件数(含嵌套)
  excluded: boolean;
  children: TreeNode[];
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** 扁平文件列表 → 树 */
function buildTree(files: ScanFileItem[]): { tree: TreeNode[] } {
  const tree: TreeNode[] = [];
  const nodeByPath = new Map<string, TreeNode>();

  for (const f of files) {
    const parts = f.relPath.split("/");
    let parent: TreeNode[] = tree;
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i]!;
      let dir = nodeByPath.get(prefix);
      if (!dir) {
        dir = { name: parts[i]!, relPath: prefix, type: "dir", size: 0, fileCount: 0, excluded: f.excluded, children: [] };
        nodeByPath.set(prefix, dir);
        parent.push(dir);
      }
      parent = dir.children;
    }
    const fileNode: TreeNode = {
      name: parts[parts.length - 1]!,
      relPath: f.relPath,
      type: "file",
      size: f.size,
      fileCount: 1,
      excluded: f.excluded,
      children: [],
    };
    nodeByPath.set(f.relPath, fileNode);
    parent.push(fileNode);
  }

  // 汇总目录 size/fileCount(自底向上)
  const summarize = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.type === "dir") {
        summarize(n.children);
        n.size = n.children.reduce((s, c) => s + c.size, 0);
        n.fileCount = n.children.reduce((s, c) => s + c.fileCount, 0);
      }
    }
  };
  summarize(tree);
  return { tree };
}

/** 收集目录下的全部文件节点 */
function collectFiles(node: TreeNode, out: TreeNode[]): void {
  if (node.type === "file") out.push(node);
  else for (const c of node.children) collectFiles(c, out);
}

function TreeCheckbox({ checked, onToggle }: { checked: boolean | null; onToggle: () => void }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = checked === null;
  }, [checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked === true}
      onChange={(e) => {
        // 阻止冒泡:避免行级 onClick 再次触发 toggle(同一操作勾选两次=无效)
        e.stopPropagation();
        onToggle();
      }}
      // 关键:click 也会冒泡到行 div——只拦 change 不够,点 checkbox 会先触发行 onClick(文件=双 toggle 抵消/目录=误展开)
      onClick={(e) => e.stopPropagation()}
      className="w-3.5 h-3.5 rounded accent-accent shrink-0"
    />
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-text-muted transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

interface FileTreeSelectorProps {
  files: ScanFileItem[];
  onChange: (selectedRelPaths: string[]) => void;
}

export function FileTreeSelector({ files, onChange }: FileTreeSelectorProps): JSX.Element {
  const { tree } = useMemo(() => buildTree(files), [files]);
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const f of files) init[f.relPath] = !f.excluded;
    return init;
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // 扫描数据变化(重新扫描/换项目) → 重置勾选,全部折叠
  useEffect(() => {
    const init: Record<string, boolean> = {};
    for (const f of files) init[f.relPath] = !f.excluded;
    setChecked(init);
    setExpanded({});
  }, [files]);

  // 勾选变化 → 上报选中的文件相对路径
  useEffect(() => {
    onChange(files.filter((f) => checked[f.relPath]).map((f) => f.relPath));
  }, [checked]);

  /** 目录选中态:全部选中 true / 全不选 false / 部分 null */
  const dirState = (node: TreeNode): boolean | null => {
    const filesInDir: TreeNode[] = [];
    collectFiles(node, filesInDir);
    if (filesInDir.length === 0) return false;
    const sel = filesInDir.filter((f) => checked[f.relPath]).length;
    if (sel === filesInDir.length) return true;
    if (sel === 0) return false;
    return null;
  };

  const toggleNode = (node: TreeNode): void => {
    if (node.type === "file") {
      setChecked((prev) => ({ ...prev, [node.relPath]: !prev[node.relPath] }));
      return;
    }
    const target = dirState(node) === true ? false : true;
    const filesInDir: TreeNode[] = [];
    collectFiles(node, filesInDir);
    setChecked((prev) => {
      const next = { ...prev };
      for (const f of filesInDir) next[f.relPath] = target;
      return next;
    });
  };

  const toggleExpand = (node: TreeNode): void => {
    setExpanded((prev) => ({ ...prev, [node.relPath]: !prev[node.relPath] }));
  };

  const expandAll = (): void => {
    const all: Record<string, boolean> = {};
    for (const n of tree) if (n.type === "dir") all[n.relPath] = true;
    setExpanded(all);
  };
  const collapseAll = (): void => {
    setExpanded({});
  };

  const renderNode = (node: TreeNode, depth: number): JSX.Element => {
    const isDir = node.type === "dir";
    const state = isDir ? dirState(node) : checked[node.relPath] ?? false;
    const isExpanded = !!expanded[node.relPath];
    const indent = depth * 14;
    return (
      <div key={node.relPath}>
        <div
          className="flex items-center gap-1.5 py-[3px] pr-2 rounded hover:bg-surface-hover transition-colors cursor-pointer group"
          style={{ paddingLeft: 8 + indent }}
          onClick={() => (isDir ? toggleExpand(node) : toggleNode(node))}
        >
          {isDir ? (
            <span
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node);
              }}
              className="shrink-0"
            >
              <ChevronIcon expanded={isExpanded} />
            </span>
          ) : (
            <span className="w-[10px] shrink-0" />
          )}
          <span className="shrink-0">
            <TreeCheckbox checked={state} onToggle={() => toggleNode(node)} />
          </span>
          {isDir ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-secondary">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          )}
          <span className="text-xs truncate flex-1 text-text-primary" title={node.relPath}>
            {node.name}
          </span>
          <span className="shrink-0 text-[10px] text-text-muted tabular-nums">
            {isDir ? `${node.fileCount} 个文件 · ${fmtSize(node.size)}` : fmtSize(node.size)}
          </span>
        </div>
        {isDir && isExpanded && (
          <div>{node.children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  const selectAll = (): void => {
    const next: Record<string, boolean> = {};
    for (const f of files) next[f.relPath] = true;
    setChecked(next);
  };
  const selectNone = (): void => {
    const next: Record<string, boolean> = {};
    for (const f of files) next[f.relPath] = false;
    setChecked(next);
  };
  const selectDefault = (): void => {
    const next: Record<string, boolean> = {};
    for (const f of files) next[f.relPath] = !f.excluded;
    setChecked(next);
  };

  return (
    <div className="bg-surface rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border gap-2">
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" className="text-[10px] text-text-secondary hover:text-accent transition-colors" onClick={selectAll}>全选</button>
          <span className="text-text-muted">·</span>
          <button type="button" className="text-[10px] text-text-secondary hover:text-accent transition-colors" onClick={selectNone}>全否</button>
          <span className="text-text-muted">·</span>
          <button type="button" className="text-[10px] text-text-secondary hover:text-accent transition-colors" onClick={selectDefault}>默认</button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" className="text-[10px] text-text-secondary hover:text-accent transition-colors" onClick={expandAll}>展开全部</button>
          <span className="text-text-muted">·</span>
          <button type="button" className="text-[10px] text-text-secondary hover:text-accent transition-colors" onClick={collapseAll}>折叠</button>
        </div>
      </div>
      <div className="max-h-56 overflow-y-auto py-1">
        {tree.map((n) => renderNode(n, 0))}
      </div>
    </div>
  );
}
