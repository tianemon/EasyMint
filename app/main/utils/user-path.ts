/**
 * 用户环境提取 — GUI 应用由 launchd (macOS) 或 desktop launcher (Linux) 启动,
 * 只继承最小环境(/usr/bin:/bin:/usr/sbin:/sbin 等),
 * 不含用户 shell 配置(.zprofile/.zshrc/.bashrc)里的 flutter/node/java/android 等工具链路径。
 * 启动早期调用一次,把用户完整环境注入主进程,之后所有子进程
 * (bash / init.sh / 运行面板命令 / 环境检查)自动继承。
 *
 * 全量导入:所有工具链变量一次到位(JAVA_HOME/ANDROID_HOME/NODE_PATH 等),
 * 不用为每个新工具链手动补变量。
 * Windows GUI 继承注册表用户环境变量,无此问题。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let loaded = false;

/** shell 会话相关变量:注入会误导子进程(如 PWD 指向 shell 启动目录) */
const SKIP_VARS = new Set(["PWD", "OLDPWD", "SHLVL", "_", "ZDOTDIR"]);

export function loadUserEnv(): void {
  if (loaded || process.platform === "win32") return;
  loaded = true;
  try {
    const userShell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
    const homedir = os.homedir();
    const isZsh = userShell.endsWith("zsh");
    const rcCandidate = isZsh ? path.join(homedir, ".zshrc") : path.join(homedir, ".bashrc");
    const sourceCmd = fs.existsSync(rcCandidate) ? `source "${rcCandidate}" >/dev/null 2>&1; ` : "";

    // -lc + 显式 source rc: 非交互模式不读 rc 文件, 需手动加载;
    // 不能用 -i(交互模式)——交互 shell 会打开 /dev/tty 做 job control, 影响终端前台进程组
    const out = execFileSync(userShell, ["-lc", `${sourceCmd}env`], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of out.split("\n")) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1);
      if (SKIP_VARS.has(key) || !value) continue;
      if (key === "PATH") {
        // PATH 前置合并:shell 完整 PATH 优先,保留 GUI 原有(系统最小集)兜底
        if (!process.env.PATH?.startsWith(value)) {
          process.env.PATH = `${value}:${process.env.PATH ?? ""}`;
        }
      } else {
        process.env[key] = value;
      }
    }
  } catch (e) {
    // 失败保持默认环境(有 buildEnv 兜底),不阻塞启动
    console.warn("[env] 提取用户环境失败(保持默认):", (e as Error).message);
  }
}
