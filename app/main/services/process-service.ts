/**
 * 项目运行进程管理 - 多命令独立启停、内存日志
 *
 * 检测入口：只读 <project>/.easymint/run.json（Mint 开发完生成）。
 */

import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync, readFileSync, writeFileSync, watch } from "node:fs";
import { join } from "node:path";
import { BrowserWindow } from "electron";
import { resolveHome } from "../utils/paths";

/** 已知 platform 值（前端配色用），未列出的用默认色 */
export type RunPlatform =
  | "react" | "vue" | "nextjs" | "nuxt" | "angular" | "svelte"
  | "spring" | "django" | "flask" | "fastapi" | "nodejs" | "rails" | "laravel" | "go" | "rust" | "dotnet"
  | "react-native" | "expo" | "flutter"
  | "electron" | "tauri"
  | "python" | "shell";

export interface Runnable {
  id: string;            // = run_command，唯一标识
  platform: string;      // 技术栈，保留原值，前端兜底配色
  label: string;
  run_command: string;
  cwd?: string;          // 工作目录（相对项目根），默认 "."
  install_command?: string;  // 依赖安装命令
  url?: string;          // 启动后访问地址
}

export interface ProcessStatus {
  running: boolean;
  pid?: number;
  run_command?: string;
  output: string[];
}

interface ProcessInfo {
  proc: ChildProcess;
  pid: number;
  run_command: string;
  output: string[];
}

const processes = new Map<string, ProcessInfo>(); // key = run_command
const MAX_LOG = 500;

/** 补全 PATH - 打包 app 的 process.env.PATH 不含 node/npm 所在目录 */
function buildEnv(): NodeJS.ProcessEnv {
  const extra = process.platform === "win32"
    ? [`${process.env.ProgramFiles}\\nodejs`, `${process.env.APPDATA}\\npm`]
    : ["/opt/homebrew/bin", "/usr/local/bin"];
  const sep = process.platform === "win32" ? ";" : ":";
  return { ...process.env, PATH: `${extra.join(sep)}${sep}${process.env.PATH}` };
}

function broadcast(commandId: string, line: string, stream: "stdout" | "stderr"): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("process:output", { commandId, line, stream });
  }
}

function broadcastStatus(commandId: string, running: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("process:status-changed", { commandId, running });
  }
}

/** 读 run.json，返回所有命令配置 */
function readRunJson(projectPath: string): Runnable[] {
  const runJson = join(resolveHome(projectPath), ".easymint", "run.json");
  if (!existsSync(runJson)) return [];
  try {
    const data = JSON.parse(readFileSync(runJson, "utf-8"));
    const commands = (data.commands as Array<Record<string, unknown>>) || [];
    const result: Runnable[] = [];
    for (const c of commands) {
      if (!c.run_command) continue;
      result.push({
        id: c.run_command as string,
        platform: (c.platform as string) || "nodejs",
        label: (c.label as string) || (c.run_command as string),
        run_command: c.run_command as string,
        cwd: c.cwd as string | undefined,
        install_command: c.install_command as string | undefined,
        url: c.url as string | undefined,
      });
    }
    return result;
  } catch {
    return [];
  }
}

/** 查单条命令配置 */
function getCommandConfig(projectPath: string, commandId: string): Runnable | undefined {
  return readRunJson(projectPath).find((r) => r.id === commandId);
}

/** 写 run.json（前端编辑/删除脚本后保存）。保留原文件其余字段与条目的未知字段
 *  （兼容旧版/自定义扩展字段，仅覆盖已知字段）；文件变化经 runJsonWatchers 广播 → 前端自动刷新 */
export function saveRunJson(projectPath: string, runnables: Runnable[]): void {
  const runJson = join(resolveHome(projectPath), ".easymint", "run.json");
  let extra: Record<string, unknown> = {};
  let oldCommands: Array<Record<string, unknown>> = [];
  if (existsSync(runJson)) {
    try {
      const old = JSON.parse(readFileSync(runJson, "utf-8")) as Record<string, unknown>;
      const { commands, ...rest } = old;
      extra = rest;
      oldCommands = Array.isArray(commands) ? (commands as Array<Record<string, unknown>>) : [];
    } catch { /* 解析失败则只写 commands */ }
  }
  const data = {
    ...extra,
    commands: runnables.map((r) => {
      // 按 id(= 旧 run_command)匹配原条目：保留未知字段，仅覆盖已知字段
      const orig = oldCommands.find((c) => c.run_command === r.id);
      return {
        ...(orig ?? {}),
        platform: r.platform,
        label: r.label,
        cwd: r.cwd || ".",
        run_command: r.run_command,
        url: r.url || "",
        ...(r.install_command ? { install_command: r.install_command } : {}),
      };
    }),
  };
  writeFileSync(runJson, JSON.stringify(data, null, 2) + "\n");
}

/** 检测启动配置 */
export function detectRunnable(projectPath: string): Runnable[] {
  return readRunJson(projectPath);
}

