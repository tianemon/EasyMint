export type AccountUsageLabel = "balance" | "cash" | "voucher" | "credit" | "owed" | "recharge" | "baseBalance" | "fiveHour" | "weekly" | "monthly" | "monthlyTools" | "quota" | "keyRemaining" | "usage" | "dailyUsage" | "weeklyUsage" | "monthlyUsage" | "premium" | "chat" | "completions";
export interface AccountUsageRow {
  id: string;
  label: AccountUsageLabel;
  value?: string;
  unit: "money" | "usedPercent" | "remainingPercent" | "remainingCount" | "unlimited";
  currency?: string;
  scope?: string;
  resetAt?: string;
}
export type AccountUsageResult = { ok: true; providerId: string; rows: AccountUsageRow[]; updatedAt: number }
  | { ok: false; reason: "unsupported" | "auth" | "rateLimit" | "unavailable" | "invalid" | "changed" };

const rows: Record<string, AccountUsageLabel[]> = {
  "openai-codex": ["fiveHour", "weekly"], deepseek: ["balance"],
  moonshotai: ["balance", "cash", "voucher"], "moonshotai-cn": ["balance", "cash", "voucher"],
  openrouter: ["usage", "keyRemaining"], minimax: ["fiveHour", "weekly"], "minimax-cn": ["fiveHour", "weekly"],
  "kimi-coding": ["fiveHour", "weekly"], zai: ["fiveHour", "weekly", "monthlyTools"], "zai-coding-cn": ["fiveHour", "weekly", "monthlyTools"],
  anthropic: ["fiveHour", "weekly"], "github-copilot": ["premium", "chat", "completions"],
  siliconflow: ["balance", "recharge", "baseBalance"], "siliconflow-cn": ["balance", "recharge", "baseBalance"],
};

export function accountUsagePlatform(provider:{presetId:string;baseUrl?:string}):string {
  if(provider.presetId!=="custom")return provider.presetId;
  try {
    const origin=new URL(provider.baseUrl??"").origin;
    if(origin==="https://api.siliconflow.cn")return "siliconflow-cn";
    if(origin==="https://api.ap.siliconflow.com")return "siliconflow";
  }catch{return "custom";}
  return "custom";
}

/** Capability follows the configured platform and credential kind, never the selected model name. */
export function accountUsageLabels(provider: { presetId: string; authType?: string; baseUrl?:string }): AccountUsageLabel[] | undefined {
  if (provider.presetId === "anthropic" && provider.authType !== "oauth") return undefined;
  const platform=accountUsagePlatform(provider);
  return Object.hasOwn(rows,platform) ? rows[platform] : undefined;
}
