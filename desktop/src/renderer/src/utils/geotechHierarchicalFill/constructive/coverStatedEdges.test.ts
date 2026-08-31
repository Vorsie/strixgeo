/**
 * WHOSE SHAPE IS THIS — the pins for ``coverStatedEdges.ts``.
 *
 * THE REPORT THESE ANSWER (owner dogfeed 2026-08-25, Cross-section 3, gap
 * GEO-06/092-S2 → GEO-05/040-S6). A five-vertex ZAND|8 at f=[0.00..0.45],
 * e=[-0.69..-0.09], ring ``(0,-0.09)(0,-0.69)(0.397,-0.69)(0.45,-0.39)
 * (0.397,-0.09)`` — read as a construct that terminated at the wrong fraction,
 * because the two ZAND|7 bands above and below it end at f=0.397 while it ends
 * at f=0.45: *"MISMATCHED termination fractions on adjacent constructs of one
 * column's stack"*.
 *
 * IT IS NOT A CONSTRUCT. The fill's own probe for that gap reports NO ties, NO
 * constructs and only five horizontal lines — the three bands' own mTAW
 * contacts. The litho cover there is a PINCH-OUT TRIANGLE (input region
 * ``(0.000,2.15)(0.000,-2.93)(0.450,-0.39)``), the column carries three packing
 * bands inside it, and a horizontal subdivision of a triangle ends each band
 * where the triangle's own flank crosses that band's own contact. Only the band
 * whose window straddles the apex ELEVATION reaches the apex FRACTION. The two
 * numbers are the same cover edge read at three different heights, not three
 * terminations that disagree.
 *
 * The owner's own contrast on that screen is the control: *"SILT|16 closes as a
 * clean triangle"* — same kind of cover, ONE band inside it, so the band is the
 * whole triangle. CT2 below is that case; the difference between the two shapes
 * is the number of bands in the cover and nothing else.
 *
 * The pins are therefore about AUTHORSHIP, not about whether any silhouette is
 * pretty: a region every one of whose sloping edges lies on its gap's litho
 * cover outline drew no diagonal of its own, and the geotech rulings about
 * triangles and quads have no jurisdiction over it. CT4 is the teeth — a gap
 * where a construct DOES fire, whose flank the cover does not state.
 */
import { describe, expect, it } from 'vitest'

import { shapeAuthorship, slopingEdges } from './coverStatedEdges'
import { computeHierarchicalGeotechFill } from '../index'
import { column, tie } from '../scene.test-helpers'
import { computeSectionFillActive } from '../../partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../../sectionPartition'

const SILT = 'f-silt'
const SAND = 'f-sand'
/** NAD 7 · dense sand. */
const N7 = 'g-sand-dense'
/** NAD 8 · very dense sand — the band that straddles the cover's apex. */
const N8 = 'g-sand-very-dense'
/** The silt's own class, so the ground around the sand is classed too. */
const N6 = 'g-silt-medium'

/** Two tests, 100 m apart — one gap, so every fraction below is that gap's. */
const ALONG = [0, 100]

/** Silt over sand over silt: the sandwich whose sand pinches out. */
const SANDWICH = [
  { formationId: SILT, top: 0, base: 4 },
  { formationId: SAND, top: 4, base: 10 },
  { formationId: SILT, top: 10, base: 14 },
]

/** One (fraction, elevation) vertex — the space every ring below lives in. */
type Pt = { fraction: number; elevation: number }

/** One band or unit before it is given a layer id. */
type Slice = { formationId: string; top: number; base: number }

/** The same three units, layer-ided for one column. */
const sandwichAt = (id: string): (Slice & { layerId: string })[] =>
  SANDWICH.map((u, i) => ({ ...u, layerId: `L${id}${i}` }))

/** The three packing bands the sand carries: N7 over N8 over N7. */
const THREE_BANDS = [
  { formationId: N7, top: 4, base: 6 },
  { formationId: N8, top: 6, base: 8 },
  { formationId: N7, top: 8, base: 10 },
]

