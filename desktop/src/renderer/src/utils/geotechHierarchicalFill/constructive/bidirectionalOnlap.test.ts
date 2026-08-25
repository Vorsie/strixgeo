/**
 * A BAND WITH ONE TIE ALWAYS ONLAPS THAT TIE — the owner's ruling of
 * 2026-08-25, on his own TS12 scene.
 *
 * Shown S6's loose sand (6.00 .. 6.41 m, 0.41 m thick) carrying a single tie on
 * its TOP contact to S14's 4.26 m medium-dense sand — the true bidirectional
 * case, where the previous law made the thin side YIELD and close flat at its
 * own column — he ruled:
 *
 *   *"no it has one tie on top, so it should onlap that same tie"*
 *
 * That supersedes the 2026-08-21 *"clearly thicker wins"* collision FOR
 * EMISSION. Where both bands carry the single shared tie and read different
 * masses, BOTH onlap it and both pinch per the 2026-08-20 termination clause
 * (*"it terminates at 0.5 Distance approximately"*) — the geometry the old rule
 * already drew for the below-ratio case, now the only geometry there is. It is
 * his standing CS3 statement made general: *"both tests will emit onlaps in
 * this case depending on what test you start from"*.
 *
 * What did NOT change: an onlap is still a CLOSED LOOP — *"the MD sand onlaps,
 * that means it is a closed loop in that gap and cannot fill the gap"* — so the
 * thicker side gains no reach from the retirement of the yield. It drew to the
 * middle before and it draws to the middle now.
 *
 * The scene below is TS12's own numbers, at TS12's own thickness ratio (10.4x,
 * five times past the retired ratio), so a re-introduction of thickness-gated
 * emission anywhere in the kernel fails here immediately.
 */
import { describe, expect, it } from 'vitest'

import { buildGapConstructs, tieElevAt, type RunBand, type RunColumn, type RunTie } from './constructs'
import type { Mass } from './emitKernel'

/** Class keys, named for the NAD density they stand for. */
const LOOSE = 'ZAND|5'
const MEDIUM = 'ZAND|6'
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
 * THE TS12 SCENE. Two tests 100 m apart.
 *
 * The left (S6) reads medium over a THIN LOOSE sand 4.00 .. 3.59 — the owner's
 * 0.41 m band — over dense. The right (S14) reads dense over a THICK MEDIUM
 * sand 5.00 .. 0.74 — his 4.26 m band — over dense. ONE tie joins the loose
 * sand's TOP contact to the medium sand's TOP contact, so each band carries
 * exactly one tied contact, they share it, and each reads a different mass at
 * the other end. 4.26 m against 0.41 m is 10.4x.
 *
 * @param farMass The class the right column's thick band carries. Defaults to
 *   the medium sand of his scene; the control passes ``LOOSE`` to make the two
 *   ends read the SAME mass across the same single tie.
 */
function ts12(farMass: string = MEDIUM): {
  left: RunColumn
  right: RunColumn
  ties: RunTie[]
  stacks: Map<number, RunBand[]>
  massOf: (b: RunBand) => Mass
} {
  const upperLeft = band('L-upper', MEDIUM, 10, 4.0, 0, 0)
  const thin = band('L-thin', LOOSE, 4.0, 3.59, 0, 0)
  const lowerLeft = band('L-lower', DENSE, 3.59, -5, 0, 0)
  const upperRight = band('R-upper', DENSE, 10, 5.0, 1, 100)
  const thick = band('R-thick', farMass, 5.0, 0.74, 1, 100)
  const lowerRight = band('R-lower', DENSE, 0.74, -5, 1, 100)
  return {
    left: { ci: 0, x: 0, bands: [upperLeft, thin, lowerLeft] },
    right: { ci: 1, x: 100, bands: [upperRight, thick, lowerRight] },
    ties: [{ key: 'tie-top', leftCi: 0, rightCi: 1, leftX: 0, rightX: 100, leftY: 4.0, rightY: 5.0 }],
    stacks: new Map([
      [0, [upperLeft, thin, lowerLeft]],
      [1, [upperRight, thick, lowerRight]],
    ]),
    massOf: (b) => ({ litho: 'SAND', packing: b.formationId }),
  }
}

