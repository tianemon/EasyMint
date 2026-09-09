import { useState } from "react";
import { useProcessStore } from "../stores/process-store";
import { OutputWindow } from "./OutputWindow";
import { toast } from "./ui/Toast";

interface LogOverlayProps {
  commandId: string;
  projectPath: string;
}

/** 运行日志浮窗 — OutputWindow 薄封装（逐行日志模式 + 停止按钮 + 进程结束后「让 Mint 修复」） */
export function LogOverlay({ commandId, projectPath }: LogOverlayProps): JSX.Element | null {
  // 细 selector：只订阅本 commandId 的状态/日志/命令配置，
  // 别条命令的日志追加/状态变更不重渲染本浮窗
  const state = useProcessStore((s) => s.cmdStates[commandId]);
  const lines = useProcessStore((s) => s.logLines[commandId]);
  const runnable = useProcessStore((s) => s.runnables.find((r) => r.id === commandId));
  const stop = useProcessStore((s) => s.stop);
  const closeLog = useProcessStore((s) => s.closeLog);
  const [asking, setAsking] = useState(false);
  const logs = lines || [];

  if (!runnable) return null;

  // 失败不是终点，是一个按钮：进程结束后把最近日志尾部交给 Mint 归因修复（steer 注入当前会话）
  const handleAskRepair = async () => {
    if (asking) return;
    setAsking(true);
    try {
      const tail = logs.slice(-40).map((l) => l.text).join("\n").slice(-2000);
      const summary = `「${runnable.label}」运行失败，请帮我修复。\n运行命令: ${runnable.run_command}\n最近输出:\n${tail || "(无输出)"}`;
      const ok = await window.electronAPI.process.askRepair(projectPath, summary);
      toast(ok ? "已请 Mint 修复，去对话查看" : "当前没有进行中的 Mint 会话，先打开一个对话再试");
    } catch {
      toast("发送失败");
    } finally {
      setAsking(false);
    }
  };

  return (
    <OutputWindow
      label={runnable.label}
      command={runnable.run_command}
      running={!!state?.running}
      logs={logs}
      onStop={() => stop(commandId)}
      onClose={closeLog}
      footer={
        !state?.running ? (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleAskRepair}
              disabled={asking}
              className="shrink-0 px-3 py-1.5 rounded-md bg-accent text-text-inverse text-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
            
              {asking ? "发送中…" : "让 Mint 修复"}
            </button>
            <span className="text-[length:var(--text-3xs)] text-text-muted text-right">进程已结束——有问题可以让 Mint 直接修复</span>
          </div>
        ) : undefined
      }
    />
  );
}
