/**
 * *"IF 2 LENSES ARE POINTED TO EACHOTHER AND THERE IS NOTHING ELSE TO FILL THE
 * GAP, NO OPEN BAND ABOVE OR BELOW, THEN YOU FILL WITH THE LOWEST DENSITY"*
 * — owner, 2026-08-26, ruling on the corrected two-level render.
 *
 * The ground he is describing is the piece of litho cover left between two
 * legally-closed facing constructs, where every rung of the remainder ladder
 * declines: sand nobody assigned a density to, standing as the "correlate me"
 * hatch inside a body that is plainly one body. The same morning he had already
 * REJECTED the other reading — splitting that leftover down the vertical middle
 * and giving each half to its own side — in one word: *"a big NOOOO"*.
 *
 * So the law is three things, and the pins below are one per thing:
 *
 *  * ONE REGION. No seam is invented inside the leftover; it is one piece of
 *    ground with one owner, whichever side of the middle it lies on.
 *  * THE LOWEST DENSITY of the masses that BOUND it — every mass whose own
 *    shape borders the leftover, not merely the two facing constructs. Least
 *    dense is his own precedent from the stacked-seam holes (*"least dense
 *    yeah"*, 2026-08-25): the lowest NAD class number in the family.
 *  * ONLY WHERE NOTHING ELSE CAN ANSWER — *"nothing else to fill the gap, no
 *    open band above or below"*. An open mass reaching for the ground is the
 *    ruled fill-through of 2026-08-21 and takes it first; a same-class facing
 *    pair is welded by the cover weld of 2026-08-26 and leaves nothing over.
 *
 * The wedges themselves never move: the bounding constructs' own shapes are
 * this rule's boundaries, and it paints only the ground they declined.
 */
import { describe, expect, it } from 'vitest'

import { computeHierarchicalGeotechFill } from '../index'
import { column, paintAt, tie } from '../scene.test-helpers'
import { totalityViolationOf } from './fillTotality'
import { computeSectionFillActive } from '../../partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../../sectionPartition'

/** The one litho soil every band below subdivides. */
const SAND = 'f-sand'
/** A second soil, so a bridged frame column can carry cover of its own. */
const CLAY = 'f-clay'

const N5 = 'g-zand-5'
const N6 = 'g-zand-6'
const N7 = 'g-zand-7'
const N8 = 'g-zand-8'
const K21 = 'g-klei-21'

/**
 * The class map the law compares masses by — without it every band keeps row
 * identity and *"the lowest density"* has no ordering to read.
 */
const PACKING = new Map<string, string>([
  [N5, 'ZAND|5'],
  [N6, 'ZAND|6'],
  [N7, 'ZAND|7'],
  [N8, 'ZAND|8'],
  [K21, 'KLEI|21'],
])

/** Two tests 69 m apart — the spacing of his own CS2 gap 0. */
const PAIR = [0, 69]

/** One band of a scene column, in metres below the collar. */
interface BandSpec {
  layerId: string
  formationId: string
  top: number
  base: number
}

type Fill = ReturnType<typeof computeHierarchicalGeotechFill>

/**
 * Two tests under ONE sand cover correlated straight through, with whatever
 * packing stacks and packing ties the pin hands in.
 *
 * @param a The left test's bands.
 * @param b The right test's bands.
 * @param geotechEdges The packing ties across the gap.
 * @returns The fill's output.
 */
function pairScene(a: readonly BandSpec[], b: readonly BandSpec[], geotechEdges: CorrelationEdge[]): Fill {
  const lithoColumns: PartitionColumn[] = [
    column('A', 10, [{ layerId: 'LA', formationId: SAND, top: 0, base: 14 }]),
    column('B', 10, [{ layerId: 'LB', formationId: SAND, top: 0, base: 14 }]),
  ]
  const lithoEdges = [tie('LA', 'LB', 'top', 'top'), tie('LA', 'LB', 'base', 'base')]
  return computeHierarchicalGeotechFill({
    lithoColumns,
    lithoEdges,
    lithoRegions: computeSectionFillActive(lithoColumns, lithoEdges, undefined, PAIR),
    geotechColumns: [column('A', 10, [...a]), column('B', 10, [...b])],
    geotechEdges,
    alongM: PAIR,
    packingClassOf: PACKING,
  })
}

