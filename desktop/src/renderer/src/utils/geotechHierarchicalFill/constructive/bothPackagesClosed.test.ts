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
import type { CorrelationEdge, PartitionColumn } from '../../partitionFill'

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

  it('BC3: two onlaps of near-equal thickness on one tie MEET at the middle', () => {
    // *"Start with clearly thicker wins"* — and A's dense 3.00 m against B's
    // medium 3.00 m is nowhere near the ratio, so neither is clearly thicker:
    // both onlap and pinch at the middle (``collision`` -> 'meet'). Each owns
    // its own half of the tie and neither crosses it.
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
