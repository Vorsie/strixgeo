import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock BOTH engines so the selector's delegation is observable without running
// any real geometry. Each mock returns a sentinel array we can identify.
const V1_SENTINEL = [{ engine: 'v1' }] as unknown
const V2_SENTINEL = [{ engine: 'v2' }] as unknown

// The v2 conflict sentinel: a distinct payload the diagnostics variant returns so
// we can prove the selector threads conflicts through on the v2 path.
const V2_CONFLICTS = [{ gapIndex: 0, tieIds: ['a', 'b'], edgeKeys: ['ka', 'kb'] }] as unknown

vi.mock('./partitionFill', () => ({
  computeSectionFill: vi.fn(() => V1_SENTINEL),
}))
vi.mock('./partitionFillV2', () => ({
  computeSectionFillV2: vi.fn(() => V2_SENTINEL),
  // The diagnostics variant consumes ``classifyOverrideOutcome`` DIRECTLY (S80) so it can surface the
  // free-draw override status alongside regions + conflicts with no extra engine pass. Sentinel a
  // ``rejected-unsafe`` status so the test proves the status threads through.
  classifyOverrideOutcome: vi.fn(() => ({
    status: 'rejected-unsafe',
    regions: V2_SENTINEL,
    conflicts: V2_CONFLICTS,
    baseDefect: 0,
    candidateDefect: 1,
  })),
}))

import { computeSectionFill } from './partitionFill'
import { classifyOverrideOutcome, computeSectionFillV2 } from './partitionFillV2'
import {
  computeSectionFillActive,
  computeSectionFillActiveWithDiagnostics,
  isPartitionEngineV2Active,
  setPartitionEngineV2,
} from './partitionEngineSelect'

const COLUMNS = [] as never[]