/** One geotech column: the silt above, the given sand bands, the silt below. */
function banded(id: string, sand: readonly Slice[]): PartitionColumn {
  return column(id, 10, [
    { layerId: `G${id}top`, formationId: N6, top: 0, base: 4 },
    ...sand.map((b, i) => ({ ...b, layerId: `G${id}${i}` })),
    { layerId: `G${id}bot`, formationId: N6, top: 10, base: 14 },
  ])
}

/** One unbanded silt column — the test the sand never reached. */
const plainSilt = (id: string): PartitionColumn =>
  column(id, 10, [{ layerId: `G${id}0`, formationId: N6, top: 0, base: 14 }])

/** Everything one scene needs, run end to end. */
function scene(input: {
  litho: PartitionColumn[]
  lithoEdges: CorrelationEdge[]
  geotech: PartitionColumn[]
  geotechEdges?: CorrelationEdge[]
}): { regions: SectionRegion[]; cover: SectionRegion[] } {
  const cover = computeSectionFillActive(input.litho, input.lithoEdges, undefined, ALONG)
  const out = computeHierarchicalGeotechFill({
    lithoColumns: input.litho,
    lithoEdges: input.lithoEdges,
    lithoRegions: cover,
    geotechColumns: input.geotech,
    geotechEdges: input.geotechEdges ?? [],
    alongM: ALONG,
  })
  return { regions: out.regions, cover }
}

/** The scene the report was cut from: the sand reaches only the LEFT test. */
function pinchScene(sand: readonly Slice[]): ReturnType<typeof scene> {
  const siltOnly = [{ layerId: 'LB0', formationId: SILT, top: 0, base: 14 }]
  return scene({
    litho: [column('A', 10, sandwichAt('A')), column('B', 10, siltOnly)],
    lithoEdges: [tie('LA0', 'LB0'), tie('LA2', 'LB0', 'base', 'base')],
    geotech: [banded('A', sand), plainSilt('B')],
  })
}

/** A region's ring on the mm grid, as readable number pairs. */
const ringOf = (region: SectionRegion): number[][] =>
  region.polygon.map((p) => [Number(p.fraction.toFixed(3)), Number(p.elevation.toFixed(2))])

/** Every region of one class, shallowest first so the pins read top-down. */
function byClass(regions: readonly SectionRegion[], formationId: string): SectionRegion[] {
  const roof = (r: SectionRegion): number => Math.max(...r.polygon.map((p) => p.elevation))
  return regions.filter((r) => r.formationId === formationId).sort((a, b) => roof(b) - roof(a))
}

/** Cover outlines by gap, the shape ``shapeAuthorship`` takes. */
function coverByGap(cover: readonly SectionRegion[]): Map<number, Pt[][]> {
  const out = new Map<number, Pt[][]>()
  for (const region of cover) {
    const rings = out.get(region.gapIndex)
    if (rings === undefined) out.set(region.gapIndex, [[...region.polygon]])
    else rings.push([...region.polygon])
  }
  return out
}

