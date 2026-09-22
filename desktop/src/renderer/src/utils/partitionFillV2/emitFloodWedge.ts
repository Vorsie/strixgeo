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
 * trick). The flood label is the facing enclosing formation at the flooded contact (owner 8f —
 * "fill the void with the dominant lithology between correlations"), read INSIDE the tie-bounded
 * channel the vacated space belongs to (``tieWindow``) so a steep tie cannot import
 * the class from the far side of a correlation the user drew.
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

import { type ResolvedTie } from './emitCurves'
import { facingMatrixLabel } from './facingMatrix'
import { clampIntoWindow, tieElevAt, tieWindowAt } from './tieWindow'
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
 * revive. See REWRITE_STATE.md §19 (deleted 2026-09-22; in git history at 8d54f6f78).
 */
const SLOPING_RIDE_ENABLED = false

/** RED-first neutraliser (s32) — set true to prove the ruling-8n tie clamp goes RED. Ships false. */
const NEUTRALISE_TIE_CLAMP = false

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
  lensMatrixLabel?: LensLabel | null,
  gapTies?: readonly ResolvedTie[],
  emittedFlankOverride?: readonly Point[],
  nearCol?: ColumnGeom,
): void {
  const midElev = (topElev + baseElev) / 2
  // RULING 8n (owner, 2026-07-18 — "stay inside the lines"): the flood wedge past a termination
  // apex is the facing unit being ONLAPPED INTO (rule 3). For an ONLAP the flood fills ONLY the
  // UNTIED side (``skipSide`` names the TIED/closed side), and that side laps up/down onto the
  // FACING unit above/below the tie — sampling the mid-elevation there reads the WRONG facing unit
  // (the mid lands in the matrix on the TIED side of the facing tie). CS1 gap1 x=96.96: the
  // base-tied ZAND onlap (mid 4.9) floods its TOP; mid-4.9 sampled col2 as KLEI [3.67..5.023]
  // (below the tie) → the wedge past the apex mislabelled KLEI, KLEI crossing its own
  // band-top/tie line (rule-4 violation). Sampling the FLOODED (untied) contact — the TOP (5.39)
  // for a base-tied onlap — lands in col2 SILT [5.023..6.278], the unit the ZAND onlaps into.
  // ``skipSide === 'base'`` → flood TOP → sample topElev; ``'top'`` → flood BASE → sample baseElev.
  //
  // RULING 8n(b) (owner, 2026-07-18 — x=646.74, "it should be silt and veen in the lens and there
  // is no sand adjacency"): a corr-0 LENS (``skipSide === null``) pinches INSIDE its ENCLOSING
  // MATRIX — the formation that wraps around the pinch on the lens's OWN column (ruling 8g), NOT
  // the far facing column at the lens mid-elevation. The caller passes that enclosing matrix as
  // ``lensMatrixLabel`` (from ``lensEnclosingMatrix``). Sampling ``facingMatrixLabel(facing,
  // midElev)`` here was the s30 bug: at col18 x=646.74 it read col19's big ZAND [-5.87..7.027]
  // 78 m away and painted a phantom "sand lens" past the thin SILT/VEEN apexes. ``lensMatrixLabel
  // === null`` means the caller's up/down enclosure walk found NO common litho (an ASK-FIRST rule
  // gap) — keep the s30 mid-elevation facing sample as a non-inventing fallback for that instance.
  // LABEL ONLY — the wedge GEOMETRY (``convY``, the corners) is unchanged. See REWRITE_STATE §35/§36.
  const labelElev = skipSide === 'base' ? topElev : skipSide === 'top' ? baseElev : midElev
  // A CLASS-LABEL SAMPLE MAY NEVER CROSS A CORRELATION (ruling 8n, owner 2026-08-18 — "same litho
  // other class, it should cleanly onlap"). The flooded space lives in a CHANNEL bounded by the
  // gap's tie lines, so its class must be read on the facing column INSIDE that same channel.
  // ``labelElev`` is an elevation on the TERMINATING column; sampling the facing column at that
  // same elevation is a HORIZONTAL read that ignores the lines, and a steep tie makes it land on
  // the far side of a correlation the user drew.
  //
  // ``tieWindowAt`` gives the channel expressed on the FACING column; the sample is clamped into
  // it, and the lookup is confined to it — so the nearest-unit fallback can no longer reach past
  // a bounding tie for a unit that has no presence in the channel at all (the S7|S6 clay, whose
  // whole stack ENDS on the tie and which was still handed the sand channel below it). Both are
  // no-ops whenever the horizontal read already lands inside the lines.
  const window = tieWindowAt(labelElev, colX, facingX, gapTies)
  const label =
    skipSide === null && lensMatrixLabel != null
      ? lensMatrixLabel
      : (facingMatrixLabel(facing, clampIntoWindow(labelElev, window), window) ??
        nearMatrixAt(nearCol, floodedNeighbourElev(topElev, baseElev, skipSide)))
  if (label === null) return
  // RULING 8g/8q (owner 2026-07-19, "the matrix detours AROUND the wedge; fill between the lines"):
  // a corr-0 LENS flood wedge fills the matrix vacated PAST the lens apex. Its convergence point
  // must sit AT the lens apex (``apexX``), NOT the gap midpoint. Under ruling 8b-rev the lens apex
  // reaches only 0.45·gap, while a midpoint conv sits at 0.50·gap — so a midpoint-conv flood flank
  // (``topCorner → conv``) diverged from the lens closing flank (``topCorner → apex``) by 0.05·gap
  // and left a razor-thin double-covered sliver (the CS1-g3 / CS2-g17 "hole" cluster: the flood at
  // x=146.75 vs the lens apex at x=142.23, same elevation). Converging the flood AT the apex makes
  // its flanks coincide with the lens closing flanks (the DCEL unions the coincident segments) and
  // its ``conv→apex`` edge degenerate — so the enclosing-matrix BAND face (already continuous across
  // the gap with the lens recorded as its hole) owns the space past the apex, hole-free. The old
  // "two opposing wedges meet at 0.5" assumption is stale under 8b-rev: each opposing lens now
  // reaches its own 0.45 apex and the matrix band between them is one continuous face, not two
  // wedges. A SKIPPED-SIDE ONLAP wedge (``convToFacingX`` set) keeps the apex-ELEVATION conv so its
  // single flank closes DIRECTLY to the apex — that path is unchanged.
  const convX = convToFacingX !== undefined ? (colX + facingX) / 2 : apexX
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
  // emitted once (both flanks lean on it), using the possibly tie-clamped conv (``emitConvApexAt``).
  let convApexEmitted = false
  // Front-2 sloping ride: the TOP flank rides the enclosing formation's BASE contour (its lower
  // bracket bounds the top wedge from below); the BASE flank rides the enclosing formation's TOP
  // contour. ``ridePolyline`` returns the corner→conv leg as a polyline sampled along that
  // contour; on a flat contour it is exactly [corner, conv] (parity).
  // RULING 8n TIE CLAMP (LENS wrap only). A gap TIE is given line art bounding the enclosing
  // matrix; the wrap flood wedge may not cross it (the space on the far side is owned by the tied
  // fill). CS1 gap18: the KLEI wrap of the VEEN lens rode its BASE flank + ``conv`` (mid-gap, at
  // the lens mid-elevation) BELOW the rising ZAND-top tie, double-covering the sub-tie sliver with
  // the ZAND fill. Clamp the SHARED ``conv`` point (and thereby both flanks + the conv→apex edge)
  // to stay on the matrix side of every gap tie: a tie beneath pushes ``conv`` UP onto it, a tie
  // above pushes it DOWN. Each flank then rides onto the binding tie at the crossing and follows it
  // to the clamped conv, so the wrap face stops AT the tie and the tied fill owns the far side. The
  // tie is a real arrangement curve, so the ride vertices sit on it and the two faces meet cleanly.
  // ONLAP wedges (skipSide set) keep the s16 gated-off ``ridePolyline`` path untouched.
  const doTieClamp = skipSide === null && gapTies !== undefined && gapTies.length > 0 && !NEUTRALISE_TIE_CLAMP
  const clamped = doTieClamp
    ? clampConvToTies(conv, topCorner, baseCorner, gapTies!)
    : conv
  // RULING 8g DETOUR (S51): for an ONLAP flood whose emitted flank rides the SAME line as the
  // onlap flank (``convToFacingX`` set → conv == apex → the flank IS ``corner→apex``), the caller
  // passes the detoured flank polyline as ``emittedFlankOverride`` so the SILT flood boundary rides
  // the SAME detour around the enclosed lens the onlap flank took — the two coincide (twin
  // half-edges, matrix on one side, flood on the other), so the enclosed lens closes as a hole in
  // BOTH. A straight flood flank here would re-cut the lens diamond the onlap flank just detoured
  // around (the convergingStack (a) ``floodsw0`` residual). The override already reaches the apex,
  // so no separate ``conv→apex`` edge is emitted for that side.
  if (skipSide !== 'top' && !deg(topCorner, clamped)) {
    if (emittedFlankOverride !== undefined) {
      push([...emittedFlankOverride])
    } else {
      const leg = doTieClamp
        ? rideFlankToTie(topCorner, clamped, gapTies!, 'above')
        : ridePolyline(topCorner, conv, facing, label, 'base', colX, facingX)
      push(leg)
      emitConvApexAt(clamped)
    }
  }
  if (skipSide !== 'base' && !deg(baseCorner, clamped)) {
    if (emittedFlankOverride !== undefined) {
      push([...emittedFlankOverride])
    } else {
      const leg = doTieClamp
        ? rideFlankToTie(baseCorner, clamped, gapTies!, 'below')
        : ridePolyline(baseCorner, conv, facing, label, 'top', colX, facingX)
      push(leg)
      emitConvApexAt(clamped)
    }
  }

  // Shared conv→apex edge, using the (possibly tie-clamped) conv. Emitted once.
  function emitConvApexAt(cv: Point): void {
    if (convApexEmitted) return
    if (!deg(cv, apex)) push([cv, apex])
    convApexEmitted = true
  }
}

