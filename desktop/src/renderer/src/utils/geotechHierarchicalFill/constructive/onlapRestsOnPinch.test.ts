/**
 * AN ONLAP RESTS ON WHAT IT SITS ON — *"why the fuck is there a zigzag in that
 * onlap?"*
 *
 * Owner dogfeed, 2026-08-26, Tie-section 12 gap 0. The loose sand's wedge paints
 * now, but its underside ZIGZAGS: the base runs down the closing line, then
 * BACKTRACKS in x around the tip of the medium lens directly beneath it, then
 * comes forward again along that lens's top. The loose sand has wrapped
 * UNDERNEATH a mass it sits on top of at its own test.
 *
 * WHY IT HAPPENS. Both lines leave the SAME point — the shared contact at the
 * band's own column — and the onlap's closing line dives STEEPER than the lens's
 * flank falls. So a little before the lens pinches out, the closing line has
 * passed below the lens's BASE, and the ground between the two belongs to the
 * loose sand by its own ``claims()``. On his section that hair-sliver is a
 * hundredth of the gap wide and a few centimetres tall, and it is a notch on
 * screen.
 *
 * THE RULING (2026-08-26). An onlap's base RESTS ON the construct below it until
 * that construct pinches out, then runs STRAIGHT from the pinch-tip to its own
 * apex. It never wraps underneath a mass it sits on top of at its own column.
 * The wedge's apex and its tie-side geometry do not move; the hair-sliver it
 * gives up goes to whatever owns the surrounding ground.
 *
 * ...and the MIRROR is the same statement upside down: an onlap that rides its
 * BASE tie has its free contact on TOP, and it may not wrap OVER a lens it sits
 * beneath.
 *
 * The scene is the owner's own: two tests 100 m apart, a 0.41 m loose sand on the
 * right whose single tie plunges 5.02 m across the gap, and a 0.78 m medium lens
 * immediately below it whose reach the same tie halves twice down to 0.1125.
 * Every number below is that scene's, not an invented one.
 */
import { describe, expect, it } from 'vitest'

import { buildGapConstructs, claims, type RunBand, type RunColumn, type RunTie } from './constructs'
import type { Mass } from './emitKernel'
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

/** Where the lens pinches out: 0.1125 of the gap in from its own test. */
const LENS_TIP_X = 88.75
/** The lens's own mid-level — its two flanks' shared vertex at the tip. */
const LENS_TIP_ELEV = 6.23
/** Where the onlap closes: *"it terminates at 0.5 Distance approximately."* */
const ONLAP_APEX_X = 50
/** The plunging tie's own elevation there — the wedge's single closing vertex. */
const ONLAP_APEX_ELEV = 4.52

const band = (
  layerId: string,
  formationId: string,
  top: number,
  base: number,
  ci: number,
  x: number,
): RunBand => ({ layerId, formationId, bodyId: null, top, base, ci, x })

interface Scene {
  left: RunColumn
  right: RunColumn
  ties: RunTie[]
  stacks: Map<number, RunBand[]>
  massOf: (b: RunBand) => Mass
}

/**
 * TIE-SECTION 12, GAP 0 — with the medium lens the dogfeed is about.
 *
 * Left (S14, f = 0) reads dense to +2.01, a medium mass spanning to −5, dense
 * below. Right (S6, f = 1) reads dense to +7.03, the LOOSE sand 7.03 .. 6.62,
 * then the MEDIUM LENS 6.62 .. 5.84, then dense to −3.
 *
 * Two ties: the loose sand's top to the spanning mass's top (the 5.02 m plunge),
 * and the two deep contacts. The lens carries none — which is what makes it a
 * lens, and what puts its tip inside the loose sand's own half-gap.
 *
 * @param farTop The plunging tie's elevation on S14. Defaults to the owner's
 *   +2.01; the control passes a value that makes the dive gentle instead.
 * @returns The gap, ready for ``buildGapConstructs``.
 */
