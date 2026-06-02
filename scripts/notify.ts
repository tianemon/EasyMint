/**
 * notify.ts — 跨会话通知工具
 *
 * 用法: npx tsx scripts/notify.ts <sessionId> <message>
 *
 * 通过 SDK query + resume 向目标会话注入一条系统通知。
 * 目标会话下次 resume 时会看到这条消息。
 */

import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("用法: npx tsx scripts/notify.ts <sessionId> <message>");
    process.exit(1);
  }

  const [sessionId, ...msgParts] = args;
  const message = msgParts.join(" ");

  // Read API config from ~/.easymint/settings.json (EasyMint's SDK config)
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".easymint");
  let apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || "";
  let baseUrl = process.env.ANTHROPIC_BASE_URL || "";

  try {
    const settingsPath = path.join(configDir, "settings.json");
    const raw = readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(raw);
    apiKey = settings.env?.ANTHROPIC_AUTH_TOKEN || apiKey;
    baseUrl = settings.env?.ANTHROPIC_BASE_URL || baseUrl;
  } catch { /* use env fallback */ }

  // Dynamic import SDK (ESM)
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === "string")) as Record<string, string>,
    ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}),
    ...(apiKey ? { ANTHROPIC_AUTH_TOKEN: apiKey } : {}),
  };

  console.log(`[notify] → sessionId=${sessionId}`);
  console.log(`[notify] message: ${message}`);

  const q = await query({
    prompt: `[系统通知] ${message}`,
    options: {
      resume: sessionId,
      env,
      permissionMode: "bypassPermissions",
      systemPrompt: { type: "preset" as const, preset: "claude_code" as const },
      model: process.env.ANTHROPIC_MODEL || undefined,
    },
  });

  let code = 0;
  for await (const msg of q) {
    if (msg.type === "result") {
      code = msg.subtype === "success" ? 0 : 1;
    }
  }

  console.log(`[notify] done (exit ${code})`);
  process.exit(code);
}

main().catch((err) => {
  console.error("[notify] error:", err);
  process.exit(1);
});
