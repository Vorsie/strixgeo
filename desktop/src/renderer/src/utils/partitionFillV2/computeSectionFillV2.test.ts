/**
 * partitionFillV2/computeSectionFillV2.test.ts — behavioural unit tests for the
 * v2 curve-emission -> face -> slice pipeline. Each case is written in the USER's
 * vocabulary (band / pinch / lens / laps up / laps down / crossing conflict /
 * band-through-the-middle), NOT in engine-variable terms (design §2, rule table).
 */

import { describe, expect, it } from 'vitest'
import {
  computeSectionFillV2,
  computeSectionFillV2WithConflicts,
} from './computeSectionFillV2'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'

// --- fixture helpers -------------------------------------------------------

let seq = 0
const layer = (): string => `L${seq++}`
const CLAY = 'clay'
const SAND = 'sand'
const SILT = 'silt'

interface U {
  top: number
  base: number
  f: string
  layerId: string
  body?: string | null
}
function col(id: string, surface: number, units: U[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({
      topDepthM: u.top,
      baseDepthM: u.base,
      formationId: u.f,
      layerId: u.layerId,
      bodyId: u.body ?? null,
    })),
  }
}

/** Regions of a given formation in a gap. */
function ofFormation(regions: SectionRegion[], f: string): SectionRegion[] {
  return regions.filter((r) => r.formationId === f)
}
/** Max fraction reached by any vertex of a polygon. */
function maxFrac(r: SectionRegion): number {
  return Math.max(...r.polygon.map((p) => p.fraction))
}
/** Min fraction. */
function minFrac(r: SectionRegion): number {
  return Math.min(...r.polygon.map((p) => p.fraction))
}
/** Elevation covered by a region at a given fraction (span). */
function coverAt(r: SectionRegion, f: number): [number, number] | null {
  const ys: number[] = []
  const p = r.polygon
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    if ((a.fraction <= f && b.fraction > f) || (b.fraction <= f && a.fraction > f)) {
      const t = (f - a.fraction) / (b.fraction - a.fraction)
      ys.push(a.elevation + t * (b.elevation - a.elevation))
    }
  }
  if (ys.length < 2) return null
  ys.sort((x, y) => x - y)
  return [ys[0], ys[ys.length - 1]]
}

// ---------------------------------------------------------------------------

