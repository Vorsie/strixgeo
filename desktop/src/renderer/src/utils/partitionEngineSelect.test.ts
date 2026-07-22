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
    setPartitionEngineV2(false)
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

  it('defaults to v1 (env unset, pref unset)', () => {
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

  it('forwards all four arguments to the chosen engine', () => {
    const edges = [{ a: 'x', b: 'y' }] as never[]
    const overrides = new Map()
    const along = [0, 10]
    computeSectionFillActive(COLUMNS, edges, overrides, along)
    expect(computeSectionFill).toHaveBeenCalledWith(COLUMNS, edges, overrides, along)
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
    // env + pref unset → v1. v1 has no override-rejection model → status is always ``unsupported``.
    const { regions, conflicts, overrideStatus } = computeSectionFillActiveWithDiagnostics(COLUMNS)
    expect(computeSectionFill).toHaveBeenCalledTimes(1)
    expect(classifyOverrideOutcome).not.toHaveBeenCalled()
    expect(regions).toBe(V1_SENTINEL)
    expect(conflicts).toEqual([])
    expect(overrideStatus).toBe('unsupported')
  })
})

describe('flag resolution without a DOM (no localStorage) does not throw', () => {
  it('degrades to v1 when localStorage is unavailable', () => {
    const orig = globalThis.localStorage
    // Simulate a worker / node-without-jsdom context: no localStorage global.
    // Deleting the property makes ``typeof localStorage === 'undefined'``.
    // @ts-expect-error — intentionally removing the global for this case
    delete globalThis.localStorage
    delete process.env.STRIX_PARTITION_V2
    try {
      expect(() => isPartitionEngineV2Active()).not.toThrow()
      expect(isPartitionEngineV2Active()).toBe(false)
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
