/**
 * 用户环境提取 — GUI 应用由 launchd 启动,只继承最小环境(/usr/bin:/bin:/usr/sbin:/sbin),
 * 不含用户 shell 配置(.zprofile/.zshrc)里的 flutter/node/java/android 等工具链路径。
 * 启动早期调用一次,把用户完整环境注入主进程,之后所有子进程
 * (bash / init.sh / 运行面板命令 / 环境检查)自动继承。
 *
 * 全量导入(zsh -lic 'env'):所有工具链变量一次到位(JAVA_HOME/ANDROID_HOME/NODE_PATH 等),
 * 不用为每个新工具链手动补变量。
 * 仅 macOS 需要;Windows GUI 继承注册表用户环境变量,无此问题。
 */

import { execFileSync } from "node:child_process";

let loaded = false;

/** shell 会话相关变量:注入会误导子进程(如 PWD 指向 shell 启动目录) */
const SKIP_VARS = new Set(["PWD", "OLDPWD", "SHLVL", "_", "ZDOTDIR"]);

export function loadUserEnv(): void {
  if (loaded || process.platform !== "darwin") return;
  loaded = true;
  try {
    // zsh -lc + 显式 source .zshrc:非交互模式不读 .zshrc,需手动加载;
    // 不能用 -i(交互模式)——交互 zsh 会打开 /dev/tty 做 job control(tcsetpgrp
    // 抢占终端前台进程组),zsh 退出后前台进程组悬空,Ctrl+C 信号发给死进程组失效
    const out = execFileSync("/bin/zsh", ["-lc", "source ~/.zshrc >/dev/null 2>&1; env"], {
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
