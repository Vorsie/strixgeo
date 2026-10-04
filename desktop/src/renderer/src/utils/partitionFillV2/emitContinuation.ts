/**
 * partitionFillV2/emitContinuation.ts — A COLUMN THAT READ NOTHING IS NOT A BOUNDARY.
 *
 * OWNER, 2026-08-21, on S7's thin interbeds drawn as phantom pinches around the short
 * S7A: *"it should be a continuous band starting from S7 but now it is interrupted at
 * S7A's column by a SF clay render."* Then, on the flat-ended curtain that first answer
 * shipped: *"you made them crossing but now it is inconsistent with the litho and some
 * don't terminate in a pinch"* / *"how do we get open terminations for lenses"*.
 *
 * THE LAW. A termination — a lens apex, a pinch — is a statement about where this unit
 * meets what a FACING TEST read. A column with no litho unit at any of the unit's own
 * levels (the ground over there is below its TD, or above the first thing it logged)
 * read nothing, so it states nothing, so it is NOT a boundary: the unit passes straight
 * through it and terminates in its ORDINARY pinch against the first column that DID read
 * that ground — one gap away, or several. Only where no column in that direction ever
 * read it does the unit run to the section edge, and only there is it closed flat.
 *
 * This is the litho arm's half of the law the geotech constructive arm already carries
 * (``geotechHierarchicalFill/constructive/`` bridges bandless columns and lends the
 * neighbour's bands across, so its construct already pinches against the first reading
 * column). The two arms must read a short log the same way or the geotech frame — which can
 * never exceed the litho cover — keeps painting a shape the litho engine invented. Measured
 * agreement on CS1: S7's KLEI +6.65..+6.03 closes at fraction 0.559 of gap 16 —
 * ``LENS_PINCH_FRACTION`` of the S7→B2 line — on BOTH arms, vertex for vertex.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type LensLabel } from './emitLenses'
import { type ColumnGeom, type UnitGeom } from './sectionGeom'
import { segmentDegenerate } from './snap'
import { type InputCurve, type Point } from './types'

/** Vertical overlap (metres) below which a facing unit is a contact touch, not a reading. */
const OVERLAP_EPS = 1e-6

/** The column a termination measures against, and the gaps its geometry spans. */
export interface TerminationRun {
  /** The first column in this direction that READ the unit's levels, or — when none did — the
   *  ADJACENT column when the unit lies below its TD (the shallow test the unit lenses toward), else
   *  the outermost column in that direction (the section edge the unit runs to). */
  column: ColumnGeom
  /** ``true`` when ``column`` actually read the ground: an ordinary pinch measures against it,
   *  crossing the blind columns on the way. ``false`` = nothing in this direction ever read it. */
  reads: boolean
  /** ``true`` only when nothing read the unit AND it does not lie below the adjacent column's TD
   *  (a unit resting exactly on that column's ground): the one case still run flat to the section
   *  edge (``emitContinuation``). A sub-TD unit no column reads lenses instead (owner 2026-10-04). */
  toEdge: boolean
  /** The gap-index half-open range ``[gapLo, gapHi)`` the run crosses. */
  gapLo: number
  gapHi: number
}

/**
 * Resolve the column a unit's termination measures against, crossing blind columns.
 *
 * ``columns`` left to right; ``nearIndex`` the terminating unit's own column; ``dir`` the look
 * direction (+1 = right); ``topElev``/``baseElev`` its elevation window (order-insensitive).
 */