/**
 * THE BRIDGED RUN — three frame columns whose middle one reads only the top
 * clay, so the sand family's own run jumps straight from A to C across it.
 *
 * The run's middle then lands in the FAR gap, and the near gap has no seam of
 * its own: the stacked-seam fallback of 2026-08-25 is scoped to *"vertical
 * seems"*, which needs a line with a half on either side of it, so this gap
 * falls through to the ladder exactly as a one-on-one gap does.
 *
 * @returns The fill's output; gap 0 is the bridged one.
 */
function bridgedScene(): Fill {
  const alongM = [0, 20, 100]
  const lithoColumns: PartitionColumn[] = [
    column('A', 10, [
      { layerId: 'LA0', formationId: CLAY, top: 0, base: 2 },
      { layerId: 'LA', formationId: SAND, top: 2, base: 14 },
    ]),
    column('B', 10, [{ layerId: 'LB0', formationId: CLAY, top: 0, base: 2 }]),
    column('C', 10, [
      { layerId: 'LC0', formationId: CLAY, top: 0, base: 2 },
      { layerId: 'LC', formationId: SAND, top: 2, base: 14 },
    ]),
  ]
  const lithoEdges = [
    tie('LA0', 'LB0', 'top', 'top'),
    tie('LB0', 'LC0', 'top', 'top'),
    tie('LA', 'LC', 'top', 'top'),
    tie('LA', 'LC', 'base', 'base'),
  ]
  return computeHierarchicalGeotechFill({
    lithoColumns,
    lithoEdges,
    lithoRegions: computeSectionFillActive(lithoColumns, lithoEdges, undefined, alongM),
    geotechColumns: [
      column('A', 10, [
        { layerId: 'GA0', formationId: K21, top: 0, base: 2 },
        { layerId: 'GA1', formationId: N7, top: 2, base: 7 },
        { layerId: 'GA2', formationId: N6, top: 7, base: 14 },
      ]),
      column('B', 10, [{ layerId: 'GB0', formationId: K21, top: 0, base: 2 }]),
      column('C', 10, [
        { layerId: 'GC0', formationId: K21, top: 0, base: 2 },
        { layerId: 'GC1', formationId: N8, top: 2, base: 7 },
        { layerId: 'GC2', formationId: N5, top: 7, base: 14 },
      ]),
    ],
    geotechEdges: [tie('GA1', 'GC1', 'top', 'top'), tie('GA2', 'GC2', 'base', 'base')],
    alongM,
    packingClassOf: PACKING,
  })
}

/** Every region of one gap, as ``class @ ring`` on the mm grid — for a shape pin. */
function shapeOf(regions: readonly SectionRegion[], gap: number, formationId: string): number[][] {
  const region = regions.find((r) => r.gapIndex === gap && r.formationId === formationId)
  return (region?.polygon ?? []).map((p) => [Number(p.fraction.toFixed(3)), Number(p.elevation.toFixed(2))])
}

/** How many regions of one class the gap carries — *"ONE region"* reads this. */
function regionCount(regions: readonly SectionRegion[], gap: number, formationId: string): number {
  return regions.filter((r) => r.gapIndex === gap && r.formationId === formationId).length
}

/** The hatch left on one gap — *"nothing else to fill the gap"* must leave none. */
function hatchOf(out: Fill, gap: number): SectionRegion[] {
  return out.lithoFallback.filter((r) => r.gapIndex === gap)
}

