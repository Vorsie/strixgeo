/**
 * OWNER RULING 2026-08-04 (evening dogfeed) — the geotech gap fill consumes
 * PACKING CORRELATION EDGES with the litho stage's 2/1/0 semantics.
 *
 *   > "correlate by hand between CPTs, so we can reuse the litho's 2/1/0 ruling"
 *
 * and its no-tie default, chosen litho-faithful:
 *
 *   > NO tie -> NO band. An untied packing span pinches out through the
 *   > refinement's existing unmatched-span machinery (overlay lens / taper /
 *   > bracket fill) instead of today's forced mid-gap class seam.
 *
 * Each case below paraphrases one clause of that ruling in the ruling's own
 * words. The compat clause matters as much as the new behaviour: a caller that
 * passes NO edge information at all keeps the legacy class+position pairing
 * byte-for-byte, which is what every owner-locked rule test in
 * ``refineLithoPartition.test.ts`` exercises and what un-threaded callers rely
 * on. An explicitly EMPTY list is the opposite statement — "no ties exist" —
 * and must pinch honestly.
 *
 * Scenes are synthetic minimal fixtures; the real-data arms live in
 * ``refineLithoPartition.cs1frozen.test.ts`` and the model-wide agreement gate.
 */

import { describe, expect, it } from 'vitest'

import type { CorrelationEdge, SectionRegion } from './partitionFill'
import {
  refineLithoPartition,
  type GeotechColumn,
  type NadFormationMeta,
  type RefinedPolygon,
} from './refineLithoPartition'

// ---------------------------------------------------------------------------
// Scene helpers (mirrors of the owner-locked suite's, kept test-local)
// ---------------------------------------------------------------------------

const NAD: ReadonlyMap<string, NadFormationMeta> = new Map([
  ['nad-zand-5', { nadClass: 5, soilCode: 'ZAND' }],
  ['nad-zand-7', { nadClass: 7, soilCode: 'ZAND' }],
  ['nad-zand-8', { nadClass: 8, soilCode: 'ZAND' }],
  ['nad-klei-22', { nadClass: 22, soilCode: 'KLEI' }],
])

const LITHO_SOIL: ReadonlyMap<string, string | null> = new Map([
  ['formation-sand', 'ZAND'],
  ['formation-clay', 'KLEI'],
])

/** A quad litho region between columns gapIndex and gapIndex+1. */
function quadRegion(
  formationId: string,
  topL: number,
  topR: number,
  baseL: number,
  baseR: number,
  gapIndex = 0,
): SectionRegion {
  return {
    formationId,
    bodyId: 'body-x',
    kind: 'quad',
    gapIndex,
    polygon: [
      { fraction: 0, elevation: topL },
      { fraction: 1, elevation: topR },
      { fraction: 1, elevation: baseR },
      { fraction: 0, elevation: baseL },
    ],
  }
}

/** Geotech column from [topElev, baseElev, formationId] bands. */
function gcol(
  investigationId: string,
  surfaceElevM: number,
  bands: readonly [number, number, string][],
): GeotechColumn {
  return {
    investigationId,
    surfaceElevM,
    units: bands.map(([topElev, baseElev, formationId], i) => ({
      layerId: `${investigationId}-g${i}`,
      topDepthM: surfaceElevM - topElev,
      baseDepthM: surfaceElevM - baseElev,
      formationId,
      bodyId: null,
    })),
  }
}

function gmap(...cols: GeotechColumn[]): ReadonlyMap<string, GeotechColumn> {
  return new Map(cols.map((c) => [c.investigationId, c]))
}

/** Even-odd point-in-polygon in (fraction, elevation) space. */
function inPoly(
  px: number,
  pe: number,
  pts: readonly { fraction: number; elevation: number }[],
): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (
      a.elevation > pe !== b.elevation > pe &&
      px <
        a.fraction + ((pe - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    )
      inside = !inside
  }
  return inside
}

/** Formation ids of refined polygons covering (fraction, elevation). */
function formsAt(refined: readonly RefinedPolygon[], f: number, e: number): Set<string> {
  const out = new Set<string>()
  for (const p of refined) if (inPoly(f, e, p.points)) out.add(p.formationId)
  return out
}

const tags = (refined: readonly RefinedPolygon[], tag: string): RefinedPolygon[] =>
  refined.filter((p) => p.tag === tag)

