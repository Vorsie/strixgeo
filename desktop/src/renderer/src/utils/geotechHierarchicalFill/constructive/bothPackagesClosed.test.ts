/**
 * BOTH PACKAGES CLOSED AT THE MIDDLE — the constructive engine's half.
 *
 * Owner, 2026-08-24, asked what owns the ground left between two closed loops
 * when the two facing packages both close at the middle — left half to the left
 * column's masses, right half to the right's? — *"yes in this case i'd rather
 * have a vertical line"*. The v2 direct engine already answers this
 * (``partitionFillV2/bothSidesClosed.ts``); these pins are the same ruling for
 * the CONSTRUCTIVE engine, which is what the framed geotech axis runs.
 *
 * THE SCENE is a minimal reduction of his own CS2 gap 0 — GEO-23/125-S34 at
 * 8 m, GEO-10/117-B1 at 77 m, and GEO-05/040-S1 0.4 m further on. Every band of
 * B1's sand package carries a same-class hop tie to S1 across the OTHER gap and
 * NONE across the gap being filled, so on his screen the whole package welded
 * left across 69 m of ground over S34's correctly-closed constructs.
 *
 * WHAT THESE MUST NOT BREAK — the SF-silt fill-through (ruled 2026-08-21): one
 * side OPEN, the facing side CLOSED, and the open mass fills through. The last
 * pin here is that case, and the real-data pin is ``loopClosureScenes`` S16a.
 */
import { describe, expect, it } from 'vitest'

import { computeHierarchicalGeotechFill } from '../index'
import { column, paintAt, tie } from '../scene.test-helpers'
import { computeSectionFillActive } from '../../partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../../sectionPartition'

/** The one litho soil every band below subdivides. */
const SAND = 'f-sand'
const MEDIUM = 'g-sand-medium'
const DENSE = 'g-sand-dense'
const VERY_DENSE = 'g-sand-very-dense'

/** S34 at 8 m, B1 at 77 m, S1 0.4 m past B1 — his own spacing, rebased to 0. */
const ALONG = [0, 69, 69.4]

/** One SAND unit per column, correlated straight through — one family. */
function lithoScene(): { columns: PartitionColumn[]; edges: CorrelationEdge[] } {
  return {
    columns: [
      column('A', 10, [{ layerId: 'LA', formationId: SAND, top: 0, base: 14 }]),
      column('B', 10, [{ layerId: 'LB', formationId: SAND, top: 0, base: 14 }]),
      column('C', 10, [{ layerId: 'LC', formationId: SAND, top: 0, base: 14 }]),
    ],
    edges: [tie('LA', 'LB'), tie('LB', 'LC')],
  }
}

/**
 * A's package, B's package, and C — B's package repeated 0.4 m along, which is
 * what GEO-05/040-S1 is. A carries no VERY_DENSE anywhere.
 */
function geotechColumns(): PartitionColumn[] {
  return [
    column('A', 10, [
      { layerId: 'GA1', formationId: DENSE, top: 0, base: 3 },
      { layerId: 'GA2', formationId: MEDIUM, top: 3, base: 14 },
    ]),
    column('B', 10, [
      { layerId: 'GB1', formationId: MEDIUM, top: 0, base: 3 },
      { layerId: 'GB2', formationId: VERY_DENSE, top: 3, base: 7 },
      { layerId: 'GB3', formationId: DENSE, top: 7, base: 14 },
    ]),
    column('C', 10, [
      { layerId: 'GC1', formationId: MEDIUM, top: 0, base: 3 },
      { layerId: 'GC2', formationId: VERY_DENSE, top: 3, base: 7 },
      { layerId: 'GC3', formationId: DENSE, top: 7, base: 14 },
    ]),
  ]
}

/**
 * B's whole package hops to C across gap 1 — top AND base of each band, so
 * every one of them has two tied contacts THERE and emits nothing there. Not
 * one of these crosses gap 0.
 */
