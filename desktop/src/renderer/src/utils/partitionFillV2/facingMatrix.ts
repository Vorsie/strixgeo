/**
 * partitionFillV2/facingMatrix.ts — facing-column matrix lookups shared by the
 * lone-side pinch / onlap / stack routers (design partition-engine-v2.md §4).
 *
 * Extracted from ``emitLonePinch.ts`` (debt #201 — kept it under the 500-line budget)
 * and consolidated with the byte-identical copy that lived in ``emitLoneStack.ts``:
 * both answered "what lithology laterally encloses the pinching unit on the facing
 * side" and "does the facing column carry one continuous matrix across a span". One
 * source of truth now.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type LensLabel } from './emitLenses'
import { type ColumnGeom } from './sectionGeom'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * The facing column's matrix label at elevation ``e`` — the lithology that laterally
 * encloses the pinching unit on the facing side. Picks the facing unit whose elevation
 * span contains ``e``; falls back to the nearest unit (an ``e`` at/above the surface or
 * below TD). Returns ``null`` only when the facing column is empty (never, given a valid
 * section).
 *
 * Parameters
 * ----------
 * facing : ColumnGeom
 *     The facing column.
 * e : number
 *     Elevation (mTAW) to sample.
 *
 * Returns
 * -------
 * LensLabel | null
 *     The enclosing facing formation + body, or ``null`` for an empty column.
 */
export function facingMatrixLabel(facing: ColumnGeom, e: number): LensLabel | null {
  let best: ColumnGeom['units'][number] | null = null
  let bestDist = Infinity
  for (const u of facing.units) {
    if (u.topElev >= e - ELEV_EPS && e >= u.baseElev - ELEV_EPS) {
      return { formationId: u.formationId, bodyId: u.bodyId }
    }
    const dist = e > u.topElev ? e - u.topElev : u.baseElev - e
    if (dist < bestDist) {
      bestDist = dist
      best = u
    }
  }
  return best ? { formationId: best.formationId, bodyId: best.bodyId } : null
}

/**
 * Whether the facing column carries formation ``fid`` CONTINUOUSLY across the elevation
 * span [``base``..``top``] — i.e. every point of that span on the facing column is that
 * one formation (a single continuous matrix laterally enclosing the lone unit). This is
 * the guard that keeps the lone-pinch to the clean lateral-lens case whose flood wedges
 * tile gaplessly (v1 ``facingCarriesMatrix``, strengthened to require FULL coverage).
 *
 * Parameters
 * ----------
 * facing : ColumnGeom
 *     The facing column.
 * fid : string
 *     The formation id that must cover the span.
 * top, base : number
 *     The elevation span [base..top] (mTAW) to check.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the facing column is one continuous ``fid`` run over the span.
 */
export function facingCoversSpan(facing: ColumnGeom, fid: string, top: number, base: number): boolean {
  // Walk the facing units overlapping [base..top]; the run must be all ``fid`` and cover
  // the whole span with no gap (the normalised stack is gap-free, so contiguous ``fid``
  // units spanning the range suffice).
  let covered = base // highest elevation covered so far, working up from the base
  const overlapping = facing.units
    .filter((u) => u.topElev > base - ELEV_EPS && top > u.baseElev - ELEV_EPS)
    .sort((a, b) => a.baseElev - b.baseElev)
  for (const u of overlapping) {
    if (u.formationId !== fid) return false
    if (u.baseElev > covered + ELEV_EPS) return false // gap below this unit
    if (u.topElev > covered) covered = u.topElev
  }
  return covered >= top - ELEV_EPS
}
