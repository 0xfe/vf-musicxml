import { describe, expect, it } from 'vitest';

import { parseCsvArgument, runWithConcurrency, summarizeDurations } from '../../src/testkit/execution-loop.js';

describe('execution loop helpers', () => {
  it('parses CSV selector arguments into trimmed identifier lists', () => {
    expect(parseCsvArgument(undefined)).toBeUndefined();
    expect(parseCsvArgument('')).toBeUndefined();
    expect(parseCsvArgument('  ')).toBeUndefined();
    expect(parseCsvArgument('a,b, c ,,d')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('runs async work in bounded concurrency while preserving result ordering', async () => {
    const started: number[] = [];
    const resolved: number[] = [];
    const items = [1, 2, 3, 4, 5];

    const results = await runWithConcurrency(items, 2, async (item) => {
      started.push(item);
      await new Promise((resolve) => setTimeout(resolve, 2));
      resolved.push(item);
      return item * 10;
    });

    expect(started.length).toBe(items.length);
    expect(resolved.length).toBe(items.length);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it('summarizes per-item durations and timing budget exceedances', () => {
    const summary = summarizeDurations([4, 8, 12, 16, 20], 10);
    expect(summary.count).toBe(5);
    expect(summary.totalMs).toBe(60);
    expect(summary.averageMs).toBe(12);
    expect(summary.minMs).toBe(4);
    expect(summary.maxMs).toBe(20);
    expect(summary.p95Ms).toBe(20);
    expect(summary.budgetExceededCount).toBe(3);
    expect(summary.budgetMs).toBe(10);
  });
});