describe('computeSectionFillV2 — 2/1/0 gestures emerge from boundary composition', () => {
  it('a unit tied on BOTH contacts bands across the gap as a quad (spans full width)', () => {
    // A sand bed tied top-and-base to the facing sand -> a full-width band.
    const lTop = layer()
    const lSand = layer()
    const lBot = layer()
    const rTop = layer()
    const rSand = layer()
    const rBot = layer()
    const left = col('L', 10, [
      { top: 0, base: 2, f: CLAY, layerId: lTop },
      { top: 2, base: 5, f: SAND, layerId: lSand },
      { top: 5, base: 8, f: CLAY, layerId: lBot },
    ])
    const right = col('R', 10, [
      { top: 0, base: 2, f: CLAY, layerId: rTop },
      { top: 2, base: 5, f: SAND, layerId: rSand },
      { top: 5, base: 8, f: CLAY, layerId: rBot },
    ])
    // top tie (sand tops) + base tie (sand bases, i.e. lower clay tops).
    const edges: CorrelationEdge[] = [
      { a: lSand, b: rSand, aSide: 'top', bSide: 'top' },
      { a: lBot, b: rBot, aSide: 'top', bSide: 'top' },
    ]
    const regions = computeSectionFillV2([left, right], edges)
    const sand = ofFormation(regions, SAND)
    expect(sand.length).toBeGreaterThanOrEqual(1)
    const band = sand.find((r) => r.kind === 'quad')
    expect(band).toBeDefined()
    // A band spans the whole gap: reaches fraction 0 and 1.
    expect(minFrac(band!)).toBeCloseTo(0, 5)
    expect(maxFrac(band!)).toBeCloseTo(1, 5)
  })

  it('a unit tied on ONE contact (top) laps UP toward the tie and pinches (not full width)', () => {
    // Silt present only on the left, its TOP tied to the right silt-top -> onlap
    // that laps up along the tie and pinches before the right column.
    const lClay = layer()
    const lSilt = layer()
    const lSand = layer()
    const rClay = layer()
    const rSand = layer()
    const left = col('L', 10, [
      { top: 0, base: 3, f: CLAY, layerId: lClay },
      { top: 3, base: 4, f: SILT, layerId: lSilt },
      { top: 4, base: 8, f: SAND, layerId: lSand },
    ])
    const right = col('R', 10, [
      { top: 0, base: 3, f: CLAY, layerId: rClay },
      { top: 3, base: 8, f: SAND, layerId: rSand },
    ])
    // Only the silt TOP correlates (to the clay base / sand top on the right):
    // tie lSilt.top <-> rSand.top.
    const edges: CorrelationEdge[] = [{ a: lSilt, b: rSand, aSide: 'top', bSide: 'top' }]
    const regions = computeSectionFillV2([left, right], edges)
    const silt = ofFormation(regions, SILT)
    expect(silt.length).toBe(1)
    expect(silt[0].kind).toBe('pinch')
    // Pinch is anchored on the LEFT column (fraction 0) and does not reach 1.
    expect(minFrac(silt[0])).toBeCloseTo(0, 5)
    expect(maxFrac(silt[0])).toBeLessThan(0.99)
  })

  it('a unit tied on NO contact is a lens pinching at 0.45 into the gap', () => {
    // A sand lens enclosed in clay on the left only, uncorrelated -> lens at 0.45.
    const lClayTop = layer()
    const lLens = layer()
    const lClayBot = layer()
    const rClay = layer()
    const left = col('L', 10, [
      { top: 0, base: 3, f: CLAY, layerId: lClayTop, body: 'bClay' },
      { top: 3, base: 4, f: SAND, layerId: lLens, body: 'bLens' },
      { top: 4, base: 8, f: CLAY, layerId: lClayBot, body: 'bClay' },
    ])
    const right = col('R', 10, [{ top: 0, base: 8, f: CLAY, layerId: rClay, body: 'bClay' }])
    const regions = computeSectionFillV2([left, right], [])
    const sand = ofFormation(regions, SAND)
    expect(sand.length).toBe(1)
    expect(sand[0].kind).toBe('lens')
    // Apex reaches ~0.45 of the gap.
    expect(maxFrac(sand[0])).toBeCloseTo(0.45, 2)
  })

  it('ruling 8b: a THIN 0-corr lens in a WIDE gap hugs its column (reach ~2× thickness)', () => {
    // Same enclosed-sand-lens shape, but a REAL 100 m gap and a 1 m-thick lens. Ruling 8b
    // (design partition-engine-v2.md §8): the auto reach caps at min(0.45× gap, 2× thickness)
    // = min(45 m, 2 m) = 2 m → apex fraction 2/100 = 0.02, a hugging halo NOT a long tongue.
    const lClayTop = layer()
    const lLens = layer()
    const lClayBot = layer()
    const rClay = layer()
    const left = col('L', 10, [
      { top: 0, base: 3, f: CLAY, layerId: lClayTop, body: 'bClay' },
      { top: 3, base: 4, f: SAND, layerId: lLens, body: 'bLens' }, // 1 m thick
      { top: 4, base: 8, f: CLAY, layerId: lClayBot, body: 'bClay' },
    ])
    const right = col('R', 10, [{ top: 0, base: 8, f: CLAY, layerId: rClay, body: 'bClay' }])
    const regions = computeSectionFillV2([left, right], [], undefined, [0, 100])
    const sand = ofFormation(regions, SAND)
    expect(sand.length).toBe(1)
    expect(sand[0].kind).toBe('lens')
    // Reach shortened from 0.45 to ~0.02 (2 m / 100 m gap) — the hugging halo.
    expect(maxFrac(sand[0])).toBeCloseTo(0.02, 2)
    expect(maxFrac(sand[0])).toBeLessThan(0.45)
  })

  it('ruling 8b: a THICK 0-corr lens keeps the 0.45 reach (parity — geometry unchanged)', () => {
    // A 30 m-thick lens in a 20 m gap: min(0.45×20, 2×30) = min(9, 60) = 9 m = 0.45× gap.
    // 2× thickness ≥ 0.45× gap, so the cap is inactive and the reach is the flat 0.45.
    const lClayTop = layer()
    const lLens = layer()
    const lClayBot = layer()
    const rClay = layer()
    const left = col('L', 50, [
      { top: 0, base: 5, f: CLAY, layerId: lClayTop, body: 'bClay' },
      { top: 5, base: 35, f: SAND, layerId: lLens, body: 'bLens' }, // 30 m thick
      { top: 35, base: 45, f: CLAY, layerId: lClayBot, body: 'bClay' },
    ])
    const right = col('R', 50, [{ top: 0, base: 45, f: CLAY, layerId: rClay, body: 'bClay' }])
    const regions = computeSectionFillV2([left, right], [], undefined, [0, 20])
    const sand = ofFormation(regions, SAND)
    expect(sand.length).toBe(1)
    expect(sand[0].kind).toBe('lens')
    // Thick unit → 0.45 reach, unchanged from the pre-8b engine.
    expect(maxFrac(sand[0])).toBeCloseTo(0.45, 2)
  })

  it('ruling 8b: a USER apex override DEEPER than the cap SURVIVES (never capped)', () => {
    // The thin-lens-in-wide-gap case (would auto-cap to ~0.02), but the engineer drew an
    // apex at fraction 0.6 (alt-click / freedraw override). Ruling 8b: drawn apex overrides
    // keep their behaviour — the override reach is honoured, NOT clamped to the 2× cap.
    const lClayTop = layer()
    const lLens = layer()
    const lClayBot = layer()
    const rClay = layer()
    const left = col('L', 10, [
      { top: 0, base: 3, f: CLAY, layerId: lClayTop, body: 'bClay' },
      { top: 3, base: 4, f: SAND, layerId: lLens, body: 'bLens' }, // 1 m thick, would cap to 0.02
      { top: 4, base: 8, f: CLAY, layerId: lClayBot, body: 'bClay' },
    ])
    const right = col('R', 10, [{ top: 0, base: 8, f: CLAY, layerId: rClay, body: 'bClay' }])
    // Override keyed by (bodyId, gapIndex): apex at fraction 0.6, own mid-elevation.
    const overrides = new Map([['bLens@0', { fraction: 0.6, elevation: 3.5 }]])
    const regions = computeSectionFillV2([left, right], [], overrides, [0, 100])
    const sand = ofFormation(regions, SAND)
    expect(sand.length).toBe(1)
    expect(sand[0].kind).toBe('lens')
    // The drawn apex at 0.6 survives — deeper than both the 0.02 cap AND the flat 0.45.
    expect(maxFrac(sand[0])).toBeCloseTo(0.6, 2)
  })

  it('an uncorrelated same-lithology enclosed unit still becomes its OWN lens face', () => {
    // Enclosed sand (a distinct body) inside a sand matrix on the left, with no
    // correlation -> a closed lens face of its own (design §2 last bullet).
    const lSandTop = layer()
    const lInner = layer()
    const lSandBot = layer()
    const rSand = layer()
    const left = col('L', 10, [
      { top: 0, base: 3, f: SAND, layerId: lSandTop, body: 'bA' },
      { top: 3, base: 4, f: SILT, layerId: lInner, body: 'bInner' },
      { top: 4, base: 8, f: SAND, layerId: lSandBot, body: 'bA' },
    ])
    const right = col('R', 10, [{ top: 0, base: 8, f: SAND, layerId: rSand, body: 'bA' }])
    const regions = computeSectionFillV2([left, right], [])
    const silt = ofFormation(regions, SILT)
    expect(silt.length).toBe(1)
    expect(silt[0].kind).toBe('lens')
  })

  it('a lens enclosed inside a CORRELATED clay band keeps the band authoritative (band spans the gap, lens holes into it)', () => {
    // The enclosed-lens-as-hole shape (design §4 increment-12): a sand lens sits inside
    // a clay matrix whose UPPER clay is correlated across the gap (a real band). The
    // clay band must stay AUTHORITATIVE — one clay region spanning the full gap width —
    // while the sand lens is its OWN lens face cut OUT of the band (a hole/notch), NOT
    // overpainting it. The band never loses authority to the lens (cs1bandauthority).
    const lClayTop = layer()
    const lLens = layer()
    const lClayBot = layer()
    const rClay = layer()
    const left = col('L', 10, [
      { top: 0, base: 3, f: CLAY, layerId: lClayTop, body: 'bClay' },
      { top: 3, base: 4, f: SAND, layerId: lLens, body: 'bLens' },
      { top: 4, base: 8, f: CLAY, layerId: lClayBot, body: 'bClay' },
    ])
    const right = col('R', 10, [{ top: 0, base: 8, f: CLAY, layerId: rClay, body: 'bClay' }])
    // Only the UPPER clay is correlated (the enclosed-lens extraction keeps ``above``
    // correlated; ``below`` stays un-edged) — the clay is a banded matrix across the gap.
    const edges: CorrelationEdge[] = [{ a: lClayTop, b: rClay, aSide: 'top', bSide: 'top' }]
    const regions = computeSectionFillV2([left, right], edges)
    // The clay band is authoritative: a single clay quad spanning fraction 0..1.
    const clayBand = ofFormation(regions, CLAY).find((r) => r.kind === 'quad')
    expect(clayBand).toBeDefined()
    expect(minFrac(clayBand!)).toBeCloseTo(0, 5)
    expect(maxFrac(clayBand!)).toBeCloseTo(1, 5)
    // The sand lens is its OWN lens face, pinching at ~0.45 — cut out of the band.
    const sand = ofFormation(regions, SAND)
    expect(sand.length).toBe(1)
    expect(sand[0].kind).toBe('lens')
    expect(maxFrac(sand[0])).toBeCloseTo(0.45, 2)
    // Band authority: at the lens's own elevation, NEAR the far column (fraction 0.9,
    // past the lens apex), the covering lithology is CLAY (the band), never SAND.
    const coverNearFar = coverAt(clayBand!, 0.9)
    expect(coverNearFar).not.toBeNull()
    expect(coverNearFar![0]).toBeLessThanOrEqual(6.5)
    expect(coverNearFar![1]).toBeGreaterThanOrEqual(6.5)
  })

  it('crossing approved ties are a hard conflict: NEITHER bands, and the conflict is reported', () => {
    // Two ties that geometrically cross in the same gap (top->base and base->top
    // over the same two units) -> both suspended, both units fall back to non-band.
    const lA = layer()
    const lB = layer()
    const rA = layer()
    const rB = layer()
    const left = col('L', 10, [
      { top: 0, base: 4, f: SAND, layerId: lA },
      { top: 4, base: 8, f: CLAY, layerId: lB },
    ])
    const right = col('R', 10, [
      { top: 0, base: 4, f: SAND, layerId: rA },
      { top: 4, base: 8, f: CLAY, layerId: rB },
    ])
    // Tie 1: lA.top (elev 10) <-> rB.base (elev 2)  -> descends left->right.
    // Tie 2: lB.base (elev 2) <-> rA.top (elev 10)  -> ascends left->right.
    // The two lines cross in the gap.
    const edges: CorrelationEdge[] = [
      { a: lA, b: rB, aSide: 'top', bSide: 'base' },
      { a: lB, b: rA, aSide: 'base', bSide: 'top' },
    ]
    const { regions, conflicts } = computeSectionFillV2WithConflicts([left, right], edges)
    expect(conflicts.length).toBeGreaterThanOrEqual(1)
    // No region spans the full gap width as a quad off these crossing ties.
    const spanningQuads = regions.filter(
      (r) => r.kind === 'quad' && minFrac(r) < 1e-4 && maxFrac(r) > 1 - 1e-4,
    )
    // Crossing ties must not produce a banded quad between the crossing pair.
    expect(spanningQuads.every((r) => r.polygon.length >= 3)).toBe(true)
    expect(conflicts[0].tieIds.length).toBe(2)
  })

  it('a tie that reaches a shallow test TD anchors the band below that TD (band follows the tie)', () => {
    // Left is deep; right is a SHALLOW test whose TD (base of its only unit) is the
    // tie anchor for the left sand's base. The band must colour DOWN to the tie
    // line below the shallow TD, not stop flat at the shallow TD elevation.
    const lTop = layer()
    const lSand = layer()
    const rTop = layer()
    const rDeep = layer()
    const left = col('L', 10, [
      { top: 0, base: 2, f: CLAY, layerId: lTop },
      { top: 2, base: 9, f: SAND, layerId: lSand },
    ])
    // Right shallow test: clay to 2, then sand to a shallow TD of 5.
    const right = col('R', 10, [
      { top: 0, base: 2, f: CLAY, layerId: rTop },
      { top: 2, base: 5, f: SAND, layerId: rDeep },
    ])
    // Sand top tie + sand base tie (base of left sand <-> base of right sand = the
    // right TD). The band base rides the tie down to the right TD (elev 5).
    const edges: CorrelationEdge[] = [
      { a: lSand, b: rDeep, aSide: 'top', bSide: 'top' },
      { a: lSand, b: rDeep, aSide: 'base', bSide: 'base' },
    ]
    const regions = computeSectionFillV2([left, right], edges)
    const band = ofFormation(regions, SAND).find((r) => r.kind === 'quad')
    expect(band).toBeDefined()
    // At the RIGHT edge (fraction 1) the band base is the right TD elev (10-5=5),
    // and the band spans the full width.
    expect(maxFrac(band!)).toBeCloseTo(1, 5)
    const coverRight = coverAt(band!, 0.98)
    expect(coverRight).not.toBeNull()
    // Band base near the right TD elevation (5), not flat at the left base (1).
    expect(coverRight![0]).toBeLessThan(6)
  })
})

