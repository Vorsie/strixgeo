/**
 * THE COVER WELD — *"those top sands have an engine tie no? the tops of all
 * tests are connected? follow the tie, same nad class, emit nothing...."*
 * (owner, 2026-08-26, on CS1 gap 19's two top sands).
 *
 * The pins are named CW1.. rather than CT1.. because ``CT`` already names the
 * carried-band taper family (``carriedBandTaper.test.ts``) and ``CT1`` the
 * cover-tie GEOMETRY pin (``coverTieGeometry.test.ts``) this ruling refines.
 *
 * Every scene below is the owner's own: CS1 gap 19, columns GEO-23/125-S6 and
 * GEO-23/125-S5A, whose two top sands are the same formation row (ZAND, NAD 6)
 * with tops at 11.430 and 11.380 mTAW and no packing tie between them.
 */
import { describe, expect, it } from 'vitest'

import { buildGapConstructs, type RunBand, type RunColumn, type RunTie } from './constructs'
import type { Mass } from './emitKernel'

/** SOIL|CLASS, the one mass identity the law compares. */
const massOf = (band: RunBand): Mass => {
  const [litho, packing] = band.formationId.split('|')
  return { litho, packing }
}

const band = (b: Partial<RunBand> & Pick<RunBand, 'layerId' | 'formationId' | 'top' | 'base' | 'ci' | 'x'>): RunBand => ({
  bodyId: null,
  ...b,
})

const emitOf = (
  constructs: readonly { band: RunBand; emit: string }[],
  layerId: string,
): string | undefined => constructs.find((c) => c.band.layerId === layerId)?.emit

