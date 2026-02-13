/**
 * Normalized timing summary returned by long-running fixture loops.
 * All values are deterministic aggregates so CI logs and local runs can
 * compare throughput changes over time.
 */
export interface DurationSummary {
  /** Total number of executed work items. */
  count: number;
  /** Sum of all measured durations in milliseconds. */
  totalMs: number;
  /** Arithmetic mean duration in milliseconds. */
  averageMs: number;
  /** Fastest observed item duration in milliseconds. */
  minMs: number;
  /** Slowest observed item duration in milliseconds. */
  maxMs: number;
  /** 95th-percentile duration in milliseconds. */
  p95Ms: number;
  /** Number of items that exceeded the configured budget. */
  budgetExceededCount: number;
  /** Configured per-item budget, if provided. */
  budgetMs: number | null;
}

/**
 * Parse comma-separated CLI identifiers into a normalized list.
 * Empty/whitespace input returns `undefined` so callers can distinguish
 * "no filter" from "explicit empty filter."
 */
export function parseCsvArgument(raw: string | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }

  const values = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  return values.length > 0 ? values : undefined;
}

/**
 * Execute asynchronous work with bounded concurrency while preserving the input
 * ordering in the returned result array.
 *
 * This pool helper is intentionally tiny and dependency-free so every script in
 * this repository can share the same scheduling behavior.
 */
export async function runWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  requestedConcurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }

  const concurrency = normalizeConcurrency(requestedConcurrency, items.length);
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      const item = items[index] as TInput;
      results[index] = await worker(item, index);
    }
  }

  const workers = Array.from({ length: concurrency }, () => runWorker());
  await Promise.all(workers);
  return results;
}

/**
 * Build a deterministic summary for item-level duration metrics.
 * This function powers fast-loop telemetry and timing budget enforcement.
 */
export function summarizeDurations(durationsMs: readonly number[], budgetMs?: number): DurationSummary {
  const normalized = durationsMs
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => Number(value));

  if (normalized.length === 0) {
    return {
      count: 0,
      totalMs: 0,
      averageMs: 0,
      minMs: 0,
      maxMs: 0,
      p95Ms: 0,
      budgetExceededCount: 0,
      budgetMs: Number.isFinite(budgetMs) && (budgetMs ?? 0) > 0 ? Number(budgetMs) : null
    };
  }

  const sorted = [...normalized].sort((left, right) => left - right);
  const totalMs = normalized.reduce((sum, value) => sum + value, 0);
  const minMs = sorted[0] ?? 0;
  const maxMs = sorted[sorted.length - 1] ?? 0;
  const averageMs = totalMs / normalized.length;
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  const p95Ms = sorted[p95Index] ?? maxMs;
  const normalizedBudget = Number.isFinite(budgetMs) && (budgetMs ?? 0) > 0 ? Number(budgetMs) : null;
  const budgetExceededCount =
    normalizedBudget === null ? 0 : normalized.filter((duration) => duration > normalizedBudget).length;

  return {
    count: normalized.length,
    totalMs,
    averageMs,
    minMs,
    maxMs,
    p95Ms,
    budgetExceededCount,
    budgetMs: normalizedBudget
  };
}

/**
 * Clamp and sanitize caller-provided concurrency to a safe positive integer.
 */
function normalizeConcurrency(requestedConcurrency: number, maxItems: number): number {
  const fallback = 1;
  if (!Number.isFinite(requestedConcurrency)) {
    return fallback;
  }

  const rounded = Math.floor(requestedConcurrency);
  if (rounded <= 0) {
    return fallback;
  }

  return Math.min(rounded, Math.max(1, maxItems));
}