/**
 * The terminating column's OWN mass just beyond the unit, on the side being flooded.
 *
 * Consulted only when the facing column has nothing in the channel at all — which, now that the
 * lookup is confined to the tie-bounded window, is a real signal rather than an impossibility. The
 * ground still has to belong to somebody, and the only test that read it is this one. Reading its
 * own column at its own contact crosses no correlation by construction.
 */
function nearMatrixAt(col: ColumnGeom | undefined, e: number): LensLabel | null {
  if (col === undefined) return null
  const EPS = 1e-6
  for (const u of col.units) {
    if (u.topElev >= e - EPS && e >= u.baseElev - EPS) {
      return { formationId: u.formationId, bodyId: u.bodyId }
    }
  }
  return null
}

/**
 * The elevation just BEYOND the terminating unit on its flooded side. ``skipSide`` names the
 * CLOSED side, so the flood is on the other one; a lens closes on both and is read at its own mid.
 */
function floodedNeighbourElev(
  topElev: number,
  baseElev: number,
  skipSide: 'top' | 'base' | null,
): number {
  const MARGIN = 1e-3
  if (skipSide === 'top') return baseElev - MARGIN
  if (skipSide === 'base') return topElev + MARGIN
  return (topElev + baseElev) / 2
}

/**
 * Clamp the shared convergence point of a LENS wrap wedge to the enclosing-matrix side of every
 * gap tie the STRAIGHT flanks cross (ruling 8n). The BASE flank runs ``baseCorner → conv``, the
 * TOP flank ``topCorner → conv``; a tie that a flank crosses is one that is on the matrix side of
 * the flank at the CORNER but on the vacated side at ``conv``. The base flank is bounded from
 * BELOW (raise conv onto a tie that ends up above it), the top flank from ABOVE (lower conv onto a
 * tie that ends up below it). Returns the clamped conv (same x); the original when no tie binds.
 */