function ts12WithLens(farTop: number = 2.01): Scene {
  const upperLeft = band('L-upper', DENSE, 12, farTop, 0, 0)
  const spanLeft = band('L-span', MEDIUM, farTop, -5, 0, 0)
  const deepLeft = band('L-deep', DENSE, -5, -12, 0, 0)
  const upperRight = band('R-upper', DENSE, 12, 7.03, 1, 100)
  const thin = band('R-thin', LOOSE, 7.03, 6.62, 1, 100)
  const lens = band('R-lens', MEDIUM, 6.62, 5.84, 1, 100)
  const midRight = band('R-mid', DENSE, 5.84, -3, 1, 100)
  const deepRight = band('R-deep', MEDIUM, -3, -12, 1, 100)
  return {
    left: { ci: 0, x: 0, bands: [upperLeft, spanLeft, deepLeft] },
    right: { ci: 1, x: 100, bands: [upperRight, thin, lens, midRight, deepRight] },
    ties: [
      { key: 'tie-plunge', leftCi: 0, rightCi: 1, leftX: 0, rightX: 100, leftY: farTop, rightY: 7.03 },
      { key: 'tie-deep', leftCi: 0, rightCi: 1, leftX: 0, rightX: 100, leftY: -5, rightY: -3 },
    ],
    stacks: new Map([
      [0, [upperLeft, spanLeft, deepLeft]],
      [1, [upperRight, thin, lens, midRight, deepRight]],
    ]),
    massOf: (b) => ({ litho: 'SAND', packing: b.formationId }),
  }
}

/**
 * THE SAME SCENE UPSIDE DOWN — the mirror the ruling's second half is about.
 *
 * Negating every elevation turns the loose sand's top tie into a base tie, so
 * its free contact is its TOP, and puts the medium lens ABOVE it. The wrap is
 * then over the lens instead of under it, and nothing else about the scene
 * changes — which is the point.
 *
 * @param scene The upright scene.
 * @returns Its mirror image about elevation zero.
 */
function mirrored(scene: Scene): Scene {
  const flipBand = (b: RunBand): RunBand => ({ ...b, top: -b.base, base: -b.top })
  const flipColumn = (c: RunColumn): RunColumn => ({
    ...c,
    bands: [...c.bands].reverse().map(flipBand),
  })
  const flipped = new Map<number, RunBand[]>()
  for (const [ci, stack] of scene.stacks) flipped.set(ci, [...stack].reverse().map(flipBand))
  return {
    left: flipColumn(scene.left),
    right: flipColumn(scene.right),
    ties: scene.ties.map((t) => ({ ...t, leftY: -t.leftY, rightY: -t.rightY })),
    stacks: flipped,
    massOf: scene.massOf,
  }
}

/** One band's construct in the gap, by layer id. */
function constructOf(scene: Scene, layerId: string): ReturnType<typeof buildGapConstructs>[number] {
  const constructs = buildGapConstructs(scene.left, scene.right, scene.ties, [], scene.stacks, scene.massOf)
  const found = constructs.find((c) => c.band.layerId === layerId)
  if (found === undefined) throw new Error(`the scene emitted no construct for ${layerId}`)
  return found
}

/**
 * The same scene as a full section: one sand litho unit, the bands inside it.
 *
 * @returns Every region the geotech fill emits.
 */
