import { useCallback, useEffect, useState } from "react";
import { toast } from "../ui/Toast";
import { OAuthLoginDialog } from "./OAuthLoginDialog";
import type { ProviderAuthStatus } from "@shared/provider-auth";

/**
 * 供应商账号登录区：查询凭据状态、发起登录 / 退出登录、承载授权弹窗。
 * 只做这一件事——供应商表单只负责选认证方式与保存。
 */

/** 账号登录的订阅说明（key = 供应商预设 id） */
export const ACCOUNT_LOGIN_HINTS: Record<string, string> = {
  anthropic: "订阅用量按 token 计费，不占套餐额度",
  "openai-codex": "需 ChatGPT Plus / Pro 订阅",
};

export interface ProviderAuthState {
  /** 该供应商是否支持账号登录（SDK 声明，不硬编码供应商列表） */
  supported: boolean;
  /** null = 尚未查到 / 该供应商无账号登录 */
  status: ProviderAuthStatus | null;
  refresh: () => void;
}

/** 查一个供应商的账号登录状态；providerId 为 null（自定义供应商等）时不做查询 */
export function useProviderAuthStatus(providerId: string | null): ProviderAuthState {
  const [status, setStatus] = useState<ProviderAuthStatus | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!providerId) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    window.electronAPI.provider
      .authStatus([providerId])
      .then((list) => {
        if (!cancelled) setStatus(list[0] ?? null);
      })
      .catch((e: unknown) => {
        // 查不到不该挡住表单：按未登录展示，用户仍可点登录重试
        if (!cancelled) console.error("[provider-auth] 查询账号登录状态失败:", e);
      });
    return () => { cancelled = true; };
  }, [providerId, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { supported: status?.supportsOAuth ?? false, status, refresh };
}

interface ProviderAccountAuthProps {
  /** SDK 的 provider id（= 预设 id，账号登录只对内置供应商开放） */
  providerId: string;
  /** 供应商显示名（预设表 label） */
  providerLabel: string;
  /** 该供应商的订阅/计费说明，没有则不给提示 */
  hint?: string;
  status: ProviderAuthStatus | null;
  /** 登录/登出成功后通知宿主刷新状态 */
  onChanged: () => void;
}

export function ProviderAccountAuth({ providerId, providerLabel, hint, status, onChanged }: ProviderAccountAuthProps): JSX.Element {
  const [loginOpen, setLoginOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // 账号登录的"已登录"判据是 OAuth 凭据；API Key 不在此区展示
  const loggedIn = status?.type === "oauth";

  const logout = useCallback(async () => {
    setLoggingOut(true);
    try {
      const r = await window.electronAPI.provider.authLogout(providerId);
      if (r.ok) {
        onChanged();
      } else {
        console.error("[provider-auth] 退出登录失败:", r.error);
        toast("退出登录失败，请重试");
      }
    } catch (e) {
      console.error("[provider-auth] 退出登录失败:", e);
      toast("退出登录失败，请重试");
    } finally {
      setLoggingOut(false);
    }
  }, [providerId, onChanged]);

  return (
    <div className="bg-surface-alt rounded-[var(--radius-lg)] px-3 py-2.5">
      {loggedIn ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-text-primary">已登录</span>
          <button type="button" onClick={() => void logout()} disabled={loggingOut}
            className="h-7 px-3 rounded-[var(--radius-lg)] text-text-secondary text-xs hover:text-danger transition-colors disabled:opacity-40">
            {loggingOut ? "退出中…" : "退出登录"}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setLoginOpen(true)}
          className="h-8 px-4 rounded-[var(--radius-lg)] btn-raised text-xs font-medium">登录 {providerLabel}</button>
      )}
      {hint && <p className="text-[length:var(--text-2xs)] text-text-secondary mt-2">{hint}</p>}
      {loginOpen && (
        <OAuthLoginDialog
          providerId={providerId}
          providerLabel={providerLabel}
          // 关弹窗一律重查状态：登录可能已落盘但同步快照失败（此时主进程会报失败），
          // 以 auth.json 的实际状态为准
          onClose={() => { setLoginOpen(false); onChanged(); }}
        />
      )}
    </div>
  );
}
