/**
 * partitionFillV2.followTieOnlap.test.ts — behavioural gate for owner ruling 8m (the RESTORED
 * follow-the-tie same-litho onlap suppression; design partition-engine-v2.md §8 8m, 2026-07-17).
 * Flag-ON (``setTwoSidedTerminations(true)``).
 *
 * Ruling 8m (verbatim): "restore it — just add a lithology check before drawing." Before drawing a
 * corr-1 onlap flank, FOLLOW the actual tie to the MATCHED facing contact (below-for-top-tie /
 * above-for-bottom-tie), compare litho — SAME → skip the flank (the tie is the boundary, the fill
 * flows, the 8j merge welds one body; the flank would be an interior seam of the identical final
 * body); DIFFERENT → draw the onlap. Scope: corr-1 onlaps ONLY.
 *
 * Cases:
 *   (a) SAME-litho corr-1 (base tie whose matched facing above the tie is the same formation) →
 *       NO onlap flank drawn; the final body is IDENTICAL to the always-draw output (one SAND body
 *       spanning the full gap width via the flood + 8j merge — merge-equivalence). Hole-free.
 *   (b) DIFFERENT-litho corr-1 (matched facing above the tie differs) → the onlap flank IS drawn
 *       (regression guard: 8m must not over-suppress).
 *   (c) MIXED — a middle column with a same-litho tie on one side and a different-litho tie on the
 *       other → exactly ONE onlap flank (the different-litho side draws, the same-litho side skips).
 *
 * Pure vitest — no engine flag leak (restored in ``finally``). No Date.now / Math.random.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { computeSectionFillV2 } from './partitionFillV2'
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

/** Count onlap flank curves (``oflank`` prefix) whose endpoints touch a column at ``x``. */
function oflankCountAtColumn(curves: readonly InputCurve[], x: number): number {
  let n = 0
  for (const c of curves) {
    if (!c.id.startsWith('oflank')) continue
    if (c.points.some((p) => Math.abs(p.x - x) < 0.005)) n++
  }
  return n
}

/**
 * Count onlap flank curves (``oflank`` prefix) whose endpoints touch a column at ``(x, elev)`` —
 * pins to ONE unit's free contact so a neighbouring unit's surface onlap (a first-unit top-band
 * onlap at the same column) is not miscounted.
 */
function oflankCountAtContact(curves: readonly InputCurve[], x: number, elev: number): number {
  let n = 0
  for (const c of curves) {
    if (!c.id.startsWith('oflank')) continue
    if (c.points.some((p) => Math.abs(p.x - x) < 0.005 && Math.abs(p.y - elev) < 0.005)) n++
  }
  return n
}

