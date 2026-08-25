/**
 * AN ONLAP IS A TRIANGLE, NOT A QUAD — and its apex is ONE vertex.
 *
 * Owner, 2026-08-22, on the loose sand he circled: *"The loose sand has a
 * bottom tie, not a top tie that is why it is an onlap and should be a triangle
 * and not a quad"*. With the termination clause of 2026-08-20 — *"an onlap
 * can't paint over ground near test itself, it terminates at 0.5 Distance
 * approximately"* — that fixes the shape completely: the free contact BENDS to
 * meet the contact the wedge rides, at the termination x, with no height left
 * over. A vertical stub is never a legal onlap termination.
 *
 * ...and the verification contract, owner 2026-08-25: *"if you draw the onlap
 * into a triangle onto the tie, you just have to verify by coordinates,
 * midpoint tie coordinate is end of onlap coordinate and you have a closed
 * loop?"* — so these pins are COORDINATE IDENTITIES, asserted with plain
 * equality. No tolerance: the two contacts must return the SAME number at the
 * termination, because the apex is computed once and shared, not reached twice
 * by two arithmetic paths.
 *
 * WHY THAT MATTERS ARITHMETICALLY. The free contact used to be evaluated as
 * ``free + t * (line - free)`` all the way to t = 1, where it is algebraically
 * the line itself — but ``free + 1 * (line - free)`` rounds a ULP away from
 * ``line`` for roughly one pair of elevations in ten. The scene below is one of
 * those pairs (base 1.02, tie 4.00 → 6.08, apex elevation 5.04): the old code
 * returned 5.039999999999999 for the free contact and 5.04 for the ridden one,
 * so the wedge's two edges did not actually meet and the arrangement was
 * entitled to mint a hair-wide loop between them.
 */
import { describe, expect, it } from 'vitest'

import { buildGapConstructs, tieElevAt, type RunBand, type RunColumn, type RunTie } from './constructs'
import type { Mass } from './emitKernel'

/** Class keys, named for the NAD density they stand for. */
const MEDIUM = 'ZAND|6'
const LOOSE = 'ZAND|5'
const DENSE = 'ZAND|7'

const band = (
  layerId: string,
  formationId: string,
  top: number,
  base: number,
  ci: number,
  x: number,
): RunBand => ({ layerId, formationId, bodyId: null, top, base, ci, x })

/**
 * THE SCENE. Two tests 100 m apart. The left carries medium sand over LOOSE
 * sand over dense; the right carries medium over dense over medium. One
 * accepted tie joins the left loose sand's TOP contact (+4.00) to the right
 * test's contact at +6.08 — so the loose sand has exactly one tied contact,
 * reads a different mass at its far end, and the law emits an onlap. Its BASE
 * (+1.02) is free, and must close onto the tie at the middle: +5.04.
 */
function scene(): {
  left: RunColumn
  right: RunColumn
  ties: RunTie[]
  stacks: Map<number, RunBand[]>
  massOf: (b: RunBand) => Mass
} {
  const upperLeft = band('L-upper', MEDIUM, 10, 4.0, 0, 0)
  const loose = band('L-loose', LOOSE, 4.0, 1.02, 0, 0)
  const lowerLeft = band('L-lower', DENSE, 1.02, -5, 0, 0)
  const upperRight = band('R-upper', MEDIUM, 10, 6.08, 1, 100)
  const middleRight = band('R-middle', DENSE, 6.08, 1.0, 1, 100)
  const lowerRight = band('R-lower', MEDIUM, 1.0, -5, 1, 100)
  return {
    left: { ci: 0, x: 0, bands: [upperLeft, loose, lowerLeft] },
    right: { ci: 1, x: 100, bands: [upperRight, middleRight, lowerRight] },
    ties: [
      {
        key: 'tie-top',
        leftCi: 0,
        rightCi: 1,
        leftX: 0,
        rightX: 100,
        leftY: 4.0,
        rightY: 6.08,
      },
    ],
    stacks: new Map([
      [0, [upperLeft, loose, lowerLeft]],
      [1, [upperRight, middleRight, lowerRight]],
    ]),
    massOf: (b) => ({ litho: 'SAND', packing: b.formationId }),
  }
}

describe('an onlap closes to a point on the contact it rides', () => {
  it('OA1 — the law emits the onlap this scene is built to produce', () => {
    const { left, right, ties, stacks, massOf } = scene()
    const constructs = buildGapConstructs(left, right, ties, [], stacks, massOf)
    const wedge = constructs.find((c) => c.band.layerId === 'L-loose')
    expect(wedge?.emit).toBe('onlap')
    expect(wedge?.topTied).toBe(true)
    expect(wedge?.baseTied).toBe(false)
  })

  it('OA2 — "midpoint tie coordinate is end of onlap coordinate": the apex is ONE vertex', () => {
    const { left, right, ties, stacks, massOf } = scene()
    const constructs = buildGapConstructs(left, right, ties, [], stacks, massOf)
    const wedge = constructs.find((c) => c.band.layerId === 'L-loose')
    if (wedge === undefined) throw new Error('the scene emitted no wedge')
    // The termination is the middle — *"it terminates at 0.5 Distance"*.
    expect(wedge.apexX).toBe(50)
    // ...and the vertex there is the TIE's own coordinate, carried on the
    // construct so the fill draws the flank onto that exact value.
    expect(wedge.apexElev).toBe(tieElevAt(ties[0], 50))
  })

  it('OA3 — "a triangle and not a quad": the free contact meets the ridden one, exactly', () => {
    const { left, right, ties, stacks, massOf } = scene()
    const constructs = buildGapConstructs(left, right, ties, [], stacks, massOf)
    const wedge = constructs.find((c) => c.band.layerId === 'L-loose')
    if (wedge === undefined) throw new Error('the scene emitted no wedge')
    // Plain equality, per the owner's verification contract: no residual
    // height at the termination means the two boundaries return one number.
    expect(wedge.baseAt(wedge.apexX as number)).toBe(wedge.topAt(wedge.apexX as number))
    expect(wedge.baseAt(wedge.apexX as number)).toBe(wedge.apexElev)
  })

  it('OA4 — the natural-convergence case is untouched: it still opens at its own test', () => {
    const { left, right, ties, stacks, massOf } = scene()
    const constructs = buildGapConstructs(left, right, ties, [], stacks, massOf)
    const wedge = constructs.find((c) => c.band.layerId === 'L-loose')
    if (wedge === undefined) throw new Error('the scene emitted no wedge')
    // At its own test the wedge is its own full thickness — the pinch happens
    // ACROSS the gap, not at the column the band was measured on.
    expect(wedge.topAt(0)).toBe(4.0)
    expect(wedge.baseAt(0)).toBe(1.02)
    // ...and it is still open at three-quarters of the way to the apex.
    expect(wedge.topAt(37.5) - wedge.baseAt(37.5)).toBeGreaterThan(0)
  })
})
