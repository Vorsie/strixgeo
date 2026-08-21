/**
 * partitionFillV2/emitContinuation.ts — A CLOSURE EXISTS TO MEET THE FACING TEST.
 *
 * OWNER, 2026-08-21, on S7's thin interbeds drawn as phantom pinches around the short
 * S7A: *"it should be a continuous band starting from S7 but now it is interrupted at
 * S7A's column by a SF clay render."*
 *
 * THE LAW. A termination — a lens apex, a pinch — is a statement about where this unit
 * meets what the FACING test read. Where the facing column has no litho unit at any of
 * the unit's own levels (the ground over there is below that column's TD, or above the
 * first thing it logged), there is nothing to meet: the unit continues to that column at
 * FULL THICKNESS instead of pinching. It closes per the ordinary 0/1/2 rules in the first
 * gap whose facing column DOES read that ground.
 *
 * This is the litho arm's half of the same law the geotech constructive arm already
 * carries (``geotechHierarchicalFill/constructive/constructs.ts`` → ``extendsToFar``);
 * the two arms must read a short log the same way or the geotech frame — which can never
 * exceed the litho cover — keeps painting a pinch the litho engine invented.
 *
 * THE SHAPE. Three closing curves per continued unit: its own top contact carried across
 * to the facing column, a CURTAIN down that column between the unit's two levels, and its
 * base contact carried back. With the unit's own column-vertical that is a closed
 * rectangle — the unit owns its window right up to the facing column, exactly as
 * ``extendsToFar`` gives a geotech construct its whole gap. The curtain idiom is the
 * substrate's (``emitBottomTieSubstrate``'s ``btcurtain``): a vertical on a column line
 * where that column has no footprint edge of its own to close against.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type LensLabel } from './emitLenses'
import { type ColumnGeom, type UnitGeom } from './sectionGeom'
import { segmentDegenerate } from './snap'
import { type InputCurve, type Point } from './types'

/** Vertical overlap (metres) below which a facing unit is a contact touch, not a reading. */
const OVERLAP_EPS = 1e-6

/**
 * Did the facing test read NOTHING at this unit's levels?
 *
 * The same predicate the geotech arm asks of the facing column's stack: no band of the
 * facing column overlaps the window at all. Because a litho column is gap-free from its
 * first logged contact to its TD, this is true exactly when the window sits entirely
 * below that column's TD or entirely above its first litho top — the two ways a test can
 * have no opinion about a depth.
 *
 * Parameters
 * ----------
 * facing : ColumnGeom
 *     The column the termination would pinch toward.
 * topElev, baseElev : number
 *     The unit's own elevation window (mTAW); order-insensitive.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when no facing unit overlaps the window — nothing to meet.
 */
export function facingReadsNothing(facing: ColumnGeom, topElev: number, baseElev: number): boolean {
  const hi = Math.max(topElev, baseElev)
  const lo = Math.min(topElev, baseElev)
  for (const fu of facing.units) {
    if (Math.min(fu.topElev, hi) - Math.max(fu.baseElev, lo) > OVERLAP_EPS) return false
  }
  return true
}

/**
 * Carry a unit across to the facing column at full thickness, in place of its termination.
 *
 * Emits the top contact, the curtain on the facing column, and the base contact — one
 * closed rectangle with the unit's own column-vertical. Every curve is labelled with the
 * unit's OWN litho so the traced face reads the unit, not the matrix flooding around it.
 *
 * Parameters
 * ----------
 * u : UnitGeom
 *     The continuing unit (its own two contacts are the rectangle's levels).
 * colX, facingX : number
 *     Along-section metres of the unit's own column and of the facing column.
 * lensLabels : Map<string, LensLabel>
 *     Shared label map the face labelling reads.
 * nextId : () => string
 *     Curve-id allocator of the calling emitter (so ids stay in that emitter's space).
 * out : InputCurve[]
 *     Curve accumulator.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the continuation was emitted; ``false`` on a physically degenerate
 *     window or gap (a sub-snap-thin unit / a sub-snap-narrow gap), where the caller's
 *     ordinary termination — itself degenerate-guarded — is left to no-op as before.
 */
export function emitContinuation(
  u: UnitGeom,
  colX: number,
  facingX: number,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  out: InputCurve[],
): boolean {
  const nearTop: Point = { x: colX, y: u.topElev }
  const nearBase: Point = { x: colX, y: u.baseElev }
  const farTop: Point = { x: facingX, y: u.topElev }
  const farBase: Point = { x: facingX, y: u.baseElev }
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
