/**
 * outerEdgeTerminations.test.ts — the OUTER-column zero-tie classifier (owner 2026-09-04).
 *
 * "zero ties = lens": a unit on the section's outer column with zero ties pinches out
 * toward the edge as a lens, never as an open band to the boundary. This gate pins the
 * ENGINE half of that ruling — which outer-column units the overlay's open-end stub must
 * pinch — by asserting ``outerColumnZeroTieLayerIds`` reports exactly the corr-0 units and
 * NOT the correlated / top-band ones on the same outer column.
 *
 * Flag-ON path (``setTwoSidedTerminations(true)``, restored in ``finally``).
 */
import { afterEach, describe, expect, it } from 'vitest'

import { outerColumnZeroTieLayerIds } from './outerEdgeTerminations'
import { setTwoSidedTerminations } from './tileFlags'
import type { CorrelationEdge, PartitionColumn } from '../sectionPartition'

const SAND = 'fSand'
const CLAY = 'fClay'

function col(
  id: string,
  surface: number,
  units: { top: number; base: number; f: string; layerId: string }[],
): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({
      topDepthM: u.top,
      baseDepthM: u.base,
      formationId: u.f,
      layerId: u.layerId,
      bodyId: null,
    })),
  }
}

function withFlip<T>(fn: () => T): T {
  const prev = setTwoSidedTerminations(true)
  try {
    return fn()
  } finally {
    setTwoSidedTerminations(prev)
  }
}

afterEach(() => setTwoSidedTerminations(false))

describe('outerColumnZeroTieLayerIds — the zero-tie rule at the section edge', () => {
  it('reports the outer-column zero-tie unit and NOT the correlated / top-band unit on the same column', () => {
    // Two columns. Each carries a top SAND (a first unit, top-band tied → corr 1) and a
    // bottom CLAY with no correlation on either side (corr 0). The CLAY is the "open end"
    // the owner objected to; the SAND keeps extending to the boundary.
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 5, f: SAND, layerId: 'a1' },
        { top: 5, base: 10, f: CLAY, layerId: 'a2' },
      ]),
      col('R', 10, [
        { top: 0, base: 6, f: SAND, layerId: 'b1' },
        { top: 6, base: 10, f: CLAY, layerId: 'b2' },
      ]),
    ]
    const zero = withFlip(() => outerColumnZeroTieLayerIds(columns, [], [0, 100]))

    // Both outer columns' bottom clays are zero-tie → pinch out as a lens.
    expect(zero.has('a2'), 'first column bottom clay is zero-tie').toBe(true)
    expect(zero.has('b2'), 'last column bottom clay is zero-tie').toBe(true)
    // The top sand is top-band tied (corr 1) → NOT a lens; it keeps reaching the boundary.
    expect(zero.has('a1'), 'first column top sand has a tie (top band)').toBe(false)
    expect(zero.has('b1'), 'last column top sand has a tie (top band)').toBe(false)
  })

  it('a unit correlated to the next column is NOT reported (it bands, keeps extending)', () => {
    // Tie the two bottom clays base-to-base AND top-to-top → a full band (corr 2). A banded
    // outer unit keeps its flat extension; it must not be flagged for a pinch.
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 5, f: SAND, layerId: 'a1' },
        { top: 5, base: 10, f: CLAY, layerId: 'a2' },
      ]),
      col('R', 10, [
        { top: 0, base: 5, f: SAND, layerId: 'b1' },
        { top: 5, base: 10, f: CLAY, layerId: 'b2' },
      ]),
    ]
    const edges: CorrelationEdge[] = [
      { a: 'a2', b: 'b2', aSide: 'top', bSide: 'top' },
      { a: 'a2', b: 'b2', aSide: 'base', bSide: 'base' },
    ]
    const zero = withFlip(() => outerColumnZeroTieLayerIds(columns, edges, [0, 100]))
    expect(zero.has('a2'), 'a banded clay is not a zero-tie lens').toBe(false)
    expect(zero.has('b2'), 'a banded clay is not a zero-tie lens').toBe(false)
  })
})