function clampConvToTies(
  conv: Point,
  topCorner: Point,
  baseCorner: Point,
  gapTies: readonly ResolvedTie[],
): Point {
  let convY = conv.y
  for (const t of gapTies) {
    const tieAtConv = tieElevAt(t, conv.x)
    // BASE flank: matrix is ABOVE. A tie BELOW the base corner (baseCorner.y) that has risen ABOVE
    // conv is the ZAND-top tie the wrap must not dip below → raise conv onto it.
    const tieAtBaseCorner = tieElevAt(t, baseCorner.x)
    if (tieAtBaseCorner < baseCorner.y - SLOPE_EPS && tieAtConv > convY + SLOPE_EPS) convY = tieAtConv
    // TOP flank: matrix is BELOW. A tie ABOVE the top corner that has fallen BELOW conv → lower conv.
    const tieAtTopCorner = tieElevAt(t, topCorner.x)
    if (tieAtTopCorner > topCorner.y + SLOPE_EPS && tieAtConv < convY - SLOPE_EPS) convY = tieAtConv
  }
  return { x: conv.x, y: convY }
}

/**
 * A LENS wrap flank riding onto its binding tie. ``corner → conv`` (conv already tie-clamped)
 * normally; when a gap tie crosses the straight ``corner → conv`` chord on the forbidden side (a
 * tie beneath for ``bound==='below'``, above for ``'above'``), insert the crossing vertex so the
 * flank rides ONTO the tie there and then runs straight to ``conv`` (which itself sits on that tie
 * after the conv-clamp). The ride vertex sits on the tie — a real arrangement curve — so the wrap
 * face and the tied fill share the boundary exactly. Returns ``[corner, conv]`` when no tie binds.
 */