describe('the leftover between two closed constructs takes the lowest density', () => {
  it('LD1: two facing closed constructs, nothing else — ONE region of the less dense', () => {
    // His own shape: A's very dense sand and B's dense sand share one top tie,
    // both onlap it, and both pinch to a point at the middle. Below the two
    // wedges there is nothing else — no open band above or below — so the
    // ground between them is *"filled with the lowest density"*, which is B's
    // dense sand (NAD 7) against A's very dense (NAD 8).
    const out = pairScene(
      [{ layerId: 'GA1', formationId: N8, top: 0, base: 14 }],
      [{ layerId: 'GB1', formationId: N7, top: 0, base: 14 }],
      [tie('GA1', 'GB1', 'top', 'top')],
    )
    expect(hatchOf(out, 0), 'the leftover is still unclassed').toEqual([])
    // ...AND IT DOES NOT SPLIT AT THE MIDDLE. *"a big NOOOO"* — the leftover on
    // A's OWN half is the lowest density too, which is the whole difference
    // between his ruling and the reading he threw out.
    expect(paintAt(out.regions, 0, 0.25, -2)?.formationId, "the left half took A's own class").toBe(
      N7,
    )
    expect(paintAt(out.regions, 0, 0.75, -2)?.formationId, 'the right half').toBe(N7)
    expect(regionCount(out.regions, 0, N7), 'the leftover came back as more than one region').toBe(1)
    // THE WEDGES NEVER MOVE. The bounding constructs' own shapes are this
    // rule's boundaries — it paints the ground they declined, and redraws
    // nothing.
    expect(shapeOf(out.regions, 0, N8), "the very dense sand's wedge moved").toEqual([
      [0, 10],
      [0, -4],
      [0.5, 10],
    ])
    expect(out.diagnostics.totalityViolations, 'a gap with a banded run kept unanswered ground').toEqual(
      [],
    )
  })

  it('LD2: the same law where the run bridges a column and the gap has no seam', () => {
    // A and C carry the sand; B reads only the top clay, so the sand family's
    // run jumps A→C and gap 0's middle sits 30 m beyond its own right edge.
    // There is no vertical there and no stacked-seam half to answer, so the
    // ladder runs and declines — and the leftover between A's two wedges is
    // *"filled with the lowest density"* of what bounds it: NAD 6 below against
    // NAD 7 above.
    const out = bridgedScene()
    expect(hatchOf(out, 0), 'the bridged gap kept its hatch').toEqual([])
    expect(paintAt(out.regions, 0, 0.5, 3)?.formationId, 'the leftover in the bridged gap').toBe(N6)
    expect(out.diagnostics.totalityViolations).toEqual([])
  })

  it('LD3 control: an open band above or below fills it, and this rule is never asked', () => {
    // *"no open band above or below"* is a PRECONDITION. Here A's and B's deep
    // sands are one mass tied at both contacts, so that mass emits nothing, is
    // open, and rung 1 hands it the ground — the ruled SF-silt fill-through of
    // 2026-08-21. Were the terminal rule consulted it would answer the lowest
    // density of the three, NAD 6; it must not be consulted at all.
    const out = pairScene(
      [
        { layerId: 'GA1', formationId: N6, top: 0, base: 10 },
        { layerId: 'GA2', formationId: N7, top: 10, base: 14 },
      ],
      [
        { layerId: 'GB1', formationId: N8, top: 0, base: 10 },
        { layerId: 'GB2', formationId: N7, top: 10, base: 14 },
      ],
      [tie('GA1', 'GB1', 'top', 'top'), tie('GA2', 'GB2', 'top', 'top')],
    )
    expect(hatchOf(out, 0)).toEqual([])
    expect(paintAt(out.regions, 0, 0.5, -2)?.formationId, 'the open mass lost its fill-through').toBe(
      N7,
    )
  })

  it('LD4 control: a same-class facing pair is welded upstream and leaves nothing', () => {
    // *"follow the tie, same nad class, emit nothing"* (owner, 2026-08-26) —
    // the cover weld answers this gap before any construct is drawn, so there
    // is no leftover for the terminal rule to reach and the whole cover is one
    // body.
    const out = pairScene(
      [{ layerId: 'GA1', formationId: N6, top: 0, base: 14 }],
      [{ layerId: 'GB1', formationId: N6, top: 0, base: 14 }],
      [],
    )
    expect(hatchOf(out, 0)).toEqual([])
    expect(regionCount(out.regions, 0, N6), 'the welded cover came back in pieces').toBe(1)
    expect(out.regions.filter((r) => r.gapIndex === 0)).toHaveLength(1)
  })

  it('LD5: THREE masses bound the leftover — the lowest density of all three', () => {
    // *"the masses that bound it"* is every shape lying against the ground, not
    // the facing pair alone. A reads very dense over loose, B reads dense, and
    // nothing is tied anywhere, so all three lens out near their own tests and
    // the whole middle of the cover is left. Its three walls are NAD 8, NAD 5
    // and NAD 7 — and the answer is the loose sand, from BELOW on the far side
    // of the gap, which neither "the mass above" nor "the nearer test" would
    // ever have picked.
    const out = pairScene(
      [
        { layerId: 'GA1', formationId: N8, top: 0, base: 7 },
        { layerId: 'GA2', formationId: N5, top: 7, base: 14 },
      ],
      [{ layerId: 'GB1', formationId: N7, top: 0, base: 14 }],
      [],
    )
    expect(hatchOf(out, 0)).toEqual([])
    // Beside B's own wedge, where the NEAREST mass is B's dense sand.
    expect(paintAt(out.regions, 0, 0.7, 6)?.formationId, 'the nearer test won').toBe(N5)
    // Directly under A's very dense wedge, where "the mass above" is NAD 8.
    expect(paintAt(out.regions, 0, 0.5, 8)?.formationId, 'the mass above won').toBe(N5)
    expect(regionCount(out.regions, 0, N5), 'the leftover came back as more than one region').toBe(1)
    expect(out.diagnostics.totalityViolations).toEqual([])
  })
})

