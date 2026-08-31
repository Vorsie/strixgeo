/**
 * partitionFillV2.edgedLayers.test.ts — behavioural spec for the PER-GAP edged-layer
 * helper (design partition-engine-v2.md §4 FINAL SHAPES fix-path row; the lens-edged
 * conformance class, doc §4 residual (b)).
 *
 * The rule, in the owner's terms: a unit tied by an edge in the ADJACENT gap is NOT
 * "edged here" for the purpose of terminating in THIS gap — it must still lens/onlap here.
 * The section-wide set (today's ``buildSectionInput``) cannot tell the two apart; this
 * helper can. These cases pin that distinction directly.
 */
import { describe, expect, it } from 'vitest'

import { type CorrelationEdge } from './sectionPartition'
import { buildEdgedLayers } from './partitionFillV2/edgedLayers'
import { type ColumnGeom, type UnitGeom } from './partitionFillV2/sectionGeom'

function unit(layerId: string, formationId: string, topElev: number, baseElev: number): UnitGeom {
  return { layerId, formationId, bodyId: null, topElev, baseElev }
}

function col(id: string, x: number, units: UnitGeom[]): ColumnGeom {
  return { investigationId: id, x, surfaceElevM: 10, units, enclosedLenses: [] }
}

describe('buildEdgedLayers — per-gap edged membership', () => {
  // Three columns → two gaps (gap 0 = c0↔c1, gap 1 = c1↔c2). A unit on the MIDDLE column
  // is edged in gap 0 but must be free to terminate in gap 1 (and vice versa).
  const c0 = col('c0', 0, [unit('a0', 'SILT', 10, 8)])
  const c1 = col('c1', 100, [unit('b0', 'SILT', 10, 8), unit('b1', 'ZAND', 8, 6)])
  const c2 = col('c2', 200, [unit('d0', 'SILT', 10, 8)])
  const columns = [c0, c1, c2]

  it('a layerId edged only in gap 0 is NOT edged in gap 1', () => {
    // b0 (SILT on the middle column) is tied to a0 across gap 0.
    const edges: CorrelationEdge[] = [{ a: 'a0', b: 'b0', aSide: 'top', bSide: 'top' }]
    const el = buildEdgedLayers(columns, edges)
    expect(el.inGap('b0', 0)).toBe(true) // edged in the gap the edge resolves to
    expect(el.inGap('b0', 1)).toBe(false) // free to terminate in the adjacent gap
    expect(el.sectionWide.has('b0')).toBe(true) // the coarse set still contains it
  })

  it('a layerId edged only in gap 1 is NOT edged in gap 0', () => {
    const edges: CorrelationEdge[] = [{ a: 'b0', b: 'd0', aSide: 'top', bSide: 'top' }]
    const el = buildEdgedLayers(columns, edges)
    expect(el.inGap('b0', 1)).toBe(true)
    expect(el.inGap('b0', 0)).toBe(false)
  })

  it('a layerId edged in BOTH adjacent gaps is edged in both', () => {
    const edges: CorrelationEdge[] = [
      { a: 'a0', b: 'b0', aSide: 'top', bSide: 'top' },
      { a: 'b0', b: 'd0', aSide: 'top', bSide: 'top' },
    ]
    const el = buildEdgedLayers(columns, edges)
    expect(el.inGap('b0', 0)).toBe(true)
    expect(el.inGap('b0', 1)).toBe(true)
  })

  it('a NON-adjacent (jump) edge belongs to no gap (it becomes a substrate bridge)', () => {
    // a0 (c0) ↔ d0 (c2) skips the middle column — not a per-gap tie.
    const edges: CorrelationEdge[] = [{ a: 'a0', b: 'd0', aSide: 'top', bSide: 'top' }]
    const el = buildEdgedLayers(columns, edges)
    expect(el.inGap('a0', 0)).toBe(false)
    expect(el.inGap('d0', 1)).toBe(false)
    expect(el.sectionWide.has('a0')).toBe(true) // still in the coarse set
    expect(el.sectionWide.has('d0')).toBe(true)
  })

  it('an unknown layerId is edged nowhere', () => {
    const el = buildEdgedLayers(columns, [])
    expect(el.inGap('nope', 0)).toBe(false)
    expect(el.sectionWide.size).toBe(0)
  })
})