const HOPS_TO_C: CorrelationEdge[] = [
  tie('GB1', 'GC1', 'top', 'top'),
  tie('GB2', 'GC2', 'top', 'top'),
  tie('GB3', 'GC3', 'top', 'top'),
  tie('GB3', 'GC3', 'base', 'base'),
]

function run(geotechEdges: CorrelationEdge[]): ReturnType<typeof computeHierarchicalGeotechFill> {
  const litho = lithoScene()
  return computeHierarchicalGeotechFill({
    lithoColumns: litho.columns,
    lithoEdges: litho.edges,
    lithoRegions: computeSectionFillActive(litho.columns, litho.edges, undefined, ALONG),
    geotechColumns: geotechColumns(),
    geotechEdges,
    alongM: ALONG,
  })
}

/**
 * Every edge of a ring that changes elevation AND fraction at once.
 *
 * *"keep mtaw lvl"* is a statement about the SHAPE, not about which class a
 * sample lands in, so the pins below read the ring itself. A band held at
 * constant elevation to the seam is bounded by horizontal and vertical edges
 * only; a wedge or a fraction-space rescale needs a sloping one, so the ruling
 * holds exactly when this is empty. Collinear vertices the face merge leaves on
 * a straight boundary are not a shape and do not show up here.
 *
 * @param region The region to measure.
 * @returns One readable string per sloping edge; empty where none slopes.
 */
function slopingEdges(region: SectionRegion): string[] {
  const point = (p: { fraction: number; elevation: number }): string =>
    `(${p.fraction.toFixed(3)}, ${p.elevation.toFixed(2)})`
  const out: string[] = []
  for (let i = 0; i < region.polygon.length; i++) {
    const a = region.polygon[i]
    const b = region.polygon[(i + 1) % region.polygon.length]
    if (Math.abs(a.fraction - b.fraction) > 1e-6 && Math.abs(a.elevation - b.elevation) > 1e-6) {
      out.push(`${point(a)}->${point(b)}`)
    }
  }
  return out
}

/**
 * The window a region occupies, on the mm grid.
 *
 * @param region The region to measure.
 * @returns Its fraction span and its elevation span.
 */
function windowOf(region: SectionRegion): {
  fractions: [number, number]
  elevations: [number, number]
} {
  const fractions = region.polygon.map((p) => Number(p.fraction.toFixed(4)))
  const elevations = region.polygon.map((p) => Number(p.elevation.toFixed(3)))
  return {
    fractions: [Math.min(...fractions), Math.max(...fractions)],
    elevations: [Math.min(...elevations), Math.max(...elevations)],
  }
}

// ---------------------------------------------------------------------------
// The stacked-seam scenes — two columns, real NAD classes, his own spacing.
// ---------------------------------------------------------------------------

/** The clay unit that interrupts A's sand, and lenses out because nothing ties it. */
const CLAY = 'f-clay'
const N5 = 'g-zand-5'
const N6 = 'g-zand-6'
const N7 = 'g-zand-7'
const N8 = 'g-zand-8'
const K21 = 'g-klei-21'

/**
 * The class map the law compares masses by — without it every band keeps row
 * identity and *"least dense"* has no ordering to read (see ``packingClassOf``).
 */
const PACKING = new Map<string, string>([
  [N5, 'ZAND|5'],
  [N6, 'ZAND|6'],
  [N7, 'ZAND|7'],
  [N8, 'ZAND|8'],
  [K21, 'KLEI|21'],
])

/** S34 and B1 alone — the two tests the ruling's own gap runs between. */
const PAIR = [0, 69]

/**
 * A's sand interrupted by an uncorrelated clay, facing B's unbroken sand.
 *
 * A carries a band ABOVE the clay and one BELOW it and nothing at the clay's
 * own levels; the clay lenses out at ``LENS_PINCH_FRACTION`` (0.45), so the
 * sliver from there to the seam is sand cover with no band of A's in it — the
 * hole the least-dense rule answers. Both packages are closed (every contact
 * that carries a tie reads a different class at the far end) and both are
 * stacked, so the rule applies.
 *
 * @param stack Which class stands above the clay and which below.
 * @returns The fill's output for the scene.
 */
