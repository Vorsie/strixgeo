// desktop/src/renderer/src/utils/partitionFillV2/baseFillCache.test.ts
//
// The ghost-handle probe calls classifyOverrideOutcome once per grab handle — 70 times
// on the owner's CS1 — each with a DIFFERENT single override but the SAME columns,
// edges and alongM. Every one of those calls recomputed the identical no-override base
// pass, exactly doubling the probe's cost (70 x 18 ms = 1.26 s on CS1).
//
// The base pass is now memoised on the identity of its inputs. The risk that buys is a
// STALE base, not a slow one, so these cases pin that the cache never answers for
// inputs it was not built from.
import { describe, expect, it } from 'vitest'
import { classifyOverrideOutcome } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'
import type { CorrelationEdge, LensApexOverride, PartitionColumn } from '../sectionPartition'

/** A two-column section whose single unit spans the given depths. */
function columnsOf(baseDepth: number): PartitionColumn[] {
  const units = [
    { layerId: 'u1', formationId: 'ZAND', bodyId: 'z', topDepthM: 0, baseDepthM: baseDepth },
  ]
  return [
    { investigationId: 'A', surfaceElevM: 10, units },
    { investigationId: 'B', surfaceElevM: 10, units },
  ] as unknown as PartitionColumn[]
}

const EDGES: CorrelationEdge[] = []
const OVERRIDE = new Map<string, LensApexOverride>([['z|0', { fraction: 0.6, elevation: 5 }]])

describe('the no-override base pass is memoised without going stale', () => {
  it('gives the same answer for the same inputs', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      const cols = columnsOf(6)
      const first = classifyOverrideOutcome(cols, EDGES, OVERRIDE, [0, 100])
      const second = classifyOverrideOutcome(cols, EDGES, OVERRIDE, [0, 100])

      expect(JSON.stringify(second.regions)).toBe(JSON.stringify(first.regions))
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('does not answer for a DIFFERENT section from the cached one', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      const shallow = columnsOf(4)
      const deep = columnsOf(9)

      const a = classifyOverrideOutcome(shallow, EDGES, OVERRIDE, [0, 100])
      const b = classifyOverrideOutcome(deep, EDGES, OVERRIDE, [0, 100])
      const aAgain = classifyOverrideOutcome(shallow, EDGES, OVERRIDE, [0, 100])

      // The deep section must not be served the shallow one's base, and coming back to
      // the shallow one must reproduce its own first answer.
      expect(JSON.stringify(b.regions)).not.toBe(JSON.stringify(a.regions))
      expect(JSON.stringify(aAgain.regions)).toBe(JSON.stringify(a.regions))
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('does not answer across a flip of the engine flag', () => {
    const cols = columnsOf(6)

    const prev = setTwoSidedTerminations(true)
    let on: string
    try {
      on = JSON.stringify(classifyOverrideOutcome(cols, EDGES, OVERRIDE, [0, 100]).regions)
    } finally {
      setTwoSidedTerminations(prev)
    }

    const prevOff = setTwoSidedTerminations(false)
    let off: string
    try {
      off = JSON.stringify(classifyOverrideOutcome(cols, EDGES, OVERRIDE, [0, 100]).regions)
    } finally {
      setTwoSidedTerminations(prevOff)
    }

    const prevOn = setTwoSidedTerminations(true)
    try {
      // Back on the flag it started with, the first answer must return — proving the
      // flag-off run neither poisoned the cache nor was served from it.
      expect(JSON.stringify(classifyOverrideOutcome(cols, EDGES, OVERRIDE, [0, 100]).regions)).toBe(on)
      expect(off).not.toBe(undefined)
    } finally {
      setTwoSidedTerminations(prevOn)
    }
  })
})
