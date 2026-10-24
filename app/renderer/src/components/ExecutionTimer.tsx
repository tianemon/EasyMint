import { useEffect, useState } from "react";
import { useUiLocale } from "../lib/i18n";
import { executionLabel } from "./chat-turn-presentation";

/** Keep the one-second clock local; streaming messages do not re-render for timer ticks. */
export function ExecutionTimer({ startedAt }: { startedAt: number }): JSX.Element {
  const locale = useUiLocale();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return <div className="execution-process-toggle execution-process-running" role="timer">
    {executionLabel(Math.max(0, now - startedAt), locale.startsWith("en"), true)}
  </div>;
}