function holeScene(stack: {
  above: string
  below: string
}): ReturnType<typeof computeHierarchicalGeotechFill> {
  const lithoColumns = [
    column('A', 10, [
      { layerId: 'LA1', formationId: SAND, top: 0, base: 3 },
      { layerId: 'LAC', formationId: CLAY, top: 3, base: 5 },
      { layerId: 'LA2', formationId: SAND, top: 5, base: 14 },
    ]),
    column('B', 10, [{ layerId: 'LB', formationId: SAND, top: 0, base: 14 }]),
  ]
  const lithoEdges = [tie('LA1', 'LB', 'top', 'top'), tie('LA2', 'LB', 'base', 'base')]
  return computeHierarchicalGeotechFill({
    lithoColumns,
    lithoEdges,
    lithoRegions: computeSectionFillActive(lithoColumns, lithoEdges, undefined, PAIR),
    geotechColumns: [
      column('A', 10, [
        { layerId: 'GA1', formationId: stack.above, top: 0, base: 3 },
        { layerId: 'GAC', formationId: K21, top: 3, base: 5 },
        { layerId: 'GA2', formationId: stack.below, top: 5, base: 14 },
      ]),
      column('B', 10, [
        { layerId: 'GB1', formationId: N5, top: 0, base: 4 },
        { layerId: 'GB2', formationId: N8, top: 4, base: 14 },
      ]),
    ],
    geotechEdges: [tie('GA1', 'GB1', 'top', 'top'), tie('GA2', 'GB2', 'base', 'base')],
    alongM: PAIR,
    packingClassOf: PACKING,
  })
}

/**
 * ONE band facing ONE band, both closed — the case the ruling leaves alone.
 *
 * @returns The fill's output for the scene.
 */
function oneOnOneScene(): ReturnType<typeof computeHierarchicalGeotechFill> {
  const lithoColumns = [
    column('A', 10, [{ layerId: 'LA', formationId: SAND, top: 0, base: 14 }]),
    column('B', 10, [{ layerId: 'LB', formationId: SAND, top: 0, base: 14 }]),
  ]
  const lithoEdges = [tie('LA', 'LB', 'top', 'top'), tie('LA', 'LB', 'base', 'base')]
  return computeHierarchicalGeotechFill({
    lithoColumns,
    lithoEdges,
    lithoRegions: computeSectionFillActive(lithoColumns, lithoEdges, undefined, PAIR),
    geotechColumns: [
      column('A', 10, [{ layerId: 'GA1', formationId: N6, top: 0, base: 14 }]),
      column('B', 10, [{ layerId: 'GB1', formationId: N8, top: 0, base: 14 }]),
    ],
    geotechEdges: [tie('GA1', 'GB1', 'top', 'top')],
    alongM: PAIR,
    packingClassOf: PACKING,
  })
}

