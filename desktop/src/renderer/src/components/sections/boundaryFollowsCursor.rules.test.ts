/**
 * boundaryFollowsCursor.rules.test.ts — SESSION 103 gate: "dragging an UN-correlated two-band
 * litho boundary CORRELATES it (snapping the wedge to a flat band, lithologies preserved), then
 * BENDS it to the cursor" (owner-decided 2026-07-24,
 * docs/design/freedraw-onlap-lens-edit-model.md → "ANY BOUNDARY BENDS TO THE CURSOR").
 *
 * The rule, in the owner's words: "i just want the boundary i click to reshape to where i move my
 * cursor" — WHETHER OR NOT the boundary carries a correlation tie. An un-correlated boundary renders
 * as a PINCH/wedge (0 correlations → LENS per the 2/1/0 rule); the ONLY way to make it bendable is to
 * CREATE the tie, which necessarily SNAPS the wedge to a flat band. The owner ACCEPTS this snap
 * ("snap the wedge to a band, the user can always shape it into a wedge") — the lithologies are
 * preserved (ZAND stays over KLEI, no flip), only the SHAPE changes.
 *
 * THE MECHANISM (S101/S102 proofs, built S103): the v2 engine's ``collectContactBends`` bends a
 * shared contact ONLY when an ACTIVE correlation TIE sits on it. So the drag (1) synthesizes the tie
 * matching the current fill (``synthesizeContactTie`` — upper band base-base, no flip), injecting it
 * into the ``edges`` fed to ``computeSectionFillV2``; then (2) bends the now-tied contact through the
 * raw cursor via the proven ``contact:U|L@g`` override. This gate drives that mechanism directly on
 * a minimal synthetic 2-band section (the real CS1 fixture has no clean un-correlated two-full-band
 * pair — all such pairs are already correlated or are the fragmented 934a78 exotic case).
 *
 * BEFORE the mechanism (§101/§102): an un-tied two-band contact override was ENGINE-INERT — the fill
 * stayed a fragmented pinch and the boundary did NOT bend (RED). AFTER (S103): the synthesized tie
 * bands the boundary and the override bends it to the cursor (GREEN).
 *
 * The COMMON case only (owner spec, prompt item 4): a boundary between TWO FULL-WIDTH BANDS. A true
 * pinch tip (band → zero) or a surface-bounded boundary is deferred (STOP-AND-REPORT, not invented).
 */
import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionColumn,
  type SectionRegion,
} from '../../utils/sectionPartition'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { contactApexOverrideKey } from '../../utils/partitionFillV2/contactOverride'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import {
  boundaryHasTie,
  reclassifyStackedBandGrab,
  resolveTwoBandBoundary,
  synthesizeContactTie,
  twoBandExtentScreenY,
} from './correlateOnDrag'

// --------------------------------------------------------------------------
// Two columns, each ZAND (top) over KLEI (bottom): the ZAND/KLEI contact is a
// boundary between TWO FULL-WIDTH BANDS (both bodies present on both columns).
// No correlation edges → the contact carries NO tie → the S100 engine-inert case.
// --------------------------------------------------------------------------
const ZAND = 'body-zand' // upper band, present on both columns (full-width)
const KLEI = 'body-klei' // lower band, present on both columns (full-width)

function twoFullBandColumns(): PartitionColumn[] {
  // Both columns identical: ZAND 0..5 m, KLEI 5..12 m. Surface at 10 → contact at el 5.
  const mk = (invId: string): PartitionColumn => ({
    investigationId: invId,
    surfaceElevM: 10,
    units: [
      { topDepthM: 0, baseDepthM: 5, formationId: 'zand', bodyId: ZAND, layerId: `${invId}-zand` },
      { topDepthM: 5, baseDepthM: 12, formationId: 'klei', bodyId: KLEI, layerId: `${invId}-klei` },
    ],
  })
  return [mk('A'), mk('B')]
}

