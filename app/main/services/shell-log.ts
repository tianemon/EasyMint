import fs from "node:fs";

/** 日志尾部读取上限（与弹层/手机端查看同口径：只取最近 100KB） */
const TAIL_BYTES = 100 * 1024;

/**
 * 读后台命令输出日志的尾部（超过上限只取最近输出，避免把 MB 级 dev server 日志整块读进内存）。
 *
 * **路径合法性由调用方负责**，两条路径的校验方式不同：
 *  - 桌面 UI（IPC `shell:read-log`）：路径来自渲染层，必须先校验「在项目根内」（防任意文件读取）；
 *  - 远程命令（`shell.readLog`）：路径只从 `backgroundShellRegistry` 里取，不来自手机，天然受控，
 *    且**不把本机路径回给手机**（与 shell-count 剥离 logPath 同口径）。
 *
 * 读不到（空路径/文件不存在/读取异常）一律返回空内容，不抛错——日志是辅助信息，不该让界面报错。
 */
export function readShellLogTail(logPath: string | undefined): { content: string; truncated: boolean } {
  try {
    if (!logPath || !fs.existsSync(logPath)) return { content: "", truncated: false };
    const stat = fs.statSync(logPath);
    if (stat.size <= TAIL_BYTES) {
      return { content: fs.readFileSync(logPath, "utf-8"), truncated: false };
    }
    const buf = Buffer.alloc(TAIL_BYTES);
    const fd = fs.openSync(logPath, "r");
    try {
      fs.readSync(fd, buf, 0, TAIL_BYTES, stat.size - TAIL_BYTES);
    } finally {
      fs.closeSync(fd);
    }
    return { content: buf.toString("utf-8"), truncated: true };
  } catch {
    return { content: "", truncated: false };
  }
}