describe('both packages closed at the middle — the leftover splits at the seam', () => {
  it('BC1: a band with NO tie across this gap never reaches the facing test', () => {
    // *"If litho has no ties emit lens"* (2026-08-19). B's VERY_DENSE has no
    // tie across gap 0 — A carries no very dense sand at all, so there is
    // nothing over there for it to weld to. It closes near its own test; the
    // far half of the gap is A's ground and no class of B's may stand in it.
    const out = run([tie('GA1', 'GB1', 'top', 'top'), ...HOPS_TO_C])
    for (const e of [6.5, 5.0, 3.5]) {
      expect(
        paintAt(out.regions, 0, 0.1, e)?.formationId,
        `B's very dense sand welded across the gap at elevation ${e}`,
      ).not.toBe(VERY_DENSE)
    }
    // ...and it is still B's own ground beside B's own test.
    expect(paintAt(out.regions, 0, 0.9, 5.0)?.formationId).toBe(VERY_DENSE)
  })

  it('BC2: a band whose only ties hop across the OTHER gap never reaches A', () => {
    // The kernel's contract is PER GAP: *"the mass on the far end of each tie
    // the band carries across THIS gap"*. C stands beyond B and flanks gap 1,
    // not gap 0 — it is B's neighbour, not A's — so no ground on A's own half
    // may be answered by a band of C, whatever C's bands are tied to over
    // there. (C's own half is not asserted: a test beyond the gap continuing
    // its mass into the half on its own side is the deep-VD case, which is
    // ruled the other way.)
    const out = run([tie('GA1', 'GB1', 'top', 'top'), ...HOPS_TO_C])
    const fromC = out.regions
      .filter((r) => r.gapIndex === 0 && r.polygon.some((p) => p.fraction < 0.49))
      .flatMap((r) => r.layerIds ?? [])
      .filter((id) => id.startsWith('GC'))
    expect(fromC, "a band of C answered ground on A's own half").toEqual([])
  })

  it('BC3: two onlaps facing each other on one tie MEET at the middle', () => {
    // Owner 2026-08-25: *"no it has one tie on top, so it should onlap that
    // same tie"* — so A's dense and B's medium both onlap the line they share
    // and both pinch at the middle. (This scene's two bands are 3.00 m each, so
    // it drew exactly this under the 2026-08-21 clearly-thicker-wins collision
    // too; retiring that rule makes the outcome unconditional rather than a
    // consequence of their being evenly matched.) Each owns its own half of the
    // tie and neither crosses it.
    const out = run([tie('GA1', 'GB1', 'top', 'top'), ...HOPS_TO_C])
    expect(paintAt(out.regions, 0, 0.25, 9.0)?.formationId, "A's half of the tie").toBe(DENSE)
    expect(paintAt(out.regions, 0, 0.75, 9.0)?.formationId, "B's half of the tie").toBe(MEDIUM)
  })

  it('BC4: the leftover between the closed loops splits at the seam', () => {
    // The 2026-08-24 ruling itself, sampled OUTSIDE every construct — this is
    // the ground the remainder answers. Under the tie every construct of both
    // columns is closed (A's medium lenses; B's very dense and dense lens), so
    // nobody runs through and *"i'd rather have a vertical line"*: at one and
    // the same elevation the left half continues A's masses and the right half
    // B's, and the two are different classes.
    const out = run([tie('GA1', 'GB1', 'top', 'top'), ...HOPS_TO_C])
    expect(paintAt(out.regions, 0, 0.3, 6.0)?.formationId, "A owns +6.0 on A's half").toBe(MEDIUM)
    expect(paintAt(out.regions, 0, 0.7, 6.0)?.formationId, "B owns +6.0 on B's half").toBe(
      VERY_DENSE,
    )
    expect(paintAt(out.regions, 0, 0.35, -3.0)?.formationId, "A owns -3.0 on A's half").toBe(MEDIUM)
    expect(paintAt(out.regions, 0, 0.85, -3.0)?.formationId, "B owns -3.0 on B's half").toBe(DENSE)
  })

  it('BC5: SF-SILT — one side open, the facing side closed, and the open mass fills through', () => {
    // RULED 2026-08-21 and unchanged: *"had 2 ties, so it shoudnt emit jack
    // shit, which leaves it open ... the other silt onlaps and the sf silt
    // fills."* A's medium now has a tied contact top AND base across gap 0, so
    // it is the open mass; B's bands close against it and its ground runs on
    // past the middle into B's half.
    const out = run([
      tie('GA1', 'GB1', 'top', 'top'),
      tie('GA2', 'GB2', 'top', 'top'),
      tie('GA2', 'GB3', 'base', 'base'),
      ...HOPS_TO_C,
    ])
    expect(paintAt(out.regions, 0, 0.9, 2.5)?.formationId, 'the open mass stopped at the seam').toBe(
      MEDIUM,
    )
  })
})