describe('ruling 8m — follow-the-tie same-litho onlap suppression', () => {
  it('(a) same-litho corr-1: NO onlap flank; final CLAY body spans full width, one body, hole-free', () => {
    seq = 0
    // L: SAND[0..3] over CLAY[3..7]. R: SAND[0..3] over CLAY[3..7] over SILT[7..9]. A MIXED tie joins
    // L CLAY's base (depth 7, elev 3) to R SILT's top (depth 7, elev 3): leftSide 'base', rightSide
    // 'top'. Mixed side → NOT a collectGapBands matched-pair band, so L CLAY reaches drawTermination
    // as a corr-1 base-tied onlap. The matched facing (ABOVE the base tie at elev 3) is R CLAY
    // [elev 3..7] — SAME formation as L CLAY → ruling 8m SKIPS the flank. Both surface first units
    // are SAND on SAND → their surface onlaps ALSO skip (matched facing first unit same), so x = 0
    // carries ZERO onlap flanks (a clean isolation of the suppression).
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
    // ZERO onlap flanks at L (x = 0): the same-litho CLAY base tie AND the same-litho SAND surface
    // onlap are BOTH followed → skipped (merge-equivalent).
    expect(oflankCountAtColumn(curves, 0)).toBe(0)

    // The final render: the CLAY fills the gap (flood) and the 8j merge welds it into ONE body
    // spanning the full width (the always-draw+merge result — merge-equivalence).
    const regions = withFlip(() => computeSectionFillV2(columns, edges, undefined, alongM))
    const clayRegs = regions.filter((r) => r.formationId === CLAY)
    expect(clayRegs.length).toBeGreaterThan(0)
    const clayBodies = new Set(clayRegs.map((r) => r.bodyId))
    expect(clayBodies.size).toBe(1) // one welded CLAY body (the emergent body)
    const fLo = Math.min(...clayRegs.flatMap((r) => r.polygon.map((p) => p.fraction)))
    const fHi = Math.max(...clayRegs.flatMap((r) => r.polygon.map((p) => p.fraction)))
    expect(fLo).toBeLessThan(0.02)
    expect(fHi).toBeGreaterThan(0.98)
  })

  it('(b) different-litho corr-1: the onlap flank IS drawn (no over-suppression)', () => {
    seq = 0
    // Identical stack shape to (a) but R's unit ABOVE the base tie is SILT, not CLAY. The matched
    // facing (above the base tie at elev 3) is now R SILT — DIFFERENT from L CLAY → ruling 8m DRAWS
    // the onlap. (Tie mixed base-top → not a band, so it reaches drawTermination.)
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
    // Tie L CLAY base (depth 7) to R CLAY top (depth 7): mixed base-top → not a band. The tie
    // endpoint sits on R CLAY, but the MATCHED facing (above the base tie at elev 3) is R SILT → DIFFERENT.
    const edges: CorrelationEdge[] = [{ a: lClay, b: rClay, aSide: 'base', bSide: 'top' }]
    const alongM = [0, 40]

    const section = buildSectionInput(columns, edges, undefined, alongM)
    const { curves } = withFlip(() => emitCurves(section))
    // The different-litho onlap draws its flank at L CLAY's free (top) contact (x = 0, elev 7).
    expect(oflankCountAtContact(curves, 0, 7)).toBe(1)
  })

  it('(c) mixed — same-litho tie one side, different the other → exactly one onlap flank on M', () => {
    seq = 0
    // Middle column M: SAND[0..3] over CLAY[3..7] (the base-tied unit). Looking LEFT into gap 0 its
    // base ties (mixed base-top) to L, whose matched facing ABOVE the tie is CLAY (SAME → skip).
    // Looking RIGHT into gap 1 its base ties (mixed base-top) to R, whose matched facing ABOVE the
    // tie is SILT (DIFFERENT → draw). So M's CLAY draws exactly ONE onlap flank (the right side) at
    // its free (top) contact (elev 7). All surface first units are SAND → surface onlaps skip.
    const lSand = layer()
    const lClay = layer()
    const lSilt = layer()
    const mSand = layer()
    const mClay = layer()
    const rSand = layer()
    const rSilt = layer()
    const rClay = layer()
    const columns: PartitionColumn[] = [
      // LEFT: SAND[0..3] over CLAY[3..7] over SILT[7..9] — matched facing ABOVE M's left base tie is CLAY.
      col('L', 10, [
        { top: 0, base: 3, f: SAND, layerId: lSand, body: 'sand-L' },
        { top: 3, base: 7, f: CLAY, layerId: lClay, body: 'clay-L' },
        { top: 7, base: 9, f: SILT, layerId: lSilt, body: 'silt-L' },
      ]),
      // MIDDLE: SAND[0..3] over CLAY[3..7]. Its base is tied on BOTH gaps.
      col('M', 10, [
        { top: 0, base: 3, f: SAND, layerId: mSand, body: 'sand-M' },
        { top: 3, base: 7, f: CLAY, layerId: mClay, body: 'clay-M' },
      ]),
      // RIGHT: SAND[0..3] over SILT[3..7] over CLAY[7..9] — matched facing ABOVE M's right base tie is SILT.
      col('R', 10, [
        { top: 0, base: 3, f: SAND, layerId: rSand, body: 'sand-R' },
        { top: 3, base: 7, f: SILT, layerId: rSilt, body: 'silt-R' },
        { top: 7, base: 9, f: CLAY, layerId: rClay, body: 'clay-R' },
      ]),
    ]
    const edges: CorrelationEdge[] = [
      // M CLAY base (depth 7) ↔ L SILT top (depth 7): mixed → not a band; matched facing above = L CLAY (SAME → skip).
      { a: mClay, b: lSilt, aSide: 'base', bSide: 'top' },
      // M CLAY base (depth 7) ↔ R CLAY top (depth 7): mixed → not a band; matched facing above = R SILT (DIFF → draw).
      { a: mClay, b: rClay, aSide: 'base', bSide: 'top' },
    ]
    const alongM = [0, 40, 80]

    const section = buildSectionInput(columns, edges, undefined, alongM)
    const { curves } = withFlip(() => emitCurves(section))
    // Exactly one onlap flank at M CLAY's free (top) contact (x = 40, elev 7): the different-litho
    // (right) side draws; the same-litho (left) side skips.
    expect(oflankCountAtContact(curves, 40, 7)).toBe(1)
  })
})
