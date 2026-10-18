/** Recognize only a Playwright MCP executable/entrypoint, never an arbitrary argument. */
export function isPlaywrightMcpInvocation(command: string, args: readonly string[] = []): boolean {
  const bin = command.replace(/\\/g, "/").split("/").pop()?.replace(/\.(?:cmd|exe)$/i, "") ?? "";
  if (/^(?:mcp-server-playwright|playwright-mcp)$/i.test(bin)) return true;
  if (/^node$/i.test(bin)) return /(?:^|[\\/])@playwright[\\/]mcp[\\/]cli\.js$/.test(args[0] ?? "");
  if (!["npx", "bunx", "pnpm", "yarn", "npm", "corepack"].includes(bin)) return false;
  let index = 0;
  if (bin === "corepack") {
    if (!["pnpm", "yarn"].includes(args[index] ?? "")) return false;
    index++;
  }
  if (["dlx", "exec", "x"].includes(args[index] ?? "")) index++;
  else if (bin === "npm") return false;
  while (args[index]?.startsWith("-")) {
    // 不允许 --call/--package 等改变实际执行对象的选项借浏览器名获得豁免。
    if (!["-y", "--yes", "--no", "--offline", "--"].includes(args[index]!)) return false;
    index++;
  }
  return /^@playwright\/mcp(?:@[^/]+)?$/.test(args[index] ?? "");
}

/** 持久 profile 按工作区共享，多会话会互相占用。默认使用官方 --isolated；
 * 显式指定的 profile、远程浏览器和配置文件保持原样。
 * 依据：@playwright/mcp 0.0.83 README “User profile” / microsoft/playwright-mcp。 */
export function playwrightMcpArgs(command: string, args: string[] = [], env: NodeJS.ProcessEnv = {}): string[] {
  if (!isPlaywrightMcpInvocation(command, args)) return args;
  const explicit = ["--isolated", "--user-data-dir", "--cdp-endpoint", "--browser-endpoint", "--extension", "--config"];
  if (args.some(arg => explicit.some(flag => arg === flag || arg.startsWith(flag + "=")))) return args;
  if (["ISOLATED", "USER_DATA_DIR", "CDP_ENDPOINT", "BROWSER_ENDPOINT", "EXTENSION", "CONFIG"]
    .some(key => env[`PLAYWRIGHT_MCP_${key}`] !== undefined)) return args;
  return [...args, "--isolated"];
}
