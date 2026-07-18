/**
 * partitionFillV2/emitFloodWedge.ts — the FLOOD-CLOSURE wedge that fills the vacated space
 * PAST a termination apex (the ``emitLonePinch`` ``floodFrom`` device — design
 * partition-engine-v2.md §4 finding A), with the SESSION-16 sloping-bracket ride (Front 2).
 *
 * A terminating unit lives on ``col`` and pinches to ``apex``; the space between the apex and
 * the FACING column is claimed by the facing column's ENCLOSING formation. The wedge is two
 * triangles ``topCorner → conv → apex`` and ``baseCorner → conv → apex`` where ``conv`` is the
 * convergence point on the FACING column. These triangles touch ``col`` only at the corner
 * VERTICES (never along a column-vertical EDGE), so their traced faces carry no column vertical
 * → ``labelFaces`` stamps them from the ``flood`` label as a BAND (the ``units.length===0``
 * trick). The flood label is the facing enclosing formation at the unit's mid-elevation (owner
 * 8f — "fill the void with the dominant lithology between correlations").
 *
 * SESSION-16 SLOPING RIDE (Front 2 — CS2 g17, the 20 remaining holes). When the facing
 * enclosing formation's bounding contour SLOPES across the wedge (band base −4.19 → −5.25 over
 * the gap), a straight ``corner → conv`` leg exits the enclosure and leaves a triangular hole
 * between the flat wedge and the dipping band base. The wedge's outer leg now RIDES the
 * enclosing formation's actual bounding contour: the corner→conv leg is replaced by a polyline
 * sampled along the facing enclosing unit's top (for the base-side wedge) / base (for the
 * top-side wedge) contour between the terminating column and the convergence point, so the
 * wedge is bounded by the real sloping line art. When the contour is FLAT (the common case) the
 * polyline collapses to the straight leg — byte-identical to the pre-session-16 wedge (parity).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { facingMatrixLabel } from './facingMatrix'
import { type LensLabel } from './emitLenses'
import { type ColumnGeom } from './sectionGeom'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres — a contour steeper than this across the wedge triggers the ride. */
const SLOPE_EPS = 1e-3

/**
 * FRONT-2 SLOPING-RIDE KILL-SWITCH (session 16). The multi-segment sloping ride
 * (``ridePolyline`` inserting a contour vertex) was BUILT + MEASURED NEGATIVE: inserting a
 * mid-vertex into the ``corner → conv → apex`` flank produces a non-simple wedge that
 * self-crosses / kinks at the shared conv→apex edge, exploding the OFF/ON battery to 509
 * above-TD holes (measured, session 16). The CS2 g17 20-hole wall is NOT a flood-wedge defect
 * but the ``emitEnclosingFlood`` INTERVAL-BRACKET geometry: the enclosing ZAND band base SLOPES
 * (−4.19 → −5.25) and the straight bracket carrier / midpoint seam leaves a triangular gap to
 * the SILT band below. Riding it correctly restructures the interval closure (high regression
 * risk — two point attempts measured +489 / +197 holes), so per ruling 7 (no partial fixes /
 * no new leaks) the ride stays GATED OFF: the plain straight wedge (parity) ships, the 20 CS2
 * g17 holes stay the documented wall. Flip to ``false`` + fix ``ridePolyline``'s simplicity to
 * revive. See REWRITE_STATE.md §19.
 */
const SLOPING_RIDE_ENABLED = false

/**
 * Emit the flood-closure wedge for one termination.
 *
 * Parameters
 * ----------
 * colX, facingX : number
 *     The terminating column's x and the facing column's x (metres — REAL alongM).
 * facing : ColumnGeom
 *     The facing column (its enclosing formation labels the wedge + its bounding contour is the
 *     sloping bracket the outer leg rides).
 * topElev, baseElev : number
 *     The terminating unit's own top / base elevation (the wedge corners).
 * apexX, apexElev : number
 *     The termination apex (shared with the lens/onlap closing).
 * skipSide : 'top' | 'base' | null
 *     For a 1-corr ONLAP the TIED side is closed by its own tie/band — the enclosing floods only
 *     the UNTIED side, so the tied-side wedge is skipped. A 0-corr LENS passes ``null`` (both
 *     sides enclosing → both wedges).
 * nextFloodId : () => string
 *     ``flood``-curve id allocator.
 * labels : Map<string, LensLabel>
 *     Shared label map — the wedge curves carry the facing enclosing formation.
 * out : InputCurve[]
 *     Curve accumulator.
 * convToFacingX : number | undefined
 *     ONLAP flag (set to the facing x): the single untied wedge converges at the apex ELEVATION
 *     out to the facing column (no mid-elevation dogleg). LENS leaves it undefined (conv at the
 *     gap midpoint so two opposing wedges meet at 0.5).
 */