/** The ZAND base contour's mid-gap apex elevation across the upper band's gap-0 regions, or null. */
function midGapContactElev(regions: SectionRegion[], upperBodyId: string): number | null {
  const upper = regions.filter((r) => r.bodyId === upperBodyId && r.gapIndex === 0)
  if (upper.length === 0) return null
  // The bent base edge inserts an interior (mid-gap) vertex at the cursor elevation. Return the
  // elevation of the deepest interior (0.02 < fraction < 0.98) vertex across the upper regions.
  let best: number | null = null
  for (const r of upper) {
    for (const p of r.polygon) {
      if (p.fraction > 0.02 && p.fraction < 0.98) {
        if (best === null || p.elevation < best) best = p.elevation
      }
    }
  }
  return best
}

/** True when the ZAND/KLEI stack fully tiles the gap with no interior hole or double-coverage. */
function hasCoverageHoleOrOverlap(regions: SectionRegion[]): boolean {
  const g0 = regions.filter((r) => r.gapIndex === 0)
  if (g0.length === 0) return true
  let elMin = Infinity
  let elMax = -Infinity
  for (const r of g0)
    for (const p of r.polygon) {
      if (p.elevation < elMin) elMin = p.elevation
      if (p.elevation > elMax) elMax = p.elevation
    }
  const inPoly = (poly: { fraction: number; elevation: number }[], f: number, e: number): boolean => {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const fi = poly[i].fraction
      const ei = poly[i].elevation
      const fj = poly[j].fraction
      const ej = poly[j].elevation
      const intersect = ei > e !== ej > e && f < ((fj - fi) * (e - ei)) / (ej - ei) + fi
      if (intersect) inside = !inside
    }
    return inside
  }
  const N = 25
  for (let fi = 1; fi < N; fi++) {
    for (let ei = 1; ei < N; ei++) {
      const f = fi / N
      const e = elMin + ((elMax - elMin) * ei) / N
      let cover = 0
      for (const r of g0) if (inPoly(r.polygon, f, e)) cover++
      if (cover > 1) return true // overlap (double coverage)
      if (cover === 0) return true // hole
    }
  }
  return false
}

/** Whether the upper band sits ABOVE the lower band (no litho flip) — the ground-truth-litho gate. */
function upperStaysAbove(regions: SectionRegion[], upperBodyId: string, lowerBodyId: string): boolean {
  const upper = regions.filter((r) => r.bodyId === upperBodyId && r.gapIndex === 0)
  const lower = regions.filter((r) => r.bodyId === lowerBodyId && r.gapIndex === 0)
  if (upper.length === 0 || lower.length === 0) return false
  const upperMin = Math.min(...upper.flatMap((r) => r.polygon.map((p) => p.elevation)))
  const lowerMax = Math.max(...lower.flatMap((r) => r.polygon.map((p) => p.elevation)))
  // The upper band's HIGHEST point must be above the lower band's; overlap only at the shared
  // contact. A crude but decisive no-flip check: the upper band's top exceeds the lower band's top.
  const upperMax = Math.max(...upper.flatMap((r) => r.polygon.map((p) => p.elevation)))
  return upperMax > lowerMax && upperMin >= lowerMax - 3 // upper never dives below the lower body
}