export function terminationRun(
  columns: readonly ColumnGeom[],
  nearIndex: number,
  dir: 1 | -1,
  topElev: number,
  baseElev: number,
): TerminationRun {
  const hi = Math.max(topElev, baseElev)
  const lo = Math.min(topElev, baseElev)
  const span = (index: number, reads: boolean, toEdge = false): TerminationRun => ({
    column: columns[index],
    reads,
    toEdge,
    gapLo: Math.min(nearIndex, index),
    gapHi: Math.max(nearIndex, index),
  })
  let last = nearIndex
  for (let i = nearIndex + dir; i >= 0 && i < columns.length; i += dir) {
    last = i
    // OWNER RULING 2026-09-07 (Cross-section 2): a facing column whose GROUND is BELOW this unit —
    // the unit sits entirely ABOVE the first thing that column logged, i.e. above its collar, where
    // there is only sky — is a BOUNDARY, not a blind column to pass through. The unit pinches its
    // ordinary lens TOWARD that column and the space beyond stays EMPTY (no facing matrix to flood).
    // This SPLITS the 2026-08-21 "a column that read nothing is not a boundary" law, which folded two
    // cases together ("the ground over there is below its TD, OR above the first thing it logged"):
    // the "below its TD" case (the column may carry the unit deeper) STILL crosses to the first
    // reading column; the "above the first thing it logged" case now terminates here. Owner: *"the
    // sand above the clay has no ties, it is a lens, the space above the tie stays empty."*
    const groundTop = columns[i].units.length > 0 ? columns[i].units[0].topElev : -Infinity
    if (groundTop < lo - OVERLAP_EPS) return span(i, true)
    for (const fu of columns[i].units) {
      if (Math.min(fu.topElev, hi) - Math.max(fu.baseElev, lo) > OVERLAP_EPS) return span(i, true)
    }
  }
  // Nothing in this direction ever read the ground. When the unit lies below the ADJACENT column's
  // TD - ground no test that way drilled - NO TIE, NO BAND (owner 2026-10-04, section "test": *"as
  // long as the bottom of S11 is not correlated to 19/100-S3 the loop isn't closed and there is
  // nothing to draw"*): the 2026-08-21 flat run to the section edge was a band made from levels,
  // under shallow tests no tie reaches. The unit lenses at its own level toward the adjacent column
  // and the rest under those TDs is the no-data void. Only a unit that merely rests on the adjacent
  // column's ground (no overlap, not below its TD) still runs flat to the edge (``last`` stays
  // ``nearIndex`` only when there is no column that way at all - the caller's ordinary path absorbs
  // that degenerate case).
  const adjacent = nearIndex + dir
  if (adjacent >= 0 && adjacent < columns.length && columns[adjacent].units.length > 0) {
    const adjacentTd = Math.min(...columns[adjacent].units.map((u) => u.baseElev))
    if (hi <= adjacentTd + OVERLAP_EPS) return span(adjacent, false)
  }
  return span(last, false, true)
}

/** The ties whose gaps the run crosses — the reach shorteners a relocated diamond can meet. */
export function runGapTies<T extends { gapIndex: number }>(
  ties: readonly T[],
  run: TerminationRun,
): T[] {
  return ties.filter((t) => t.gapIndex >= run.gapLo && t.gapIndex < run.gapHi)
}

/**
 * Run a unit flat at full thickness from its own column to ``edgeX`` (a closed rectangle).
 *
 * Emits the top contact, a CURTAIN on the far column, and the base contact: with the unit's
 * own column-vertical that is a closed rectangle — a vertical on a column line where that column
 * has no footprint edge of its own to close against. Callers: a unit ``terminationRun`` sends to
 * the section edge (``toEdge`` — one resting on the adjacent column's ground, never one below its
 * TD: owner 2026-10-04, "no tie, no band"), and the gap-local straddle sliver of
 * ``emitSubTdLenses``.
 *
 * ``colX``/``edgeX`` are the unit's own column and the edge column in along-metres; ``nextId``
 * is the calling emitter's id allocator so ids stay in that emitter's space. Returns ``false``
 * on a physically degenerate window or run (sub-snap thin / sub-snap narrow), leaving the
 * caller's ordinary — itself degenerate-guarded — termination to no-op as before.
 */
export function emitContinuation(
  u: UnitGeom,
  colX: number,
  edgeX: number,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  out: InputCurve[],
): boolean {
  const nearTop: Point = { x: colX, y: u.topElev }
  const nearBase: Point = { x: colX, y: u.baseElev }
  const farTop: Point = { x: edgeX, y: u.topElev }
  const farBase: Point = { x: edgeX, y: u.baseElev }
  // Physical floor only (never a policy width): below the 1 mm snap grid a side collapses
  // and the rectangle cannot bound a face. Both the carried contacts and the curtain must
  // survive, or none of them is emitted — a half-open loop is worse than the pinch.
  if (segmentDegenerate(nearTop, farTop) || segmentDegenerate(farTop, farBase)) return false
  const push = (points: Point[], named: boolean): void => {
    const id = nextId()
    // ONLY THE CURTAIN NAMES THE UNIT. The two carried contacts are SHARED with whatever
    // lies above and below — a stack of continued interbeds meets along them — so naming
    // one of them would hand the neighbour's face this unit's litho (measured on CS1
    // gap 17: the KLEI interbed read SILT off the silt above it). A contact belongs to
    // both its units, exactly as the band contours (``bandc``) carry no label either; the
    // curtain is the unit's own far edge and is its alone.
    if (named) {
      lensLabels.set(id, { formationId: u.formationId, bodyId: u.bodyId, layerId: u.layerId })
    }
    out.push({ id, kind: 'closing', points })
  }
  push([nearTop, farTop], false)
  push([farTop, farBase], true)
  push([farBase, nearBase], false)
  return true
}