export function emitFloodWedge(
  colX: number,
  facingX: number,
  facing: ColumnGeom,
  topElev: number,
  baseElev: number,
  apexX: number,
  apexElev: number,
  skipSide: 'top' | 'base' | null,
  nextFloodId: () => string,
  labels: Map<string, LensLabel>,
  out: InputCurve[],
  convToFacingX?: number,
): void {
  const midElev = (topElev + baseElev) / 2
  // RULING 8n (owner, 2026-07-18 — "stay inside the lines"): the flood wedge past a termination
  // apex is the facing unit being ONLAPPED INTO (rule 3). For a LENS both sides flood, so the
  // enclosing matrix is sampled at the unit's OWN mid-elevation (``skipSide === null``). For an
  // ONLAP the flood fills ONLY the UNTIED side (``skipSide`` names the TIED/closed side), and that
  // side laps up/down onto the FACING unit above/below the tie — sampling the mid-elevation there
  // reads the WRONG facing unit (the mid lands in the matrix on the TIED side of the facing tie).
  // CS1 gap1 x=96.96: the base-tied ZAND onlap (mid 4.9) floods its TOP; mid-4.9 sampled col2 as
  // KLEI [3.67..5.023] (below the tie) → the wedge past the apex mislabelled KLEI, KLEI crossing
  // its own band-top/tie line (rule-4 violation). Sampling the FLOODED (untied) contact — the TOP
  // (5.39) for a base-tied onlap — lands in col2 SILT [5.023..6.278], the unit the ZAND onlaps
  // into. ``skipSide === 'base'`` → flood TOP → sample topElev; ``'top'`` → flood BASE → sample
  // baseElev; ``null`` (lens) → mid. LABEL ONLY — the wedge GEOMETRY (``convY``, the corners) is
  // unchanged. See REWRITE_STATE §35.
  const labelElev = skipSide === 'base' ? topElev : skipSide === 'top' ? baseElev : midElev
  const label = facingMatrixLabel(facing, labelElev)
  if (label === null) return
  const convX = (colX + facingX) / 2
  // For a SKIPPED-SIDE ONLAP wedge the conv sits at the apex ELEVATION so the wedge flank closes
  // DIRECTLY to the apex (topCorner→apex) with no mid-elevation dogleg. At apex elevation the
  // conv→apex edge is degenerate (skipped), so the wedge is one clean triangle.
  const convY = convToFacingX !== undefined ? apexElev : midElev
  const conv: Point = { x: convX, y: convY }
  const apex: Point = { x: apexX, y: apexElev }
  const topCorner: Point = { x: colX, y: topElev }
  const baseCorner: Point = { x: colX, y: baseElev }
  const push = (points: Point[]): void => {
    const id = nextFloodId()
    labels.set(id, label)
    out.push({ id, kind: 'closing', points })
  }
  const deg = (a: Point, b: Point): boolean => segmentDeg(a, b)
  // The shared conv→apex edge closes the wedge between the pinch face and the facing side. It is
  // emitted once (both flanks lean on it).
  let convApexEmitted = false
  const emitConvApex = (): void => {
    if (convApexEmitted) return
    if (!deg(conv, apex)) push([conv, apex])
    convApexEmitted = true
  }
  // Front-2 sloping ride: the TOP flank rides the enclosing formation's BASE contour (its lower
  // bracket bounds the top wedge from below); the BASE flank rides the enclosing formation's TOP
  // contour. ``ridePolyline`` returns the corner→conv leg as a polyline sampled along that
  // contour; on a flat contour it is exactly [corner, conv] (parity).
  if (skipSide !== 'top' && !deg(topCorner, conv)) {
    push(ridePolyline(topCorner, conv, facing, label, 'base', colX, facingX))
    emitConvApex()
  }
  if (skipSide !== 'base' && !deg(baseCorner, conv)) {
    push(ridePolyline(baseCorner, conv, facing, label, 'top', colX, facingX))
    emitConvApex()
  }
}

