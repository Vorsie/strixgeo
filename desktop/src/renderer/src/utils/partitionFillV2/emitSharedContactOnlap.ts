/**
 * partitionFillV2/emitSharedContactOnlap.ts — the UNIFIED SHARED-CONTACT ONLAP
 * (owner ruling 8a, design partition-engine-v2.md §8, 2026-07-15, on the real S5A|S5 render).
 *
 * A minority whose top OR base contact rides a TIED shared contact — its own drawn tie, or a
 * DERIVED tie through the shared contact with a directly-adjacent tied band — is 1-corr and
 * must ONLAP that tie: a pinch tapering from the unit's own column contact to a tip at
 * ``INTERIOR_PINCH_FRACTION`` (0.5) ON the tie line it rides. The space BEYOND the tip is NOT
 * a vacancy needing its own fill rule: the ENCLOSING matrix on the UNTIED side closes around
 * the onlap notch by boundary composition (owner's own trace on S5A|S5: "sand tie from the
 * right test → up the clay onlap → silt top → back — a closed silt face with the onlap as a
 * notch"). This DISSOLVES the pre-8a "mixed-bracket-awaiting-ruling" and "converging = data
 * void" classes: a shared tied contact IS an anchor, so the same onlap emission applies whether
 * the facing bracket has real thickness OR converges to a point.
 *
 * Geometry (base-tied onlap — the S5A|S5 KLEI shape, the top-tied case is the mirror):
 *
 *   - the tied contact is the unit's BASE (it rides the tied band below); the pinch tapers from
 *     the unit's own [top..base] column span to a tip at 0.5 on the base bracket line;
 *   - the vacated wedge past the tip is flooded by the ABOVE matrix (the enclosing lithology on
 *     the UNTIED — top — side), which descends around the onlap. The tied band below keeps its
 *     own full-width band; it never rises above its tie line into the interval (that was the
 *     symptom of routing the below matrix into the base wedge — ZAND painting above its tie).
 *
 * The pinch's tied-side edge carries an ``onlap`` id so ``labelFaces`` classifies the pinch
 * face ONLAP (nTie 1 via the onlap marker + nClose from the other closing) while it keeps its
 * own column-vertical litho; the flood wedge (``flood`` id, ``units`` empty) reads BAND from
 * the enclosing-matrix label. Coverage stays complete (hole-free) and disjoint by construction.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { INTERIOR_PINCH_FRACTION } from '../sectionPartition'
import { type IntervalUnit } from './emitIntervalLenses'
import { type LonePinchBracket } from './emitLonePinch'
import { type LensLabel } from './emitLenses'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * Emit the shared-contact onlap for one lone-side unit (ruling 8a).
 *
 * The unit onlaps the tied contact (its ``base``-tied or ``top``-tied side); the ENCLOSING
 * matrix on the untied side floods the vacated wedge past the tip. Both flood wedges carry the
 * enclosing matrix (never the tied band's own lithology — that band keeps its full-width band).
 *
 * Parameters
 * ----------
 * u0 : IntervalUnit
 *     The lone-side onlapping unit (its ``topElev``/``baseElev`` = the interval-clamped span).
 * side : 'left' | 'right'
 *     The column the unit lives on (the pinch side).
 * loneX, facingX : number
 *     Along-section x of the pinch column and the facing column (metres).
 * top, base : LonePinchBracket
 *     The interval's enclosing bracket interfaces (the two tied bands the unit sits between).
 * baseTied : boolean
 *     ``true`` when the unit's BASE contact is the tied one (it rides the band below → the ABOVE
 *     matrix floods); ``false`` when the TOP contact is tied (the BELOW matrix floods).
 * enclosingMatrix : LensLabel
 *     The enclosing matrix on the UNTIED side — the lithology that closes around the onlap.
 * nextId : () => string
 *     ``close`` / ``onlap`` curve id allocator (the pinch triangle).
 * nextFloodId : () => string
 *     ``flood`` curve id allocator (the vacated-wedge boundary; ``labelFaces`` stamps it BAND).
 * labels : Map<string, LensLabel>
 *     Shared label map: flood-curve ids -> the enclosing matrix.
 * out : InputCurve[]
 *     Curve accumulator.
 */
