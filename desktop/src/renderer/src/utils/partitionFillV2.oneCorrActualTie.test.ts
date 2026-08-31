/**
 * partitionFillV2.oneCorrActualTie.test.ts — behavioural gates for the audit's TieRef fix
 * (item 6): a corr-1 unit's onlap must FOLLOW ITS OWN tie, not "whichever tie happens to sit at
 * that elevation". Ruling 8m (design partition-engine-v2.md §8) compares the litho at the tie's
 * MATCHED facing contact to decide whether to draw the onlap flank; the far endpoint that
 * comparison samples must belong to the unit's ACTUAL edge, not the first tie found at the shared
 * near elevation. Ruling 8a: a shared physical contact hands both adjacent units the same tie.
 *
 * Flag-ON (``setTwoSidedTerminations(true)``, restored in ``finally``).
 *
 * Cases:
 *   (a) TWO active ties at the SAME own-contact elevation on the near column, landing at DIFFERENT
 *       far endpoints / facing lithos. The corr-1 unit must follow ITS OWN tie's far endpoint for
 *       the 8m litho decision — NOT the first tie found at that elevation. This is the TieRef RED
 *       target: the current elevation-guessing ``tieFacingElevAt`` returns the first tie's far
 *       endpoint, so it can compare the WRONG facing litho and draw/skip the wrong flank. The
 *       Part-2 TieRef fix turns this GREEN in THIS session.
 *   (b) same MATCHED lithology via the unit's actual tie → NO onlap flank (8m suppression;
 *       regression lock — may already pass via 8m).
 *   (c) different MATCHED lithology via the unit's actual tie → EXACTLY ONE ``oflank`` (regression
 *       lock — may already pass via 8m).
 *
 * Pure vitest — no engine flag leak (restored in ``finally``). No Date.now / Math.random.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { emitCurves } from './partitionFillV2/emitCurves'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { type InputCurve } from './partitionFillV2/types'
import { type CorrelationEdge, type PartitionColumn } from './sectionPartition'

let seq = 0
const layer = (): string => `L${seq++}`
const SAND = 'sand'
const CLAY = 'clay'
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

/** Flip the flag ON for the callback, restore after. */
function withFlip<T>(fn: () => T): T {
  const prev = setTwoSidedTerminations(true)
  try {
    return fn()
  } finally {
    setTwoSidedTerminations(prev)
  }
}

afterEach(() => {
  setTwoSidedTerminations(false)
})

/** Count onlap flank curves (``oflank`` prefix) touching a column contact at ``(x, elev)``. */
function oflankCountAtContact(curves: readonly InputCurve[], x: number, elev: number): number {
  let n = 0
  for (const c of curves) {
    if (!c.id.startsWith('oflank')) continue
    if (c.points.some((p) => Math.abs(p.x - x) < 0.005 && Math.abs(p.y - elev) < 0.005)) n++
  }
  return n
}