describe('a pinching litho cover states the shapes of the bands inside it', () => {
  it('CT1: three bands in a pinch-out triangle end at three different fractions', () => {
    // The sand pinches out between A and B, so the litho stage closes it as a
    // triangle from A's own column to its apex at LENS_PINCH_FRACTION. A's own
    // three packing bands run flat inside it.
    const { regions, cover } = pinchScene(THREE_BANDS)
    const sandCover = cover.filter((r) => r.formationId === SAND)
    expect(ringOf(sandCover[0]), 'the litho cover is no longer the pinch triangle').toEqual([
      [0, 6],
      [0, 0],
      [0.45, 3],
    ])
    // THE OWNER'S SHAPE, reproduced. The middle band straddles the apex
    // elevation (+3 lies inside 4..2), so it is the one that reaches the apex
    // FRACTION; the two outer bands stop where the cover's own flanks cross
    // their own contacts, at +4 and at +2 — both at f=0.300 here, because this
    // scene is symmetric about the apex. Nothing terminated anything.
    expect(ringOf(byClass(regions, N8)[0]), 'the band holding the cover apex moved').toEqual([
      [0, 4],
      [0, 2],
      [0.3, 2],
      [0.45, 3],
      [0.3, 4],
    ])
    const dense = byClass(regions, N7)
    expect(ringOf(dense[0]), 'the band above the apex band moved').toEqual([
      [0, 6],
      [0, 4],
      [0.3, 4],
    ])
    expect(ringOf(dense[1]), 'the band below the apex band moved').toEqual([
      [0, 2],
      [0, 0],
      [0.3, 2],
    ])
  })

  it("CT1b: ...and not one of those diagonals is the fill's own", () => {
    // The authorship claim, stated mechanically. Every sloping edge of every
    // sand region lies ON the litho cover outline, so the geotech fill drew no
    // diagonal at all here and no ruling of its own reaches these silhouettes.
    const { regions, cover } = pinchScene(THREE_BANDS)
    const sand = regions.filter((r) => r.formationId === N7 || r.formationId === N8)
    const verdicts = shapeAuthorship(sand, coverByGap(cover))
    expect(verdicts.length, 'the sand regions have no sloping edge to attribute').toBeGreaterThan(0)
    const readable = (e: { a: Pt; b: Pt }): string =>
      `(${e.a.fraction},${e.a.elevation})->(${e.b.fraction},${e.b.elevation})`
    for (const verdict of verdicts) {
      expect(
        verdict.ownDiagonals.map(readable),
        'the fill drew a diagonal the litho cover does not state',
      ).toEqual([])
    }
  })

  it('CT2: the SAME cover with ONE band is the clean triangle he contrasted it with', () => {
    // *"SILT|16 closes as a clean triangle"*. One band fills the whole cover, so
    // the region IS the cover: three vertices, one apex. The five-vertex shape
    // of CT1 differs from this one by the number of bands in the cover and by
    // nothing else — which is why it is not evidence of a defect.
    const { regions } = pinchScene([{ formationId: N8, top: 4, base: 10 }])
    expect(ringOf(byClass(regions, N8)[0]), 'a single band no longer IS its cover').toEqual([
      [0, 6],
      [0, 0],
      [0.45, 3],
    ])
  })

  it('CT3: mirrored, the fractions mirror — they are the cover read at three heights', () => {
    // The same sandwich on the RIGHT test instead. If 0.45 and 0.30 were
    // termination constants of the constructs they would stand where they
    // stood; they are the cover's own flank, so they mirror to 0.55 and 0.70.
    const { regions } = scene({
      litho: [
        column('A', 10, [{ layerId: 'LA0', formationId: SILT, top: 0, base: 14 }]),
        column('B', 10, sandwichAt('B')),
      ],
      lithoEdges: [tie('LA0', 'LB0'), tie('LA0', 'LB2', 'base', 'base')],
      geotech: [plainSilt('A'), banded('B', THREE_BANDS)],
    })
    expect(ringOf(byClass(regions, N8)[0]), 'the mirrored apex band moved').toEqual([
      [0.55, 3],
      [0.7, 2],
      [1, 2],
      [1, 4],
      [0.7, 4],
    ])
  })

  it('CT4: TEETH — where a construct fires, its flank is NOT cover-stated', () => {
    // The control that keeps CT1b from passing vacuously. Both tests carry the
    // sand, so the cover is a plain quad across the gap; A's dense sand carries
    // one tie and reads a different mass at the far end, so the law emits an
    // ONLAP and the fill draws its flank. That diagonal is the fill's own, and
    // the same helper says so.
    const { regions, cover } = scene({
      litho: [column('A', 10, sandwichAt('A')), column('B', 10, sandwichAt('B'))],
      lithoEdges: [tie('LA0', 'LB0'), tie('LA1', 'LB1'), tie('LA2', 'LB2')],
      geotech: [
        banded('A', [{ formationId: N7, top: 4, base: 10 }]),
        banded('B', [{ formationId: N8, top: 4, base: 10 }]),
      ],
      geotechEdges: [tie('GA0', 'GB0', 'top', 'top')],
    })
    const onlap = byClass(regions, N7)[0]
    const flanks = slopingEdges(onlap.polygon)
    expect(flanks.length, 'the onlap has no flank to attribute').toBeGreaterThan(0)
    const verdict = shapeAuthorship([onlap], coverByGap(cover))[0]
    expect(
      verdict.ownDiagonals.length,
      'a construct flank was mistaken for an edge the litho cover states',
    ).toBeGreaterThan(0)
  })
})
