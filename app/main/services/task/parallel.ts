/**
 * 并发执行 — 从 omp 移植，纯 JS，零依赖
 */

export interface ParallelResult<R> {
  results: (R | undefined)[];
  aborted: boolean;
}

function promiseWithResolvers<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export function normalizeConcurrencyLimit(max: number): number {
  const n = Number.isFinite(max) ? Math.trunc(max) : 0;
  return n > 0 ? n : 0;
}

export async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  signal?: AbortSignal,
): Promise<ParallelResult<R>> {
  const limit = Math.max(1, Math.min(Math.max(1, normalizeConcurrencyLimit(concurrency) || items.length), items.length));
  const results: (R | undefined)[] = new Array(items.length);
  let nextIndex = 0;

  const abortController = new AbortController();
  const workerSignal = signal ? AbortSignal.any([signal, abortController.signal]) : abortController.signal;

  let rejectFirst: (error: unknown) => void;
  const firstErrorPromise = new Promise<never>((_, reject) => { rejectFirst = reject; });

  const worker = async (): Promise<void> => {
    while (true) {
      if (workerSignal.aborted) return;
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index, workerSignal);
      } catch (error) {
        if (!workerSignal.aborted) {
          abortController.abort();
          rejectFirst(error);
          throw error;
        }
      }
    }
  };

  const workers = Array.from({ length: limit }, () => worker());

  try {
    await Promise.race([Promise.all(workers), firstErrorPromise]);
  } catch (error) {
    if (signal?.aborted) return { results, aborted: true };
    throw error;
  }

  return { results, aborted: signal?.aborted ?? false };
}

export class Semaphore {
  #max: number;
  #current = 0;
  #queue: Array<() => void> = [];

  constructor(max: number) {
    const n = normalizeConcurrencyLimit(max);
    this.#max = n > 0 ? n : Number.POSITIVE_INFINITY;
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("Semaphore acquire aborted");
    if (this.#current < this.#max) { this.#current++; return; }
    const { promise, resolve, reject } = promiseWithResolvers<void>();
    let waiter: () => void = resolve;
    if (signal) {
      const onAbort = () => {
        const idx = this.#queue.indexOf(waiter);
        if (idx >= 0) this.#queue.splice(idx, 1);
        reject(new Error("Semaphore acquire aborted"));
      };
      waiter = () => { signal.removeEventListener("abort", onAbort); resolve(); };
      signal.addEventListener("abort", onAbort, { once: true });
    }
    this.#queue.push(waiter);
    return promise;
  }

  release(): void {
    if (this.#current > 0) this.#current--;
    if (this.#current < this.#max) {
      const next = this.#queue.shift();
      if (next) { this.#current++; next(); }
    }
  }
}