describe('computeSectionFillV2 — multi-gap band passes THROUGH the middle column', () => {
  it('a band tied across three columns bends at the middle contact (no S7A straight line)', () => {
    // Three columns; the sand is tied L-M and M-R. The middle column sand top sits
    // at a DIFFERENT elevation than a straight line between the L and R tops would
    // give. The band boundary must pass THROUGH the middle contact (the retired
    // S7A linearisation class must be impossible).
    const lClay = layer()
    const lSand = layer()
    const lBot = layer()
    const mClay = layer()
    const mSand = layer()
    const mBot = layer()
    const rClay = layer()
    const rSand = layer()
    const rBot = layer()
    // Middle surface is LOWER so its sand-top elevation is off the L-R chord.
    const left = col('L', 10, [
      { top: 0, base: 2, f: CLAY, layerId: lClay },
      { top: 2, base: 5, f: SAND, layerId: lSand },
      { top: 5, base: 8, f: CLAY, layerId: lBot },
    ])
    const mid = col('M', 6, [
      { top: 0, base: 1, f: CLAY, layerId: mClay },
      { top: 1, base: 4, f: SAND, layerId: mSand },
      { top: 4, base: 7, f: CLAY, layerId: mBot },
    ])
    const right = col('R', 10, [
      { top: 0, base: 2, f: CLAY, layerId: rClay },
      { top: 2, base: 5, f: SAND, layerId: rSand },
      { top: 5, base: 8, f: CLAY, layerId: rBot },
    ])
    const edges: CorrelationEdge[] = [
      { a: lSand, b: mSand, aSide: 'top', bSide: 'top' },
      { a: mSand, b: rSand, aSide: 'top', bSide: 'top' },
      { a: lBot, b: mBot, aSide: 'top', bSide: 'top' },
      { a: mBot, b: rBot, aSide: 'top', bSide: 'top' },
    ]
    const regions = computeSectionFillV2([left, mid, right], edges)
    // The sand band exists in BOTH gaps (0 and 1).
    const gap0Sand = ofFormation(regions, SAND).filter((r) => r.gapIndex === 0 && r.kind === 'quad')
    const gap1Sand = ofFormation(regions, SAND).filter((r) => r.gapIndex === 1 && r.kind === 'quad')
    expect(gap0Sand.length).toBeGreaterThanOrEqual(1)
    expect(gap1Sand.length).toBeGreaterThanOrEqual(1)
    // The middle sand-top elevation (6-1=5). At the shared column edge the gap-0
    // band's fraction-1 top must equal the gap-1 band's fraction-0 top = 5 — the
    // boundary passes THROUGH the middle contact, not a straight L->R chord
    // (which at the middle would be 10-2=8).
    const g0 = gap0Sand[0]
    // Sample right AT the shared column edge (fraction 1) — the band top there must
    // be the MIDDLE sand-top elevation (6-1=5), NOT the L->R straight-chord value
    // (which at the middle would be 10-2=8). This is the retired S7A class.
    const g0Right = coverAt(g0, 0.999)
    expect(g0Right).not.toBeNull()
    expect(g0Right![1]).toBeCloseTo(5, 1)
    // And decisively: the band top at the shared edge is well below the chord (8).
    expect(g0Right![1]).toBeLessThan(6)
  })
})