// ---------------------------------------------------------------------------
// The scene both halves of the ruling are read on.
//
// One sand litho region [10 .. 0] over a clay unit that continues below it.
// Both columns carry an n5 crust over a deeper sand class, and the deeper
// classes DIFFER across the gap (n7 left, n8 right) — the case that today
// produces the forced mid-gap seam.
// ---------------------------------------------------------------------------

const REGION = quadRegion('formation-sand', 10, 10, 0, 0)

const COLS = gmap(
  gcol('A', 10, [
    [10, 6, 'nad-zand-5'],
    [6, 0, 'nad-zand-7'],
    [0, -5, 'nad-klei-22'],
  ]),
  gcol('B', 10, [
    [10, 4, 'nad-zand-5'],
    [4, 0, 'nad-zand-8'],
    [0, -5, 'nad-klei-22'],
  ]),
)

/** Tie the n5 crust: its TOP contact and (via the spans below) its BASE contact. */
const CRUST_TIED: CorrelationEdge[] = [
  { a: 'A-g0', b: 'B-g0', aSide: 'top', bSide: 'top' }, // the crust tops
  { a: 'A-g1', b: 'B-g1', aSide: 'top', bSide: 'top' }, // the contact under the crust
]

describe('refineLithoPartition — packing edges drive the gap fill (owner ruling 2026-08-04)', () => {
  it('two tied packing bands connect across the gap', () => {
    // Both bounding contacts of the n5 crust are correlated to the neighbour
    // (its own top, and the contact below it), so the crust bands the gap —
    // litho's 2 -> BAND, read on packing sub-bands.
    const refined = refineLithoPartition([REGION], ['A', 'B'], COLS, NAD, LITHO_SOIL, {
      packingEdges: CRUST_TIED,
    })
    const bands = tags(refined, 'band')
    expect(bands.some((p) => p.formationId === 'nad-zand-5')).toBe(true)
    // The band reaches BOTH columns — it connects, it does not lap.
    expect(formsAt(refined, 0.03, 9.5)).toEqual(new Set(['nad-zand-5']))
    expect(formsAt(refined, 0.97, 9.5)).toEqual(new Set(['nad-zand-5']))
  })

  it('a deeper pair whose class run is tied top AND base also bands (2 -> BAND, all the way down)', () => {
    // Same crust, but now both columns carry the SAME deeper class and the
    // clay tops below the region are tied too — so the deeper span's base
    // contact is correlated exactly as the build arm reads it.
    const cols = gmap(
      gcol('A', 10, [
        [10, 6, 'nad-zand-5'],
        [6, 0, 'nad-zand-7'],
        [0, -5, 'nad-klei-22'],
      ]),
      gcol('B', 10, [
        [10, 4, 'nad-zand-5'],
        [4, 0, 'nad-zand-7'],
        [0, -5, 'nad-klei-22'],
      ]),
    )
    const refined = refineLithoPartition([REGION], ['A', 'B'], cols, NAD, LITHO_SOIL, {
      packingEdges: [...CRUST_TIED, { a: 'A-g2', b: 'B-g2', aSide: 'top', bSide: 'top' }],
    })
    const bands = tags(refined, 'band')
    expect(bands.some((p) => p.formationId === 'nad-zand-5')).toBe(true)
    expect(bands.some((p) => p.formationId === 'nad-zand-7')).toBe(true)
    // No unmatched-span overlay anywhere: every span found its partner.
    expect(tags(refined, 'hlens')).toEqual([])
    expect(formsAt(refined, 0.5, 9.5)).toEqual(new Set(['nad-zand-5']))
    expect(formsAt(refined, 0.5, 1.0)).toEqual(new Set(['nad-zand-7']))
  })

  it('an untied pair pinches out instead of meeting at a mid-gap seam', () => {
    // The two deeper spans (n7 left, n8 right) are NOT tied. Today they meet at
    // a forced seam halfway across the gap, each owning its half at full
    // height. Under the ruling neither bands: they pinch out from their own
    // side through the unmatched-span machinery.
    const legacy = refineLithoPartition([REGION], ['A', 'B'], COLS, NAD, LITHO_SOIL)
    // TODAY (pinned, so the change is visible): past the mid-gap seam the right
    // span owns the interval down to the region base, at full height.
    expect(formsAt(legacy, 0.6, 4.0).has('nad-zand-8')).toBe(true)

    const refined = refineLithoPartition([REGION], ['A', 'B'], COLS, NAD, LITHO_SOIL, {
      packingEdges: CRUST_TIED,
    })
    // The untied right span no longer owns everything past the seam — it
    // pinches from its own column as an overlay lens at its own position.
    expect(formsAt(refined, 0.6, 4.0).has('nad-zand-8')).toBe(false)
    expect(tags(refined, 'hlens').some((p) => p.formationId === 'nad-zand-8')).toBe(true)
    // Nothing untied bands: only the tied crust spans the gap as a band.
    expect(tags(refined, 'band').every((p) => p.formationId === 'nad-zand-5')).toBe(true)
    // Both columns still read their OWN packing at their own column — the
    // pinch-out may not overwrite a CPT with its neighbour's class.
    expect(formsAt(refined, 0.99, 2).has('nad-zand-8')).toBe(true)
    expect(formsAt(refined, 0.01, 2).has('nad-zand-7')).toBe(true)
  })

  it('no edge information at all → the legacy pairing (compat)', () => {
    // An un-threaded caller passes no packing edges. Nothing about its output
    // may move: the legacy class+position pairing stands, seam and all.
    const noOptions = refineLithoPartition([REGION], ['A', 'B'], COLS, NAD, LITHO_SOIL)
    const undefinedEdges = refineLithoPartition([REGION], ['A', 'B'], COLS, NAD, LITHO_SOIL, {
      packingEdges: undefined,
    })
    expect(JSON.stringify(undefinedEdges)).toEqual(JSON.stringify(noOptions))
    // The legacy mid-gap seam is still there, unchanged.
    expect(formsAt(noOptions, 0.6, 4.0).has('nad-zand-8')).toBe(true)
  })

  it('an empty tie list pinches', () => {
    // An empty list is a STATEMENT — "no ties exist here" — not an absence of
    // information. Every span is untied, so nothing bands.
    const refined = refineLithoPartition([REGION], ['A', 'B'], COLS, NAD, LITHO_SOIL, {
      packingEdges: [],
    })
    expect(tags(refined, 'band')).toEqual([])
    expect(tags(refined, 'hlens').length).toBeGreaterThan(0)
    // Nothing is left unpainted by the pinch-out: the interval still tiles.
    expect(formsAt(refined, 0.5, 5).size).toBeGreaterThan(0)
    expect(formsAt(refined, 0.5, 1).size).toBeGreaterThan(0)
  })

  it('a side with NO packing of its own keeps the shipped mirror/borrow, ties or not', () => {
    // Rule 6b + the S10 mirror apply to sides that have no layers to tie. A
    // borrowed or mirrored side must behave exactly as it shipped — the tie
    // precondition cannot be applied to spans the column does not own.
    const cols = gmap(
      gcol('A', 10, [
        [10, 6, 'nad-zand-5'],
        [6, 0, 'nad-zand-7'],
      ]),
      gcol('B', 10, []),
    )
    const mirrored = refineLithoPartition([REGION], ['A', 'B'], cols, NAD, LITHO_SOIL, {
      packingEdges: [],
    })
    const shipped = refineLithoPartition([REGION], ['A', 'B'], cols, NAD, LITHO_SOIL)
    expect(JSON.stringify(mirrored)).toEqual(JSON.stringify(shipped))
  })

  it('a tied pair bands at ANY elevation — position is not required', () => {
    // The discriminating case for "an explicit tie outranks position: a tied
    // pair bands at ANY elevation (the litho matcher's own rule for a
    // correlated bed that dips)". Every other case in this file ties spans
    // that ALSO overlap vertically, so a pairing that quietly still demanded
    // overlap would pass all of them. Here the two n7 spans share NO elevation
    // at all — left 9..7, right 3..1 — and the engineer has tied both their
    // bounding contacts. A steeply dipping correlated bed is the ordinary
    // reason for that, and it must band.
    const cols = gmap(
      gcol('A', 10, [
        [10, 9, 'nad-zand-5'],
        [9, 7, 'nad-zand-7'],
        [7, 0, 'nad-zand-8'],
      ]),
      gcol('B', 10, [
        [10, 3, 'nad-zand-5'],
        [3, 1, 'nad-zand-7'],
        [1, 0, 'nad-zand-8'],
      ]),
    )
    const refined = refineLithoPartition([REGION], ['A', 'B'], cols, NAD, LITHO_SOIL, {
      packingEdges: [
        { a: 'A-g1', b: 'B-g1', aSide: 'top', bSide: 'top' }, // the tied bed's top
        { a: 'A-g2', b: 'B-g2', aSide: 'top', bSide: 'top' }, // the contact under it
      ],
    })
    // It connects as a band, not as two pinch-out lenses on their own columns.
    expect(tags(refined, 'band').some((p) => p.formationId === 'nad-zand-7')).toBe(true)
    // And it reaches both columns at each column's OWN elevation for that bed.
    expect(formsAt(refined, 0.02, 8).has('nad-zand-7')).toBe(true)
    expect(formsAt(refined, 0.98, 2).has('nad-zand-7')).toBe(true)
  })

  it('DEFERRED — one tied contact is treated as untied (pinned, not endorsed)', () => {
    // Litho's middle case (exactly ONE correlated contact -> ONLAP) has no
    // primitive in fraction space: the anchor walk alternates unmatched
    // interval / pair band, and a half-anchored band cannot enter it without
    // redesigning the machinery every guard in it was forced by. Until that
    // design exists, 1 tie is treated as 0 — the span pinches out rather than
    // banding. This case pins THAT, so the day the onlap lands it goes red.
    const cols = gmap(
      gcol('A', 10, [
        [10, 6, 'nad-zand-5'],
        [6, 0, 'nad-zand-7'],
        [0, -5, 'nad-klei-22'],
      ]),
      gcol('B', 10, [
        [10, 4, 'nad-zand-5'],
        [4, 0, 'nad-zand-7'],
        [0, -5, 'nad-klei-22'],
      ]),
    )
    // ONLY the crust tops are tied: the n5 crust has 1 of its 2 contacts.
    const refined = refineLithoPartition([REGION], ['A', 'B'], cols, NAD, LITHO_SOIL, {
      packingEdges: [{ a: 'A-g0', b: 'B-g0', aSide: 'top', bSide: 'top' }],
    })
    expect(tags(refined, 'band')).toEqual([])
  })

  it('DEFERRED — a JUMP tie over an undivided borehole cannot band yet (pinned, not endorsed)', () => {
    // Step 2 of the packing pipeline proposes ties across borehole columns that
    // carry no packing yet (``geotech_edge_bridging``), so an accepted tie can
    // name two CPTs with an undivided borehole standing between them. The
    // refinement pairs PER GAP — A|M then M|B — and neither gap has both of
    // that tie's endpoints, so the tie cannot be read and the fill behaves
    // exactly as if it did not exist.
    //
    // That is a real limit, not a bug to paper over: engine surgery to pair
    // across a gap is its own design. The workflow answer already exists —
    // step 4 divides the borehole, M gets its own packing, and the two
    // now-ADJACENT pairs (A|M, M|B) band through the ordinary 2 -> BAND path
    // above. This case pins the limit so the day the engine spans a gap, it
    // goes red rather than changing silently.
    const regions = [
      quadRegion('formation-sand', 10, 10, 0, 0, 0),
      quadRegion('formation-sand', 10, 10, 0, 0, 1),
    ]
    const cols = gmap(
      gcol('A', 10, [
        [10, 6, 'nad-zand-5'],
        [6, 0, 'nad-zand-7'],
      ]),
      gcol('M', 10, []), // the undivided borehole — no packing of its own
      gcol('B', 10, [
        [10, 6, 'nad-zand-5'],
        [6, 0, 'nad-zand-7'],
      ]),
    )
    // An ACCEPTED jump tie, A straight to B over M.
    const jump: CorrelationEdge[] = [
      { a: 'A-g0', b: 'B-g0', aSide: 'top', bSide: 'top' },
      { a: 'A-g1', b: 'B-g1', aSide: 'top', bSide: 'top' },
    ]
    const withJump = refineLithoPartition(regions, ['A', 'M', 'B'], cols, NAD, LITHO_SOIL, {
      packingEdges: jump,
    })
    const withoutAnyTie = refineLithoPartition(regions, ['A', 'M', 'B'], cols, NAD, LITHO_SOIL, {
      packingEdges: [],
    })
    expect(JSON.stringify(withJump)).toEqual(JSON.stringify(withoutAnyTie))
  })
})
