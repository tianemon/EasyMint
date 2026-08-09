/**
 * 用户 PATH 提取 — GUI 应用由 launchd 启动,只继承最小 PATH(/usr/bin:/bin:/usr/sbin:/sbin),
 * 不含用户 shell 配置(.zprofile/.zshrc)里的 flutter/node 等路径。
 * 启动早期调用一次,把用户完整 PATH 注入主进程环境,之后所有子进程
 * (bash / init.sh / 运行面板命令 / 环境检查)自动继承。
 *
 * 仅 macOS 需要;Windows GUI 继承注册表用户环境变量,无此问题。
 */

import { execFileSync } from "node:child_process";

let loaded = false;

export function loadUserPath(): void {
  if (loaded || process.platform !== "darwin") return;
  loaded = true;
  try {
    // zsh -lic:login+interactive+command,完整加载 .zprofile/.zshrc;
    // stderr 丢弃(交互配置可能有杂音),tail 取最后一行防多行输出
    const out = execFileSync("/bin/zsh", ["-lic", "print -r -- $PATH"], {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
    const shellPath = lines[lines.length - 1];
    if (shellPath && !process.env.PATH?.startsWith(shellPath)) {
      process.env.PATH = `${shellPath}:${process.env.PATH ?? ""}`;
      console.log(`[env] 已注入用户 PATH(${shellPath.split(":").length} 段)`);
    }
  } catch (e) {
    // 失败保持最小 PATH(有 buildEnv 兜底),不阻塞启动
    console.warn("[env] 提取用户 PATH 失败(保持默认):", (e as Error).message);
  }
}
