/**
 * AN ONLAP IS A TRIANGLE WHATEVER ITS TIE'S PLUNGE — *"still not onlapping"*.
 *
 * Owner dogfeed, 2026-08-26 morning, on Tie-section 12 gap 0: S6's 0.41 m loose
 * sand emits its onlap, the probe says so, and NOTHING of it appears on screen.
 * The ground its wedge should hold is painted by the medium sand beside it.
 *
 * That is his standing ruling of 2026-08-22 broken at the claim level — *"WHERE
 * A BAND'S OWN CONSTRUCT SPEAKS, IT SPEAKS COMPLETELY"* — and the scene below is
 * the one that breaks it: a THIN band whose tie PLUNGES, dropping far more over
 * the half-gap than the band is thick. S6's loose sand is 0.41 m; its tie falls
 * 2.51 m from its own column to the termination.
 *
 * WHY THAT SHAPE AND NOT ANOTHER. The wedge's two contacts are the tie it rides
 * and the free contact converging onto it. Write the free contact's height as a
 * fraction ``t`` of the way to the apex, the band's thickness as ``h`` and the
 * tie's own drop over that half-gap as ``Δ``. Chasing the tie's MOVING height —
 * ``free + t·(tie(x) − free)`` — opens a gap of
 *
 *     top − base = (1 − t)·(h + Δ·t)
 *
 * which is a triangle only while ``h + Δ·t`` stays positive. A plunging tie has
 * ``Δ < 0``, so the moment ``|Δ| > h`` the wedge INVERTS at ``t = h / |Δ|`` and
 * is upside down for the rest of its span. With S6's numbers that is t = 0.163:
 * the band can claim the first 16 % of its own half-gap and not one millimetre
 * of the other 84 %, because ``claims()`` ends in ``top > base``.
 *
 * Converging on the SHARED APEX instead — one fixed vertex, the one the fill
 * already draws its flank onto — gives ``top − base = h·(1 − t)``: a clean taper
 * to zero, for any plunge, which is the triangle the owner has asked for.
 *
 * The pins below are written in his vocabulary, not the arithmetic's: the wedge
 * is OPEN from its own test to its apex, the band OWNS the ground inside it, and
 * the neighbour does NOT.
 */
import { describe, expect, it } from 'vitest'

import { buildGapConstructs, claims, tieElevAt, type RunBand, type RunColumn, type RunTie } from './constructs'
import type { Mass } from './emitKernel'
import { fillGapProbe } from './fillGapProbe'
import { silentConstructs } from './onlapClosure'
import { computeHierarchicalGeotechFill } from '../index'
import { column, paintAt, tie as lithoTie } from '../scene.test-helpers'
import { computeSectionFillActive } from '../../partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn } from '../../sectionPartition'

/** Class keys, named for the NAD density they stand for. */
const LOOSE = 'ZAND|5'
const MEDIUM = 'ZAND|6'
const DENSE = 'ZAND|7'

/** The one litho unit every band below subdivides — sand, top to bottom. */
const SAND = 'f-sand'

const ALONG = [0, 100]

const band = (
  layerId: string,
  formationId: string,
  top: number,
  base: number,
  ci: number,
  x: number,
): RunBand => ({ layerId, formationId, bodyId: null, top, base, ci, x })

/**
 * TIE-SECTION 12, GAP 0 — the owner's own numbers, two tests 100 m apart.
 *
 * Left (S14, f = 0) reads dense down to +2.01, then a medium sand spanning to
 * −5, then dense. Right (S6, f = 1) reads dense down to +7.03, then the LOOSE
 * sand 7.03 .. 6.62 — his 0.41 m band — then medium to −3, then dense.
 *
 * Two ties. The one this test is about joins the loose sand's TOP (+7.03 on S6)
 * to the medium sand's top (+2.01 on S14): a 5.02 m PLUNGE across the gap, so
 * 2.51 m from the loose sand's column to the termination, against 0.41 m of band.
 * The second ties the two spanning masses' deep contacts, which is what makes
 * the medium sand a two-tied band — the open neighbour that takes the wedge's
 * ground today.
 *
 * @param farTop The elevation the plunging tie reaches on S14. Defaults to the
 *   owner's +2.01; the control passes a near-horizontal value.
 */