describe('computeSectionFillV2 — deep-to-deep substrate below a shallow test', () => {
  it('a deep unit runs deep-to-deep across a SHALLOW test that never reached it', () => {
    // Left and right are DEEP; the middle is a SHALLOW test that bottoms out high.
    // The engineer draws a JUMP TIE (left deep sand <-> right deep sand, across the
    // shallow middle). The deep sand must fill the gap BELOW the shallow test's TD —
    // a deep-to-deep bridge — rather than leaving the sub-TD strip empty.
    const lTopClay = layer()
    const lSand = layer()
    const mClay = layer() // shallow test: only clay, TD is high
    const rTopClay = layer()
    const rSand = layer()
    const left = col('L', 10, [
      { top: 0, base: 3, f: CLAY, layerId: lTopClay },
      { top: 3, base: 12, f: SAND, layerId: lSand }, // sand deep, base at elev -2
    ])
    const mid = col('M', 10, [
      { top: 0, base: 4, f: CLAY, layerId: mClay }, // shallow TD at elev 6
    ])
    const right = col('R', 10, [
      { top: 0, base: 3, f: CLAY, layerId: rTopClay },
      { top: 3, base: 12, f: SAND, layerId: rSand },
    ])
    // Jump tie: left deep sand <-> right deep sand, tied on BOTH contacts, so the
    // bridge carries the sand band's top AND base across the shallow middle column.
    const edges: CorrelationEdge[] = [
      { a: lSand, b: rSand, aSide: 'top', bSide: 'top' },
      { a: lSand, b: rSand, aSide: 'base', bSide: 'base' },
    ]
    // Real along-metres so the bridge interpolates at the middle's true position.
    const regions = computeSectionFillV2([left, mid, right], edges, undefined, [0, 100, 200])
    // The sand appears in BOTH gaps (0 and 1) BELOW the shallow middle TD (elev 6):
    // the bridge carries the deep sand across the shallow test.
    const sandGap0 = ofFormation(regions, SAND).filter((r) => r.gapIndex === 0)
    const sandGap1 = ofFormation(regions, SAND).filter((r) => r.gapIndex === 1)
    expect(sandGap0.length).toBeGreaterThanOrEqual(1)
    expect(sandGap1.length).toBeGreaterThanOrEqual(1)
    // In gap 0, near the middle column (fraction 1), the sand reaches BELOW the
    // shallow middle TD (elev 6) — the deep-to-deep fill, not a stop at the TD.
    const g0Sand = sandGap0.reduce((lo, r) =>
      Math.min(lo, ...r.polygon.filter((p) => p.fraction > 0.9).map((p) => p.elevation)), Infinity)
    expect(g0Sand).toBeLessThan(6)
  })

  it('a strip below a shallow TD with NO bridging tie stays empty (owner Q3)', () => {
    // Same shallow middle, but NO jump tie is drawn. The deep sand is known only at
    // the two deep columns; nothing anchors the sub-TD strip under the shallow test,
    // so it must stay UNFILLED (a genuinely bridge-less strip). White is correct.
    const lTopClay = layer()
    const lSand = layer()
    const mClay = layer()
    const rTopClay = layer()
    const rSand = layer()
    const left = col('L', 10, [
      { top: 0, base: 3, f: CLAY, layerId: lTopClay },
      { top: 3, base: 12, f: SAND, layerId: lSand },
    ])
    const mid = col('M', 10, [{ top: 0, base: 4, f: CLAY, layerId: mClay }])
    const right = col('R', 10, [
      { top: 0, base: 3, f: CLAY, layerId: rTopClay },
      { top: 3, base: 12, f: SAND, layerId: rSand },
    ])
    // NO edges at all — the deep sands are uncorrelated across the shallow gap.
    const regions = computeSectionFillV2([left, mid, right], [], undefined, [0, 100, 200])
    // The sub-TD strip below the shallow middle (elev < 6) in gaps 0 and 1 must have
    // NO sand fill (nothing bridges it). The left/right sands can only pinch as
    // lenses toward the middle from their own columns; neither reaches deep-to-deep.
    const deepSandNearMiddle = ofFormation(regions, SAND)
      .filter((r) => r.gapIndex === 0)
      .some((r) => r.polygon.some((p) => p.fraction > 0.9 && p.elevation < 5))
    expect(deepSandNearMiddle).toBe(false)
  })
})

