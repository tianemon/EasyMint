import { useState, useEffect } from "react";

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

interface FileTreePanelProps {
  projectPath: string;
}

export function FileTreePanel({ projectPath }: FileTreePanelProps): JSX.Element {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");

  useEffect(() => {
    if (projectPath) {
      window.electronAPI.file.readTree(projectPath).then(setFiles);
    }
  }, [projectPath]);

  const handleFileClick = async (filePath: string) => {
    setSelectedFile(filePath);
    const content = await window.electronAPI.file.readContent(filePath);
    setFileContent(content);
  };

  const renderTree = (nodes: FileNode[], depth = 0): JSX.Element[] => {
    return nodes.map((node) => (
      <div key={node.path}>
        <button
          className={`w-full text-left px-2 py-1 text-sm hover:bg-surface-hover transition-colors ${
            selectedFile === node.path ? "bg-accent/20" : ""
          }`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => !node.isDirectory && handleFileClick(node.path)}
        >
          {node.isDirectory ? "📁" : "📄"} {node.name}
        </button>
        {node.children && renderTree(node.children, depth + 1)}
      </div>
    ));
  };

  return (
    <div className="flex h-full">
      {/* File tree */}
      <div className="w-64 border-r border-border overflow-y-auto bg-surface-alt">
        <div className="p-3 border-b border-border text-sm font-medium text-text-secondary">
          项目结构
        </div>
        {renderTree(files)}
      </div>
      {/* File content preview */}
      <div className="flex-1 overflow-auto p-4">
        {selectedFile ? (
          <pre className="text-sm font-mono whitespace-pre-wrap text-text-secondary">
            {fileContent}
          </pre>
        ) : (
          <div className="flex items-center justify-center h-full text-text-secondary">
            选择文件查看内容
          </div>
        )}
      </div>
    </div>
  );
}
