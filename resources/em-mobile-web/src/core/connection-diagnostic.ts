/** Measures an existing authenticated command, including network and desktop processing time. */
export async function measureConnection(request: () => Promise<unknown>, samples = 3): Promise<number[]> {
  const times: number[] = [];
  for (let index = 0; index < samples; index++) {
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        request(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('检测超时')), 5000); }),
      ]);
      times.push(Math.round(performance.now() - start));
    } finally { if (timer) clearTimeout(timer); }
  }
  return times;
}

export type FrameResult = { frames: number; slowFrames: number; seconds: number };

/** Measure visible chat frames only. No message content or browsing activity is collected. */
export function captureChatFrames(isChatVisible: () => boolean, onComplete: (result: FrameResult) => void, durationMs = 20_000): () => void {
  let frame = 0, previous: number | null = null, elapsed = 0, frames = 0, slowFrames = 0;
  const onVisibility = (): void => { previous = null; };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  const tick = (time: number): void => {
    if (isChatVisible()) {
      if (previous !== null) {
        const delta = time - previous;
        if (delta > 0) { elapsed += delta; frames++; if (delta > 50) slowFrames++; }
      }
      previous = time;
    } else previous = null;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  const cleanup = (): void => { cancelAnimationFrame(frame); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility); };
  const timer = setTimeout(() => { cleanup(); onComplete({ frames, slowFrames, seconds: elapsed / 1000 }); }, durationMs);
  return () => { clearTimeout(timer); cleanup(); };
}
