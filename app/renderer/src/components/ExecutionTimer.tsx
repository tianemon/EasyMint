import { useEffect, useState } from "react";
import { uiText, useUiLocale } from "../lib/i18n";
import { executionLabel } from "./chat-turn-presentation";

/** Keep the one-second clock local; streaming messages do not re-render for timer ticks. */
export function ExecutionTimer({ startedAt, processed = false }: { startedAt: number; processed?: boolean }): JSX.Element {
  const locale = useUiLocale();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return <span role="timer" className="text-xs font-medium">
    {processed ? <IdentityTime durationMs={Math.max(0, now - startedAt)} running /> : executionLabel(Math.max(0, now - startedAt), locale.startsWith("en"), true)}
  </span>;
}

/** The identity row keeps the final elapsed time after the live clock stops. */
export function IdentityTime({ durationMs, running = false }: { durationMs?: number; running?: boolean }): JSX.Element | null {
  const locale = useUiLocale();
  if (durationMs === undefined) return null;
  if (!running) return <>{executionLabel(durationMs, locale.startsWith("en"))}</>;
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  return <>{uiText("ui.ChatPanel.processedTime", { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 })}</>;
}
