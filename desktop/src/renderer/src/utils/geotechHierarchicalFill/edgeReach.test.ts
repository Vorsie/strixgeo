/**
 * ER1-ER7 — the clamped-edge tripwire.
 *
 * The rule in the words that motivate it: a gap that emits fill must be
 * READABLE at the two column edges the 3-D build samples. Wherever the litho
 * cover holds ground at the backend's clamped edge fraction and the classed
 * fill holds none, the build reads that section as empty there and silently
 * falls back to extruding its neighbour alone.
 *
 * The carve-outs matter as much as the rule (debt #259): a region that
 * GENUINELY ends mid-gap — a lens pinching out — must never be dragged to the
 * column, and a shortfall inside the snap grid is a rounding artefact the
 * backend's own 2 mm inset already clears.
 */
import { describe, expect, it } from 'vitest'

import { clampedEdgeFractions, edgeReachViolations } from './edgeReach'
import { computeHierarchicalGeotechFill } from './index'
import { column, tie } from './scene.test-helpers'
import { computeSectionFillActive } from '../partitionEngineSelect'
import type { SectionRegion } from '../sectionPartition'

/** A rectangle over [f0, f1] × [base, top] on one gap. */
function box(
  gapIndex: number,
  f0: number,
  f1: number,
  base: number,
  top: number,
  formationId = 'F',
): SectionRegion {
  return {
    formationId,
    bodyId: null,
    gapIndex,
    kind: 'quad',
    polygon: [
      { fraction: f0, elevation: top },
      { fraction: f1, elevation: top },
      { fraction: f1, elevation: base },
      { fraction: f0, elevation: base },
    ],
  } as SectionRegion
}

/** A triangle pinching out to an apex at ``apexF`` — the #259 lens. */
function wedge(gapIndex: number, apexF: number, base: number, top: number): SectionRegion {
  return {
    formationId: 'LENS',
    bodyId: null,
    gapIndex,
    kind: 'lens',
    polygon: [
      { fraction: 0, elevation: top },
      { fraction: apexF, elevation: (top + base) / 2 },
      { fraction: 0, elevation: base },
    ],
  } as SectionRegion
}

/** A 100 m gap: the clamped edges sit at fraction 2e-5 and 1 - 2e-5. */
const ALONG_100M = [0, 100]

describe('clampedEdgeFractions', () => {
  it('ER1 mirrors the backend inset — two snap cells in the gap own fraction space', () => {
    // 2 cells x 1 mm over 100 m of gap.
    expect(clampedEdgeFractions(100)).toEqual([2e-5, 1 - 2e-5])
  })

  it('ER2 never reaches the midpoint, however degenerate the gap', () => {
    const [lo, hi] = clampedEdgeFractions(0.001)
    expect(lo).toBeLessThan(0.5)
    expect(hi).toBeGreaterThan(0.5)
    expect(lo).toBeLessThan(hi)
  })
})

