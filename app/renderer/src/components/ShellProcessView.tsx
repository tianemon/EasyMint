import { useEffect, useState } from "react";
import { OutputWindow } from "./OutputWindow";

/**
 * 后台命令输出查看弹层 — OutputWindow 薄封装（整块内容模式 + 日志路径）。
 * 数据三层:
 *  1. 打开时加载日志尾部 100KB(shell.readLog)
 *  2. 运行中订阅 agent:shell-output(按 id 过滤)实时追加
 *  3. 自动滚动贴底(用户滚离底部停止跟随,可自由滚动;回底按钮恢复);命令结束保留已显示内容
 */
export function ShellProcessView({
  id,
  command,
  logPath,
  running,
  onClose,
}: {
  id: string;
  command: string;
  logPath: string;
  running: boolean;
  onClose: () => void;
}): JSX.Element {
  const [content, setContent] = useState("");
  const [truncated, setTruncated] = useState(false);

  // 打开/切换命令:加载日志尾部(dev server 日志可能 MB 级,只取最近输出)
  useEffect(() => {
    let cancelled = false;
    setContent("");
    setTruncated(false);
    (async () => {
      if (!logPath) return;
      const r = await window.electronAPI.shell.readLog(logPath);
      if (cancelled) return;
      setContent(r.content);
      setTruncated(r.truncated);
    })();
    return () => { cancelled = true; };
  }, [logPath, id]);

  // 实时输出订阅(按命令 id 过滤;chunk 追加)
  useEffect(() => {
    const unsub = window.electronAPI.agent.onShellOutput((data) => {
      if (data.id !== id) return;
      setContent((prev) => prev + data.chunk);
    });
    return unsub;
  }, [id]);

  return (
    <OutputWindow
      command={command}
      running={running}
      content={content}
      logPath={logPath}
      truncated={truncated}
      onClose={onClose}
    />
  );
}
