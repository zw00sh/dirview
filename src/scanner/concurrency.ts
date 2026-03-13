/**
 * Maps items through an async function with a max concurrency limit.
 * Results are returned in input order. If signal is provided, workers
 * stop accepting new items once it is aborted (in-progress items complete).
 */
export async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
  signal?: AbortSignal
): Promise<R[]> {
  if (items.length === 0) { return []; }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      if (signal?.aborted) { return; }
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