function rideFlankToTie(
  corner: Point,
  conv: Point,
  gapTies: readonly ResolvedTie[],
  bound: 'above' | 'below',
): Point[] {
  const flankAt = (x: number): number => {
    if (Math.abs(conv.x - corner.x) < SLOPE_EPS) return corner.y
    const t = (x - corner.x) / (conv.x - corner.x)
    return corner.y + t * (conv.y - corner.y)
  }
  let best: Point | null = null
  for (const t of gapTies) {
    const dCorner = tieElevAt(t, corner.x) - flankAt(corner.x)
    const dConv = tieElevAt(t, conv.x) - flankAt(conv.x)
    // 'below' (base flank): a tie BELOW the flank at the corner and AT/ABOVE it at conv crosses
    // upward into the flank. 'above' (top flank): the mirror. (``dConv >= 0`` since conv now rides
    // the tie after the clamp — the flank meets the tie at conv.)
    const crossesIn = bound === 'below' ? dCorner < -SLOPE_EPS && dConv > -SLOPE_EPS : dCorner > SLOPE_EPS && dConv < SLOPE_EPS
    if (!crossesIn) continue
    const denom = dConv - dCorner
    if (Math.abs(denom) < SLOPE_EPS) continue
    const xCross = corner.x + (0 - dCorner) / denom * (conv.x - corner.x)
    if (xCross <= corner.x + SLOPE_EPS || xCross >= conv.x - SLOPE_EPS) continue
    const pt: Point = { x: xCross, y: tieElevAt(t, xCross) }
    if (best === null || xCross < best.x) best = pt
  }
  if (best === null) return [corner, conv]
  if (segmentDeg(best, conv)) return [corner, conv]
  return [corner, best, conv]
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
