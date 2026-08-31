/**
 * partitionFillV2.coincidentColumns.test.ts — a paired CPT + borehole standing at the
 * SAME map coordinates must still fill the strip between their two columns.
 *
 * Owner's rule, in his words: "a CPT and a borehole drilled at the same spot are two
 * columns on the section — the ribbon between them has to paint like any other gap.
 * It must never come out as an empty white strip."
 *
 * The columns are drawn at their nudged screen positions, so the gap is visibly wide
 * even when the two investigations project onto the same along-section metre. The
 * partition output is per-gap FRACTION space, so the real width of that gap never
 * appears in the output — a zero-metre gap is still a full 0..1 fraction strip.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './partitionFillV2/computeSectionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { type CorrelationEdge, type PartitionColumn } from './sectionPartition'

const CLAY = 'clay'
const SAND = 'sand'

function col(id: string, units: { top: number; base: number; f: string; layerId: string }[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: 10,
    units: units.map(u => ({
      topDepthM: u.top,
      baseDepthM: u.base,
      formationId: u.f,
      layerId: u.layerId,
      bodyId: null,
    })),
  }
}

/** A CPT and a borehole with the same three-unit stack, tied on every contact. */
function pairedStation(): { columns: PartitionColumn[]; edges: CorrelationEdge[] } {
  const left = col('CPT-1', [
    { top: 0, base: 2, f: CLAY, layerId: 'lc' },
    { top: 2, base: 5, f: SAND, layerId: 'ls' },
    { top: 5, base: 8, f: CLAY, layerId: 'lb' },
  ])
  const right = col('BH-1', [
    { top: 0, base: 2, f: CLAY, layerId: 'rc' },
    { top: 2, base: 5, f: SAND, layerId: 'rs' },
    { top: 5, base: 8, f: CLAY, layerId: 'rb' },
  ])
  const edges: CorrelationEdge[] = [
    { a: 'ls', b: 'rs', aSide: 'top', bSide: 'top' },
    { a: 'ls', b: 'rs', aSide: 'base', bSide: 'base' },
    { a: 'lc', b: 'rc', aSide: 'base', bSide: 'base' },
    { a: 'lb', b: 'rb', aSide: 'top', bSide: 'top' },
  ]
  return { columns: [left, right], edges }
}

afterEach(() => {
  setTwoSidedTerminations(false)
})

describe.each([
  ['sweep off', false],
  ['sweep on', true],
])('coincident columns (%s)', (_label, sweep) => {
  it('two investigations at the SAME along-metre still paint the gap between them', () => {
    setTwoSidedTerminations(sweep)
    const { columns, edges } = pairedStation()
    // Both at along 41.5 m — a CPT and a borehole logged at one DOV location.
    const regions = computeSectionFillV2(columns, edges, undefined, [41.5, 41.5])
    expect(regions.length).toBeGreaterThan(0)
    expect(regions.every(r => r.gapIndex === 0)).toBe(true)
  })

  it('a coincident pair fills the gap the same way a spaced pair does', () => {
    setTwoSidedTerminations(sweep)
    const { columns, edges } = pairedStation()
    const spaced = computeSectionFillV2(columns, edges, undefined, [41.5, 91.5])
    const coincident = computeSectionFillV2(columns, edges, undefined, [41.5, 41.5])
    // Same formations painted, same number of pieces — the gap's real width is
    // normalised away by fraction space, so nothing about the fill may depend on it.
    expect(coincident.map(r => r.formationId).sort()).toEqual(
      spaced.map(r => r.formationId).sort(),
    )
  })

  it('a third column beyond a coincident pair keeps its own gap', () => {
    setTwoSidedTerminations(sweep)
    const { columns, edges } = pairedStation()
    const far = col('CPT-2', [
      { top: 0, base: 2, f: CLAY, layerId: 'fc' },
      { top: 2, base: 5, f: SAND, layerId: 'fs' },
      { top: 5, base: 8, f: CLAY, layerId: 'fb' },
    ])
    const allEdges: CorrelationEdge[] = [
      ...edges,
      { a: 'rs', b: 'fs', aSide: 'top', bSide: 'top' },
      { a: 'rs', b: 'fs', aSide: 'base', bSide: 'base' },
      { a: 'rc', b: 'fc', aSide: 'base', bSide: 'base' },
      { a: 'rb', b: 'fb', aSide: 'top', bSide: 'top' },
    ]
    const regions = computeSectionFillV2([...columns, far], allEdges, undefined, [
      41.5, 41.5, 120,
    ])
    expect(regions.some(r => r.gapIndex === 0)).toBe(true)
    expect(regions.some(r => r.gapIndex === 1)).toBe(true)
  })
})
