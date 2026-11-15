/**
 * 装配审计日志（`~/.easymint/logs/provisioning.log`）。
 *
 * 单独成模块，是因为**两个入口都要写**：用户点的安装（provisioning/run.ts）和
 * 启动时的静默准备（services/windows-runtime.ts）。此前后者只 `console.warn`——打包版没有
 * 控制台，准备失败在磁盘上不留任何痕迹，用户报告「一直检测不到」时无从查起
 * （2026-11-15 的真实现场：日志里只有一条被 abort 的中止记录，解压阶段的失败完全没留痕）。
 */
import fs from "node:fs";
import path from "node:path";
import { emHome } from "../../utils/paths";

const LOG_DIR = path.join(emHome(), "logs");
const LOG_PATH = path.join(LOG_DIR, "provisioning.log");

/** 审计日志：命令、退出码、输出尾部（方案 §8.4）。日志本身失败不能影响安装 */
export function logProvisioning(line: string): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
  } catch { /* ignore */ }
}

export { LOG_PATH as PROVISIONING_LOG_PATH };