describe('S103 — un-correlated two-full-band boundary correlates then follows the cursor', () => {
  it('creates the tie (wedge→band, litho preserved) then bends the boundary to the cursor, one region, gap-free', () => {
    setTwoSidedTerminations(true)
    try {
      const columns = twoFullBandColumns()

      // (pre) The un-correlated boundary renders as a PINCH/wedge (0 edges → LENS). The boundary
      // carries NO tie — the S100/S102 engine-inert case that this mechanism resolves.
      const boundary = resolveTwoBandBoundary(columns[0], columns[1], ZAND, KLEI)
      expect(boundary, 'the synthetic section must resolve as a two-full-band boundary').not.toBeNull()
      expect(
        boundaryHasTie([], [boundary!.upperLeft, boundary!.upperRight], [boundary!.lowerLeft, boundary!.lowerRight]),
        'the boundary starts UN-correlated (no tie)',
      ).toBe(false)

      // (a) DRAGGING CREATES THE TIE matching the current fill (ZAND base-base, no flip). Injecting
      // it into the engine edges SNAPS the wedge to a flat band — the wedge→band snap the owner
      // accepts, lithologies preserved.
      const tie = synthesizeContactTie(boundary!.upperLeft, boundary!.upperRight)
      const edges: CorrelationEdge[] = [tie]
      expect(
        boundaryHasTie(edges, [boundary!.upperLeft, boundary!.upperRight], [boundary!.lowerLeft, boundary!.lowerRight]),
        'the synthesized tie now sits on the boundary',
      ).toBe(true)

      const banded = computeSectionFillV2(columns, edges)
      // The wedge is gone: ZAND is one flat band, KLEI is one flat band (no pinch fragments).
      const zandBanded = banded.filter((r) => r.bodyId === ZAND && r.gapIndex === 0)
      const kleiBanded = banded.filter((r) => r.bodyId === KLEI && r.gapIndex === 0)
      expect(zandBanded.length, 'ZAND snaps to a single band').toBe(1)
      expect(kleiBanded.length, 'KLEI snaps to a single band').toBe(1)
      // LITHOS PRESERVED: ZAND stays ABOVE KLEI (no flip) — the ground-truth-litho gate.
      expect(upperStaysAbove(banded, ZAND, KLEI), 'ZAND stays over KLEI (no litho flip)').toBe(true)

      // (b) BEND the now-tied boundary to the RAW cursor (el 3, mid-gap). The stored node's
      // elevation ≈ the cursor elevation.
      const CURSOR_EL = 3
      const key = contactApexOverrideKey(ZAND, KLEI, 0)
      const ov = new Map<string, LensApexOverride>([
        [key, { fraction: 0.5, elevation: CURSOR_EL, upper: [], lower: [] } as unknown as LensApexOverride],
      ])
      const after = computeSectionFillV2(columns, edges, ov)

      const bentElev = midGapContactElev(after, ZAND)
      expect(bentElev, 'the boundary must bend — an interior apex must exist').not.toBeNull()
      // (b) the STORED node el ≈ cursor el.
      expect(Math.abs(bentElev! - CURSOR_EL)).toBeLessThan(0.5)

      // (c) ONE region set, gap-free: the SAME body reshaped, never fragmented into a pinch.
      const upperAfter = after.filter((r) => r.bodyId === ZAND && r.gapIndex === 0)
      const lowerAfter = after.filter((r) => r.bodyId === KLEI && r.gapIndex === 0)
      expect(upperAfter.length, 'the reshaped upper band must not fragment').toBe(1)
      expect(lowerAfter.length, 'the reshaped lower band must not fragment').toBe(1)
      expect(hasCoverageHoleOrOverlap(after), 'bent fill must stay a true partition').toBe(false)
      expect(upperStaysAbove(after, ZAND, KLEI), 'ZAND stays over KLEI after the bend').toBe(true)

      // (d) RE-WEDGEABLE: a SECOND drag re-shapes it (still follows the cursor). Move the cursor to
      // a different elevation and fraction — the boundary tracks it again.
      const CURSOR_EL2 = 1.5
      const ov2 = new Map<string, LensApexOverride>([
        [key, { fraction: 0.35, elevation: CURSOR_EL2, upper: [], lower: [] } as unknown as LensApexOverride],
      ])
      const after2 = computeSectionFillV2(columns, edges, ov2)
      const bentElev2 = midGapContactElev(after2, ZAND)
      expect(bentElev2, 'the second drag must still bend the boundary').not.toBeNull()
      expect(Math.abs(bentElev2! - CURSOR_EL2), 'the boundary re-shapes to the new cursor').toBeLessThan(0.5)
      expect(hasCoverageHoleOrOverlap(after2), 'the re-shaped fill stays a true partition').toBe(false)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})

describe('S103 — grab reclassification (fix the isApexShapeable→lens hijack)', () => {
  // The un-correlated stacked pair renders its lower band (KLEI) as a PINCH → grabbed as a LENS.
  // The reclassify must recover the two-band CONTACT pair regardless of WHICH band the cursor
  // grabbed (near the top contact → grabbed is the lower band; near the base → grabbed is upper).
  const columns = twoFullBandColumns()

  it('a grab on the LOWER band (KLEI) near its TOP resolves ZAND-over-KLEI (grabbed = lower)', () => {
    // KLEI spans el 5..-2; its TOP is el 5 (the shared boundary). Cursor near el 5.
    const pair = reclassifyStackedBandGrab(columns[0], columns[1], KLEI, 5)
    expect(pair).not.toBeNull()
    expect(pair!.upperBodyId, 'ZAND is the upper band (no flip)').toBe(ZAND)
    expect(pair!.lowerBodyId, 'KLEI is the lower band').toBe(KLEI)
  })

  it('a grab on the UPPER band (ZAND) near its BASE resolves ZAND-over-KLEI (grabbed = upper)', () => {
    // ZAND spans el 10..5; its BASE is el 5 (the shared boundary). Cursor near el 5.
    const pair = reclassifyStackedBandGrab(columns[0], columns[1], ZAND, 5)
    expect(pair).not.toBeNull()
    expect(pair!.upperBodyId, 'ZAND is the upper band').toBe(ZAND)
    expect(pair!.lowerBodyId, 'KLEI is the lower band (no flip)').toBe(KLEI)
  })

  it('a one-sided body (a genuine lens) does NOT reclassify — the lens drag stands', () => {
    // A body present on only ONE column is a real lens, not a stacked band → null (keep lens drag).
    const oneSided: PartitionColumn[] = [
      {
        investigationId: 'A',
        surfaceElevM: 10,
        units: [
          { topDepthM: 0, baseDepthM: 5, formationId: 'zand', bodyId: ZAND, layerId: 'A-zand' },
          { topDepthM: 5, baseDepthM: 7, formationId: 'silt', bodyId: 'body-silt', layerId: 'A-silt' },
          { topDepthM: 7, baseDepthM: 12, formationId: 'klei', bodyId: KLEI, layerId: 'A-klei' },
        ],
      },
      {
        investigationId: 'B',
        surfaceElevM: 10,
        units: [
          { topDepthM: 0, baseDepthM: 5, formationId: 'zand', bodyId: ZAND, layerId: 'B-zand' },
          { topDepthM: 5, baseDepthM: 12, formationId: 'klei', bodyId: KLEI, layerId: 'B-klei' },
        ],
      },
    ]
    // ``body-silt`` is only on column A → a genuine lens, not a stacked band.
    expect(reclassifyStackedBandGrab(oneSided[0], oneSided[1], 'body-silt', 4)).toBeNull()
  })

  it('a TOP-TOP edge on the UPPER band does NOT count as tied (S1 — it ties the surface, not the contact)', () => {
    const b = resolveTwoBandBoundary(columns[0], columns[1], ZAND, KLEI)!
    // A top-top tie on the two ZAND layers ties ZAND's TOP (ground surface), NOT the ZAND/KLEI
    // contact — S101 proved this leaves the bend engine-inert. It must read as UN-tied so the drag
    // still injects the base-base tie that actually bends the boundary.
    const zandTopTop: CorrelationEdge = {
      a: b.upperLeft.layerId,
      b: b.upperRight.layerId,
      aSide: 'top',
      bSide: 'top',
    }
    expect(
      boundaryHasTie([zandTopTop], [b.upperLeft, b.upperRight], [b.lowerLeft, b.lowerRight]),
      'a top-top upper-band edge is NOT a tie on this shared boundary',
    ).toBe(false)
    // The base-base tie the drag synthesizes DOES count.
    expect(
      boundaryHasTie(
        [synthesizeContactTie(b.upperLeft, b.upperRight)],
        [b.upperLeft, b.upperRight],
        [b.lowerLeft, b.lowerRight],
      ),
    ).toBe(true)
  })

  it('S106 — an onlap INTERVENING on ONE column blocks reclassify → the onlap survives (no absorb)', () => {
    // The S106 topology (owner dogfeed "the onlapping sand quad disappears instead of moving with"):
    // upper A (full-width) over lower C (full-width), with a NON-full-width sand onlap B that
    // INTERVENES between A and C on the RIGHT column ONLY. On the LEFT column A sits directly above C.
    //   LEFT  : A 0..5,          C 5..12          → A/C contact at el 5
    //   RIGHT : A 0..5, B 5..7,  C 7..12          → A base el 5, C top el 3 (B between)
    // The OLD code resolved the (upper, lower) pair from the LEFT column alone → {A, C}, then a
    // correlate/reshape absorbed the intervening onlap B. The both-column adjacency guard makes the
    // grab resolve to NULL (A's base el 5 ≠ C's top el 3 on the right column) → NO reclassify → NO
    // tie → B is never absorbed. B is not a clean two-full-band boundary, so it is a NO-OP for now
    // (the "onlap rides along" full reshape is a deferred owner item — NOT a destructive absorb).
    const A = 'body-a'
    const B = 'body-b-onlap' // the sand onlap — present on the RIGHT column only (intervenes A↕C)
    const C = 'body-c'
    const s106: PartitionColumn[] = [
      {
        investigationId: 'L',
        surfaceElevM: 10,
        units: [
          { topDepthM: 0, baseDepthM: 5, formationId: 'a', bodyId: A, layerId: 'L-a' },
          { topDepthM: 5, baseDepthM: 12, formationId: 'c', bodyId: C, layerId: 'L-c' },
        ],
      },
      {
        investigationId: 'R',
        surfaceElevM: 10,
        units: [
          { topDepthM: 0, baseDepthM: 5, formationId: 'a', bodyId: A, layerId: 'R-a' },
          { topDepthM: 5, baseDepthM: 7, formationId: 'b', bodyId: B, layerId: 'R-b' }, // the onlap
          { topDepthM: 7, baseDepthM: 12, formationId: 'c', bodyId: C, layerId: 'R-c' },
        ],
      },
    ]

    // (a) The RECLASSIFY of a grab on C near its top must NOW return null (was {A, C} pre-guard) —
    // A and C are NOT adjacent on the right column (B intervenes), so this is not a clean two-band
    // boundary. clickElev near C's top on the LEFT column (el 5).
    const stacked = reclassifyStackedBandGrab(s106[0], s106[1], C, 5)
    expect(
      stacked,
      'A and C are not adjacent on the right column (B intervenes) → no reclassify (was {A, C})',
    ).toBeNull()

    // (b) The onlap B SURVIVES: with no tie injected, the engine fill keeps B's region. The region
    // count is unchanged — B is not absorbed into the A/C band.
    const before = computeSectionFillV2(s106, [])
    const bBefore = before.filter((r) => r.bodyId === B && r.gapIndex === 0)
    expect(bBefore.length, 'the sand onlap B renders in the base fill').toBeGreaterThan(0)
    // No tie is synthesized (reclassify returned null), so nothing changes — B is not swallowed.

    // (c) resolveTwoBandBoundary({A, C}) must ALSO bail (its right-column adjacency check catches the
    // intervening B) — the two guards agree, so even a manual {A, C} pendingContactTie is null.
    expect(
      resolveTwoBandBoundary(s106[0], s106[1], A, C),
      'the {A, C} boundary is not two-full-band-adjacent on the right column',
    ).toBeNull()
  })

  it('the gap-free clamp spans the FULL two-band extent (upper top → lower base)', () => {
    // levelToScreen: identity-flip (higher elevation → smaller y). Use y = -elevation.
    const levelToScreen = (el: number): number => -el
    const extent = twoBandExtentScreenY(columns[0], columns[1], ZAND, KLEI, levelToScreen)
    expect(extent).not.toBeNull()
    // Upper band top = el 10 → minY = -10; lower band base = el -2 → maxY = 2.
    expect(extent!.minY, 'clamp top = ZAND top (el 10)').toBe(-10)
    expect(extent!.maxY, 'clamp base = KLEI base (el -2)').toBe(2)
    // The clamp must span BOTH bands — not trap the bend inside the grabbed band.
    expect(extent!.maxY - extent!.minY, 'the clamp spans the full stack').toBe(12)
  })
})
