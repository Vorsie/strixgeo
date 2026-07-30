/**
 * A base tie must reach the 3-D builder, or the deepest unit cannot band.
 *
 * Owner, 2026-07-30, pointing at Cross-section 1 between GEO-23/125-S6 and
 * GEO-10/170-S11: *"there is a base tie and a top tie, why is there no clay
 * there?"* — the clay bands correctly in Fill bands and is absent from the built
 * 3-D model over three whole gaps.
 *
 * THE DEFECT. A correlation edge carries which CONTACT it joins: `aSide` / `bSide`,
 * each `'top'` or `'base'`. The section overlay threads them into the engine and
 * says why in its own comment — so the engine "can split bottom-ties (base<->base)
 * from normal top-keyed edges, letting the deepest unit band without a base-tie
 * polluting the topCorr signal". The BUILD path dropped them, in two independent
 * lossy maps, and because `CorrelationEdge.aSide/bSide` are OPTIONAL and documented
 * as "Omitted => 'top'", the compiler could not see the loss. Every base<->base tie
 * therefore arrived at the builder as a DUPLICATE top<->top tie, so no base tie
 * existed anywhere in the section and the deepest unit had a top bound with no
 * bottom bound.
 *
 * On the owner's model that erased the clay from three gaps outright and left a
 * half-wedge in the fourth, at gap-local fraction 0.000..0.500 — the engine's
 * one-correlated-contact onlap taper, not a coincidence.
 *
 * These tests pin the SIDES SURVIVING THE ASSEMBLY, which is where they were lost.
 * The engine's use of them is already covered by its own suites.
 */

import { describe, expect, it } from 'vitest'
import { assembleLithoSectionInputs } from './assembleLithoSectionInputs'
import type { InvestigationLocation, LithoLayerLike, SectionLike } from './assembleLithoSectionInputs'

const SECTION: SectionLike = {
  id: 'sec-1',
  start_x: 0,
  start_y: 0,
  end_x: 100,
  end_y: 0,
  projection_buffer_m: 50,
}

const INVESTIGATIONS: InvestigationLocation[] = [
  { id: 'A', kind: 'cpt', location_x: 0, location_y: 0, elevation_m: 10 } as InvestigationLocation,
  { id: 'B', kind: 'cpt', location_x: 100, location_y: 0, elevation_m: 10 } as InvestigationLocation,
]

/** Both tests bottom out in the same clay — so its base can only be BASE-tied. */
const LAYERS: LithoLayerLike[] = [
  {
    id: 'a-sand',
    cpt_id: 'A',
    borehole_id: null,
    formation_id: 'ZAND',
    body_id: 'sand',
    depth_top_m: 0,
    depth_base_m: 6,
    status: 'accepted',
  },
  {
    id: 'a-clay',
    cpt_id: 'A',
    borehole_id: null,
    formation_id: 'KLEI',
    body_id: 'clay',
    depth_top_m: 6,
    depth_base_m: 9,
    status: 'accepted',
  },
  {
    id: 'b-sand',
    cpt_id: 'B',
    borehole_id: null,
    formation_id: 'ZAND',
    body_id: 'sand',
    depth_top_m: 0,
    depth_base_m: 7,
    status: 'accepted',
  },
  {
    id: 'b-clay',
    cpt_id: 'B',
    borehole_id: null,
    formation_id: 'KLEI',
    body_id: 'clay',
    depth_top_m: 7,
    depth_base_m: 11,
    status: 'accepted',
  },
]

describe('the sides of a correlation edge reach the 3-D builder', () => {
  it('a base tie stays a base tie', () => {
    const [input] = assembleLithoSectionInputs({
      visibleSections: [SECTION],
      investigations: INVESTIGATIONS,
      lithoLayers: LAYERS,
      edgesBySectionId: new Map([
        [
          'sec-1',
          [
            { a: 'a-clay', b: 'b-clay', aSide: 'top' as const, bSide: 'top' as const },
            { a: 'a-clay', b: 'b-clay', aSide: 'base' as const, bSide: 'base' as const },
          ],
        ],
      ]),
    })

    const sides = input.edges.map((e) => `${e.aSide ?? 'top'}<->${e.bSide ?? 'top'}`)
    expect(sides).toContain('base<->base')
  })

  it('a top tie and a base tie on the same pair stay TWO distinct ties', () => {
    // The silent-failure shape: stripped of their sides, both edges collapse to
    // the same {a, b} and the base tie ceases to exist. The engine then sees one
    // correlated contact instead of two, and an onlap replaces the band.
    const [input] = assembleLithoSectionInputs({
      visibleSections: [SECTION],
      investigations: INVESTIGATIONS,
      lithoLayers: LAYERS,
      edgesBySectionId: new Map([
        [
          'sec-1',
          [
            { a: 'a-clay', b: 'b-clay', aSide: 'top' as const, bSide: 'top' as const },
            { a: 'a-clay', b: 'b-clay', aSide: 'base' as const, bSide: 'base' as const },
          ],
        ],
      ]),
    })

    const distinct = new Set(
      input.edges.map((e) => `${e.a}|${e.b}|${e.aSide ?? 'top'}|${e.bSide ?? 'top'}`),
    )
    expect(distinct.size).toBe(2)
  })

  it('a mixed tie keeps which end is the base', () => {
    // A mixed tie (one top, one base) means the top-side unit rises toward the
    // facing column's TD. Losing the sides turns it into an ordinary top tie and
    // silently relocates the contact by one layer thickness.
    const [input] = assembleLithoSectionInputs({
      visibleSections: [SECTION],
      investigations: INVESTIGATIONS,
      lithoLayers: LAYERS,
      edgesBySectionId: new Map([
        ['sec-1', [{ a: 'a-clay', b: 'b-clay', aSide: 'base' as const, bSide: 'top' as const }]],
      ]),
    })

    expect(input.edges).toHaveLength(1)
    expect(input.edges[0].aSide).toBe('base')
    expect(input.edges[0].bSide).toBe('top')
  })
})
