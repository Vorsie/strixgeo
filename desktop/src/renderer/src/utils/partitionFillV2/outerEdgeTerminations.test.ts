/**
 * outerEdgeTerminations.test.ts — the OUTER-column termination rule (owner 2026-09-07).
 *
 * "the basal clay on 20/034-S5 emits a lens to the left; it is a test on the utter left side,
 * it should band left, like all the other columns." Every unit on an outermost column bands to
 * the section edge, whatever its tie count on the inner side — so ``outerColumnZeroTieLayerIds``
 * (the set the overlay's open-end stub pinches) is always EMPTY. This REVERSES, at the outer
 * edge only, the earlier "zero ties = lens" pinch (owner 2026-09-04); interior zero-tie lenses
 * between two columns are unchanged.
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

describe('outerColumnZeroTieLayerIds — the outermost column bands to the edge', () => {
  it('a zero-tie basal clay on an outer column is NOT pinched — it bands to the edge', () => {
    // Two columns, a top SAND over a bottom CLAY with no correlation anywhere. The bottom clay is
    // zero-tie on its inner side, but it lives on an OUTERMOST column → it bands to the section
    // edge (owner 2026-09-07), never a lens.
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
    expect([...zero], 'every outer-column unit bands — nothing pinches').toEqual([])
  })

  it('a banded outer unit is also not pinched (unchanged)', () => {
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
    expect([...zero]).toEqual([])
  })
})