export function emitSharedContactOnlap(
  u0: IntervalUnit,
  side: 'left' | 'right',
  loneX: number,
  facingX: number,
  top: LonePinchBracket,
  base: LonePinchBracket,
  baseTied: boolean,
  enclosingMatrix: LensLabel,
  nextId: () => string,
  nextFloodId: () => string,
  labels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  const loneTopElev = side === 'left' ? top.leftElev : top.rightElev
  const loneBaseElev = side === 'left' ? base.leftElev : base.rightElev
  const facingTopElev = side === 'left' ? top.rightElev : top.leftElev
  const facingBaseElev = side === 'left' ? base.rightElev : base.leftElev

  // conv — where the two bracket interfaces meet on the FACING column (a converging facing has
  // zero interval thickness there; v1 ``conv`` = the facing convergence point).
  const conv: Point = { x: facingX, y: (facingTopElev + facingBaseElev) / 2 }

  // The onlap tip rides the TIED bracket at 0.5. For a base-tied onlap the apex sits on the BASE
  // interface (rising toward the facing base contact); for a top-tied onlap on the TOP interface.
  const apexFrac = INTERIOR_PINCH_FRACTION
  const apexX = loneX + apexFrac * (facingX - loneX)
  const apexElev = baseTied
    ? loneBaseElev + apexFrac * (facingBaseElev - loneBaseElev)
    : loneTopElev + apexFrac * (facingTopElev - loneTopElev)
  const apex: Point = { x: apexX, y: apexElev }

  // (a) The onlap pinch: the unit's own [top..base] column span -> the shared apex. The TIED
  // side edge carries an ``onlap`` id (counted as a tie without a label by ``labelFaces``, so
  // the pinch reads ONLAP and keeps its own column litho); the untied side edge is a plain
  // ``close``. The unit's own column vertical closes the loop.
  const label: LensLabel = { formationId: u0.unit.formationId, bodyId: u0.unit.bodyId }
  const topPt: Point = { x: loneX, y: loneTopElev }
  const basePt: Point = { x: loneX, y: loneBaseElev }
  if (baseTied) {
    // Top edge = plain close (the untied top); base edge = onlap (rides the tied band).
    pushLabelled(nextId, label, labels, out, [topPt, apex])
    out.push({ id: `onlap${nextId()}`, kind: 'closing', points: [apex, basePt] })
  } else {
    // Top edge = onlap (rides the tied band above); base edge = plain close.
    out.push({ id: `onlap${nextId()}`, kind: 'closing', points: [topPt, apex] })
    pushLabelled(nextId, label, labels, out, [apex, basePt])
  }

  // (b) The flood wedge closing the vacated interval past the tip. Both sub-triangles carry the
  // ENCLOSING matrix (the untied-side lithology) — it closes AROUND the onlap notch. The tied
  // band keeps its own full-width band and never rises/descends into the interval. The wedge is
  // the interval quad (topCorner, baseCorner, conv) minus the pinch triangle: two triangles
  // (topCorner->conv->apex and baseCorner->conv->apex) sharing the conv->apex edge.
  const floodLabelled = (points: Point[]): void => pushLabelled(nextFloodId, enclosingMatrix, labels, out, points)
  const emitWedge = (corner: Point): void => {
    // Skip a degenerate wedge (corner coincides with conv — zero facing thickness on that side).
    if (Math.abs(corner.y - conv.y) < ELEV_EPS && Math.abs(corner.x - conv.x) < ELEV_EPS) return
    floodLabelled([corner, conv])
    floodLabelled([conv, apex])
  }
  emitWedge(topPt)
  emitWedge(basePt)
}

/** Push one closing curve and record its litho label under the allocated id. */
function pushLabelled(
  nextId: () => string,
  label: LensLabel,
  labels: Map<string, LensLabel>,
  out: InputCurve[],
  points: Point[],
): void {
  const id = nextId()
  labels.set(id, label)
  out.push({ id, kind: 'closing', points })
}
