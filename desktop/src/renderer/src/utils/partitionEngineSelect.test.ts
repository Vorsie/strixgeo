import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the engine so the wrapper's delegation is observable without running any
// real geometry. Each mock returns a sentinel we can identify.
const V2_SENTINEL = [{ engine: 'v2' }] as unknown

// The conflict sentinel: a distinct payload the diagnostics variant returns so
// we can prove the wrapper threads conflicts through.
const V2_CONFLICTS = [{ gapIndex: 0, tieIds: ['a', 'b'], edgeKeys: ['ka', 'kb'] }] as unknown
const V2_FLAGS = [{ kind: 'review' }] as unknown
const IDENTITY = { regions: V2_SENTINEL, groups: [['l1', 'l2']] } as unknown

vi.mock('./partitionFillV2', () => ({
  computeSectionFillV2: vi.fn(() => V2_SENTINEL),
  // The diagnostics + identity variants consume ``classifyOverrideOutcome``
  // DIRECTLY (S80) so status / identity surface with no extra engine pass.
  classifyOverrideOutcome: vi.fn(() => ({
    status: 'rejected-unsafe',
    regions: V2_SENTINEL,
    conflicts: V2_CONFLICTS,
    reviewFlags: V2_FLAGS,
    identity: IDENTITY,
    baseDefect: 0,
    candidateDefect: 1,
  })),
}))

// Spy on the sweep flag: the entry points MUST run the engine with two-sided
// terminations ON and restore the previous value afterwards — without this the
// app silently ran the flag-OFF seam engine (owner dogfeed 2026-07-19).
const setFlag = vi.fn((v: boolean) => false)
vi.mock('./partitionFillV2/tileFlags', () => ({
  setTwoSidedTerminations: (v: boolean) => setFlag(v),
}))

import { classifyOverrideOutcome, computeSectionFillV2 } from './partitionFillV2'
import {
  computeSectionFillActive,
  computeSectionFillActiveWithDiagnostics,
  computeSectionFillActiveWithIdentity,
} from './partitionEngineSelect'

const COLUMNS = [] as never[]

// There is no engine CHOICE any more — v1 was archived 2026-08-31 (#280) and
// these entry points are a thin wrapper around v2 plus its sweep-flag wiring.
// What is worth pinning is exactly that wrapper: the arguments forward
// verbatim, the sweep flag is set and restored around every variant, and the
// diagnostics / identity payloads thread through unchanged.
describe('partition entry points — v2 wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards all four arguments to the engine', () => {
    const edges = [{ a: 'x', b: 'y' }] as never[]
    const overrides = new Map()
    const along = [0, 10]
    computeSectionFillActive(COLUMNS, edges, overrides, along)
    expect(computeSectionFillV2).toHaveBeenCalledWith(COLUMNS, edges, overrides, along)
  })

  it.each([
    ['plain', () => computeSectionFillActive(COLUMNS)],
    ['identity', () => computeSectionFillActiveWithIdentity(COLUMNS)],
    ['diagnostics', () => computeSectionFillActiveWithDiagnostics(COLUMNS)],
  ])('%s variant runs under the sweep flag and restores it', (_name, run) => {
    run()
    // Set ON first, then restored to whatever it was (the mock returns false).
    expect(setFlag.mock.calls[0]).toEqual([true])
    expect(setFlag.mock.calls[1]).toEqual([false])
  })

  it('identity variant returns the fallback-excluding weld regions + layer-id groups', () => {
    const { regions, groups } = computeSectionFillActiveWithIdentity(COLUMNS)
    expect(classifyOverrideOutcome).toHaveBeenCalledWith(COLUMNS, [], undefined, undefined, {
      withIdentity: true,
    })
    expect(regions).toBe(V2_SENTINEL)
    expect(groups).toEqual([['l1', 'l2']])
  })

  it('diagnostics variant threads conflicts, review flags and the override status through (§8 Q4 + S80)', () => {
    const { regions, conflicts, reviewFlags, overrideStatus } =
      computeSectionFillActiveWithDiagnostics(COLUMNS)
    expect(classifyOverrideOutcome).toHaveBeenCalledTimes(1)
    expect(regions).toBe(V2_SENTINEL)
    expect(conflicts).toBe(V2_CONFLICTS)
    expect(reviewFlags).toBe(V2_FLAGS)
    // The free-draw override status threads through for the red-handle /
    // snap-back UX (S80).
    expect(overrideStatus).toBe('rejected-unsafe')
  })
})