describe('the cover weld — a cover boundary whose far band is the same mass reads as tied', () => {
  /**
   * CS1 gap 19's real top: both columns' shallowest band is the same mass
   * (ZAND NAD 6), both sit at their litho unit's own top, and no packing tie
   * joins them. GEO-23/125-S5A's band additionally carries a packing tie on
   * its base, to a DIFFERENT mass (ZAND NAD 5) at the far test.
   */
  const gap19 = (
    farTopMass: string,
  ): {
    left: RunColumn
    right: RunColumn
    stacks: Map<number, RunBand[]>
    ties: RunTie[]
    coverTies: RunTie[]
  } => {
    const s6Top = band({
      layerId: 'S6-top',
      formationId: 'ZAND|6',
      top: 11.43,
      base: 11.06,
      ci: 0,
      x: 0,
      atCoverTop: true,
    })
    const s6Lower = band({
      layerId: 'S6-lower',
      formationId: 'ZAND|5',
      top: 11.06,
      base: 10.65,
      ci: 0,
      x: 0,
      atCoverBase: true,
    })
    const s5aTop = band({
      layerId: 'S5A-top',
      formationId: farTopMass,
      top: 11.38,
      base: 11.07,
      ci: 1,
      x: 100,
      atCoverTop: true,
      atCoverBase: true,
    })
    const stacks = new Map<number, RunBand[]>([
      [0, [s6Top, s6Lower]],
      [1, [s5aTop]],
    ])
    return {
      left: { ci: 0, x: 0, bands: [s6Top, s6Lower] },
      right: { ci: 1, x: 100, bands: [s5aTop] },
      stacks,
      // The one packing tie that crosses this gap: the silt top, which is
      // S6's lower sand's BASE and S5A's top sand's BASE.
      ties: [
        { key: 'silt-top', leftCi: 0, rightCi: 1, leftX: 0, rightX: 100, leftY: 10.65, rightY: 11.07 },
      ],
      // The accepted LITHO line on the same contact. There is NO stored litho
      // tie on the two sands' tops — the model's own top surface is implicit.
      coverTies: [
        { key: 'litho-silt-top', leftCi: 0, rightCi: 1, leftX: 0, rightX: 100, leftY: 10.65, rightY: 11.07 },
      ],
    }
  }

  it('CW1 — two same-mass tops under one cover top: both emit nothing and both ride the cover line', () => {
    const scene = gap19('ZAND|6')
    const constructs = buildGapConstructs(
      scene.left,
      scene.right,
      scene.ties,
      scene.coverTies,
      scene.stacks,
      massOf,
    )
    // *"follow the tie, same nad class, emit nothing"* — neither sand closes a
    // loop, so no lens and no onlap is drawn between the two tests.
    expect(emitOf(constructs, 'S6-top'), 'S6 top sand').toBe('nothing')
    expect(emitOf(constructs, 'S5A-top'), 'S5A top sand').toBe('nothing')
    // ...and the line they follow is the cover's own top, not each band's flat
    // level: the two tops are 5 cm apart, and one boundary joins them.
    const s6 = constructs.find((c) => c.band.layerId === 'S6-top') as (typeof constructs)[number]
    const s5a = constructs.find((c) => c.band.layerId === 'S5A-top') as (typeof constructs)[number]
    expect(s6.topTied, 'S6 top rides the cover top').toBe(true)
    expect(s5a.topTied, 'S5A top rides the cover top').toBe(true)
    expect(s6.topAt(50), 'S6 top at mid-gap').toBeCloseTo(11.405, 6)
    expect(s5a.topAt(50), 'S5A top at mid-gap — the SAME line').toBeCloseTo(11.405, 6)
  })

  it('CW2 — a DIFFERENT packing across the same cover top welds nothing: today\'s lens and onlap stand', () => {
    // The control the ruling exists to protect (Ruling A, 2026-08-22): a litho
    // line must never force a statement between two different packings.
    const scene = gap19('ZAND|8')
    const constructs = buildGapConstructs(
      scene.left,
      scene.right,
      scene.ties,
      scene.coverTies,
      scene.stacks,
      massOf,
    )
    expect(emitOf(constructs, 'S6-top'), 'no tie at all -> lens').toBe('lens')
    expect(emitOf(constructs, 'S5A-top'), 'one packing tie, different far mass -> onlap').toBe('onlap')
    const s6 = constructs.find((c) => c.band.layerId === 'S6-top') as (typeof constructs)[number]
    expect(s6.topTied, 'and its cover top states nothing').toBe(false)
  })

  it('CW3 — the rule is about cover boundaries, not the surface: a STORED litho tie deeper down welds too', () => {
    // M spans its whole litho unit; F's upper band is the same mass and sits at
    // the same unit's top. Their shared contact is the unit's own BASE, which
    // carries an accepted litho tie and no packing tie.
    const m = band({
      layerId: 'M',
      formationId: 'ZAND|6',
      top: 10,
      base: 0,
      ci: 0,
      x: 0,
      atCoverTop: true,
      atCoverBase: true,
    })
    const f = band({
      layerId: 'F',
      formationId: 'ZAND|6',
      top: 8,
      base: -2,
      ci: 1,
      x: 10,
      atCoverTop: true,
      atCoverBase: true,
    })
    const stacks = new Map<number, RunBand[]>([
      [0, [m]],
      [1, [f]],
    ])
    const coverTies: RunTie[] = [
      { key: 'litho-base', leftCi: 0, rightCi: 1, leftX: 0, rightX: 10, leftY: 0, rightY: -2 },
    ]
    const constructs = buildGapConstructs(
      { ci: 0, x: 0, bands: [m] },
      { ci: 1, x: 10, bands: [f] },
      [],
      coverTies,
      stacks,
      massOf,
    )
    expect(emitOf(constructs, 'M'), 'same mass across the stored litho base').toBe('nothing')
    expect(emitOf(constructs, 'F'), 'same mass across the stored litho base').toBe('nothing')
  })

  it('CW4 — a stored cover tie to a DIFFERENT mass keeps Ruling A exactly: geometry only, no weld', () => {
    // The CT1 arrangement of ``coverTieGeometry.test.ts``, restated: M welds on
    // top to F's dense, and its untied cover BASE faces F's LOOSE — a different
    // mass. The line is still ridden (Ruling A's geometry half) and the
    // classification is still the law's own.
    const m = band({
      layerId: 'M',
      formationId: 'ZAND|6',
      top: 10,
      base: 0,
      ci: 0,
      x: 0,
      atCoverTop: true,
      atCoverBase: true,
    })
    const fDense = band({
      layerId: 'F-dense',
      formationId: 'ZAND|6',
      top: 8,
      base: 3,
      ci: 1,
      x: 10,
      atCoverTop: true,
    })
    const fLoose = band({
      layerId: 'F-loose',
      formationId: 'ZAND|5',
      top: 3,
      base: -2,
      ci: 1,
      x: 10,
      atCoverBase: true,
    })
    const stacks = new Map<number, RunBand[]>([
      [0, [m]],
      [1, [fDense, fLoose]],
    ])
    const constructs = buildGapConstructs(
      { ci: 0, x: 0, bands: [m] },
      { ci: 1, x: 10, bands: [fDense, fLoose] },
      [{ key: 'weld', leftCi: 0, rightCi: 1, leftX: 0, rightX: 10, leftY: 10, rightY: 8 }],
      [{ key: 'litho-base', leftCi: 0, rightCi: 1, leftX: 0, rightX: 10, leftY: 0, rightY: -2 }],
      stacks,
      massOf,
    )
    const mc = constructs.find((c) => c.band.layerId === 'M') as (typeof constructs)[number]
    expect(mc.emit, 'one packing tie, same far mass -> nothing').toBe('nothing')
    expect(mc.baseAt(5), 'the untied cover base still rides the litho line').toBeCloseTo(-1, 6)
  })

  it('CW6 — a cover boundary INSIDE a merged cover welds nothing, however alike the far mass', () => {
    // CS1 gap 0, the scene that caught this while the rule was written. The
    // silt family's cover merges several litho units, so S10 carries a thin top
    // silt (12.22..11.68) whose BASE is its own unit's base, and S6 carries a
    // same-class silt whose base is its unit's base at 5.59 — SIX METRES lower.
    // Neither is the cover's own edge, and joining them invents a boundary.
    const s10Top = band({
      layerId: 'S10-top-silt',
      formationId: 'SILT|14',
      top: 12.22,
      base: 11.68,
      ci: 0,
      x: 0,
      atCoverBase: true,
    })
    const s10Deep = band({
      layerId: 'S10-deep-silt',
      formationId: 'SILT|14',
      top: 6.84,
      base: 6.32,
      ci: 0,
      x: 0,
      atCoverBase: true,
    })
    const s6Big = band({
      layerId: 'S6-big-silt',
      formationId: 'SILT|13',
      top: 11.61,
      base: 6.05,
      ci: 1,
      x: 100,
      atCoverTop: true,
    })
    const s6Deep = band({
      layerId: 'S6-deep-silt',
      formationId: 'SILT|14',
      top: 6.05,
      base: 5.59,
      ci: 1,
      x: 100,
      atCoverBase: true,
    })
    const stacks = new Map<number, RunBand[]>([
      [0, [s10Top, s10Deep]],
      [1, [s6Big, s6Deep]],
    ])
    const constructs = buildGapConstructs(
      { ci: 0, x: 0, bands: [s10Top, s10Deep] },
      { ci: 1, x: 100, bands: [s6Big, s6Deep] },
      // The owner's own reading: the top silt has ONE tie, on its top contact.
      [{ key: 'top', leftCi: 0, rightCi: 1, leftX: 0, rightX: 100, leftY: 12.22, rightY: 11.61 }],
      [],
      stacks,
      massOf,
    )
    // *"top silt has only a top tie, follow that tie and you get a silt with
    // another packing type, emit onlap"* (owner, 2026-08-20) — still true.
    expect(emitOf(constructs, 'S10-top-silt')).toBe('onlap')
    const top = constructs.find(
      (c) => c.band.layerId === 'S10-top-silt',
    ) as (typeof constructs)[number]
    expect(top.baseTied, 'its base welded across a merged cover').toBe(false)
  })

  it('CW5 — a same-mass cover weld is a TIED CONTACT: with one packing tie it makes a band, not an onlap', () => {
    // S5A's top sand in CS1 gap 19: its base carries a packing tie to a
    // different mass (which alone would say onlap), and its top welds across
    // the cover to S6's same-mass sand. Two tied contacts is a band.
    const scene = gap19('ZAND|6')
    const constructs = buildGapConstructs(
      scene.left,
      scene.right,
      scene.ties,
      scene.coverTies,
      scene.stacks,
      massOf,
    )
    const s5a = constructs.find((c) => c.band.layerId === 'S5A-top') as (typeof constructs)[number]
    expect(s5a.emit).toBe('nothing')
    expect(s5a.apexX, 'a band closes no loop').toBeUndefined()
  })
})
