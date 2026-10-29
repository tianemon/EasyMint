import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({
  app: { isPackaged: false },
  // registry 每次状态变化都会广播给窗口；测试里没有窗口
  BrowserWindow: { getAllWindows: () => [] },
}));

import { HumanActionDetector, detectHumanActions } from "./human-action";
import { maskSecrets } from "../../utils/secret-mask";
import { createEnhancedBashTool } from "./tool";
import { backgroundShellRegistry } from "./registry";
import { EXECUTION_POLICY } from "../permission/wrap-tool";
import { createExecutionContext } from "../permission/execution-context";

/** 一段模仿 npm 登录提示的输出（2026-10-29 那次事故的原型） */
const NPM_LOGIN =
  "npm notice Log in on https://registry.npmjs.org/\n"
  + "To use the new login flow, please visit: https://www.npmjs.com/login?next=/login/cli/9f3c2b";

const NPM_PUBLISH =
  "npm notice Publishing to https://registry.npmjs.org/ with tag latest\n"
  + "This operation requires two-factor authentication.\n"
  + "Open https://www.npmjs.com/login/authorize-device?session=7a1b to approve this publish";

describe("命令输出的人工操作识别", () => {
  it("认出授权链接（登录 / 发布两次分别成条）", () => {
    const actions = detectHumanActions(`${NPM_LOGIN}\n${NPM_PUBLISH}`);
    const links = actions.filter((a) => a.kind === "link");
    expect(links.map((a) => a.url)).toEqual([
      "https://www.npmjs.com/login?next=/login/cli/9f3c2b",
      "https://www.npmjs.com/login/authorize-device?session=7a1b",
    ]);
    // 两次授权必须各自独立（同一进程里也去不得重）
    expect(new Set(links.map((a) => a.key)).size).toBe(2);
    expect(links.every((a) => a.confidence === "explicit")).toBe(true);
  });

  it("认出按键与验证码提示", () => {
    const cases = [
      "Press ENTER to open the browser",
      "Verification code: ",
      "Continue? [y/N]",
      "Password: ",
      "Enter the one-time code",
      // npm EOTP 分支：只给提示不给链接，不认这里等于完全静默
      "npm ERR! You can provide a one-time password by passing --otp=<code> to the command you ran.",
    ];
    for (const line of cases) {
      const actions = detectHumanActions(line);
      expect(actions.some((a) => a.kind === "prompt"), `未识别: ${line}`).toBe(true);
    }
  });

  it("普通链接不当作等待操作", () => {
    const quiet = [
      "See https://docs.npmjs.com/cli/v10/commands for details",
      "Fetched https://registry.npmjs.org/left-pad in 120ms",
      "Homepage: https://github.com/example/repo#readme",
    ].join("\n");
    expect(detectHumanActions(quiet)).toEqual([]);
  });

  it("同一行既有提示又有链接时，给的是可点的链接而不是干提示", () => {
    // 实测复现过的坑：先判提示再 continue，链接被吞，用户拿不到可点的东西
    const actions = detectHumanActions("Press ENTER to open https://www.npmjs.com/login?next=/cli/abc");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("link");
    expect(actions[0]!.url).toBe("https://www.npmjs.com/login?next=/cli/abc");
  });

  it("提示行回显的验证码不进卡片文本", () => {
    const actions = detectHumanActions("Enter code: 123456");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.hint).not.toContain("123456");
    // 没有长数字串的提示保留整行，可读性不受影响
    expect(detectHumanActions("Press ENTER to continue")[0]!.hint).toBe("Press ENTER to continue");
  });

  it("提示被 chunk 切断、且中间夹着 ANSI 也能认出", () => {
    const d = new HumanActionDetector();
    expect(d.feed("npm notice \x1b[1mPress EN")).toEqual([]);
    const hit = d.feed("TER\x1b[0m to continue\n");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.kind).toBe("prompt");
  });

  it("同一提示重复输出只发一次（进度条/重绘不刷屏）", () => {
    const d = new HumanActionDetector();
    d.feed("Press ENTER to continue\n");
    expect(d.feed("Press ENTER to continue\nPress ENTER to continue\n")).toEqual([]);
  });

  it("链接候选有上限，防止文档刷屏", () => {
    const d = new HumanActionDetector(2);
    const text = [
      "login via https://a.example.com/login/1",
      "login via https://b.example.com/login/2",
      "login via https://c.example.com/login/3",
    ].join("\n");
    expect(d.feed(text).filter((a) => a.kind === "link")).toHaveLength(2);
  });
});