describe('the totality tripwire', () => {
  // AFTER THIS RULE THE FILL IS TOTAL. Every gap that has a banded run on both
  // sides now has an owner for every square metre of its own cover: the
  // constructs answer what they claim, the ladder answers the rest, and this
  // rule answers whatever the ladder declined. So residual on such a gap is no
  // longer "ground the law has no opinion about" — it is a DEFECT, and the
  // engine says so by name.
  const gap = { gapIndex: 4, xa: 0, xb: 10, run: {} as never }
  const face = {
    gapIndex: 4,
    formationId: 'f-sand',
    bodyId: null,
    kind: 'quad' as const,
    polygon: [
      { fraction: 0, elevation: 0 },
      { fraction: 0.5, elevation: 0 },
      { fraction: 0.5, elevation: 2 },
      { fraction: 0, elevation: 2 },
    ],
  }

  it('TOT1: a defect injected into a banded gap fires a named violation', () => {
    expect(totalityViolationOf(gap, { residual: [face] })).toEqual({
      gapIndex: 4,
      faces: 1,
      areaM2: 10,
    })
  })

  it('TOT2: a gap with nothing left is silent', () => {
    expect(totalityViolationOf(gap, { residual: [] })).toBeNull()
  })

  it('TOT3: a gap with no banded run is not a defect — nobody ever read that ground', () => {
    // A one-sided gap, or one flanked by an un-divided test, has no law to be
    // total about (owner ruling 2026-08-15: an un-divided borehole shows
    // visibly empty ground). The tripwire is silent there by design, so it
    // cannot cry wolf on the one case the engine is right to leave blank.
    expect(totalityViolationOf({ ...gap, run: null }, { residual: [face] })).toBeNull()
  })
})
