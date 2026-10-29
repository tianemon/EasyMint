/**
 * OAuth 本地回调端口的可用性预检 —— 只对**端口写死、且没有退路**的供应商做。
 *
 * 为什么需要这一层：SDK 起回调服务失败时是**静默**的。`pi-ai` 的 codex 登录写的是
 *
 *     startOAuthCallbackServer({ host, port: 1455, path: "/auth/callback", ... })
 *       .catch(() => undefined)          // ← 失败被吞掉，callback 变成 undefined
 *
 * 于是流程只剩「粘贴授权码」这条路，界面拿不到任何原因（`waitForCallbackOrManualInput`
 * 在两种情况下发的都是同一个 manual_code 步骤，界面无法区分）。
 *
 * 什么时候绑不上：Windows 上最常见的原因是**系统端口保留**——WinNAT / Hyper-V / WSL2 /
 * Docker 会把成段的动态端口划进 `excludedportrange`，端口没被任何进程占用也照样拒绝绑定，
 * Winsock 报 10013，Node 侧是 `EACCES`（社区实测：1455 落在 1359–1458 那段里）。
 * 用户看到的现象就是「mac 能自动跳回来、win 只能手动复制授权码」。
 * 参考：https://codexinsider.com/errors/login-server-os-error-10013
 *
 * 为什么不能把端口换掉：codex 的 `redirect_uri` 写死为 `http://localhost:1455/auth/callback`
 * 并原样送进 authorize 与换 token 两处，换端口授权方直接拒。所以这里**只探测、不改流程**——
 * 粘贴授权码依然是有效路径，我们做的是把原因和处置办法交到界面上。
 *
 * 只登记 openai-codex：anthropic 虽然也优先 53692，但绑不上会自动退到随机空闲端口
 * （`pi-ai/dist/auth/oauth/anthropic.js` 的 `startCallbackServer(0)`），没有这个问题。
 */
import net from "node:net";

/**
 * 端口写死、绑不上就只能手动粘贴的供应商。
 * 常量抄自 SDK（改依赖版本时去 `node_modules/@earendil-works/pi-ai/dist/auth/oauth/*.js`
 * 核对 `REDIRECT_URI` 与 `port`）。
 */
export const FIXED_LOOPBACK_PORTS: Readonly<Record<string, number>> = {
  "openai-codex": 1455,
};

/** 端口不可用的结论：`code` 为 Node errno（EADDRINUSE / EACCES / ...），取不到时给 "UNKNOWN" */
export interface LoopbackBlocked {
  port: number;
  code: string;
}

/**
 * SDK 会把回调服务绑到哪个 host —— 必须与它**同一口径**，否则探测结论和实际能不能跳回无关：
 * `pi-ai/dist/auth/oauth/openai-codex.js` 的 `getCallbackHost()` 是
 * `getProviderEnvValue("PI_OAUTH_CALLBACK_HOST") || "127.0.0.1"`，而 `getProviderEnvValue`
 * 就是读 `process.env`（空串按 falsy 处理），所以这里照抄。
 */
export function oauthCallbackHost(): string {
  return process.env.PI_OAUTH_CALLBACK_HOST || "127.0.0.1";
}

/**
 * 试绑一次再立刻释放。返回 null = 端口可用。
 *
 * 两个细节：
 * 1. **等 close 回调再 resolve**。`server.close()` 是异步的，早 resolve 等于把端口交给下一个
 *    调用者时它可能还没真正释放（理论上，SDK 紧接着要绑同一个端口）。实测 macOS/Node 22
 *    300 次未复现 EADDRINUSE——但这里没有成本，按确定行为写。
 * 2. 探测用的监听不建连接，关掉后不留 TIME_WAIT；并发登录被 `loginProvider`
 *    的「同供应商只允许一个在途」挡住，不存在两个探测互抢。
 */
export function probeLoopbackPort(port: number, host = oauthCallbackHost()): Promise<LoopbackBlocked | null> {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const done = (blocked: LoopbackBlocked | null): void => {
      if (settled) return;
      settled = true;
      server.removeAllListeners();
      if (!server.listening) {
        // 没监听成功：没有句柄要回收（error 分支会走到这里）
        resolve(blocked);
        return;
      }
      server.close(() => resolve(blocked));
    };
    server.once("error", (e: NodeJS.ErrnoException) => done({ port, code: e.code ?? "UNKNOWN" }));
    server.listen({ port, host }, () => done(null));
  });
}
