/**
 * NO ISLANDS — *"that weird lens quad has no provenance, it isn't in the litho,
 * it isn't in the geotech model yet suddenly a lighter triangle appeared"*
 * (owner dogfeed 2026-08-25, Cross-section 3, gap 7) and, on the same shape,
 * *"it should all be one dense sand body? fill merge should have filled that
 * and merged that weird constructor line?"*
 *
 * The rule his two sentences state, and what this file pins:
 *
 *  * **a pocket enclosed by one mass's own ground belongs to that mass.** A
 *    loop whose whole neighbourhood inside the cover is one other class, and
 *    which touches neither of the gap's own columns, is that class's ground —
 *    not a body of its own.
 *  * **a face may never be an ISLAND detached from its winning band's own
 *    ground.** A band answers ground it can be reached from: its own column
 *    face, or a same-mass face contiguous with it. Ground it cannot reach is
 *    not its.
 *
 * ...AND WHAT THAT MUST NOT COST: the SF-silt fill-through (ruled 2026-08-21,
 * pinned as BC5 in ``bothPackagesClosed.test.ts``). An open mass filling
 * through past the middle is CONTIGUOUS FROM ITS OWN COLUMN — that contiguity
 * is exactly what tells it from an island, and the control below states the
 * distinction in those terms rather than trusting the two pins not to collide.
 *
 * @module utils/geotechHierarchicalFill/constructive/pocketIsland
 */
import { describe, expect, it } from 'vitest'

import { computeHierarchicalGeotechFill } from '../index'
import { column, paintAt, tie } from '../scene.test-helpers'
import { computeSectionFillActive } from '../../partitionEngineSelect'
import type { PartitionColumn, SectionRegion } from '../../sectionPartition'

const SAND = 'litho-sand'
const CLAY = 'litho-clay'
const DENSE = 'nad-dense'
const MEDIUM = 'nad-medium'
const CLAY_SOFT = 'nad-soft'

/**
 * THE SCENE. Three tests, and the middle one is blind to the pocket's levels.
 *
 * A (x=0) and C (x=110) both read sand over the whole window; B (x=10) reads
 * clay down to -4 and sand only below it, so B has no sand-family band at
 * -1..-3 at all. A's MEDIUM band there is therefore carried ACROSS B into the
 * B→C gap (``bandContinuation.ts``) and pinches toward C — the one real
 * termination in its direction.
 *
 * The sand cover's own top in that gap runs from -4 at B up to +10 at C, so it
 * CUTS the carried band's pinch off from the gap's left edge: what is left of
 * it inside the cover touches neither column. That is the owner's triangle,
 * built from the same three ingredients (a carried band, a distant apex, a
 * litho cover boundary across it).
 */
function scene(): {
  regions: SectionRegion[]
  gap: number
} {
  const lithoColumns: PartitionColumn[] = [
    column('A', 10, [{ layerId: 'LA', formationId: SAND, top: 0, base: 20 }]),
    column('B', 10, [
      { layerId: 'LB-clay', formationId: CLAY, top: 0, base: 13 },
      { layerId: 'LB-sand', formationId: SAND, top: 13, base: 20 },
    ]),
    column('C', 10, [{ layerId: 'LC', formationId: SAND, top: 0, base: 20 }]),
  ]
  const lithoEdges = [tie('LA', 'LB-sand'), tie('LB-sand', 'LC')]
  const geotechColumns: PartitionColumn[] = [
    column('A', 10, [
      { layerId: 'GA-d1', formationId: DENSE, top: 0, base: 11 },
      { layerId: 'GA-m', formationId: MEDIUM, top: 11, base: 13 },
      { layerId: 'GA-d2', formationId: DENSE, top: 13, base: 20 },
    ]),
    column('B', 10, [
      { layerId: 'GB-clay', formationId: CLAY_SOFT, top: 0, base: 13 },
      { layerId: 'GB-d', formationId: DENSE, top: 13, base: 20 },
    ]),
    column('C', 10, [{ layerId: 'GC-d', formationId: DENSE, top: 0, base: 20 }]),
  ]
  // The dense sand is the OPEN mass of the B→C gap: B and C share their BASE
  // contact, same class at the far end, so the law emits nothing and both span
  // the gap — that welded body is the ground the pocket sits inside. The tie
  // runs at -10, far below the carried band, because ``lensReach`` halves any
  // diamond a tie would cross and a halved pinch leaves nothing to read.
  //
  // Nothing ties the carried band itself: the 0-tie case is what makes it a
  // lens carried across a blind column in the first place.
  const geotechEdges = [tie('GB-d', 'GC-d', 'base', 'base')]
  const alongM = [0, 10, 110]
  const lithoRegions = computeSectionFillActive(lithoColumns, lithoEdges, undefined, alongM)
  const out = computeHierarchicalGeotechFill({
    lithoColumns,
    lithoEdges,
    lithoRegions,
    geotechColumns,
    geotechEdges,
    alongM,
  })
  return { regions: out.regions, gap: 1 }
}

describe('a pocket belongs to the mass around it', () => {
  it('PI1: the carried band pinches to nothing where the cover cuts it off its own ground', () => {
    const { regions, gap } = scene()
    // The pocket's own sample: inside the carried MEDIUM band's diamond, past
    // the cover boundary that severed it, and nowhere near either column.
    expect(paintAt(regions, gap, 0.178, -2.068)?.formationId, 'the pocket at (0.178, -2.068)').toBe(
      DENSE,
    )
    // ...and it is not merely OVERPAINTED: no medium-sand body exists in that
    // gap at all. An island detached from its own ground is not a body.
    expect(
      regions.filter((r) => r.gapIndex === gap && r.formationId === MEDIUM),
      'a medium-sand island survived in the B→C gap',
    ).toHaveLength(0)
    // *"it should all be one dense sand body?"* — and the merge says so: one
    // region, no notch where the island stood, no seam through it.
    const dense = regions.filter((r) => r.gapIndex === gap && r.formationId === DENSE)
    expect(dense, 'the dense sand came back in pieces').toHaveLength(1)
    // The pinch's own apex was the tip of the notch the dense body used to walk
    // into and back out of. It is gone: the pocket welded in, and what is left
    // of the island's outline is the litho cover's boundary, which was always
    // the dense body's own edge there.
    expect(
      dense[0].polygon.some(
        (p) => Math.abs(p.fraction - 0.395) < 0.01 && Math.abs(p.elevation + 2.0) < 0.05,
      ),
      "the dense body still walks in to the island's apex and back",
    ).toBe(false)
  })

  it('PI2: CONTROL — the same carried band still owns its own ground where it reaches it', () => {
    const { regions } = scene()
    // Gap 0 is A→B: the carried band's OWN gap, where it runs at full thickness
    // from its own column (B is blind, so there is nothing to pinch onto). It is
    // contiguous from A and it keeps every metre of it — the contiguity that
    // tells a fill-through from an island, stated on the very band the pocket
    // rule takes ground away from in the next gap.
    expect(paintAt(regions, 0, 0.2, -2.0)?.formationId, "the carried band beside its own test").toBe(
      MEDIUM,
    )
  })
})