describe("`***` 归属：EM 脱敏不会改写授权链接", () => {
  it("npm 风格授权链接原样保留（说明 *** 来自命令自身，不是 EM）", () => {
    const url = "https://www.npmjs.com/login?next=/login/cli/9f3c2b";
    expect(maskSecrets(url)).toBe(url);
    // 已带 *** 的输出不被再次改写，反证 EM 不是它的来源
    const npmOut = "npm notice Log in on https://registry.npmjs.org/ ***";
    expect(maskSecrets(npmOut)).toBe(npmOut);
  });

  it("真正的凭据仍被脱敏（脱敏能力不为这次改动让步）", () => {
    expect(maskSecrets("api_key=abcd1234")).toBe("api_key=***");
    expect(maskSecrets("https://user:pass@registry.example.com/")).toBe("https://user:***@registry.example.com/");
  });
});

describe("命令执行路径上的交接（本地模拟，无真实 npm 登录）", () => {
  const dirs: string[] = [];
  const mkdir = (): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), "em-human-action-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const id of backgroundShellRegistry.list().map((s) => s.id)) backgroundShellRegistry.stop(id, "user");
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("前台：命令跑到一半才出现的链接，立即交给界面", async () => {
    const cwd = mkdir();
    const got: string[] = [];
    const tool = await createEnhancedBashTool(cwd, {
      onHumanAction: (command, action) => { got.push(`${command}|${action.url ?? action.hint}`); },
    });
    const script = `setTimeout(() => console.log(${JSON.stringify(NPM_LOGIN)}), 200); setTimeout(() => {}, 400);`;
    await (tool as unknown as {
      execute: (id: string, p: Record<string, unknown>, s: undefined, u: undefined, ctx: unknown) => Promise<unknown>;
    }).execute(
      "fg1",
      { command: `node -e ${JSON.stringify(script)}`, [EXECUTION_POLICY]: createExecutionContext(cwd, "full") },
      undefined,
      undefined,
      {},
    );
    expect(got).toHaveLength(1);
    expect(got[0]).toContain("https://www.npmjs.com/login?next=/login/cli/9f3c2b");
  }, 30_000);

  it("后台：不等进程退出就交出去，两次授权各自成条", async () => {
    const cwd = mkdir();
    const got: string[] = [];
    const tool = await createEnhancedBashTool(cwd, {
      onHumanAction: (_command, action) => { if (action.url) got.push(action.url); },
    });
    const script = [
      `console.log(${JSON.stringify(NPM_LOGIN)});`,
      `setTimeout(() => console.log(${JSON.stringify(NPM_PUBLISH)}), 300);`,
      "setTimeout(() => {}, 1200);",
    ].join("");
    const res = await (tool as unknown as {
      execute: (id: string, p: Record<string, unknown>, s: undefined, u: undefined, ctx: unknown) => Promise<{ content: Array<{ text: string }> }>;
    }).execute(
      "bg1",
      { command: `node -e ${JSON.stringify(script)}`, background: true, [EXECUTION_POLICY]: createExecutionContext(cwd, "full") },
      undefined,
      undefined,
      {},
    );
    expect(res.content[0]!.text).toContain("已后台启动");
    // 第一条链接在命令仍运行时就必须已交出去（进入轮询等待，不是等 onExit）
    await new Promise((r) => setTimeout(r, 700));
    expect(got).toEqual([
      "https://www.npmjs.com/login?next=/login/cli/9f3c2b",
      "https://www.npmjs.com/login/authorize-device?session=7a1b",
    ]);
  }, 30_000);
});
