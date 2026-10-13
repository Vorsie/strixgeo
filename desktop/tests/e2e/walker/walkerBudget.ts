/**
 * The walker's budget knobs -- pure, so the defaults and the timeout rule are
 * unit tested without Playwright.
 *
 * Owner 2026-10-13: "Walk again, add more steps. I test it once and find a
 * bug, walker is thus not doing its job." The defaults were 300 steps / 900 s
 * under a hard 20-minute Playwright timeout; raising one knob past that
 * ceiling killed the run instead of walking longer. Now the timeout FOLLOWS
 * the time budget, and WALKER_RUNS repeats the walk with consecutive seeds.
 */

/** Steps per walk when ``WALKER_STEPS`` is unset (was 300). */
export const DEFAULT_STEPS = 900

/** Wall-clock budget per walk in seconds when ``WALKER_TIME_BUDGET_S`` is unset (was 900). */
export const DEFAULT_TIME_BUDGET_S = 1500

/** Independent walks per invocation when ``WALKER_RUNS`` is unset. */
export const DEFAULT_RUNS = 1

/**
 * Seconds added to the time budget for the Playwright test timeout: the launch,
 * the worked-example restore (up to 90 s on its own), the close handshake and
 * the 5 s survivor poll all run OUTSIDE the walk's own time check.
 */
export const TEST_TIMEOUT_MARGIN_S = 300

/** The knobs one invocation runs with. */
export interface WalkerBudget {
  /** Maximum steps per walk. */
  readonly steps: number
  /** Wall-clock budget per walk, seconds. */
  readonly timeBudgetS: number
  /** Number of independent walks (seeds seed, seed+1, ...). */
  readonly runs: number
}

/** A strictly positive integer from an env string, else the fallback. */
function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw.trim())
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.floor(n)
}

/**
 * Read the budget knobs from an environment.
 *
 * @param env - Usually ``process.env``. Reads ``WALKER_STEPS``,
 *   ``WALKER_TIME_BUDGET_S`` and ``WALKER_RUNS``; an empty, non-numeric or
 *   non-positive value falls back to the default (never NaN, never 0).
 * @returns The budget for this invocation.
 */
export function readBudget(env: Readonly<Record<string, string | undefined>>): WalkerBudget {
  return {
    steps: positiveInt(env.WALKER_STEPS, DEFAULT_STEPS),
    timeBudgetS: positiveInt(env.WALKER_TIME_BUDGET_S, DEFAULT_TIME_BUDGET_S),
    runs: positiveInt(env.WALKER_RUNS, DEFAULT_RUNS),
  }
}

/**
 * The Playwright timeout for one walk: its time budget plus the fixed margin.
 *
 * @param timeBudgetS - The walk's wall-clock budget, seconds.
 * @returns The timeout in milliseconds.
 */
export function testTimeoutMs(timeBudgetS: number): number {
  return (timeBudgetS + TEST_TIMEOUT_MARGIN_S) * 1000
}

/**
 * The seeds of N independent walks: the base seed, then +1 per run (uint32).
 *
 * @param baseSeed - The printed / ``WALKER_SEED`` seed of run 1.
 * @param runs - How many walks.
 * @returns One seed per run, in run order.
 */
export function runSeeds(baseSeed: number, runs: number): number[] {
  const out: number[] = []
  for (let i = 0; i < runs; i++) out.push((baseSeed + i) >>> 0)
  return out
}
