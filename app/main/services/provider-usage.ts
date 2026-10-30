import { createHash } from "node:crypto";
import type { ApiProvidersData, ProviderConfig } from "../../shared/platform-presets";
import { accountUsageLabels, accountUsagePlatform, type AccountUsageLabel, type AccountUsageResult, type AccountUsageRow } from "../../shared/provider-usage";

export interface UsageAuth { token: string; type: "oauth" | "api_key"; enterpriseUrl?: string }
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const number = (value: unknown): number | undefined => (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) ? Number(value) : undefined;
const money = (value: unknown): string | undefined => number(value) !== undefined ? String(value) : undefined;
function reset(value: unknown): string | undefined {
  const n = number(value);
  if (n !== undefined && n <= 0) return undefined;
  const date = n !== undefined ? new Date(n > 1e11 ? n : n * 1000) : typeof value === "string" ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/** Endpoints are platform-owned constants; inference proxies/custom hosts never receive account credentials. */
export function usageRequest(config: ProviderConfig, auth: UsageAuth): { url: string; headers: Record<string, string> } | undefined {
  const preset = accountUsagePlatform(config);
  const headers: Record<string, string> = { Authorization: `Bearer ${auth.token}`, Accept: "application/json" };
  const urls: Record<string, string> = {
    moonshotai: "https://api.moonshot.ai/v1/users/me/balance", "moonshotai-cn": "https://api.moonshot.cn/v1/users/me/balance",
    openrouter: "https://openrouter.ai/api/v1/key", "kimi-coding": "https://api.kimi.com/coding/v1/usages",
    zai: "https://api.z.ai/api/monitor/usage/quota/limit", "zai-coding-cn": "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    siliconflow: "https://api.ap.siliconflow.com/v1/user/info", "siliconflow-cn": "https://api.siliconflow.cn/v1/user/info",
  };
  if (Object.hasOwn(urls,preset)) return { url: urls[preset]!, headers };
  if (config.presetId === "anthropic" && auth.type === "oauth") {
    headers["anthropic-beta"] = "oauth-2025-04-20";
    return { url: "https://api.anthropic.com/api/oauth/usage", headers };
  }
  if (config.presetId === "minimax" || config.presetId === "minimax-cn") {
    const origin = config.presetId === "minimax-cn" ? "https://api.minimaxi.com" : "https://api.minimax.io";
    headers["Content-Type"] = "application/json";
    return { url: origin + (auth.token.startsWith("sk-api-") ? "/account/query_balance" : "/v1/token_plan/remains"), headers };
  }
  if (config.presetId === "github-copilot") {
    let host = "api.github.com";
    if (auth.enterpriseUrl) {
      try {
        const domain = new URL(auth.enterpriseUrl.includes("://") ? auth.enterpriseUrl : `https://${auth.enterpriseUrl}`).hostname.toLowerCase();
        if (domain !== "github.com") {
          if (!/^[a-z0-9-]+\.ghe\.com$/.test(domain)) return undefined;
          host = `api.${domain}`;
        }
      } catch { return undefined; }
    }
    headers["User-Agent"] = "EasyMint";
    return { url: `https://${host}/copilot_internal/user`, headers };
  }
  return undefined;
}

/** Parsers keep absent values absent. No quota, currency or billing scope is inferred from model names. */
export function parseProviderUsage(preset: string, raw: unknown): AccountUsageRow[] {
  const body = object(raw), rows: AccountUsageRow[] = [];
  const amount = (label: AccountUsageLabel, value: unknown, currency?: string) => {
    const parsed = money(value);
    if (parsed !== undefined) rows.push({ id: label, label, unit: "money", value: parsed, currency });
  };
  const percent = (id: string, label: AccountUsageLabel, value: unknown, when?: unknown, scope?: string, remaining = false) => {
    const parsed = number(value);
    if (parsed !== undefined && parsed >= 0 && parsed <= (remaining ? 1000 : 100)) rows.push({ id, label, unit: remaining ? "remainingPercent" : "usedPercent", value: String(parsed), resetAt: reset(when), scope });
  };
  const count = (id: string, label: AccountUsageLabel, value: unknown, when?: unknown, scope?: string) => {
    const parsed = number(value);
    if (parsed !== undefined && parsed >= 0) rows.push({ id, label, unit: "remainingCount", value: String(parsed), resetAt: reset(when), scope });
  };
  if (preset === "siliconflow" || preset === "siliconflow-cn") {
    if (body.status === false || body.code !== 20000) return [];
    const data = object(body.data);
    amount("balance", data.totalBalance); amount("recharge", data.chargeBalance); amount("baseBalance", data.balance);
  } else if (preset.startsWith("moonshotai")) {
    if (body.status === false || body.status !== true && body.code !== 0) return [];
    const data = object(body.data), currency = preset === "moonshotai-cn" ? "CNY" : "USD";
    amount("balance", data.available_balance, currency); amount("cash", data.cash_balance, currency); amount("voucher", data.voucher_balance, currency);
  } else if (preset === "openrouter") {
    const data = object(body.data);
    for (const [field, label] of [["usage", "usage"], ["usage_daily", "dailyUsage"], ["usage_weekly", "weeklyUsage"], ["usage_monthly", "monthlyUsage"]] as const) amount(label, data[field], "USD");
    // A key cap is not the account wallet; null means no key cap, not infinite account funds.
    if (data.limit === null) rows.push({ id: "keyRemaining", label: "keyRemaining", unit: "unlimited" });
    else amount("keyRemaining", data.limit_remaining, "USD");
  } else if (preset === "anthropic") {
    const windows: Array<[string, AccountUsageLabel, string?]> = [["five_hour", "fiveHour"], ["seven_day", "weekly"], ["seven_day_sonnet", "weekly", "Sonnet"], ["seven_day_opus", "weekly", "Opus"]];
    for (const [id, label, scope] of windows) { const item = object(body[id]); percent(id, label, item.utilization, item.resets_at, scope); }
    if (!rows.length && Array.isArray(body.limits)) for (const value of body.limits) {
      const item = object(value), id = String(item.type ?? item.name ?? ""), window = windows.find(w => w[0] === id);
      if (window) percent(id, window[1], item.percent ?? item.utilization, item.resets_at, window[2]);
    }
  } else if (preset === "github-copilot") {
    for (const [id, label] of [["premium_interactions", "premium"], ["chat", "chat"], ["completions", "completions"]] as const) {
      const item = object(object(body.quota_snapshots)[id]);
      if (item.unlimited === true) rows.push({ id, label, unit: "unlimited" });
      else {
        const remaining = number(item.percent_remaining), total = number(item.entitlement), left = number(item.remaining ?? item.quota_remaining);
        percent(id, label, remaining !== undefined ? 100 - remaining : total && left !== undefined ? (total - left) / total * 100 : undefined, item.quota_reset_at ?? body.quota_reset_date_utc ?? body.quota_reset_date);
      }
    }
  } else if (preset === "zai" || preset === "zai-coding-cn") {
    if (body.success === false || body.code !== undefined && body.code !== 0 && body.code !== 200) return [];
    const limits = object(body.data).limits ?? body.limits;
    if (Array.isArray(limits)) limits.slice(0, 40).forEach((value, index) => {
      const item = object(value), type = String(item.type ?? ""), unit = number(item.unit), n = number(item.number);
      const label = type === "TIME_LIMIT" ? "monthlyTools" : unit === 6 ? "weekly" : unit === 3 && n === 5 ? "fiveHour" : "quota";
      if (["TIME_LIMIT", "TOKENS_LIMIT", "CREDIT_LIMIT"].includes(type)) percent(`limit-${index}`, label, item.percentage, item.nextResetTime ?? item.resetTime);
    });
  } else if (preset === "kimi-coding") {
    const usages = object(body.usages);
    for (const [id, label] of [["limit_5h", "fiveHour"], ["limit_7d", "weekly"], ["limit_month_total", "monthly"], ["limit_month_code", "monthly"]] as const) {
      const item = object(usages[id]), ratio = number(item.used_ratio);
      percent(id, label, ratio === undefined ? undefined : ratio * 100, item.reset_time, id === "limit_month_code" ? "Code" : undefined);
    }
    // Older responses carry explicit count windows; prefer these over inconsistent ratio snapshots.
    if (Array.isArray(body.limits)) body.limits.slice(0, 20).forEach((value, index) => {
      const item = object(value), window = object(item.window), detail = object(item.detail), total = number(detail.limit), used = number(detail.used);
      if (!total || total < 0 || used === undefined) return;
      const minutes = number(window.duration), label = window.timeUnit === "TIME_UNIT_MINUTE" && minutes === 300 ? "fiveHour" : window.timeUnit === "TIME_UNIT_DAY" && minutes === 7 ? "weekly" : "quota";
      const existing = rows.findIndex(row => row.label === label);
      if (existing >= 0) rows.splice(existing, 1);
      percent(`count-${index}`, label, used / total * 100, detail.resetTime);
    });
    if (!rows.length) { const item = object(body.usage), total = number(item.limit), used = number(item.used); if (total && total > 0 && used !== undefined) percent("total", "quota", used / total * 100, item.resetTime); }
  } else if (preset === "minimax" || preset === "minimax-cn") {
    if (object(body.base_resp).status_code !== undefined && object(body.base_resp).status_code !== 0) return [];
    if (body.available_amount !== undefined) {
      for (const [field, label] of [["available_amount", "balance"], ["cash_balance", "cash"], ["voucher_balance", "voucher"], ["credit_balance", "credit"], ["owed_amount", "owed"]] as const) amount(label, body[field], typeof body.currency === "string" ? body.currency : undefined);
    } else if (Array.isArray(body.model_remains)) body.model_remains.slice(0, 20).forEach((value, index) => {
      const item = object(value), scope = typeof item.model_name === "string" ? item.model_name.slice(0, 120) : undefined;
      if (item.current_interval_total_count === 0 && item.current_weekly_total_count === 0 && item.current_interval_status === 3 && item.current_weekly_status === 3) return;
      for (const [period, label, when] of [["interval", "fiveHour", item.end_time], ["weekly", "weekly", item.weekly_end_time]] as const) {
        const id = `${index}-${period}`;
        if (item[`current_${period}_status`] === 3) { rows.push({id,label,unit:"unlimited",scope}); continue; }
        // MiniMax's official CLI treats *_usage_count as remaining and applies the weekly boost separately.
        // https://github.com/MiniMax-AI/cli/blob/main/src/output/quota-table.ts
        const total = number(item[`current_${period}_total_count`]), remaining = number(item[`current_${period}_usage_count`]);
        const reported = number(item[`current_${period}_remaining_percent`]);
        const pct = reported ?? (total && total > 0 && remaining !== undefined ? remaining / total * 100 : undefined);
        const boost = period === "weekly" ? number(item.weekly_boost_permille) ?? 1000 : 1000;
        percent(id, label, pct === undefined ? undefined : pct * boost / 1000, when, scope, true);
        if (pct === undefined && remaining !== undefined) count(id, label, remaining, when, scope);
      }
    });
  }
  return rows;
}

export function createProviderUsageService(deps: {
  providers: () => ApiProvidersData | undefined;
  auth: (config: ProviderConfig) => Promise<UsageAuth | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const cache = new Map<string, { at: number; result: AccountUsageResult }>();
  const pending = new Map<string, Promise<AccountUsageResult>>();
  const now = deps.now ?? Date.now;
  return { async query(providerId: string, force = false): Promise<AccountUsageResult> {
    const current = deps.providers(), configured = current?.configs[providerId];
    if (current?.current !== providerId || !configured || configured.id !== providerId) return { ok:false, reason:"changed" };
    const config = { ...configured };
    if (!accountUsageLabels(config)) return { ok:false, reason:"unsupported" };
    const isCurrent = () => {
      const next = deps.providers(), candidate = next?.configs[providerId];
      return next?.current === providerId && candidate?.presetId === config.presetId && candidate?.authType === config.authType && candidate?.apiKey === config.apiKey && candidate?.baseUrl === config.baseUrl;
    };
    let auth: UsageAuth | undefined;
    try { auth = await deps.auth(config); } catch { return {ok:false,reason:"unavailable"}; }
    if (!auth?.token) return {ok:false,reason:"auth"};
    if (!isCurrent()) return {ok:false,reason:"changed"};
    const request = usageRequest(config, auth);
    if (!request) return {ok:false,reason:"unsupported"};
    const key = `${providerId}:${config.presetId}:${createHash("sha256").update(auth.token).update(request.url).digest("hex")}`;
    const previous = cache.get(key);
    if (previous && now() - previous.at < 60_000 && (!force || !previous.result.ok && previous.result.reason === "rateLimit")) return previous.result;
    let work = pending.get(key);
    if (!work) {
      work = (async (): Promise<AccountUsageResult> => {
        try {
          const response = await (deps.fetch ?? fetch)(request.url, {headers:request.headers,redirect:"error",signal:AbortSignal.timeout(10_000)});
          if (!response.ok) {
            await response.body?.cancel();
            return {ok:false,reason:response.status === 401 || response.status === 403 ? "auth" : response.status === 429 ? "rateLimit" : "unavailable"};
          }
          const rows = parseProviderUsage(accountUsagePlatform(config), await response.json());
          return rows.length ? {ok:true,providerId,rows,updatedAt:now()} : {ok:false,reason:"invalid"};
        } catch { return {ok:false,reason:"unavailable"}; }
      })();
      pending.set(key, work);
      void work.then(result => { cache.set(key,{at:now(),result}); if (cache.size > 32) cache.delete(cache.keys().next().value!); }).finally(() => pending.delete(key));
    }
    const result = await work;
    return isCurrent() ? result : {ok:false,reason:"changed"};
  }};
}
