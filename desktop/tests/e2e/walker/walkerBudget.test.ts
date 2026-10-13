/**
 * Pins for the walker's budget knobs (owner 2026-10-13: "Walk again, add more
 * steps").
 *
 * The rules, in the ruling's words: the Playwright timeout FOLLOWS the time
 * budget (budget + a fixed margin), never a hard 20 minutes; the defaults are
 * 900 steps and 1500 s when the knobs are unset; both stay overridable; and
 * WALKER_RUNS gives N independent walks with seeds seed, seed+1, ...
 *
 * Explicit vitest imports (see walkerPolicy.test.ts for why).
 */

import { describe, it, expect } from 'vitest'

import {
  DEFAULT_RUNS,
  DEFAULT_STEPS,
  DEFAULT_TIME_BUDGET_S,
  TEST_TIMEOUT_MARGIN_S,
  readBudget,
  runSeeds,
  testTimeoutMs,
} from './walkerBudget'

describe('walker budget -- defaults when the knobs are unset', () => {
  it('900 steps, 1500 s and one run', () => {
    expect(DEFAULT_STEPS).toBe(900)
    expect(DEFAULT_TIME_BUDGET_S).toBe(1500)
    expect(DEFAULT_RUNS).toBe(1)
    expect(readBudget({})).toEqual({ steps: 900, timeBudgetS: 1500, runs: 1 })
  })

  it('an empty or unusable value falls back to the default, never to NaN or 0', () => {
    expect(readBudget({ WALKER_STEPS: '', WALKER_TIME_BUDGET_S: 'abc', WALKER_RUNS: '0' })).toEqual({
      steps: 900,
      timeBudgetS: 1500,
      runs: 1,
    })
    expect(readBudget({ WALKER_STEPS: '-5' }).steps).toBe(900)
  })
})

describe('walker budget -- the knobs stay overridable', () => {
  it('WALKER_STEPS, WALKER_TIME_BUDGET_S and WALKER_RUNS are read as given', () => {
    expect(readBudget({ WALKER_STEPS: '40', WALKER_TIME_BUDGET_S: '120', WALKER_RUNS: '3' })).toEqual({
      steps: 40,
      timeBudgetS: 120,
      runs: 3,
    })
  })
})

describe('walker budget -- the test timeout follows the time budget', () => {
  it('is the time budget plus the fixed margin, in milliseconds', () => {
    expect(TEST_TIMEOUT_MARGIN_S).toBe(300)
    expect(testTimeoutMs(1500)).toBe((1500 + 300) * 1000)
    expect(testTimeoutMs(60)).toBe((60 + 300) * 1000)
  })

  it('a longer budget gets a longer timeout (no hard 20-minute ceiling)', () => {
    expect(testTimeoutMs(3600)).toBeGreaterThan(20 * 60_000)
  })
})

describe('walker budget -- N runs use seeds seed, seed+1, ...', () => {
  it('counts up from the base seed', () => {
    expect(runSeeds(42, 3)).toEqual([42, 43, 44])
  })

  it('wraps at uint32 like every other walker seed', () => {
    expect(runSeeds(0xffffffff, 2)).toEqual([0xffffffff, 0])
  })
})