describe('edgeReachViolations', () => {
  it('ER3 a fill that spans its gap edge to edge is silent', () => {
    const cover = [box(0, 0, 1, -10, 0, 'COVER')]
    const fill = [box(0, 0, 1, -10, 0)]
    expect(edgeReachViolations(fill, cover, ALONG_100M)).toEqual([])
  })

  it('ER4 a fill stopping 25 mm short of the far column is named, with the edge', () => {
    // 25 mm on a 100 m gap = fraction 2.5e-4, twelve times the 2e-5 inset.
    const cover = [box(0, 0, 1, -10, 0, 'COVER')]
    const fill = [box(0, 0, 1 - 2.5e-4, -10, 0)]
    const out = edgeReachViolations(fill, cover, ALONG_100M)
    expect(out).toHaveLength(1)
    expect(out[0].gapIndex).toBe(0)
    expect(out[0].edge).toBe(1)
    expect(out[0].coverM).toBeCloseTo(10, 6)
    expect(out[0].filledM).toBe(0)
  })

  it('ER5 the near column is watched too', () => {
    const cover = [box(0, 0, 1, -10, 0, 'COVER')]
    const fill = [box(0, 2.5e-4, 1, -10, 0)]
    const out = edgeReachViolations(fill, cover, ALONG_100M)
    expect(out).toHaveLength(1)
    expect(out[0].edge).toBe(0)
  })

  it('ER6 a shortfall inside the snap grid is NOT a defect — the 2 mm inset clears it', () => {
    // 0.7 mm — the worst real shortfall measured over all 69 gaps of the
    // owner's model, and pure 1 mm snap quantisation.
    const cover = [box(0, 0, 1, -10, 0, 'COVER')]
    const fill = [box(0, 0, 1 - 7e-6, -10, 0)]
    expect(edgeReachViolations(fill, cover, ALONG_100M)).toEqual([])
  })

  it('ER7 a lens that genuinely pinches out mid-gap is not dragged to the column (#259)', () => {
    // The wedge stops at fraction 0.45 on purpose. Its gap still reaches both
    // edges through the matrix around it, so nothing is wrong here.
    const cover = [box(0, 0, 1, -10, 0, 'COVER')]
    const fill = [box(0, 0, 1, -10, 0), wedge(0, 0.45, -6, -4)]
    expect(edgeReachViolations(fill, cover, ALONG_100M)).toEqual([])
  })

  it('ER8 a gap whose COVER itself stops short is not flagged for following it', () => {
    const cover = [box(0, 0, 0.9, -10, 0, 'COVER')]
    const fill = [box(0, 0, 0.9, -10, 0)]
    expect(edgeReachViolations(fill, cover, ALONG_100M)).toEqual([])
  })

  it('ER9 a gap the fill never classed at all is blank, not short', () => {
    // An un-divided column blanks its two gaps by ruling (2026-08-15). The
    // totality tripwire scopes that out and so does this one.
    const cover = [box(0, 0, 1, -10, 0, 'COVER')]
    expect(edgeReachViolations([], cover, ALONG_100M)).toEqual([])
  })
})

describe('the engine itself reaches its column edges', () => {
  it('ER10 a banded two-column scene reports no clamped-edge violation', () => {
    // Sand over clay on both tests, both contacts tied — the plainest scene
    // the law bands straight across. Its fill must be readable AT the columns,
    // which is what the 3-D build asks it for.
    const lithoColumns = [
      column('A', 10, [
        { layerId: 'aSand', formationId: 'SAND', top: 0, base: 6 },
        { layerId: 'aClay', formationId: 'CLAY', top: 6, base: 14 },
      ]),
      column('B', 9, [
        { layerId: 'bSand', formationId: 'SAND', top: 0, base: 5 },
        { layerId: 'bClay', formationId: 'CLAY', top: 5, base: 13 },
      ]),
    ]
    const geotechColumns = [
      column('A', 10, [
        { layerId: 'aN5', formationId: 'N5', top: 0, base: 6 },
        { layerId: 'aN21', formationId: 'N21', top: 6, base: 14 },
      ]),
      column('B', 9, [
        { layerId: 'bN5', formationId: 'N5', top: 0, base: 5 },
        { layerId: 'bN21', formationId: 'N21', top: 5, base: 13 },
      ]),
    ]
    const lithoEdges = [tie('aSand', 'bSand'), tie('aClay', 'bClay')]
    const alongM = [0, 100]
    const out = computeHierarchicalGeotechFill({
      lithoColumns,
      lithoEdges,
      lithoRegions: computeSectionFillActive(lithoColumns, lithoEdges, undefined, alongM),
      geotechColumns,
      geotechEdges: [tie('aN5', 'bN5'), tie('aN21', 'bN21')],
      alongM,
    })
    expect(out.regions.length).toBeGreaterThan(0)
    expect(out.diagnostics.edgeReachViolations).toEqual([])
  })
})
