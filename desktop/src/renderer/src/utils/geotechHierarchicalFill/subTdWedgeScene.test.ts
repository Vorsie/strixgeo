/**
 * HIS CROSS-SECTION 1, GAP 14 — the whole fill, end to end.
 *
 * Owner, 2026-08-28, pointing at the triangle under his dense sand:
 *
 *   *"i don't want the VD sand to spill below that bottom tie"*
 *   *"why isn't the closest test on section used? it even has a top and bottom
 *    tie that unit to the left, so that should be a vertical termination in the
 *    middle"*
 *
 * The scene is his four tests, at their real spacing and their real elevations:
 *
 *  * **S9** — one column BEHIND the gap. Very dense sand -1.17..-4.67, then
 *    medium dense to -5.27.
 *  * **S8** — the gap's left test. Very dense -1.18..-3.68, DENSE -3.68..-4.45,
 *    silt below.
 *  * **S10** — the gap's right test. It STOPS at -3.24: that is its total
 *    depth, and it has no reading of its own at the wedge's levels.
 *  * **B2** — one column beyond, medium dense sand -3.23..-4.45.
 *
 * and his two manual ties: S10's base to S8's dense-sand top (which is what
 * makes the dense sand a one-tie onlap that pinches at the middle), and, one
 * gap back, S9's very-dense base to S8's very-dense base.
 *
 * The ladder pins for the same case are in
 * ``constructive/remainderSubTdWedge.test.ts``; these three are what he can see
 * on screen.
 */
import { describe, expect, it } from 'vitest'

import { computeHierarchicalGeotechFill } from './index'
import { column, inRegion, paintAt, tie } from './scene.test-helpers'
import type { PartitionColumn, SectionRegion } from '../sectionPartition'
import { computeSectionFillActive } from '../partitionEngineSelect'

const CLAY = 'litho-clay'
const SAND = 'litho-sand'
const SILT = 'litho-silt'
/** NAD 8 — his *"very dense"*. */
const VD = 'ZAND|8'
/** NAD 7 — his *"dense body"*. */
const D = 'ZAND|7'
/** NAD 6 — medium dense. */
const MD = 'ZAND|6'

/** Along-section metres, his own spacing: S9, S8, S10, B2. */
const ALONG = [537.7, 569.6, 574.9, 577.8]
/** The gap he is looking at — S8 to S10. */
const GAP = 1
/** The gap's own two column positions and the vertical between them. */
const MIDDLE_FRACTION = ((ALONG[1] + ALONG[2]) / 2 - ALONG[1]) / (ALONG[2] - ALONG[1])

/** Every column has a flat collar at 0 mTAW, so depth reads as -elevation. */
const LITHO: PartitionColumn[] = [
  column('S9', 0, [
    { layerId: 'L9-clay', formationId: CLAY, top: 0, base: 1.17 },
    { layerId: 'L9-sand', formationId: SAND, top: 1.17, base: 5.27 },
    { layerId: 'L9-silt', formationId: SILT, top: 5.27, base: 11 },
  ]),
  column('S8', 0, [
    { layerId: 'L8-clay', formationId: CLAY, top: 0, base: 1.18 },
    { layerId: 'L8-sand', formationId: SAND, top: 1.18, base: 4.45 },
    { layerId: 'L8-silt', formationId: SILT, top: 4.45, base: 11 },
  ]),
  column('S10', 0, [
    { layerId: 'L10-clay', formationId: CLAY, top: 0, base: 1.17 },
    { layerId: 'L10-sand', formationId: SAND, top: 1.17, base: 4.52 },
    { layerId: 'L10-silt', formationId: SILT, top: 4.52, base: 11 },
  ]),
  column('B2', 0, [
    { layerId: 'LB-clay', formationId: CLAY, top: 0, base: 1.17 },
    { layerId: 'LB-sand', formationId: SAND, top: 1.17, base: 4.45 },
    { layerId: 'LB-silt', formationId: SILT, top: 4.45, base: 11 },
  ]),
]
const LITHO_EDGES = [
  tie('L9-sand', 'L8-sand'),
  tie('L8-sand', 'L10-sand'),
  tie('L10-sand', 'LB-sand'),
  tie('L9-silt', 'L8-silt'),
  tie('L8-silt', 'L10-silt'),
  tie('L10-silt', 'LB-silt'),
]

/**
 * The packing bands. S10 carries NOTHING below -3.24 — its total depth — while
 * its litho sand runs on to -4.52, which is the situation his ruling is about.
 */