describe('ruling 8m / TieRef — a corr-1 onlap follows ITS OWN tie', () => {
  it('(a) two ties at one near elevation, different far endpoints → the onlap follows its own tie (TieRef)', () => {
    seq = 0
    // Column L: SAND[0..3] / CLAY[3..7] / SILT[7..9]. The contact at depth 7 (elev 3) is SHARED by
    // L's CLAY (its base) and L's SILT (its top). Looking RIGHT into gap 0, TWO ties leave that ONE
    // shared near elevation (elev 3) but land at DIFFERENT far endpoints on R:
    //   - Tie A (L CLAY's OWN tie): L CLAY base (elev 3) ↔ R CLAY top (elev 3). Matched facing ABOVE
    //     the base tie (elev 3 + ε) = R CLAY [elev 3..7] — SAME litho as L CLAY → ruling 8m SKIPS.
    //   - Tie B (L SILT's tie): L SILT top (elev 3) ↔ R SAND-2 top (elev 5). A DIFFERENT far
    //     elevation (5, not 3). Sampling the facing ABOVE elev 5 lands in R's SILT-2 [elev 5..8] —
    //     a DIFFERENT litho from L CLAY.
    // L CLAY is corr-1 (base-tied via Tie A). The elevation-guessing ``tieFacingElevAt`` matches the
    // FIRST tie whose NEAR endpoint ≈ elev 3 — which can be Tie B (L SILT's) — and returns its FAR
    // endpoint (elev 5). ``matchedFacingSameLitho`` then samples R above elev 5 → R SILT-2 →
    // DIFFERENT → DRAWS a spurious onlap flank at L CLAY's free (top) contact (elev 7). Following L
    // CLAY's ACTUAL tie (Tie A, far elev 3 → R CLAY, same) correctly draws NO flank. This is the
    // TieRef RED target; the Part-2 fix makes it GREEN.
    const lSand = layer()
    const lClay = layer()
    const lSilt = layer()
    // R stack, top→down: SAND[0..3] (elev 10..7) / SILT-2[elev 7..5] / SAND-2[elev 5..3] /
    // CLAY[elev 3..-1] / SILT[elev -1..-3]. R CLAY top at elev 3 (Tie A far); R SAND-2 top at elev 5
    // (Tie B far). Above elev 5 is SILT-2 (different from CLAY); above elev 3 is R CLAY itself... no:
    // "above the base tie" samples elev 3 + ε → still inside R CLAY[3..-1]? R CLAY spans [3..-1], so
    // elev 3 IS its top; elev 3 + ε is just ABOVE it = R SAND-2 [5..3]. Make R SAND-2 = CLAY so the
    // matched-facing-above of Tie A is CLAY (same → skip). Rename for clarity below.
    const rSandTop = layer()
    const rSilt2 = layer()
    const rClayHi = layer() // the unit ABOVE the elev-3 tie (matched facing for a base tie) = CLAY
    const rClayTie = layer() // R's unit whose TOP is at elev 3 (Tie A far endpoint)
    const rSiltDeep = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 3, f: SAND, layerId: lSand, body: 'sand-L' },
        { top: 3, base: 7, f: CLAY, layerId: lClay, body: 'clay-L' },
        { top: 7, base: 9, f: SILT, layerId: lSilt, body: 'silt-L' },
      ]),
      col('R', 10, [
        { top: 0, base: 3, f: SAND, layerId: rSandTop, body: 'sand-R' }, // elev 10..7
        { top: 3, base: 5, f: SILT, layerId: rSilt2, body: 'silt2-R' }, // elev 7..5  (Tie B far = elev 5 top? no)
        { top: 5, base: 7, f: CLAY, layerId: rClayHi, body: 'clayHi-R' }, // elev 5..3 (ABOVE the elev-3 tie)
        { top: 7, base: 11, f: CLAY, layerId: rClayTie, body: 'clayTie-R' }, // elev 3..-1 (Tie A: top elev 3)
        { top: 11, base: 13, f: SILT, layerId: rSiltDeep, body: 'siltDeep-R' }, // elev -1..-3
      ]),
    ]
    // Tie A (L CLAY's own): L CLAY base (elev 3) ↔ R clayTie top (elev 3) — mixed base↔top, not a
    // band. Matched facing ABOVE L's base tie (elev 3 + ε) = R clayHi CLAY [elev 5..3] → SAME litho
    // as L CLAY → ruling 8m SKIPS (correct). Tie B (L SILT's): L SILT top (elev 3) ↔ R silt2 base
    // (elev 5) — near elev 3 (SAME as Tie A's near), far elev 5. If ``tieFacingElevAt`` picks Tie B
    // for L CLAY it follows to elev 5 and samples ABOVE → R silt2 SILT [elev 7..5] → DIFFERENT → a
    // spurious draw.
    // Tie B listed FIRST so the elevation-guessing ``tieFacingElevAt`` (first match at near-elev 3)
    // picks the WRONG tie — the pre-fix engine follows Tie B (far elev 5, different litho) and draws
    // a spurious flank; the TieRef fix follows L CLAY's own Tie A regardless of edge order.
    const edges: CorrelationEdge[] = [
      { a: lSilt, b: rSilt2, aSide: 'top', bSide: 'base' },
      { a: lClay, b: rClayTie, aSide: 'base', bSide: 'top' },
    ]
    const alongM = [0, 40]
    const section = buildSectionInput(columns, edges, undefined, alongM)
    const { curves } = withFlip(() => emitCurves(section))
    // L CLAY's OWN tie (Tie A) matched facing above = R clayHi CLAY (SAME) → NO onlap flank at L
    // CLAY's free (top) contact (x = 0, elev 7). The wrong-tie path (following Tie B) would draw one.
    expect(oflankCountAtContact(curves, 0, 7)).toBe(0)
  })

  it('(b) same matched litho via the actual tie → NO onlap flank (regression lock)', () => {
    seq = 0
    // Single gap: L SAND[0..3]/CLAY[3..7]; R SAND[0..3]/CLAY[3..7]/SILT[7..9]. Tie L CLAY base
    // (elev 3) ↔ R SILT top (elev 3): mixed → not a band. Matched facing ABOVE the base tie = R
    // CLAY [elev 3..7] — SAME as L CLAY → ruling 8m skips. (Identical to followTieOnlap (a); kept
    // as a TieRef-scoped lock that the single-tie case is unchanged.)
    const lSand = layer()
    const lClay = layer()
    const rSand = layer()
    const rClay = layer()
    const rSilt = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 3, f: SAND, layerId: lSand, body: 'sand-L' },
        { top: 3, base: 7, f: CLAY, layerId: lClay, body: 'clay-L' },
      ]),
      col('R', 10, [
        { top: 0, base: 3, f: SAND, layerId: rSand, body: 'sand-R' },
        { top: 3, base: 7, f: CLAY, layerId: rClay, body: 'clay-R' },
        { top: 7, base: 9, f: SILT, layerId: rSilt, body: 'silt-R' },
      ]),
    ]
    const edges: CorrelationEdge[] = [{ a: lClay, b: rSilt, aSide: 'base', bSide: 'top' }]
    const alongM = [0, 40]
    const section = buildSectionInput(columns, edges, undefined, alongM)
    const { curves } = withFlip(() => emitCurves(section))
    // L CLAY's free (top) contact (x = 0, elev 7): same-litho matched facing → NO flank.
    expect(oflankCountAtContact(curves, 0, 7)).toBe(0)
  })

  it('(c) different matched litho via the actual tie → EXACTLY ONE oflank (regression lock)', () => {
    seq = 0
    // L SAND[0..3]/CLAY[3..7]; R SAND[0..3]/SILT[3..7]/CLAY[7..9]. Tie L CLAY base (elev 3) ↔ R
    // CLAY top (elev 3): mixed → not a band. Matched facing ABOVE the base tie = R SILT [elev 3..7]
    // — DIFFERENT from L CLAY → ruling 8m draws exactly ONE onlap flank at L CLAY's free (top)
    // contact (elev 7). (Identical to followTieOnlap (b); TieRef-scoped lock.)
    const lSand = layer()
    const lClay = layer()
    const rSand = layer()
    const rSilt = layer()
    const rClay = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 3, f: SAND, layerId: lSand, body: 'sand-L' },
        { top: 3, base: 7, f: CLAY, layerId: lClay, body: 'clay-L' },
      ]),
      col('R', 10, [
        { top: 0, base: 3, f: SAND, layerId: rSand, body: 'sand-R' },
        { top: 3, base: 7, f: SILT, layerId: rSilt, body: 'silt-R' },
        { top: 7, base: 9, f: CLAY, layerId: rClay, body: 'clay-R' },
      ]),
    ]
    const edges: CorrelationEdge[] = [{ a: lClay, b: rClay, aSide: 'base', bSide: 'top' }]
    const alongM = [0, 40]
    const section = buildSectionInput(columns, edges, undefined, alongM)
    const { curves } = withFlip(() => emitCurves(section))
    expect(oflankCountAtContact(curves, 0, 7)).toBe(1)
  })
})
