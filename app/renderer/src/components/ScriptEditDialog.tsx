import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTabStore } from "../stores/tab-store";
import { registerOverlay } from "../lib/overlay-stack";
import { toast } from "./ui/Toast";

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

/** 从 run_command 解析引用的脚本文件绝对路径（bash/sh/python/./ 调用）；纯命令返回 null */
function extractScriptPath(runCommand: string, cwd: string | undefined, projectPath: string): string | null {
  const parts = runCommand.trim().split(/\s+/);
  const first = parts[0]?.toLowerCase() || "";
  const interpreter = ["bash", "sh", "zsh", "python", "python3"].includes(first);
  let candidate: string | undefined;
  if (first.startsWith("./") && (first.endsWith(".sh") || first.endsWith(".py"))) {
    candidate = parts[0];
  } else if (interpreter && parts[1] && !parts[1].startsWith("-")) {
    candidate = parts[1];
  }
  if (!candidate || candidate.includes("..")) return null; // 无脚本调用或路径逃逸，保守返回
  const base = `${projectPath.replace(/\/+$/, "")}/${(cwd || ".").replace(/^\.\/?/, "")}`;
  return candidate.startsWith("./") ? `${base}/${candidate.slice(2)}` : `${base}/${candidate}`;
}

/** 脚本编辑弹窗：极简（标题+命令）；命令引用脚本文件时可跳转 EM 编辑器编辑文件本体。
 *  保存只更新标题/命令，其余字段（platform/cwd/url 等）继承原条目，不影响面板功能 */
export function ScriptEditDialog({ projectPath, runnable, runnables, onClose }: ScriptEditDialogProps): JSX.Element | null {
  const [label, setLabel] = useState(runnable?.label || "");
  const [runCommand, setRunCommand] = useState(runnable?.run_command || "");
  const [saving, setSaving] = useState(false);

  if (!runnable) return null;

  // 命令引用的脚本文件（相对 cwd 解析为项目内绝对路径）
  const scriptPath = extractScriptPath(runCommand, runnable.cwd, projectPath);
  const scriptFileName = scriptPath ? scriptPath.split("/").pop() || "" : "";
  // 注册到全局弹窗栈:点击本弹窗不关闭下层(如侧边栏抽屉)
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => registerOverlay(overlayRef.current), []);

  const handleSave = async () => {
    if (!label.trim() || !runCommand.trim()) { toast("标题和运行命令必填"); return; }
    setSaving(true);
    try {
      const updated: Runnable = {
        ...runnable, // 继承 platform/cwd/url/install_command
        label: label.trim(),
        run_command: runCommand.trim(),
      };
      const next = runnables.map((r) => (r.id === runnable.id ? updated : r));
      await window.electronAPI.process.saveRunJson(projectPath, next);
      onClose();
    } catch (e) {
      console.error("[ScriptEditDialog] save failed:", e);
      toast("保存失败，请检查 run.json 是否被占用");
    } finally {
      setSaving(false);
    }
  };

  const handleEditScript = () => {
    if (!scriptPath) return;
    useTabStore.getState().openTab({ id: "", type: "file", title: scriptFileName, filePath: scriptPath });
    onClose();
  };

  const inputCls = "em-input w-full h-8 px-2.5 text-xs text-text-primary";

  // createPortal 挂 body：侧边栏抽屉(sb-drawer)常驻 transform 会劫持 fixed 定位
  // （fixed 相对 transform 祖先而非视口）——弹窗必须脱离才能在软件窗口内居中
  return createPortal(
    <div ref={overlayRef} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="relative bg-surface rounded-xl border border-border shadow-2xl w-[760px] h-[600px] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-alt shrink-0">
          <span className="text-sm font-medium text-text-primary">编辑脚本</span>
          <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors" onClick={onClose} title="关闭">✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-4 py-3">
          <div>
            <label className="text-xs text-text-secondary block mb-1">标题</label>
            <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如：安卓端打包" />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">运行命令</label>
            <textarea
              className="em-input w-full px-2.5 py-1.5 text-[length:var(--text-caption)] text-text-primary resize-none font-mono leading-relaxed"
              rows={8}
              value={runCommand}
              onChange={(e) => setRunCommand(e.target.value)}
              placeholder="如：flutter build apk 或 bash scripts/release.sh"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border bg-surface-alt shrink-0">
          {scriptPath && (
            <button onClick={handleEditScript}
              className="h-8 px-3 whitespace-nowrap rounded-lg border border-accent-border text-accent text-xs hover:bg-accent-subtle transition-colors shrink-0">
              编辑脚本文件
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose}
            className="h-8 px-4 whitespace-nowrap rounded-lg border border-border text-text-secondary text-xs hover:bg-surface-hover transition-colors shrink-0">取消</button>
          <button onClick={handleSave} disabled={saving}
            className="h-8 px-4 whitespace-nowrap rounded-lg btn-accent text-xs font-medium shrink-0">
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
