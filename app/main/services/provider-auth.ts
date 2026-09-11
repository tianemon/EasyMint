/**
 * 供应商账号登录（OAuth）桥接层。
 *
 * OAuth 全流程由 SDK 承担（起本地回调服务 / 设备码轮询、换 token、写 auth.json、到期刷新），
 * EM 只做三件事：把 SDK 的交互事件转成给界面的事件、把界面的输入与取消回填给 SDK、查凭据状态。
 * 凭据文件（auth.json）与 runtime 同路径，EM 不改路径、不加密、不读内容。
 *
 * 为什么必须桥接：SDK 的 AuthInteraction 是进程内回调（prompt 要真正拿到用户输入、
 * auth_url 要真的打开浏览器），而登录发生在主进程、界面在渲染层。
 */

import { shell } from "electron";
import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import { broadcast } from "./ipc-broadcast";
import { getModelRuntime } from "./pi-init";
import type { Store } from "./store";
import type {
  ProviderAuthEventMessage,
  ProviderAuthPromptOption,
  ProviderAuthStatus,
  ProviderAuthType,
  ProviderAuthUiEvent,
  ProviderLoginResult,
} from "../../shared/provider-auth";

type ModelRuntimeInstance = Awaited<ReturnType<typeof getModelRuntime>>;

interface PendingPrompt {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
}

/** 一次进行的登录：一个 requestId 对应一次 runtime.login */
interface PendingLogin {
  providerId: string;
  abort: AbortController;
  /** 正在等待界面输入的步骤；null = 等浏览器回调 / 设备码轮询，无需界面输入 */
  prompt: PendingPrompt | null;
  /** 本次登录的结果。同 requestId 重复发起时共用它（见 loginProvider） */
  result: Promise<ProviderLoginResult>;
}

const pendingLogins = new Map<string, PendingLogin>();

/** 打开授权页：只放行 http(s)，避免 SDK 侧数据异常时拉起本机其它协议处理器 */
export async function openAuthUrl(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.error("[provider-auth] 授权链接不是合法 URL，已忽略");
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    console.error(`[provider-auth] 拒绝打开非 http(s) 授权链接：${parsed.protocol}`);
    return false;
  }
  try {
    await shell.openExternal(parsed.toString());
    return true;
  } catch (e) {
    // 打不开浏览器不是致命错误：界面还有「复制链接」与粘贴授权码兜底
    console.error("[provider-auth] 打开授权页失败:", (e as Error).message);
    return false;
  }
}

/** SDK 事件 → 界面事件。info 只留日志：它承载的是 SDK 的过程说明，界面按状态自写文案 */
function toUiEvent(event: AuthEvent, providerId: string): ProviderAuthUiEvent | null {
  switch (event.type) {
    case "auth_url":
      if (event.instructions) console.log(`[provider-auth] ${providerId} instructions: ${event.instructions}`);
      // SDK 不会自己拉浏览器，链接给到界面之前先交给系统打开
      void openAuthUrl(event.url);
      return { kind: "browser", url: event.url };
    case "device_code":
      return {
        kind: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        intervalSeconds: event.intervalSeconds,
        expiresInSeconds: event.expiresInSeconds,
      };
    case "progress":
      console.log(`[provider-auth] ${providerId} progress: ${event.message}`);
      return { kind: "progress" };
    case "info":
      console.log(`[provider-auth] ${providerId} info: ${event.message}`);
      return null;
  }
}

function promptOptions(prompt: AuthPrompt): ProviderAuthPromptOption[] | undefined {
  if (prompt.type !== "select") return undefined;
  return prompt.options.map((o) => ({ id: o.id, label: o.label, description: o.description }));
}

function promptPlaceholder(prompt: AuthPrompt): string | undefined {
  return prompt.type === "select" ? undefined : prompt.placeholder;
}

function createInteraction(requestId: string, providerId: string, pending: PendingLogin): AuthInteraction {
  const emit = (event: ProviderAuthUiEvent): void => {
    const payload: ProviderAuthEventMessage = { requestId, providerId, event };
    broadcast("provider:authEvent", payload);
  };

  return {
    signal: pending.abort.signal,
    notify: (event: AuthEvent) => {
      const ui = toUiEvent(event, providerId);
      if (ui) emit(ui);
    },
    prompt: (prompt: AuthPrompt) =>
      new Promise<string>((resolve, reject) => {
        // SDK 侧英文原文只留日志，界面按 promptType 自写中文
        console.log(`[provider-auth] ${providerId} prompt(${prompt.type}): ${prompt.message}`);
        if (pending.abort.signal.aborted) {
          reject(new Error("登录已取消"));
          return;
        }
        const step: PendingPrompt = { resolve, reject };
        // 同一步骤不会被问两次；真出现时先释放旧步骤，避免旧 Promise 永挂
        pending.prompt?.reject(new Error("该输入步骤已被新步骤替换"));
        pending.prompt = step;
        // prompt.signal 是「这一步」的取消（如回调服务已拿到授权码），与整流程的 signal 不同
        prompt.signal?.addEventListener("abort", () => {
          if (pending.prompt !== step) return;
          pending.prompt = null;
          reject(new Error("该输入步骤已取消"));
        }, { once: true });
        emit({ kind: "prompt", promptType: prompt.type, placeholder: promptPlaceholder(prompt), options: promptOptions(prompt) });
      }),
  };
}

