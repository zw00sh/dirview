import { describe, it, expect } from 'vitest';
import { parallelMap } from './concurrency';

describe('parallelMap', () => {
  it('returns results in input order', async () => {
    const result = await parallelMap([3, 1, 2], async (n) => n * 2, 2);
    expect(result).toEqual([6, 2, 4]);
  });

  it('handles empty arrays', async () => {
    const result = await parallelMap([], async (n: number) => n, 5);
    expect(result).toEqual([]);
  });

  it('respects concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const result = await parallelMap(
      [1, 2, 3, 4, 5],
      async (n) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>(r => setTimeout(r, 10));
        active--;
        return n;
      },
      2
    );
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it('propagates errors', async () => {
    await expect(
      parallelMap([1, 2, 3], async (n) => {
        if (n === 2) { throw new Error('fail'); }
        return n;
      }, 3)
    ).rejects.toThrow('fail');
  });

  it('handles concurrency larger than item count', async () => {
    const result = await parallelMap([1, 2], async (n) => n + 10, 100);
    expect(result).toEqual([11, 12]);
  });

  it('handles concurrency of 1 (sequential)', async () => {
    const order: number[] = [];
    await parallelMap([1, 2, 3], async (n) => {
      order.push(n);
      return n;
    }, 1);
    expect(order).toEqual([1, 2, 3]);
  });

  it('stops accepting new items when signal is pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const processed: number[] = [];
    await parallelMap([1, 2, 3], async (n) => {
      processed.push(n);
      return n;
    }, 1, controller.signal);
    // With concurrency=1, the abort check fires before any item is started.
    expect(processed).toHaveLength(0);
  });

  it('completes in-progress items but skips new ones after abort', async () => {
    const controller = new AbortController();
    const processed: number[] = [];
    await parallelMap(
      [1, 2, 3, 4, 5],
      async (n) => {
        processed.push(n);
        if (n === 1) { controller.abort(); }
        return n;
      },
      1, // sequential so order is deterministic
      controller.signal
    );
    // Item 1 completes, then abort fires; items 2+ are skipped.
    expect(processed).toEqual([1]);
  });

  it('works without signal (backward compat)', async () => {
    const result = await parallelMap([1, 2, 3], async (n) => n * 2, 2);
    expect(result).toEqual([2, 4, 6]);
  });
});
