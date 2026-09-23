/** SDK abort() 会等待 idle；请求挂死时不能让停止 IPC 无限等待。 */
export async function waitForAbortSettlement(
  abort: Promise<unknown>,
  promptDone: Promise<unknown> | undefined,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled([abort, promptDone ?? Promise.resolve()]).then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
