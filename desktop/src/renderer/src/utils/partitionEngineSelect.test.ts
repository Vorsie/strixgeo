import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock BOTH engines so the selector's delegation is observable without running
// any real geometry. Each mock returns a sentinel array we can identify.
const V1_SENTINEL = [{ engine: 'v1' }] as unknown
const V2_SENTINEL = [{ engine: 'v2' }] as unknown

vi.mock('./partitionFill', () => ({
  computeSectionFill: vi.fn(() => V1_SENTINEL),
}))
vi.mock('./partitionFillV2', () => ({
  computeSectionFillV2: vi.fn(() => V2_SENTINEL),
}))

import { computeSectionFill } from './partitionFill'
import { computeSectionFillV2 } from './partitionFillV2'
import {
  computeSectionFillActive,
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
