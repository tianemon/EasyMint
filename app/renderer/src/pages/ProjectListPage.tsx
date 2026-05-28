import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { NewProjectDialog } from "../components/NewProjectDialog";

export function ProjectListPage(): JSX.Element {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = () => {
    setError(null);
    window.electronAPI.project.list().then(setProjects).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "加载项目列表失败");
    });
  };

  useEffect(() => {
    loadProjects();
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-8 p-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">EasyMint</h1>
        <p className="text-text-secondary">AI 项目工作台 — 从想法到产品，一键启动</p>
      </div>

      {error ? (
        <div className="text-center p-12 rounded-lg border border-red-500/30 bg-surface-alt">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            className="px-6 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors"
            onClick={loadProjects}
          >
            重试
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center p-12 rounded-lg border border-border bg-surface-alt">
          <p className="text-text-secondary mb-4">还没有项目</p>
          <button
            className="px-6 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors"
            onClick={() => setShowNewDialog(true)}
          >
            + 新建项目
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4 w-full max-w-4xl">
          {projects.map((p) => (
            <button
              key={p.id}
              className="p-4 rounded-lg border border-border bg-surface-alt hover:bg-surface-hover transition-colors text-left"
              onClick={() => navigate(`/project/${p.id}`)}
            >
              <div className="font-medium">{p.name}</div>
              <div className="text-sm text-text-secondary mt-1 truncate">{p.path}</div>
              <div className="text-xs text-text-secondary mt-2">
                {new Date(p.lastOpenedAt).toLocaleDateString("zh-CN")}
              </div>
            </button>
          ))}
          <button
            className="p-4 rounded-lg border border-dashed border-border hover:border-accent transition-colors flex items-center justify-center text-text-secondary"
            onClick={() => setShowNewDialog(true)}
          >
            + 新建项目
          </button>
        </div>
      )}

      {showNewDialog && (
        <NewProjectDialog
          onClose={() => setShowNewDialog(false)}
          onCreated={(project) => {
            setShowNewDialog(false);
            navigate(`/setup/${project.id}`);
          }}
        />
      )}
    </div>
  );
}