/** The two bands the ruling is about, built from the scene. */
function ts12Constructs(farMass?: string): {
  thin: ReturnType<typeof buildGapConstructs>[number]
  thick: ReturnType<typeof buildGapConstructs>[number]
  tie: RunTie
} {
  const { left, right, ties, stacks, massOf } = ts12(farMass)
  const constructs = buildGapConstructs(left, right, ties, [], stacks, massOf)
  const thin = constructs.find((c) => c.band.layerId === 'L-thin')
  const thick = constructs.find((c) => c.band.layerId === 'R-thick')
  if (thin === undefined || thick === undefined) throw new Error('the scene emitted no constructs')
  return { thin, thick, tie: ties[0] }
}

describe('one tie means one onlap, whatever the masses weigh', () => {
  it('TS12a — the THIN side onlaps its own tie: *"it has one tie on top, so it should onlap that same tie"*', () => {
    // Owner 2026-08-25, verbatim, on this band. It reads a different mass
    // across its single tie, and that is the whole test the law makes. The
    // 10.4x thickness the facing band carries is no longer consulted anywhere.
    const { thin } = ts12Constructs()
    expect(thin.emit).toBe('onlap')
    expect(thin.topTied, 'the ruling is about the tie on its TOP').toBe(true)
    expect(thin.baseTied, 'its base is free — that is the contact that closes').toBe(false)
  })

  it('TS12b — and it RIDES that tie, rather than closing flat at its own column', () => {
    // The shape the yield used to draw was a lens: both contacts tapering from
    // the band's own levels to a point near its own test, stating nothing about
    // the line it is tied to. Riding means the tied contact IS the line — at
    // its own column, and everywhere across the gap it draws.
    const { thin, tie } = ts12Constructs()
    expect(thin.topAt(0)).toBe(4.0)
    expect(thin.topAt(25)).toBe(tieElevAt(tie, 25))
    expect(thin.topAt(50)).toBe(tieElevAt(tie, 50))
  })

  it('TS12c — ...and pinches onto it at the middle, one shared vertex', () => {
    // *"it terminates at 0.5 Distance approximately"* (2026-08-20), and the
    // owner's own verification contract of 2026-08-25: *"midpoint tie
    // coordinate is end of onlap coordinate and you have a closed loop"*. Plain
    // equality — a residual height at the termination is the quad he has
    // reported five times.
    const { thin, tie } = ts12Constructs()
    expect(thin.apexX).toBe(50)
    expect(thin.apexElev).toBe(tieElevAt(tie, 50))
    expect(thin.baseAt(thin.apexX as number)).toBe(thin.topAt(thin.apexX as number))
    // It is still open on the way there — a triangle, not a hair.
    expect(thin.topAt(10) - thin.baseAt(10)).toBeGreaterThan(0)
  })

  it('TS12d — the THICK side is unchanged: it onlaps to the middle and no further', () => {
    // *"the MD sand onlaps, that means it is a closed loop in that gap and
    // cannot fill the gap"* (2026-08-21) STANDS. Retiring the yield gives the
    // thicker band nothing: it drew its onlap to the middle under the old law
    // and it draws the same onlap to the same middle now. Its own column is at
    // x = 100, so its apex is the middle reached from the right.
    const { thick, tie } = ts12Constructs()
    expect(thick.emit).toBe('onlap')
    expect(thick.topTied).toBe(true)
    expect(thick.baseTied).toBe(false)
    expect(thick.apexX).toBe(50)
    expect(thick.apexElev).toBe(tieElevAt(tie, 50))
    expect(thick.baseAt(thick.apexX as number)).toBe(thick.topAt(thick.apexX as number))
  })

  it('TS12e — CONTROL: one tie whose far end reads the SAME mass still emits nothing', () => {
    // The law's other half is untouched — *"if litho at other end of tie has
    // same litho and packing density emit nothing"* (2026-08-19). Same single
    // tie, same 10.4x thickness difference, only the far class changed: the two
    // are one mass, so neither draws a line and neither pinches.
    const { thin, thick } = ts12Constructs(LOOSE)
    expect(thin.emit).toBe('nothing')
    expect(thick.emit).toBe('nothing')
    expect(thin.apexX, 'a welded mass has no termination').toBeUndefined()
  })
})