function ts12Gap0(farTop: number = 2.01): {
  left: RunColumn
  right: RunColumn
  ties: RunTie[]
  stacks: Map<number, RunBand[]>
  massOf: (b: RunBand) => Mass
} {
  const upperLeft = band('L-upper', DENSE, 12, farTop, 0, 0)
  const spanLeft = band('L-span', MEDIUM, farTop, -5, 0, 0)
  const deepLeft = band('L-deep', DENSE, -5, -12, 0, 0)
  const upperRight = band('R-upper', DENSE, 12, 7.03, 1, 100)
  const thin = band('R-thin', LOOSE, 7.03, 6.62, 1, 100)
  const midRight = band('R-mid', MEDIUM, 6.62, -3, 1, 100)
  const deepRight = band('R-deep', DENSE, -3, -12, 1, 100)
  return {
    left: { ci: 0, x: 0, bands: [upperLeft, spanLeft, deepLeft] },
    right: { ci: 1, x: 100, bands: [upperRight, thin, midRight, deepRight] },
    ties: [
      { key: 'tie-plunge', leftCi: 0, rightCi: 1, leftX: 0, rightX: 100, leftY: farTop, rightY: 7.03 },
      { key: 'tie-deep', leftCi: 0, rightCi: 1, leftX: 0, rightX: 100, leftY: -5, rightY: -3 },
    ],
    stacks: new Map([
      [0, [upperLeft, spanLeft, deepLeft]],
      [1, [upperRight, thin, midRight, deepRight]],
    ]),
    massOf: (b) => ({ litho: 'SAND', packing: b.formationId }),
  }
}

/** The loose sand's construct, built from the scene. */
function wedgeOf(farTop?: number): {
  wedge: ReturnType<typeof buildGapConstructs>[number]
  tie: RunTie
} {
  const { left, right, ties, stacks, massOf } = ts12Gap0(farTop)
  const constructs = buildGapConstructs(left, right, ties, [], stacks, massOf)
  const wedge = constructs.find((c) => c.band.layerId === 'R-thin')
  if (wedge === undefined) throw new Error('the scene emitted no construct for the loose sand')
  return { wedge, tie: ties[0] }
}

/**
 * The same scene as a full section: one sand litho unit, the bands inside it.
 *
 * @param farTop The elevation the plunging tie reaches on S14.
 * @returns Every region the geotech fill emits.
 */
function regionsOf(farTop: number = 2.01): ReturnType<typeof computeHierarchicalGeotechFill> {
  const depth = (elevation: number): number => 12 - elevation
  const litho: PartitionColumn[] = [
    column('S14', 12, [{ layerId: 'L-sand', formationId: SAND, top: 0, base: 24 }]),
    column('S6', 12, [{ layerId: 'R-sand', formationId: SAND, top: 0, base: 24 }]),
  ]
  const lithoEdges: CorrelationEdge[] = [lithoTie('L-sand', 'R-sand')]
  const geotechColumns: PartitionColumn[] = [
    column('S14', 12, [
      { layerId: 'L-upper', formationId: DENSE, top: 0, base: depth(farTop) },
      { layerId: 'L-span', formationId: MEDIUM, top: depth(farTop), base: depth(-5) },
      { layerId: 'L-deep', formationId: DENSE, top: depth(-5), base: 24 },
    ]),
    column('S6', 12, [
      { layerId: 'R-upper', formationId: DENSE, top: 0, base: depth(7.03) },
      { layerId: 'R-thin', formationId: LOOSE, top: depth(7.03), base: depth(6.62) },
      { layerId: 'R-mid', formationId: MEDIUM, top: depth(6.62), base: depth(-3) },
      { layerId: 'R-deep', formationId: DENSE, top: depth(-3), base: 24 },
    ]),
  ]
  const geotechEdges: CorrelationEdge[] = [
    lithoTie('L-span', 'R-thin', 'top', 'top'),
    lithoTie('L-span', 'R-mid', 'base', 'base'),
  ]
  return computeHierarchicalGeotechFill({
    lithoColumns: litho,
    lithoEdges,
    lithoRegions: computeSectionFillActive(litho, lithoEdges, undefined, ALONG),
    geotechColumns,
    geotechEdges,
    alongM: ALONG,
  })
}

