/**
 * THE OWN-SHADOW GUARD IS ABOUT A BAND'S OWN WINDOW — narrowed 2026-08-26.
 *
 * Two of the owner's rulings meet on the same ground and the guard used to
 * decide it the wrong way round:
 *
 *  * 2026-08-22 — *"where a band's own construct speaks, it speaks
 *    completely"*. His ci19 loose sand pinched its free top onto its base tie,
 *    the engine drew that triangle correctly, and the remainder then handed the
 *    band the wedge directly ABOVE that pinching top — ground still inside its
 *    measured 11.06..10.65, so it won the ``ownsLevel`` rank and the two faces
 *    squared back into the quad he circled. THAT is the shadow this guard bars.
 *  * 2026-08-24 — *"yes in this case i'd rather have a vertical line"*: the
 *    ground left between two closed loops goes left half to the left column's
 *    masses, right half to the right's.
 *
 * Firing the first rule on ground wholly OUTSIDE the band's own window is not
 * the defect it was written for, and it took the second rule's ground away: on
 * his CS1 gap 2 a clay cover climbing 3.67..5.02 → 7.13..7.51 left a strip at
 * 6.10..6.68 that NO band of the family reads at any column, and the cover came
 * out "correlate me" down its middle against his own S9/S9b pins.
 *
 * These pins are the two halves of that, on one scene, in the guard's own terms.
 */
import { describe, expect, it } from 'vitest'

import { claims, type BandConstruct, type RunBand, type RunTie } from './constructs'
import { pickRemainder, type RemainderInput } from './remainderLadder'

/** His ci19 loose sand: 0.41 m thick, measured on the left test at x = 0. */
const LOOSE: RunBand = {
  layerId: 'L-loose',
  formationId: 'ZAND|5',
  bodyId: null,
  top: 11.06,
  base: 10.65,
  ci: 0,
  x: 0,
}

/**
 * Its construct: it rides its BASE tie (flat, at 10.65) and pinches its free
 * TOP down onto that line, terminating at the middle of the 100 m gap.
 */
const WEDGE: BandConstruct = {
  band: LOOSE,
  emit: 'onlap',
  apexX: 50,
  apexElev: 10.65,
  farX: 100,
  topTied: false,
  baseTied: true,
  baseAt: () => 10.65,
  topAt: (x: number) => LOOSE.top + Math.min(1, Math.max(0, x / 50)) * (10.65 - LOOSE.top),
}

/**
 * One remainder decision on that scene.
 *
 * @param y The sample's elevation, mTAW.
 * @param lo, hi The loop's own extent on the sample's vertical.
 * @returns What the ladder hands the ground to.
 */
function ask(y: number, lo: number, hi: number): RunBand | null {
  const input: RemainderInput = {
    flankBands: [LOOSE],
    familyBands: [LOOSE],
    closedAtMiddle: new Set([LOOSE.layerId]),
    middle: 50,
    lo,
    hi,
    x: 25,
    y,
    massKeyOf: (b) => b.formationId,
    drawnTies: [] as RunTie[],
    // No correlation is drawn anywhere on this scene, so no band has a boundary
    // of its own to honour.
    ownContactTies: new Map(),
    closureBars: new Map(),
    shapedByLayer: new Map([[LOOSE.layerId, WEDGE]]),
    // ONE test, no facing column — which is why the sub-TD relaxation of
    // 2026-08-28 does not reach this scene: "the facing test measured nothing
    // here" has to be a fact about ITS total depth, and there is no facing test.
    stacks: new Map([[LOOSE.ci, [LOOSE]]]),
  }
  return pickRemainder(input).band
}

describe('the own-shadow guard bars a band inside its own window, and only there', () => {
  it('OS1 — INSIDE the window: the ci19 shadow is still barred', () => {
    // 10.95 sits above the wedge's pinched top at x = 25 (10.855) and below the
    // band's own measured top (11.06) — the exact shape of his quad. The band
    // has already said, at this x, that it does not occupy this ground.
    expect(claims(WEDGE, 25, 10.95), 'the scene must put the sample in the shadow').toBe(false)
    expect(ask(10.95, 10.9, 11.0)).toBeNull()
  })

  it('OS2 — OUTSIDE the window: the flank answers its own half of the seam', () => {
    // 9.5 is a metre below the band's own base. Nothing of its construct ever
    // spoke about this ground, so the 2026-08-22 rule has nothing to say — and
    // the 2026-08-24 seam ruling does: a closed flank takes the leftover on its
    // own side. This is his CS1 gap-2 strip, in miniature.
    expect(claims(WEDGE, 25, 9.5), 'the construct does not claim it either way').toBe(false)
    expect(ask(9.5, 9.4, 9.6)).toBe(LOOSE)
  })

  it('OS3 — CONTROL: ground the construct still claims was never the guard\'s business', () => {
    // Inside the wedge itself. The guard only ever fires where ``claims`` says
    // no; where the shape still speaks for the ground, nothing is barred.
    expect(claims(WEDGE, 25, 10.75)).toBe(true)
    expect(ask(10.75, 10.7, 10.8)).toBe(LOOSE)
  })
})