describe('computeSectionFillV2 — a bracketed jump-tie pair BANDS through pass-through columns', () => {
  it('two jump ties bracketing a unit band the quad across the middle column (owner 2026-08-18)', () => {
    // Owner ruling, verbatim: "2/1/0 is still the basis of the model — that VD
    // quad has a top and a bottom correlation so it should be there."
    //
    // His scene: S10's very-dense sand tied top AND base to S6's very-dense
    // sand, jumping B2 whose thick sand both lines cross MID-BAND (no contact
    // near the lines — the divide correctly keeps these as spans). Ruling
    // 8i(e) made a bridge's pass-through side read onlap; for a BRACKETED
    // pair — two ties, same column pair, same formation both ends — 2/1/0
    // outranks it: two correlations make a band, adjacency was never part of
    // the rule.
    const lTop = layer()
    const lVd = layer()
    const lBelow = layer()
    const mTop = layer()
    const mThick = layer()
    const mBot = layer()
    const rTop = layer()
    const rVd = layer()
    const rBelow = layer()
    const VD = 'vd-sand'
    const BELOW = 'md-below'
    const THICK = 'md-thick'
    const left = col('L', 10, [
      { top: 0, base: 2, f: CLAY, layerId: lTop },
      { top: 2, base: 4, f: VD, layerId: lVd },
      { top: 4, base: 8, f: BELOW, layerId: lBelow },
    ])
    // The middle column's thick sand spans BOTH bridge lines' elevations —
    // crossed mid-band, exactly like B2.
    const mid = col('M', 10, [
      { top: 0, base: 1, f: CLAY, layerId: mTop },
      { top: 1, base: 7, f: THICK, layerId: mThick },
      { top: 7, base: 8, f: CLAY, layerId: mBot },
    ])
    const right = col('R', 10, [
      { top: 0, base: 2.2, f: CLAY, layerId: rTop },
      { top: 2.2, base: 4.2, f: VD, layerId: rVd },
      { top: 4.2, base: 8, f: BELOW, layerId: rBelow },
    ])
    // The top correlation (VD tops) and the bottom correlation (the units
    // below — the VD bases), both jumping M.
    const edges: CorrelationEdge[] = [
      { a: lVd, b: rVd, aSide: 'top', bSide: 'top' },
      { a: lBelow, b: rBelow, aSide: 'top', bSide: 'top' },
    ]
    const regions = computeSectionFillV2([left, mid, right], edges)
    const vdGap0 = ofFormation(regions, VD).filter((r) => r.gapIndex === 0)
    const vdGap1 = ofFormation(regions, VD).filter((r) => r.gapIndex === 1)
    // The quad exists on BOTH sides of the pass-through column…
    expect(vdGap0.length).toBeGreaterThanOrEqual(1)
    expect(vdGap1.length).toBeGreaterThanOrEqual(1)
    // …and COVERS each gap fully: a band, not an onlap pinching mid-gap. The
    // strip may arrive in several pieces (termination fences legitimately cut
    // it), so the assertion is coverage at sample fractions, with each piece
    // sitting inside the two ties' elevation envelope (tops 8/7.8, bases
    // 6/5.8).
    for (const [pieces, label] of [
      [vdGap0, 'gap 0'],
      [vdGap1, 'gap 1'],
    ] as const) {
      for (const f of [0.02, 0.25, 0.5, 0.75, 0.98]) {
        const covered = pieces.some((r) => {
          const cover = coverAt(r, f)
          return cover !== null && cover[1] - cover[0] > 0.5
        })
        expect(covered, `${label}: the band must cover fraction ${f}`).toBe(true)
      }
      for (const r of pieces) {
        expect(maxFrac(r)).toBeLessThanOrEqual(1.000001)
        const mid = coverAt(r, (minFrac(r) + maxFrac(r)) / 2)
        if (mid !== null) {
          expect(mid[1]).toBeLessThanOrEqual(8.05)
          expect(mid[0]).toBeGreaterThanOrEqual(5.75)
        }
      }
    }
  })
})