function regionsOf(): ReturnType<typeof computeHierarchicalGeotechFill> {
  const depth = (elevation: number): number => 12 - elevation
  const litho: PartitionColumn[] = [
    column('S14', 12, [{ layerId: 'L-sand', formationId: SAND, top: 0, base: 24 }]),
    column('S6', 12, [{ layerId: 'R-sand', formationId: SAND, top: 0, base: 24 }]),
  ]
  const lithoEdges: CorrelationEdge[] = [lithoTie('L-sand', 'R-sand')]
  const geotechColumns: PartitionColumn[] = [
    column('S14', 12, [
      { layerId: 'L-upper', formationId: DENSE, top: 0, base: depth(2.01) },
      { layerId: 'L-span', formationId: MEDIUM, top: depth(2.01), base: depth(-5) },
      { layerId: 'L-deep', formationId: DENSE, top: depth(-5), base: 24 },
    ]),
    column('S6', 12, [
      { layerId: 'R-upper', formationId: DENSE, top: 0, base: depth(7.03) },
      { layerId: 'R-thin', formationId: LOOSE, top: depth(7.03), base: depth(6.62) },
      { layerId: 'R-lens', formationId: MEDIUM, top: depth(6.62), base: depth(5.84) },
      { layerId: 'R-mid', formationId: DENSE, top: depth(5.84), base: depth(-3) },
      { layerId: 'R-deep', formationId: MEDIUM, top: depth(-3), base: 24 },
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

/** The lens's own two flanks, straight from its column to its tip. */
const lensTopAt = (x: number): number => 6.62 - ((100 - x) / 11.25) * 0.39
const lensBaseAt = (x: number): number => 5.84 + ((100 - x) / 11.25) * 0.39

describe('an onlap rests on the construct below it and never wraps under it', () => {
  it('OR1 — the scene is the one the dogfeed is about: an onlap over a lens that pinches first', () => {
    const scene = ts12WithLens()
    const wedge = constructOf(scene, 'R-thin')
    const lens = constructOf(scene, 'R-lens')
    expect(wedge.emit).toBe('onlap')
    expect(wedge.topTied, 'the tie is on its TOP — the base is the contact that closes').toBe(true)
    expect(wedge.apexX).toBe(ONLAP_APEX_X)
    expect(wedge.apexElev).toBeCloseTo(ONLAP_APEX_ELEV, 9)
    expect(lens.emit).toBe('lens')
    // The lens pinches out INSIDE the onlap's own half-gap — that is what makes
    // it the construct the onlap rests on, and what gives the base a tip to
    // leave from.
    expect(lens.apexX).toBeCloseTo(LENS_TIP_X, 9)
    expect(lens.topAt(LENS_TIP_X)).toBeCloseTo(LENS_TIP_ELEV, 9)
  })

  it('OR2 — from its own test to the tip the onlap\'s base IS the lens\'s top flank', () => {
    // *"an onlap's base rests ON the construct below it until that construct
    // pinches out"* — the two lines are one line over that stretch, so there is
    // nothing between them for the onlap to claim.
    const wedge = constructOf(ts12WithLens(), 'R-thin')
    for (const x of [100, 97, 94.375, 91, LENS_TIP_X]) {
      expect(wedge.baseAt(x), `the base left the lens's flank at x = ${x}`).toBeCloseTo(
        lensTopAt(x),
        9,
      )
    }
  })

  it('OR3 — past the tip it runs STRAIGHT to its own apex: no vertical, no backtrack', () => {
    // One segment from the pinch-tip to the wedge's own closing vertex. Straight
    // means the midpoint of the segment is on it, and monotone means the base
    // only ever falls as the wedge runs away from its test.
    const wedge = constructOf(ts12WithLens(), 'R-thin')
    expect(wedge.baseAt(LENS_TIP_X)).toBeCloseTo(LENS_TIP_ELEV, 9)
    expect(wedge.baseAt(ONLAP_APEX_X)).toBeCloseTo(ONLAP_APEX_ELEV, 9)
    const midX = (LENS_TIP_X + ONLAP_APEX_X) / 2
    expect(wedge.baseAt(midX)).toBeCloseTo((LENS_TIP_ELEV + ONLAP_APEX_ELEV) / 2, 9)
    let previous = wedge.baseAt(100)
    for (let x = 99.5; x >= ONLAP_APEX_X; x -= 0.5) {
      const here = wedge.baseAt(x)
      expect(here, `the base climbed back up at x = ${x}`).toBeLessThanOrEqual(previous + 1e-9)
      previous = here
    }
    // ...and the wedge is still a wedge: open from its own test, closed at one
    // vertex, exactly as the plunging-tie ruling left it.
    for (const x of [99, 95, 90, 80, 60, 51]) {
      expect(wedge.topAt(x) - wedge.baseAt(x), `the wedge is inside out at x = ${x}`).toBeGreaterThan(0)
    }
    expect(wedge.baseAt(ONLAP_APEX_X)).toBe(wedge.topAt(ONLAP_APEX_X))
  })

  it('OR4 — it claims NO ground below the lens it sits on', () => {
    // The notch itself. Just inside the tip the old closing line ran below the
    // lens's BASE, and every point between the two read as loose sand.
    const wedge = constructOf(ts12WithLens(), 'R-thin')
    for (const x of [89.3, 89.5, 89.8]) {
      const underneath = lensBaseAt(x) - 0.005
      expect(
        claims(wedge, x, underneath),
        `the loose sand wrapped under the lens at x = ${x}`,
      ).toBe(false)
    }
  })

  it('OR5 — on the section the notch is gone and the freed sliver goes to the ground around it', () => {
    const out = regionsOf()
    // A sample inside the old wrap: below the lens's base, above the old closing
    // line. It belongs to the medium mass that surrounds it, never to the loose
    // sand above the lens.
    const painted = paintAt(out.regions, 0, 0.893, 6.1908)
    expect(painted, 'nothing at all is painted in the freed sliver').not.toBeNull()
    expect(painted?.formationId, 'the loose sand still holds ground under the lens').toBe(MEDIUM)
    // ...and the wedge it DOES own is untouched.
    expect(paintAt(out.regions, 0, 0.75, 5.7)?.formationId, 'the wedge lost its own ground').toBe(
      LOOSE,
    )
  })

  it('OR6 — CONTROL: nothing pinching below it — the base is one straight line', () => {
    // The band below closes at the same middle the onlap does, so it offers no
    // tip inside the onlap's own reach and the ruling has nothing to act on.
    const scene = ts12WithLens()
    scene.right.bands = scene.right.bands.filter((b) => b.layerId !== 'R-lens')
    scene.right.bands[2] = { ...scene.right.bands[2], top: 6.62 }
    scene.stacks.set(1, scene.right.bands)
    const wedge = constructOf(scene, 'R-thin')
    const straight = (x: number): number =>
      6.62 + ((x - 100) / (ONLAP_APEX_X - 100)) * (ONLAP_APEX_ELEV - 6.62)
    for (const x of [100, 94.375, LENS_TIP_X, 70, ONLAP_APEX_X]) {
      expect(wedge.baseAt(x), `the straight closing line moved at x = ${x}`).toBeCloseTo(
        straight(x),
        9,
      )
    }
  })

  it('OR7 — CONTROL: a lens below, but the dive never reaches it — unchanged', () => {
    // Same lens, same tip, only the tie's far end moved so the wedge closes
    // gently. The closing line stays above the lens's top the whole way, so it
    // rests on nothing and remains one straight segment.
    const scene = ts12WithLens(6.3)
    const wedge = constructOf(scene, 'R-thin')
    const lens = constructOf(scene, 'R-lens')
    expect(lens.emit, 'the control lost the lens it is controlling for').toBe('lens')
    expect(lens.apexX, 'the control lens no longer pinches inside the onlap').toBeGreaterThan(
      ONLAP_APEX_X,
    )
    const apexElev = wedge.apexElev as number
    const straight = (x: number): number =>
      6.62 + ((x - 100) / (ONLAP_APEX_X - 100)) * (apexElev - 6.62)
    for (const x of [100, 94.375, 80, 60, ONLAP_APEX_X]) {
      expect(wedge.baseAt(x), `the gentle closing line moved at x = ${x}`).toBeCloseTo(straight(x), 9)
      expect(
        wedge.baseAt(x),
        `the gentle wedge reached the lens at x = ${x}`,
      ).toBeGreaterThanOrEqual(lens.topAt(x))
    }
  })

  it('OR8 — MIRROR: an onlap riding its BASE tie never wraps OVER the lens above it', () => {
    // The same scene upside down: the free contact is the TOP now, the lens sits
    // above, and the wrap would be over it instead of under. Mirroring swaps the
    // lens's two flanks, so the one the onlap rests against is the image of the
    // upright lens's TOP flank, and the illegal ground is above the image of its
    // BASE flank.
    const wedge = constructOf(mirrored(ts12WithLens()), 'R-thin')
    expect(wedge.emit).toBe('onlap')
    expect(wedge.baseTied, 'the mirror puts the tie on the BASE').toBe(true)
    for (const x of [100, 97, 94.375, 91, LENS_TIP_X]) {
      expect(wedge.topAt(x), `the top left the lens's own flank at x = ${x}`).toBeCloseTo(
        -lensTopAt(x),
        9,
      )
    }
    expect(wedge.topAt(LENS_TIP_X)).toBeCloseTo(-LENS_TIP_ELEV, 9)
    expect(wedge.topAt(ONLAP_APEX_X)).toBeCloseTo(-ONLAP_APEX_ELEV, 9)
    for (const x of [89.3, 89.5, 89.8]) {
      const over = -lensBaseAt(x) + 0.005
      expect(claims(wedge, x, over), `the loose sand wrapped over the lens at x = ${x}`).toBe(false)
    }
  })
})
