import type { AuthStorageBackend } from "@earendil-works/pi-coding-agent";

/** Connection tests must neither load a real account nor persist authentication state. */
export class InMemoryAuthStorageBackend implements AuthStorageBackend {
  private value?: string;
  private chain: Promise<unknown> = Promise.resolve();
  withLock<T>(fn: (current: string | undefined) => { result: T; next?: string }): T {
    const update = fn(this.value);
    if (update.next !== undefined) this.value = update.next;
    return update.result;
  }
  withLockAsync<T>(fn: (current: string | undefined) => Promise<{ result: T; next?: string }>): Promise<T> {
    const result = this.chain.then(async () => {
      const update = await fn(this.value);
      if (update.next !== undefined) this.value = update.next;
      return update.result;
    });
    this.chain = result.catch(() => undefined);
    return result;
  }
}