/** run.json 监听器(按 resolved 路径防重注册) */
const runJsonWatchers = new Set<string>();

/**
 * 监听 .easymint/run.json 变化 → 广播 → 前端运行面板自动重新检测。
 * Mint 直接写文件即可(无需 MCP 工具/手动刷新),链路自动闭环。
 */
export function ensureRunJsonWatch(projectPath: string): void {
  const resolved = resolveHome(projectPath);
  if (runJsonWatchers.has(resolved)) return;
  const dir = join(resolved, ".easymint");
  if (!existsSync(dir)) return;
  runJsonWatchers.add(resolved);
  try {
    watch(dir, (_event, filename) => {
      if (filename !== "run.json") return;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("process:run-json-changed", { projectPath });
      }
    }).on("error", () => {
      // 目录被删/不可读:放弃监听,下次 detect 时重试注册
      runJsonWatchers.delete(resolved);
    });
  } catch {
    runJsonWatchers.delete(resolved);
  }
}

/** 启动进程 */
export function startProcess(projectPath: string, commandId: string, port?: number): void {
  const resolved = resolveHome(projectPath);
  if (processes.has(commandId)) return;

  const config = getCommandConfig(projectPath, commandId);
  const run_command = commandId;
  const cwd = config?.cwd ? join(resolved, config.cwd) : resolved;

  const isWin = process.platform === "win32";
  const shell = isWin ? "cmd.exe" : "bash";
  const shellArgs = isWin ? ["/c", run_command] : ["-c", run_command];

  const env = buildEnv();
  if (port) env.PORT = String(port);

  const proc = spawn(shell, shellArgs, {
    cwd,
    env,
    detached: !isWin,
    shell: false,
  });

  const info: ProcessInfo = { proc, pid: proc.pid ?? -1, run_command, output: [] };
  processes.set(commandId, info);

  const pushLog = (line: string, stream: "stdout" | "stderr") => {
    info.output.push(line);
    if (info.output.length > MAX_LOG) info.output.shift();
    broadcast(commandId, line, stream);
  };

  proc.stdout?.on("data", (chunk: Buffer) => {
    chunk.toString().split("\n").filter(Boolean).forEach((l) => pushLog(l, "stdout"));
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    chunk.toString().split("\n").filter(Boolean).forEach((l) => pushLog(l, "stderr"));
  });
  proc.on("close", (_code, _signal) => {
    if (processes.get(commandId) === info) {
      processes.delete(commandId);
      broadcast(commandId, "[进程已退出]", "stdout");
      broadcastStatus(commandId, false);
    }
  });
  proc.on("error", (err) => {
    pushLog(`[启动失败] ${err.message}`, "stderr");
  });
}

/** 安装依赖（一次性命令，输出广播到同一 commandId 日志） */
/** 停止进程（杀整树 + 销毁日志） */
export function stopProcess(commandId: string): void {
  const info = processes.get(commandId);
  if (!info) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(info.pid), "/T", "/F"]);
    } else {
      process.kill(-info.pid, "SIGTERM");
    }
  } catch { /* ignore */ }
  processes.delete(commandId);
}

/** 重启 */
export function restartProcess(projectPath: string, commandId: string): void {
  stopProcess(commandId);
  setTimeout(() => startProcess(projectPath, commandId), 500);
}

/** 获取单条命令状态 */
export function getStatus(commandId: string): ProcessStatus {
  const info = processes.get(commandId);
  if (!info) return { running: false, output: [] };
  return { running: true, pid: info.pid, run_command: info.run_command, output: [...info.output] };
}

/** 获取所有运行中命令的 commandId */
export function getRunningIds(): string[] {
  return Array.from(processes.keys());
}

/** 检测端口占用状态 */
export function checkPort(port: number): { free: boolean; pid?: number; name?: string } {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    return { free: true };
  }
  try {
    let output = "";
    if (process.platform === "win32") {
      output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf-8", timeout: 3000 });
    } else {
      output = execSync(`lsof -i :${port} -P -n -t`, { encoding: "utf-8", timeout: 3000 });
    }
    const pid = parseInt(output.trim().split("\n")[0]);
    if (!pid) return { free: true };
    // 获取进程名
    try {
      const name = process.platform === "win32"
        ? execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: "utf-8", timeout: 2000 }).split(",")[0]?.replace(/"/g, "")
        : execSync(`ps -p ${pid} -o comm=`, { encoding: "utf-8", timeout: 2000 }).trim();
      return { free: false, pid, name };
    } catch {
      return { free: false, pid };
    }
  } catch {
    return { free: true };
  }
}

/** 释放端口（kill 占用进程） */
export function killPort(port: number): boolean {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    return false;
  }
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf-8" });
      const pid = out.trim().split(/\s+/).pop();
      if (pid) execSync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
    } else {
      execSync(`lsof -i :${port} -P -n -t | xargs kill -9`, { timeout: 5000 });
    }
    return true;
  } catch {
    return false;
  }
}
