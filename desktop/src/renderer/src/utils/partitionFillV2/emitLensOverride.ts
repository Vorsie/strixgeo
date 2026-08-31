/**
 * partitionFillV2/emitLensOverride.ts — the free-draw apex override for the SWEEP's corr-0
 * interior-lens tips (``drawTermination.emitLens``), the counterpart to ``emitLenses``'
 * enclosed-lens override and ``apexOverride``'s onlap-tip override.
 *
 * SESSION 75 (owner 2026-07-22, THIRD engine grant — "make every handle reshape"). S74 measured
 * that the SWEEP-drawn corr-0 lens tips (a single-lithology onlap the ``matchedFacingSameLitho``
 * suppression turns into a lens, plus every genuine corr-0 minority the sweep pinches) read NO
 * override → their grab handle was DEAD. This module gives them the SAME consumption the enclosed
 * lens already has: when the section carries an override for the tip's ``(bodyId, gapIndex)``, the
 * apex MOVES to the drawn (fraction, elevation); the flanks + flood wedge re-close around it so the
 * partition stays gap/overlap-free by construction.
 *
 * A lens apex takes BOTH the fraction (reach) AND the elevation — a lens is a free 2D shape (unlike
 * an onlap tip, whose elevation rides its tie). The fraction is CLAMPED to the strictly-interior
 * envelope (never ON/PAST the far column vertical → the closing flank can never be collinear with /
 * cross the far column, the "never overlap" legality bound); it passes UN-capped by the 8b reach
 * cap (design §8 line 795 — an overridden apex is the user's explicit reach).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type LensApexOverride } from '../sectionPartition'
import { terminationApexOverride } from './apexOverride'
import { type IntervalUnit } from './emitIntervalLenses'
import { type LensLabel } from './emitLenses'
import { type UnitGeom } from './sectionGeom'
import { segmentDegenerate } from './snap'
import { type InputCurve, type Point } from './types'

/** The resolved apex of an overridden sweep lens: the moved (x, elevation) + gap-local fraction. */
export interface SweepLensOverrideApex {
  apexX: number
  apexElev: number
  /** Fraction from the EMITTING column toward the facing column (drives the flood wedge apex). */
  fracFromCol: number
}

/**
 * Resolve the SWEEP corr-0 lens apex for a per-body free-draw override, or ``null`` when no override
 * applies (the caller keeps its 8b-capped default apex byte-identical).
 *
 * The override fraction is gap-local (0 = LEFT column, 1 = RIGHT column). The sweep's emitting
 * column may be either side of the gap; we convert to a fraction FROM the emitting column toward
 * the facing column so ``emitLens``'s ``colX + frac*(facingX-colX)`` places the apex correctly. A
 * left-column emit (``facingX > colX``) uses the fraction directly; a right-column emit mirrors it
 * (``1 − fraction``).
 *
 * Parameters
 * ----------
 * overrides : ReadonlyMap<string, LensApexOverride> | undefined
 *     The section's per-(body, gap) apex overrides (``section.lensApexOverrides``).
 * u : UnitGeom
 *     The terminating lens unit (its ``bodyId`` is the override key half).
 * gapIndex : number
 *     The gap the tip is emitted into (the override key half).
 * colX, facingX : number
 *     The emitting column x and the facing column x (metres — REAL alongM).
 */
export function sweepLensOverrideApex(
  overrides: ReadonlyMap<string, LensApexOverride> | undefined,
  u: UnitGeom,
  gapIndex: number,
  colX: number,
  facingX: number,
): SweepLensOverrideApex | null {
  const ov = terminationApexOverride(overrides, u.bodyId, gapIndex)
  if (!ov) return null
  // Gap-local fraction (0 = left column) → fraction FROM the emitting column. A left-column emit
  // faces right (facingX > colX): frac-from-col == gap-local fraction. A right-column emit faces
  // left (facingX < colX): frac-from-col == 1 − gap-local fraction (the mirror).
  const emitsFromLeft = facingX > colX
  const fracFromCol = emitsFromLeft ? ov.fraction : 1 - ov.fraction
  return { apexX: colX + fracFromCol * (facingX - colX), apexElev: ov.elevation, fracFromCol }
}

/**
 * Emit the two closing flanks (top→apex, apex→base) of an overridden sweep lens DIRECTLY at the
 * moved apex, bypassing ``emitLensClosing``'s 8b reach cap (an overridden apex is the user's
 * explicit reach — design §8 line 795). Registers each flank's label and returns ``true`` when
 * both flanks were emitted, ``false`` on a physical degenerate no-op (a sub-snap apex on the
 * column — the ``emitLensClosing`` no-op parity, so the enclosing flood covers the slot).
 *
 * Parameters
 * ----------
 * iu : IntervalUnit
 *     The terminating unit (its own top/base contacts are the flank corners on the column).
 * colX : number
 *     The emitting column x (the flank corner x).
 * apex : Point
 *     The moved apex (from ``sweepLensOverrideApex``).
 * label : LensLabel
 *     The unit's own litho label (each flank carries it, parity with the default lens).
 * nextId : () => string
 *     Curve-id allocator.
 * out : InputCurve[]
 *     Curve accumulator.
 * lensLabels : Map<string, LensLabel>
 *     Shared label map — each emitted flank registers ``label``.
 */
export function emitOverriddenLensClosing(
  iu: IntervalUnit,
  colX: number,
  apex: Point,
  label: LensLabel,
  nextId: () => string,
  out: InputCurve[],
  lensLabels: Map<string, LensLabel>,
): boolean {
  const topPt: Point = { x: colX, y: iu.topElev }
  const basePt: Point = { x: colX, y: iu.baseElev }
  // Degenerate guard (parity with ``emitLensClosing``): a sub-snap apex collapses a flank to a
  // single grid cell → emit NEITHER so no output curve is degenerate and the loop is never half-open.
  if (segmentDegenerate(topPt, apex) || segmentDegenerate(apex, basePt)) return false
  for (const points of [[topPt, apex], [apex, basePt]]) {
    const id = nextId()
    lensLabels.set(id, label)
    out.push({ id, kind: 'closing', points })
  }
  return true
}
