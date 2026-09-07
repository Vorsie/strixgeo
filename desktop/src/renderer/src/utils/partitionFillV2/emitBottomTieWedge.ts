/**
 * partitionFillV2/emitBottomTieWedge.ts — the sub-TD wedge below a BOTTOM TIE (owner ruling R3/R4,
 * 2026-09-07).
 *
 * THE CASE. A deep test's TOP contact is tied to the FACING (shallow) column's DEEPEST contact — its
 * TD (a mixed base↔top tie, which the base↔base ``emitBottomTieSubstrate`` never sees). The tied unit
 * above ONLAPS all the way to that bottom-tie point on the shallow column (``drawTermination``
 * ``bottomTieToTd`` — apex at the facing column), so its base flank is the line
 * ``(col, tiedUnitBase) → (facingX, facingTD)``. The sub-TD wedge BELOW that flank is a triangle that
 * narrows to the shallow-TD apex, and the untied units in it must pinch (LENS) toward that apex, not
 * flood the gap full-width (the old ``emitContinuation`` defect) nor leave a construction hole between
 * the rising onlap flank and a symmetric-diamond lens (the ``emitCorr0Termination`` gap).
 *
 * THE CONSTRUCTION. Every corr-0 sub-TD unit below the bottom tie is a triangle whose apex is the
 * SHARED point on the onlap's base-flank line at ``LENS_PINCH_FRACTION`` — so the shallowest unit's TOP
 * flank rides the onlap base flank exactly (no gap under the onlap), adjacent units share a flank
 * (a hole-free tiling of the wedge), and the deepest unit pinches SHORT of the apex column (a visible
 * lens, never a full-width flood). The space past the pinch is the §8-Q3 no-data void (owner: "the
 * untied clay lens legitimately leaves the no-data void below its own pinch").
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type LensLabel } from './emitLenses'
import { segmentDegenerate } from './snap'
import { type UnitGeom } from './sectionGeom'
import { type InputCurve, type Point } from './types'
import { LENS_PINCH_FRACTION } from '../sectionPartition'

/**
 * Emit the corr-0 sub-TD wedge below a bottom tie. Each unit becomes a triangle converging to the
 * SHARED apex on the onlap base-flank line at ``LENS_PINCH_FRACTION``; the unit's own column vertical
 * closes the loop. Returns the number of units drawn.
 *
 * Parameters
 * ----------
 * units : readonly UnitGeom[]
 *     The corr-0 units entirely below the facing TD, shallowest first (their tops descend). All must
 *     lie below the bottom-tie contact (the caller passes only those).
 * colX : number
 *     The near (deep) column's along-metres x.
 * facingX : number
 *     The facing (shallow) column's along-metres x — the apex direction.
 * facingTD : number
 *     The facing column's TD elevation — the bottom-tie point the onlap above reached.
 * lensLabels : Map<string, LensLabel>
 *     Shared label map — each triangle's flanks carry the unit's own litho.
 * nextId : () => string
 *     Curve-id allocator (the caller's sub-TD id space).
 * out : InputCurve[]
 *     Curve accumulator.
 */
export function emitBottomTieWedge(
  units: readonly UnitGeom[],
  colX: number,
  facingX: number,
  facingTD: number,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  out: InputCurve[],
): number {
  if (units.length === 0) return 0
  // The onlap base-flank line runs from the shallowest sub-TD unit's TOP (= the tied unit's base) to
  // the bottom-tie point on the facing column. The SHARED apex is that line sampled at the pinch
  // fraction, so every wedge unit's TOP flank rides the onlap base flank (or the unit-above's base
  // flank) — a hole-free tiling that pinches short of the apex column.
  const firstTop = Math.max(...units.map((u) => u.topElev))
  const apexX = colX + LENS_PINCH_FRACTION * (facingX - colX)
  const apexElev = firstTop + LENS_PINCH_FRACTION * (facingTD - firstTop)
  const apex: Point = { x: apexX, y: apexElev }
  let drawn = 0
  for (const u of units) {
    const topPt: Point = { x: colX, y: u.topElev }
    const basePt: Point = { x: colX, y: u.baseElev }
    // Physical floor only: a wedge unit whose either flank collapses to a snap cell cannot bound a
    // face — draw neither flank (the enclosing substrate/void covers the slot), never a half-open loop.
    if (segmentDegenerate(topPt, apex) || segmentDegenerate(apex, basePt)) continue
    const label: LensLabel = { formationId: u.formationId, bodyId: u.bodyId }
    // The flanks carry an ``oflank`` prefix so ``channelMatrix.isEnclosingFloodFace`` treats this face
    // as the unit's OWN closed loop (immune, line 116): the wedge apex rides INTO the tied unit's
    // elevation band, so the CHANNEL-MATRIX vacancy rule would otherwise sample the window top inside
    // the tied unit and repaint the wedge as the tied litho (measured: the KLEI wedge relabelled ZAND).
    const topId = `oflank${nextId()}`
    lensLabels.set(topId, label)
    out.push({ id: topId, kind: 'closing', points: [topPt, apex] })
    const baseId = `oflank${nextId()}`
    lensLabels.set(baseId, label)
    out.push({ id: baseId, kind: 'closing', points: [apex, basePt] })
    drawn++
  }
  return drawn
}
