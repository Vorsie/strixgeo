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
import { UNBOUNDED_WINDOW, unitReachesWindow, type TieWindow } from './tieWindow'

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
export function facingMatrixLabel(
  facing: ColumnGeom,
  e: number,
  window: TieWindow = UNBOUNDED_WINDOW,
): LensLabel | null {
  let best: ColumnGeom['units'][number] | null = null
  let bestDist = Infinity
  for (const u of facing.units) {
    // A CLASS-LABEL SAMPLE MAY NEVER CROSS A CORRELATION. The nearest-unit fallback is right for a
    // sample that merely overshoots a collar or a TD by a few centimetres — but only among units
    // that are actually PRESENT in the tie-bounded window the sample belongs to. A column whose
    // stack ENDS on the bounding tie has nothing in the channel beyond it, and reaching for it
    // anyway is how a clay came to name a sand channel under its own base tie. Callers that know
    // no window pass none and keep the original behaviour byte-for-byte.
    if (!unitReachesWindow(u, window)) continue
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
 * The ENCLOSING matrix of a lone-stack interval, taken from the LONE column's OWN bracket
 * adjacency (v1's ``belowLith ?? aboveLith``) rather than a facing-column sample.
 *
 * ``routeLoneStack`` used ``facingMatrixLabel(facing, convElev)`` to name the enclosing
 * matrix, but ``convElev`` is the facing convergence elevation — at a ZERO-THICKNESS facing
 * bracket (the interval sits on a CONTACT of the facing column, both bracket lines meeting
 * at one point) that sample lands on the contact and returns whichever facing unit the loop
 * hits FIRST (the unit above the contact), NOT the lithology that actually encloses the lone
 * stack. Tie-6 gap0 is the canonical case: the lone left stack ``[KLEI, SILT]`` sits below a
 * ZAND top-tie and above a KLEI base-band, and the facing right column has ZAND base = KLEI
 * top at −3.88 (zero-thickness); ``facingMatrixLabel(−3.88)`` returns ZAND, so the stack
 * cannot reduce (ZAND is not in it) → bail → SILT floods full-width (a ruling-8 violation).
 *
 * The enclosing lithology is instead read from the lone column itself: the unit immediately
 * BELOW the interval (its top ≈ the interval base) gives ``belowLith``; the unit immediately
 * ABOVE (its base ≈ the interval top) gives ``aboveLith``; prefer ``belowLith`` (v1). To be a
 * usable matrix the picked formation must ALSO appear in the stack (so ``extractLoneStackLenses``
 * can reduce the stack around it) — a below-lith the stack does not contain (Tie-6: below =
 * KLEI, which the stack DOES contain) is preferred, then above-lith; the first that is present
 * in ``stackFids`` wins. When neither adjacency formation is in the stack, returns ``null`` and
 * the caller keeps its fallback (the interval is not an enclosed lone stack).
 *
 * Parameters
 * ----------
 * loneCol : ColumnGeom
 *     The lone column carrying the stack.
 * stackFids : ReadonlySet<string>
 *     The formations present in the lone stack (the reduction target must be one of them).
 * top, base : number
 *     The interval's top / base elevations on the lone column (mTAW).
 *
 * Returns
 * -------
 * LensLabel | null
 *     The enclosing matrix (formation + body) from the lone column's bracket adjacency, or
 *     ``null`` when neither adjacent lithology is a stack formation.
 */
export function enclosingMatrixOfInterval(
  loneCol: ColumnGeom,
  stackFids: ReadonlySet<string>,
  top: number,
  base: number,
): LensLabel | null {
  // Unit immediately BELOW the interval: its TOP contact is at (or just above) the interval
  // base. Unit immediately ABOVE: its BASE contact is at (or just below) the interval top.
  let belowU: ColumnGeom['units'][number] | null = null
  let aboveU: ColumnGeom['units'][number] | null = null
  for (const u of loneCol.units) {
    if (Math.abs(u.topElev - base) <= ELEV_EPS + 1e-3) belowU = u
    if (Math.abs(u.baseElev - top) <= ELEV_EPS + 1e-3) aboveU = u
  }
  // Prefer belowLith when it is a stack formation (v1 ``belowLith ?? aboveLith``), then
  // aboveLith. A pick outside the stack cannot enclose it (the reduction would strip
  // everything), so it is skipped.
  for (const u of [belowU, aboveU]) {
    if (u && stackFids.has(u.formationId)) return { formationId: u.formationId, bodyId: u.bodyId }
  }
  return null
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