describe('computeSectionFillActive — engine selection', () => {
  const origEnv = process.env.STRIX_PARTITION_V2

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.STRIX_PARTITION_V2
    try {
      localStorage.clear()
    } catch {
      // no localStorage in this context — the pref-set tests skip themselves
    }
    // Do NOT call setPartitionEngineV2(false) here: since v2 became the default that
    // writes an explicit opt-OUT, which is the opposite of the unset state the
    // default-resolution cases need. localStorage.clear() above is the unset state.
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (origEnv === undefined) delete process.env.STRIX_PARTITION_V2
    else process.env.STRIX_PARTITION_V2 = origEnv
    try {
      localStorage.clear()
    } catch {
      // ignore
    }
  })

  it('defaults to v2 (env unset, pref unset)', () => {
    // A fresh install must get the engine the owner validated. Measured on the real
    // 14 sections with only the engine differing: the drilled gate is identical at
    // 54 exact / 0 wrong, contact-error p90 0.125 -> 0.123 m and the WORST contact
    // error 5.335 -> 3.145 m, with 1.5 % fewer triangles.
    const out = computeSectionFillActive(COLUMNS)
    expect(computeSectionFillV2).toHaveBeenCalledTimes(1)
    expect(computeSectionFill).not.toHaveBeenCalled()
    expect(out).toBe(V2_SENTINEL)
  })

  it('falls back to v1 when the device pref opts out', () => {
    // v1 stays reachable as the beta fallback, now by explicit opt-OUT.
    setPartitionEngineV2(false)
    expect(isPartitionEngineV2Active()).toBe(false)
    const out = computeSectionFillActive(COLUMNS)
    expect(computeSectionFill).toHaveBeenCalledTimes(1)
    expect(computeSectionFillV2).not.toHaveBeenCalled()
    expect(out).toBe(V1_SENTINEL)
  })

  it('selects v2 when STRIX_PARTITION_V2=1 (env override)', () => {
    process.env.STRIX_PARTITION_V2 = '1'
    const out = computeSectionFillActive(COLUMNS)
    expect(computeSectionFillV2).toHaveBeenCalledTimes(1)
    expect(computeSectionFill).not.toHaveBeenCalled()
    expect(out).toBe(V2_SENTINEL)
  })

  it('stays on v1 when STRIX_PARTITION_V2 is set to a non-"1" value', () => {
    process.env.STRIX_PARTITION_V2 = '0'
    computeSectionFillActive(COLUMNS)
    expect(computeSectionFill).toHaveBeenCalledTimes(1)
    expect(computeSectionFillV2).not.toHaveBeenCalled()
  })

  it('selects v2 when the device pref is set (env unset)', () => {
    setPartitionEngineV2(true)
    expect(isPartitionEngineV2Active()).toBe(true)
    const out = computeSectionFillActive(COLUMNS)
    expect(computeSectionFillV2).toHaveBeenCalledTimes(1)
    expect(out).toBe(V2_SENTINEL)
  })

  it('env override wins over the device pref', () => {
    setPartitionEngineV2(true) // pref says v2 ...
    process.env.STRIX_PARTITION_V2 = '0' // ... but env forces v1
    computeSectionFillActive(COLUMNS)
    expect(computeSectionFill).toHaveBeenCalledTimes(1)
    expect(computeSectionFillV2).not.toHaveBeenCalled()
  })

  it('forwards all four arguments to whichever engine is active', () => {
    // Pin each engine rather than leaning on the default, so this keeps testing
    // argument forwarding if the default ever moves again.
    const edges = [{ a: 'x', b: 'y' }] as never[]
    const overrides = new Map()
    const along = [0, 10]

    process.env.STRIX_PARTITION_V2 = '0'
    computeSectionFillActive(COLUMNS, edges, overrides, along)
    expect(computeSectionFill).toHaveBeenCalledWith(COLUMNS, edges, overrides, along)

    process.env.STRIX_PARTITION_V2 = '1'
    computeSectionFillActive(COLUMNS, edges, overrides, along)
    expect(computeSectionFillV2).toHaveBeenCalledWith(COLUMNS, edges, overrides, along)
  })

  it('diagnostics variant returns v2 conflicts + override status when v2 is active (§8 Q4 + S80)', () => {
    process.env.STRIX_PARTITION_V2 = '1'
    const { regions, conflicts, overrideStatus } = computeSectionFillActiveWithDiagnostics(COLUMNS)
    expect(classifyOverrideOutcome).toHaveBeenCalledTimes(1)
    expect(regions).toBe(V2_SENTINEL)
    expect(conflicts).toBe(V2_CONFLICTS)
    // The free-draw override status threads through for the red-handle / snap-back UX (S80).
    expect(overrideStatus).toBe('rejected-unsafe')
  })

  it('diagnostics variant returns EMPTY conflicts + unsupported status on the v1 engine', () => {
    // v1 has no override-rejection model → status is always ``unsupported``. v1 is now
    // the opt-out fallback rather than the default, so pin it explicitly.
    process.env.STRIX_PARTITION_V2 = '0'
    const { regions, conflicts, overrideStatus } = computeSectionFillActiveWithDiagnostics(COLUMNS)
    expect(computeSectionFill).toHaveBeenCalledTimes(1)
    expect(classifyOverrideOutcome).not.toHaveBeenCalled()
    expect(regions).toBe(V1_SENTINEL)
    expect(conflicts).toEqual([])
    expect(overrideStatus).toBe('unsupported')
  })
})

describe('flag resolution without a DOM (no localStorage) does not throw', () => {
  it('takes the default engine when localStorage is unavailable', () => {
    const orig = globalThis.localStorage
    // Simulate a worker / node-without-jsdom context: no localStorage global.
    // Deleting the property makes ``typeof localStorage === 'undefined'``.
    // @ts-expect-error — intentionally removing the global for this case
    delete globalThis.localStorage
    delete process.env.STRIX_PARTITION_V2
    try {
      expect(() => isPartitionEngineV2Active()).not.toThrow()
      // No storage means no opt-out was ever recorded, so the default applies — a
      // worker or node context must render the same engine as the app, not the
      // fallback.
      expect(isPartitionEngineV2Active()).toBe(true)
      expect(() => computeSectionFillActive(COLUMNS)).not.toThrow()
    } finally {
      // Restore for the rest of the suite.
      Object.defineProperty(globalThis, 'localStorage', {
        value: orig,
        configurable: true,
        writable: true,
      })
    }
  })
})