const GEOTECH: PartitionColumn[] = [
  column('S9', 0, [
    { layerId: 'G9-vd', formationId: VD, top: 1.17, base: 4.67 },
    { layerId: 'G9-md', formationId: MD, top: 4.67, base: 5.27 },
  ]),
  column('S8', 0, [
    { layerId: 'G8-vd', formationId: VD, top: 1.18, base: 3.68 },
    { layerId: 'G8-d', formationId: D, top: 3.68, base: 4.45 },
  ]),
  column('S10', 0, [{ layerId: 'G10-vd', formationId: VD, top: 1.17, base: 3.24 }]),
  column('B2', 0, [{ layerId: 'GB-md', formationId: MD, top: 3.23, base: 4.45 }]),
]
const GEOTECH_EDGES = [
  // His two manual ties across the gap he is looking at.
  tie('G8-vd', 'G10-vd'),
  tie('G10-vd', 'G8-d', 'base', 'top'),
  // His two manual ties one gap back — the second is the one the painted very
  // dense sand contradicted.
  tie('G8-vd', 'G9-vd'),
  tie('G8-d', 'G9-md'),
  // The automatic tie out to B2.
  tie('G10-vd', 'GB-md', 'base', 'top'),
]

/** His tie, at a fraction of the gap: -3.68 at S8 rising to -3.24 at S10. */
const tieElevAtFraction = (f: number): number => -3.68 + f * (-3.24 - -3.68)

/** Run the whole fill on the scene. */
function fill(): ReturnType<typeof computeHierarchicalGeotechFill> {
  const lithoRegions = computeSectionFillActive(LITHO, LITHO_EDGES, undefined, ALONG)
  return computeHierarchicalGeotechFill({
    lithoColumns: LITHO,
    lithoEdges: LITHO_EDGES,
    lithoRegions,
    geotechColumns: GEOTECH,
    geotechEdges: GEOTECH_EDGES,
    alongM: ALONG,
  })
}

describe('CS1 gap 14 — the wedge under the dense sand that pinches at the middle', () => {
  it('VD1 — no very dense sand anywhere below the base he tied it on', () => {
    const out = fill()
    // Sweep the gap at the elevation the defect painted (-4.13), which lies
    // below his tie everywhere across the gap and above the sand cover's own
    // floor everywhere across it.
    for (let i = 1; i < 50; i++) {
      const f = i / 50
      expect(tieElevAtFraction(f), `f=${f} must be below his tie`).toBeGreaterThan(-4.13)
      const painted = paintAt(out.regions, GAP, f, -4.13)
      expect(painted?.formationId, `f=${f} reads very dense below his tie`).not.toBe(VD)
    }
  })

  it('VD2 — the wedge is the near test own dense sand, ending vertically at the middle', () => {
    const out = fill()
    expect(paintAt(out.regions, GAP, 0.25, -4.13)?.formationId).toBe(D)
    // WHOSE ground it is, on the surface where that is decided. Each loop is
    // decided once, before the weld, and this one must go to GEO-23/125-S8's
    // OWN dense sand — the nearest test on the section, not a test behind it.
    const wedge = out.preMergeRegions.find(
      (r) => r.gapIndex === GAP && inRegion(0.25, -4.13, r),
    ) as SectionRegion
    expect(wedge?.layerIds).toEqual(['G8-d'])
    // ...and it stops at the middle: its far edge is the vertical line, which
    // is his *"vertical termination in the middle"*.
    const far = Math.max(...wedge.polygon.map((p) => p.fraction))
    expect(far, 'the dense sand was decided past the middle').toBeCloseTo(MIDDLE_FRACTION, 3)
    const atFar = wedge.polygon
      .filter((p) => Math.abs(p.fraction - far) < 1e-6)
      .map((p) => p.elevation)
    expect(atFar.length, 'its far edge is not a vertical line').toBeGreaterThanOrEqual(2)
    expect(Math.max(...atFar) - Math.min(...atFar), 'its far edge has no height').toBeGreaterThan(
      0.5,
    )
    // WHY THE MERGED REGION IS WIDER THAN THE WEDGE ON THIS SCENE, and only on
    // this scene. On his own CS1 the facing half of that strip is
    // 1411-GEO-23/126-B2's MEDIUM DENSE sand, so the dense sand really does end
    // at the seam on screen; four columns are not enough to give B2's band a
    // second tied contact, so here it closes in its own gap and cannot answer
    // this one. The leftover rule of 2026-08-26 then fills the facing half with
    // the least dense of the masses bounding it, which on this scene is the
    // dense sand itself, and the weld joins two decisions that agree. Which
    // half belongs to whom is what this pin is about, and that is unchanged.
  })

  it('VD3 — no sand in the gap is left asking to be correlated', () => {
    const out = fill()
    // The clay above and the silt below carry no packing bands at all on this
    // scene, so their bare cover is the honest answer and is not the question.
    // The SAND cover is the ground his ruling is about, and none of it may be
    // left over.
    const bare = out.lithoFallback.filter((r) => r.gapIndex === GAP && r.formationId === SAND)
    expect(bare).toEqual([])
    expect(out.diagnostics.totalityViolations).toEqual([])
  })
})