describe('an onlap riding a plunging tie still draws its whole wedge', () => {
  it('PT1 — the scene is the one the ruling is about: one tie on top, so one onlap', () => {
    const { wedge, tie } = wedgeOf()
    expect(wedge.emit).toBe('onlap')
    expect(wedge.topTied, 'the tie is on its TOP contact').toBe(true)
    expect(wedge.baseTied, 'its base is free — that is the contact that closes').toBe(false)
    // *"it terminates at 0.5 Distance approximately"*, and the apex is the tie's
    // own coordinate there — the plunge does not move either.
    expect(wedge.apexX).toBe(50)
    expect(wedge.apexElev).toBe(tieElevAt(tie, 50))
  })

  it('PT2 — the wedge is OPEN from its own test all the way to its apex', () => {
    // The shape is a triangle: it starts at the band's full thickness on its own
    // column and narrows to nothing at the termination, never turning inside out
    // on the way. A tie that falls 2.51 m over the half-gap does not change what
    // an onlap IS.
    const { wedge } = wedgeOf()
    for (const x of [95, 90, 80, 75, 60, 51]) {
      expect(
        wedge.topAt(x) - wedge.baseAt(x),
        `the wedge is inside out at x = ${x}`,
      ).toBeGreaterThan(0)
    }
    // ...and it closes to a point, exactly, at the apex.
    expect(wedge.baseAt(50)).toBe(wedge.topAt(50))
    expect(wedge.baseAt(50)).toBe(wedge.apexElev)
  })

  it('PT3 — *"where a band\'s own construct speaks, it speaks completely"*: it claims its wedge', () => {
    // Mid-way to the apex the wedge holds real ground between the tie above and
    // the closing contact below. Every point of it is the loose sand's.
    const { wedge } = wedgeOf()
    for (const x of [90, 80, 75, 65, 55]) {
      const mid = (wedge.topAt(x) + wedge.baseAt(x)) / 2
      expect(claims(wedge, x, mid), `the band disowned its own wedge at x = ${x}`).toBe(true)
    }
  })

  it('PT4 — and on the section the wedge is PAINTED, not handed to the medium sand beside it', () => {
    // The dogfeed report itself: the construct emitted and the screen showed no
    // loose sand at all, the neighbouring medium taking its ground instead.
    const out = regionsOf()
    const painted = paintAt(out.regions, 0, 0.75, 5.67)
    expect(painted, 'nothing at all is painted inside the wedge').not.toBeNull()
    expect(painted?.formationId, 'the neighbour took the wedge').toBe(LOOSE)
    expect(
      out.regions.filter((r) => r.gapIndex === 0 && r.formationId === LOOSE).length,
      'the loose sand emitted an onlap and drew nothing',
    ).toBeGreaterThan(0)
  })

  it('PT6 — and the silence tripwire agrees: nothing here emitted and drew nothing', () => {
    // A FORWARD GUARD, and its limits are worth stating. On the BROKEN engine
    // this scene's inverted wedge still kept the first 16 % of its half-gap —
    // ``t = h/|Δ| = 0.41/2.51`` — and the arrangement cut a sliver face there,
    // so ``silentConstructs`` alone stayed quiet and PT4 is what went red. On
    // the owner's own Tie-section 12 the same construct kept nothing at all and
    // the tripwire named it exactly (``g0 onlap apexF=0.500 ZAND|5 7.03..6.62``),
    // which is where its teeth were verified; the detector's own pins are SC1-SC4.
    // What this pin adds is engine-level: if a later change makes this wedge
    // silent outright, it fails here rather than on a dogfeed.
    fillGapProbe.enabled = true
    fillGapProbe.entries.length = 0
    let probes: (typeof fillGapProbe)['entries']
    try {
      regionsOf()
    } finally {
      probes = [...fillGapProbe.entries]
      fillGapProbe.entries.length = 0
      fillGapProbe.enabled = false
    }
    // The scene has to produce the construct it is pinning, or the sweep below
    // passes by being empty.
    const emitted = probes.flatMap((p) => p.constructs).find((c) => c.layer === 'R-thin')
    expect(emitted?.emit, 'the scene emitted no onlap for the loose sand').toBe('onlap')
    expect(silentConstructs(probes)).toEqual([])
  })

  it('PT5 — CONTROL: a near-horizontal tie is unchanged — open, and closed at one vertex', () => {
    // The gentle case never inverted and must not start to. Same band, same
    // single tie, only the far end moved: 0.40 m of fall across the whole gap
    // against 0.41 m of band, so the old chase-the-line arithmetic stayed the
    // right way up here and the new one must agree with it about the shape.
    const { wedge, tie } = wedgeOf(6.63)
    expect(wedge.emit).toBe('onlap')
    expect(wedge.topAt(100)).toBe(7.03)
    expect(wedge.baseAt(100)).toBe(6.62)
    for (const x of [95, 80, 75, 60, 51]) {
      expect(wedge.topAt(x) - wedge.baseAt(x), `the gentle wedge closed early at x = ${x}`).toBeGreaterThan(0)
    }
    expect(wedge.apexElev).toBe(tieElevAt(tie, 50))
    expect(wedge.baseAt(50)).toBe(wedge.topAt(50))
  })
})
