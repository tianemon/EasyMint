import { useState } from "react";
import { Select } from "./Select";

interface Runnable {
  id: string;
  platform: string;
  label: string;
  run_command: string;
  cwd?: string;
  install_command?: string;
  url?: string;
}

interface ScriptEditDialogProps {
  projectPath: string;
  /** 编辑对象（null 时关闭不渲染） */
  runnable: Runnable | null;
  /** 全量脚本列表（保存时替换目标条目写回 run.json） */
  runnables: Runnable[];
  onClose: () => void;
}

const PLATFORM_OPTIONS = [
  "react", "vue", "nextjs", "nuxt", "angular", "svelte",
  "spring", "django", "flask", "fastapi", "nodejs", "rails", "laravel",
  "go", "rust", "dotnet", "react-native", "expo", "flutter",
  "electron", "tauri", "python", "shell",
].map((p) => ({ value: p, label: p }));

/** 脚本编辑弹窗：编辑 run.json 单条脚本（标题点击进入；保存后 watcher 自动刷新面板） */
export function ScriptEditDialog({ projectPath, runnable, runnables, onClose }: ScriptEditDialogProps): JSX.Element | null {
  const [label, setLabel] = useState(runnable?.label || "");
  const [platform, setPlatform] = useState(runnable?.platform || "shell");
  const [runCommand, setRunCommand] = useState(runnable?.run_command || "");
  const [cwd, setCwd] = useState(runnable?.cwd || "");
  const [url, setUrl] = useState(runnable?.url || "");
  const [installCommand, setInstallCommand] = useState(runnable?.install_command || "");
  const [saving, setSaving] = useState(false);

  if (!runnable) return null;

  const handleSave = async () => {
    if (!label.trim() || !runCommand.trim()) { alert("名称和运行命令必填"); return; }
    setSaving(true);
    try {
      const updated: Runnable = {
        ...runnable,
        label: label.trim(),
        platform,
        run_command: runCommand.trim(),
        cwd: cwd.trim() || ".",
        url: url.trim() || "",
        install_command: installCommand.trim() || undefined,
      };
      const next = runnables.map((r) => (r.id === runnable.id ? updated : r));
      await window.electronAPI.process.saveRunJson(projectPath, next);
      onClose();
    } catch (e) {
      console.error("[ScriptEditDialog] save failed:", e);
      alert("保存失败，请检查 run.json 是否被占用");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full h-8 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-primary outline-none focus:border-accent/50";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="relative bg-surface rounded-xl border border-border shadow-2xl w-[480px] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-alt shrink-0">
          <span className="text-sm font-medium text-text-primary">编辑脚本</span>
          <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors" onClick={onClose} title="关闭">✕</button>
        </div>
        <div className="space-y-3 px-4 py-3 overflow-y-auto">
          <div>
            <label className="text-xs text-text-secondary block mb-1">名称</label>
            <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如：安卓端打包" />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">运行命令</label>
            <input className={inputCls} value={runCommand} onChange={(e) => setRunCommand(e.target.value)} placeholder="如：flutter build apk" />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">平台（技术栈，用于配色）</label>
            <Select block value={platform} onChange={setPlatform} options={PLATFORM_OPTIONS} title="选择平台" />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">工作目录（相对项目根，默认 .）</label>
            <input className={inputCls} value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="." />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">访问地址（启动后可打开，可选）</label>
            <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:5173" />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">安装命令（可选）</label>
            <input className={inputCls} value={installCommand} onChange={(e) => setInstallCommand(e.target.value)} placeholder="如：flutter pub get" />
          </div>
        </div>
        <div className="flex gap-2 px-4 py-2.5 border-t border-border bg-surface-alt shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-1.5 rounded-lg border border-border text-text-secondary text-xs hover:bg-surface-hover transition-colors">取消</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-1.5 rounded-lg bg-accent text-text-inverse text-xs font-medium hover:bg-accent-hover transition-colors disabled:opacity-40">
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