/** 发起账号登录：resolve 时流程已结束（成功/失败/取消），界面据结果切状态。
 *
 * 同一 requestId 重复发起共用同一次登录：React StrictMode 会在挂载期跑
 * setup → cleanup → setup，界面会把同一个 requestId 发两次——第二次若另起一次登录，
 * 回调服务端口被占（同一供应商只允许一个在途登录）而直接报错。
 * 注册必须在第一个 await 之前完成：每次 await 前都可能插进同 requestId 的第二次调用。 */
export function loginProvider(store: Store, providerId: string, requestId: string): Promise<ProviderLoginResult> {
  const existing = pendingLogins.get(requestId);
  if (existing) return existing.result;
  // 同供应商只允许一个在途登录：OAuth 回调服务端口是固定的，第二个会互相抢回调。
  // 必须在入表之前同步判断：等到 await 之后，同一批次发起的两个请求都已入表，谁也说不清谁先来
  for (const p of pendingLogins.values()) {
    if (p.providerId === providerId) return Promise.resolve({ ok: false, error: "该供应商正在登录中，请稍候" });
  }
  const abort = new AbortController();
  const pending: PendingLogin = {
    providerId,
    abort,
    prompt: null,
    // 占位值不可达：赋值与 runLogin 起跑之间没有 await，别的请求插不进来
    result: Promise.resolve({ ok: false, error: "登录尚未开始" }),
  };
  pendingLogins.set(requestId, pending);
  pending.result = runLogin(store, providerId, requestId, pending);
  return pending.result;
}

async function runLogin(
  store: Store,
  providerId: string,
  requestId: string,
  pending: PendingLogin,
): Promise<ProviderLoginResult> {
  try {
    const runtime = await getModelRuntime(store);
    const provider = runtime.getProvider(providerId);
    if (!provider) return { ok: false, error: `未知供应商：${providerId}` };
    if (!provider.auth.oauth) return { ok: false, error: `${provider.name} 不支持账号登录` };
    await runtime.login(providerId, "oauth", createInteraction(requestId, providerId, pending));
    return { ok: true };
  } catch (e) {
    return { ok: false, canceled: pending.abort.signal.aborted, error: e instanceof Error ? e.message : String(e) };
  } finally {
    // 未决输入随流程结束一并释放：界面可能还停在输入步骤上
    pending.prompt?.reject(new Error("登录流程已结束"));
    pending.prompt = null;
    pendingLogins.delete(requestId);
  }
}

/** 界面提交某一步的输入。返回 false = 该步骤已结束（超时/取消/已被回调抢先） */
export function respondAuthInput(requestId: string, value: string): boolean {
  const pending = pendingLogins.get(requestId);
  const prompt = pending?.prompt;
  if (!pending || !prompt) return false;
  pending.prompt = null;
  prompt.resolve(value);
  return true;
}

/** 界面点取消 / 关闭弹窗：中止整条登录流程 */
export function cancelAuthLogin(requestId: string): boolean {
  const pending = pendingLogins.get(requestId);
  if (!pending) return false;
  pending.prompt?.reject(new Error("登录已取消"));
  pending.prompt = null;
  pending.abort.abort();
  return true;
}

/** 退出登录（删除 auth.json 中该供应商的凭据） */
export async function logoutProvider(store: Store, providerId: string): Promise<ProviderLoginResult> {
  const runtime = await getModelRuntime(store);
  if (!runtime.getProvider(providerId)) return { ok: false, error: `未知供应商：${providerId}` };
  // 在途登录先中止：否则登录完成后会把凭据又写回去，用户看到「退出了但还是登录态」
  for (const requestId of [...pendingLogins.keys()]) {
    if (pendingLogins.get(requestId)?.providerId === providerId) cancelAuthLogin(requestId);
  }
  try {
    await runtime.logout(providerId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** auth.json 中已存凭据的供应商集合（读取失败时降级为空集，不阻断状态查询） */
async function readStoredProviderIds(runtime: ModelRuntimeInstance): Promise<Set<string>> {
  try {
    const list = await runtime.listCredentials();
    return new Set(list.map((c) => c.providerId));
  } catch (e) {
    console.warn("[provider-auth] 读取凭据列表失败:", (e as Error).message);
    return new Set();
  }
}

/** 不传 providerIds 时只返回支持账号登录的供应商 */
export async function getProviderAuthStatus(store: Store, providerIds?: string[]): Promise<ProviderAuthStatus[]> {
  const runtime = await getModelRuntime(store);
  const wanted = providerIds && providerIds.length > 0 ? new Set(providerIds) : null;
  const targets = runtime.getProviders().filter((p) => (wanted ? wanted.has(p.id) : !!p.auth.oauth));
  const stored = await readStoredProviderIds(runtime);
  const out: ProviderAuthStatus[] = [];
  for (const p of targets) {
    let type: ProviderAuthType | null = null;
    let source: string | undefined;
    try {
      const check = await runtime.checkAuth(p.id);
      if (check) {
        type = check.type;
        source = check.source;
      }
    } catch (e) {
      // 单个供应商的可用性检查失败不该让整个设置页查不到状态：按「未配置」展示
      console.warn(`[provider-auth] 检查 ${p.id} 认证状态失败:`, (e as Error).message);
    }
    out.push({ providerId: p.id, name: p.name, supportsOAuth: !!p.auth.oauth, type, hasCredential: stored.has(p.id), source });
  }
  return out;
}