/**
 * ...AND WHAT EACH HALF LOOKS LIKE — owner, 2026-08-25.
 *
 * The seam of 2026-08-24 put the leftover on the right side of the line; this
 * is the geometry INSIDE each half, and it is the owner's own two messages:
 *
 *   *"why don't we keep thickness horizontally, and then where gaps emerge
 *    e.g. the silt lense we fill with the least decent adjacent (above or
 *    below) packing?"* — corrected in the same breath to *"or better even keep
 *    mtaw lvl"*.
 *
 *   *"this is only the rule for vertical seems with a stacked sequence on both
 *    side, if it is one on one the rule stays the same. least dense yeah, The
 *    different height is acceptable, i will prolly tie the dense sand on one
 *    column to the dense sand on the second column anyway after this fix, but
 *    we need a decent fallback"*.
 *
 * So: STACKED on both sides, both closed → each test's bands run to the seam at
 * their own mTAW, holes take the LEAST DENSE neighbour, and the step where the
 * two stacks meet is accepted. One-on-one keeps the behaviour it already had.
 * This is the FALLBACK for un-correlated packages — once he ties band to band
 * the ties are real correlations and this rule no longer reaches them.
 */
describe('a stacked seam half keeps mTAW level', () => {
  it('SS1: each half runs its own test bands horizontally to the seam', () => {
    // *"keep mtaw lvl"*. A reads DENSE 10..7 over MEDIUM 7..-4; B reads MEDIUM
    // 10..7, VERY DENSE 7..3, DENSE 3..-4. Every band of both is closed and
    // neither package runs through, so A's half IS A's stack at A's own
    // elevations and B's half IS B's — five rectangles, no wedge, no rescale.
    const out = run([tie('GA1', 'GB1', 'top', 'top'), ...HOPS_TO_C])
    const at = (f: number, e: number): SectionRegion => {
      const region = paintAt(out.regions, 0, f, e)
      expect(region, `nothing is painted at (${f}, ${e})`).not.toBeNull()
      return region as SectionRegion
    }
    /** One band of one half: the class it must be, and the window it must fill. */
    const band = (
      f: number,
      e: number,
      formationId: string,
      window: { fractions: [number, number]; elevations: [number, number] },
    ): void => {
      const region = at(f, e)
      expect(region.formationId, `the class at (${f}, ${e})`).toBe(formationId)
      expect(slopingEdges(region), `the band at (${f}, ${e}) wedges or rescales`).toEqual([])
      expect(windowOf(region), `the band at (${f}, ${e}) does not reach the seam`).toEqual(window)
    }
    // A's half — its two bands, at A's own two contacts, flat to the seam.
    band(0.25, 8.5, DENSE, { fractions: [0, 0.5], elevations: [7, 10] })
    band(0.25, 0, MEDIUM, { fractions: [0, 0.5], elevations: [-4, 7] })
    // The band boundary is HORIZONTAL: just under A's own contact at +7 the
    // class is still dense all the way to the seam, and just over it, medium.
    expect(at(0.45, 7.5).formationId, "A's contact sagged or rose toward the seam").toBe(DENSE)
    expect(at(0.45, 6.5).formationId, "A's contact sagged or rose toward the seam").toBe(MEDIUM)
    // B's half — its three bands, at B's own three contacts.
    band(0.75, 8.5, MEDIUM, { fractions: [0.5, 1], elevations: [7, 10] })
    band(0.75, 5.0, VERY_DENSE, { fractions: [0.5, 1], elevations: [3, 7] })
    band(0.75, 0, DENSE, { fractions: [0.5, 1], elevations: [-4, 3] })
    // *"The different height is acceptable"* — A's contact at +7 meets B's at
    // +7 here, but B's other two contacts (+3) meet nothing on A's side, and
    // the step that leaves at the seam is the ruling, not a defect.
    expect(at(0.55, 5.0).formationId, "B's very dense sand at +5.0").toBe(VERY_DENSE)
    expect(at(0.45, 5.0).formationId, "A's medium sand faces it at +5.0").toBe(MEDIUM)
  })

  it('SS2: a hole in a half takes the LEAST DENSE of the bands above and below', () => {
    // *"where gaps emerge e.g. the silt lense we fill with the least decent
    // adjacent (above or below) packing"* — his own CS2 gap 0, reduced: A's
    // sand is interrupted by a clay unit nothing correlates, so the clay
    // lenses out at 0.45 and the sliver between its apex and the seam is sand
    // cover that A's OWN stack has no band for. Above it n6, below it n7, and
    // the loose one wins.
    const out = holeScene({ above: N6, below: N7 })
    expect(
      paintAt(out.regions, 0, 0.48, 6.0)?.formationId,
      'the hole past the lens apex went to hatch or to the denser neighbour',
    ).toBe(N6)
  })

  it('SS2b: ...LEAST dense, not simply the band above', () => {
    // The same hole with the stack inverted — n7 above, n6 below. If the rule
    // were "the mass above closes over it" this would paint n7; *"least dense
    // yeah"* makes it n6, from BELOW.
    const out = holeScene({ above: N7, below: N6 })
    expect(
      paintAt(out.regions, 0, 0.48, 6.0)?.formationId,
      'the hole took the band above rather than the least dense one',
    ).toBe(N6)
  })

  it('SS3: one on one, both closed — *"if it is one on one the rule stays the same"*', () => {
    // ONE band facing ONE band is explicitly OUT of the STACKED-SEAM rule's
    // scope: whatever the emit law already draws there stands, WEDGES AND ALL.
    // Two facing bands each carrying the one shared tie both onlap it (owner
    // 2026-08-25: *"no it has one tie on top, so it should onlap that same
    // tie"*) and meet at the middle, so each is the triangle from its own
    // full-thickness column edge to the seam. Pinned verbatim so the stacked
    // rule cannot leak into the case he ruled out of it.
    //
    // ...AND THE GROUND BELOW THE TWO TRIANGLES IS NO LONGER HATCH (owner,
    // 2026-08-26: *"if 2 lenses are pointed to eachother and there is nothing
    // else to fill the gap, no open band above or below, then you fill with the
    // lowest density"* — see ``leastDenseLeftover.ts``). This scene IS his
    // scene: nothing runs through, both wedges close, and what they leave takes
    // the LOWER of the two classes, NAD 6 against NAD 8. It stays ONE piece —
    // splitting it at the middle and giving each half its own side is the
    // reading he rejected that morning, *"a big NOOOO"*.
    //
    // NEITHER WEDGE MOVED. B's triangle is byte-identical below; A's own flank
    // from (0, -4) to (0.5, 10) is still exactly where the law drew it and is
    // now INTERIOR to A's region, because the leftover that welded onto it is
    // the same mass — which is the ordinary fill sweep, not a new shape.
    const out = oneOnOneScene()
    const shape = out.regions.map((r) => ({
      formationId: r.formationId,
      ring: r.polygon.map((p) => [Number(p.fraction.toFixed(3)), Number(p.elevation.toFixed(2))]),
    }))
    expect(shape, 'the one-on-one collision shapes moved').toEqual([
      { formationId: N6, ring: [[0, -4], [0.5, -4], [1, -4], [0.5, 10], [0, 10]] },
      { formationId: N8, ring: [[0.5, 10], [1, -4], [1, 10]] },
    ])
    expect(paintAt(out.regions, 0, 0.25, 8.0)?.formationId, 'A owns the ground beside A').toBe(N6)
    expect(paintAt(out.regions, 0, 0.75, 8.0)?.formationId, 'B owns the ground beside B').toBe(N8)
    // The leftover, on BOTH sides of the middle — one mass, no seam.
    expect(paintAt(out.regions, 0, 0.25, -2.0)?.formationId, "A's half of the leftover").toBe(N6)
    expect(paintAt(out.regions, 0, 0.75, -2.0)?.formationId, "B's half of the leftover").toBe(N6)
    expect(out.lithoFallback, 'the one-on-one leftover is still hatch').toEqual([])
  })
})
