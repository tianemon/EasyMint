import { useProcessStore } from "../stores/process-store";
import { OutputWindow } from "./OutputWindow";

interface LogOverlayProps {
  commandId: string;
}

/** 运行日志浮窗 — OutputWindow 薄封装（逐行日志模式 + 停止按钮） */
export function LogOverlay({ commandId }: LogOverlayProps): JSX.Element | null {
  const { cmdStates, runnables, stop, closeLog } = useProcessStore();
  const state = cmdStates[commandId];
  const runnable = runnables.find((r) => r.id === commandId);
  const logs = state?.logs || [];

  if (!runnable) return null;

  return (
    <OutputWindow
      label={runnable.label}
      command={runnable.run_command}
      running={!!state?.running}
      logs={logs}
      onStop={() => stop(commandId)}
      onClose={closeLog}
    />
  );
}
