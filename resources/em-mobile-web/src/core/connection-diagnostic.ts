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