/**
 * The corner→conv leg as a polyline riding the facing enclosing formation's bounding contour
 * (SESSION-16 Front 2). ``bound`` = which of the enclosing formation's own contours bounds this
 * flank ('base' for the top flank — the lower bracket; 'top' for the base flank — the upper
 * bracket). The enclosing formation's contour on the FACING column is at ``facingBoundElev``; on
 * the terminating column it is at the corner elevation. When the two differ by more than
 * ``SLOPE_EPS`` the leg dips/rises across the wedge, so we insert an intermediate vertex on the
 * contour at the conv x — bounding the wedge by the real sloping line art instead of a straight
 * chord that exits the enclosure (the CS2 g17 triangular hole). A flat contour yields exactly
 * ``[corner, conv]`` (byte-identical parity).
 */
function ridePolyline(
  corner: Point,
  conv: Point,
  facing: ColumnGeom,
  label: LensLabel,
  bound: 'top' | 'base',
  colX: number,
  facingX: number,
): Point[] {
  // The facing enclosing unit's bounding contour elevation (its own top or base) — the sloping
  // bracket. Sample the facing unit of the flood formation nearest the corner elevation.
  if (!SLOPING_RIDE_ENABLED) return [corner, conv] // gated off — see the kill-switch comment above
  const facingBoundElev = enclosingBoundElev(facing, label.formationId, corner.y, bound)
  if (facingBoundElev === null) return [corner, conv]
  // The contour runs from ``corner.y`` (on the terminating column, colX) to ``facingBoundElev``
  // (on the facing column, facingX). Its elevation at the conv x (straight interpolation in x).
  const width = facingX - colX
  if (Math.abs(width) < SLOPE_EPS) return [corner, conv]
  const tConv = (conv.x - colX) / width
  const boundAtConv = corner.y + tConv * (facingBoundElev - corner.y)
  // FLAT contour (or conv already on it) → the straight leg is inside the enclosure; keep parity.
  if (Math.abs(boundAtConv - conv.y) <= SLOPE_EPS) return [corner, conv]
  // The straight chord ``corner → conv`` would leave ``conv`` off the sloping contour. Insert the
  // contour point at the conv x so the leg rides the bracket to it, then closes to conv along the
  // (now short) vertical to the conv elevation — bounding the wedge by the actual sloping line.
  const ride: Point = { x: conv.x, y: boundAtConv }
  if (segmentDeg(ride, conv)) return [corner, conv]
  return [corner, ride, conv]
}

/**
 * The facing enclosing formation's bounding-contour elevation (``bound`` = 'top' or 'base' of
 * its own unit) nearest ``nearElev`` on the facing column. Returns ``null`` when the facing
 * carries no unit of ``formationId`` (the flood has no sloping bracket to ride — keep the
 * straight leg).
 */
function enclosingBoundElev(
  facing: ColumnGeom,
  formationId: string,
  nearElev: number,
  bound: 'top' | 'base',
): number | null {
  let best: number | null = null
  let bestDist = Infinity
  for (const u of facing.units) {
    if (u.formationId !== formationId) continue
    const mid = (u.topElev + u.baseElev) / 2
    const dist = Math.abs(mid - nearElev)
    if (dist < bestDist) {
      bestDist = dist
      best = bound === 'top' ? u.topElev : u.baseElev
    }
  }
  return best
}

/** Whether both endpoints snap to the same 1 mm grid cell (inline to avoid a snap cycle). */
function segmentDeg(a: Point, b: Point): boolean {
  const SNAP = 0.001
  return (
    Math.round(a.x / SNAP) === Math.round(b.x / SNAP) && Math.round(a.y / SNAP) === Math.round(b.y / SNAP)
  )
}
