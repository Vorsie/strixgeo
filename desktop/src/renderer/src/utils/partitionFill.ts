/**
 * True-partition fill between two adjacent litho columns.
 *
 * Problem this replaces
 * ----------------------
 * ``morphFill.ts`` paints body-envelope bands then overpaints pinch triangles
 * with z-order. The envelopes of two bodies can overlap in the gap (a clay that
 * sweeps over a silt), and morph/pinch mismatches leave gaps. The result is only
 * a visual approximation, not a partition — bodies overlap.
 *
 * This is load-bearing: the 2D section defines the 3D geological model. Any
 * overlap or gap in 2D becomes an overlap or gap in 3D.
 *
 * The partition algorithm
 * -----------------------
 * 1.  **Monotonic LCS alignment.** Match units across columns by ``bodyId``
 *     using a longest-common-subsequence that preserves order. Matching is
 *     order-preserving (monotonic) — a body that appears *before* a shared
 *     marker on one column cannot be matched to an occurrence *after* that
 *     marker on the other column. This is exactly what splits an interrupted
 *     body into two pieces: if body K appears on the left after silt Si, and
 *     on the right both before and after Si, the pre-Si right K is unmatched
 *     (monotonicity blocks it); the post-Si right K is matched.  Units with
 *     ``bodyId === null`` never match (each is its own pinch).
 *
 * 2.  **Interval groups.** Between each pair of consecutive matched quads (and
 *     between the surface/floor and the outermost quads) all unmatched units
 *     belong to the same "interval" — a trapezoidal region bounded by the same
 *     top and base interfaces.  Units from the left column advance the LEFT
 *     boundary of that interface; units from the right column advance the RIGHT
 *     boundary.  The interval's top is the base of the previous quad (or
 *     the column surface), and the base is the top of the next quad (or the
 *     column floor).
 *
 * 3.  **Meeting fraction inside an interval.** When an interval has both left-
 *     only and right-only pinches, the entire interval is split at a single
 *     fraction f weighted by total thickness: f = sumLeft / (sumLeft + sumRight).
 *     Left-only pinches tile [0, f]; right-only tile [f, 1].  Each pinch is a
 *     TRAPEZOID cut from the interval's enclosing interfaces.  A lone pinch
 *     collapses fully (f = 1 for left, f = 0 for right — triangle geometry).
 *
 * 4.  **Monotonic elevation clamp.** Interface elevations are clamped so that
 *     each successive interface is non-decreasing in depth, preventing a
 *     crossing correlation from inverting a region.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 * The overlay maps ``fraction → screenX`` and ``elevation → screenY``.
 */

// Re-export the input types from morphFill so consumers import from one place.
export type { MorphColumn, MorphUnit } from './morphFill'
import type { MorphColumn } from './morphFill'

const EPS = 1e-9

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** A point in (fraction, elevation) space. fraction 0 = left column, 1 = right. */
export interface PartitionPoint {
  /** 0 = left column edge, 1 = right column edge. */
  fraction: number
  /** Absolute elevation in mTAW. */
  elevation: number
}

/**
 * One filled region of the partition.
 *
 * ``polygon`` is a closed ring (no repeated last point) in
 * (fraction, elevation) space.  The overlay maps it to screen coordinates.
 */
export interface PartitionRegion {
  formationId: string
  bodyId: string | null
  /**
   * ``quad``  = body present on both columns (four-corner trapezoid).
   * ``pinch`` = body present on one column only; cut at the meeting fraction
   *             inside its interval (triangular when alone, trapezoidal when
   *             sharing the interval with an opposite pinch).
   */
  kind: 'quad' | 'pinch'
  /** Closed polygon ring, no repeated last point. */
  polygon: PartitionPoint[]
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** One horizontal interface line: left-depth ↔ right-depth. */
interface Interface {
  leftDepth: number
  rightDepth: number
}

/** A pinch unit pending placement inside an interval. */
interface PinchUnit {
  bodyId: string | null
  formationId: string
  side: 'left' | 'right'
  /** Depth span on the unit's own column. */
  ownTopDepth: number
  ownBaseDepth: number
}

// ---------------------------------------------------------------------------
// LCS alignment
// ---------------------------------------------------------------------------

/**
 * Compute the longest order-preserving match between left and right unit
 * sequences on equal ``bodyId``.  Units with ``bodyId === null`` never match.
 *
 * Returns a list of (leftIndex, rightIndex) pairs in ascending order.
 *
 * Parameters
 * ----------
 * leftIds : (string | null)[]
 *     bodyId values for the left column's units.
 * rightIds : (string | null)[]
 *     bodyId values for the right column's units.
 *
 * Returns
 * -------
 * Array<[number, number]>
 *     Matched (leftIndex, rightIndex) pairs in ascending order.
 */
function lcsAlignment(
  leftIds: (string | null)[],
  rightIds: (string | null)[],
): Array<[number, number]> {
  const n = leftIds.length
  const m = rightIds.length

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const lid = leftIds[i - 1]
      const rid = rightIds[j - 1]
      if (lid !== null && rid !== null && lid === rid) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const pairs: Array<[number, number]> = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const lid = leftIds[i - 1]
    const rid = rightIds[j - 1]
    if (lid !== null && rid !== null && lid === rid && dp[i][j] === dp[i - 1][j - 1] + 1) {
      pairs.push([i - 1, j - 1])
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  pairs.reverse()
  return pairs
}

// ---------------------------------------------------------------------------
// Interface helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a candidate interface so it is not shallower than the previous one
 * on either side.
 */
function clampIface(iface: Interface, prev: Interface): Interface {
  return {
    leftDepth: Math.max(iface.leftDepth, prev.leftDepth),
    rightDepth: Math.max(iface.rightDepth, prev.rightDepth),
  }
}

/**
 * Interpolate the mTAW elevation on an interface at a given fraction.
 *
 * An interface is a straight line from (f=0, leftSurface − leftDepth) to
 * (f=1, rightSurface − rightDepth).
 */
function ifaceElev(
  iface: Interface,
  fraction: number,
  leftSurface: number,
  rightSurface: number,
): number {
  const leftElev = leftSurface - iface.leftDepth
  const rightElev = rightSurface - iface.rightDepth
  return leftElev + fraction * (rightElev - leftElev)
}

// ---------------------------------------------------------------------------
// Polygon builders
// ---------------------------------------------------------------------------

/**
 * Build the 4-point quad polygon for a matched body.
 *
 * Corner order: top-left → top-right → base-right → base-left.
 */
function buildQuadPolygon(
  topIface: Interface,
  baseIface: Interface,
  leftSurface: number,
  rightSurface: number,
): PartitionPoint[] {
  return [
    { fraction: 0, elevation: leftSurface - topIface.leftDepth },
    { fraction: 1, elevation: rightSurface - topIface.rightDepth },
    { fraction: 1, elevation: rightSurface - baseIface.rightDepth },
    { fraction: 0, elevation: leftSurface - baseIface.leftDepth },
  ]
}

/**
 * Build the polygon for a LEFT-only pinch that occupies [0, meetFraction].
 *
 * The enclosing interval spans from ``topIface`` to ``baseIface``.  The cut at
 * ``meetFraction`` is the dividing line shared with the right-only pinches in
 * the same interval, computed from both interfaces independently so the cut is
 * a straight (possibly slanted) line and the two trapezoids tile exactly.
 *
 * Corner order: top-left → top-cut → base-cut → base-left.
 * When meetFraction = 1 the cut IS the right column — triangle shape.
 */
function buildLeftPinchPolygon(
  topIface: Interface,
  baseIface: Interface,
  meetFraction: number,
  leftSurface: number,
  rightSurface: number,
): PartitionPoint[] {
  const topLeftElev = leftSurface - topIface.leftDepth
  const baseLeftElev = leftSurface - baseIface.leftDepth
  const topCutElev = ifaceElev(topIface, meetFraction, leftSurface, rightSurface)
  const baseCutElev = ifaceElev(baseIface, meetFraction, leftSurface, rightSurface)

  if (Math.abs(topCutElev - baseCutElev) < EPS) {
    // Degenerate: both interfaces meet at the cut → triangle.
    return [
      { fraction: 0, elevation: topLeftElev },
      { fraction: meetFraction, elevation: (topCutElev + baseCutElev) / 2 },
      { fraction: 0, elevation: baseLeftElev },
    ]
  }
  return [
    { fraction: 0, elevation: topLeftElev },
    { fraction: meetFraction, elevation: topCutElev },
    { fraction: meetFraction, elevation: baseCutElev },
    { fraction: 0, elevation: baseLeftElev },
  ]
}

/**
 * Build the polygon for a RIGHT-only pinch that occupies [meetFraction, 1].
 *
 * Corner order: top-cut → top-right → base-right → base-cut.
 */
function buildRightPinchPolygon(
  topIface: Interface,
  baseIface: Interface,
  meetFraction: number,
  leftSurface: number,
  rightSurface: number,
): PartitionPoint[] {
  const topRightElev = rightSurface - topIface.rightDepth
  const baseRightElev = rightSurface - baseIface.rightDepth
  const topCutElev = ifaceElev(topIface, meetFraction, leftSurface, rightSurface)
  const baseCutElev = ifaceElev(baseIface, meetFraction, leftSurface, rightSurface)

  if (Math.abs(topCutElev - baseCutElev) < EPS) {
    return [
      { fraction: meetFraction, elevation: (topCutElev + baseCutElev) / 2 },
      { fraction: 1, elevation: topRightElev },
      { fraction: 1, elevation: baseRightElev },
    ]
  }
  return [
    { fraction: meetFraction, elevation: topCutElev },
    { fraction: 1, elevation: topRightElev },
    { fraction: 1, elevation: baseRightElev },
    { fraction: meetFraction, elevation: baseCutElev },
  ]
}

// ---------------------------------------------------------------------------
// Interval emission
// ---------------------------------------------------------------------------

/**
 * Emit regions for one interval (the span between two quads, or between the
 * surface/floor and a quad).
 *
 * An interval has a fixed enclosing ``topIface`` and ``baseIface``.  Any number
 * of left-only and right-only pinches share this interval and are tiled inside
 * it side-by-side.
 *
 * Meeting fraction = totalLeftThickness / (totalLeft + totalRight) — the
 * thicker side keeps more of the interval width.  When only one side has
 * pinches the lone side fills the whole interval (meetFraction 0 or 1).
 *
 * Parameters
 * ----------
 * pinches : PinchUnit[]
 *     The unmatched units in this interval, in top→bottom order per side.
 * topIface : Interface
 *     Top boundary of the interval.
 * baseIface : Interface
 *     Base boundary of the interval.
 * leftSurface, rightSurface : number
 *     Column surface elevations (mTAW).
 *
 * Returns
 * -------
 * PartitionRegion[]
 *     The pinch regions tiling this interval.  Empty when ``pinches`` is empty.
 */
function emitInterval(
  pinches: PinchUnit[],
  topIface: Interface,
  baseIface: Interface,
  leftSurface: number,
  rightSurface: number,
): PartitionRegion[] {
  if (pinches.length === 0) return []

  const leftPinches = pinches.filter((p) => p.side === 'left')
  const rightPinches = pinches.filter((p) => p.side === 'right')

  // Compute total elevation thickness on each side for the meeting-fraction weight.
  const sumLeft = leftPinches.reduce((s, p) => {
    return s + Math.max(0, (leftSurface - p.ownTopDepth) - (leftSurface - p.ownBaseDepth))
  }, 0)
  const sumRight = rightPinches.reduce((s, p) => {
    return s + Math.max(0, (rightSurface - p.ownTopDepth) - (rightSurface - p.ownBaseDepth))
  }, 0)

  let meetFraction: number
  if (leftPinches.length > 0 && rightPinches.length > 0) {
    meetFraction = sumLeft + sumRight > EPS ? sumLeft / (sumLeft + sumRight) : 0.5
  } else if (leftPinches.length > 0) {
    meetFraction = 1 // lone left-only: full triangle to right column
  } else {
    meetFraction = 0 // lone right-only: full triangle to left column
  }

  const regions: PartitionRegion[] = []

  // Each left pinch is a SEPARATE region.  They all use the SAME topIface and
  // baseIface (the interval boundaries) and the SAME meetFraction — they tile
  // the same [0, meetFraction] slice, one per pinch body.
  // When there are multiple left pinches they are stacked vertically inside
  // [0, meetFraction]: each gets its own sub-interval.
  if (leftPinches.length === 1) {
    const p = leftPinches[0]
    const polygon = buildLeftPinchPolygon(topIface, baseIface, meetFraction, leftSurface, rightSurface)
    regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
  } else if (leftPinches.length > 1) {
    // Multiple left pinches: subdivide the interval vertically on the left side.
    // Each pinch's own depth span defines its sub-interval on the left.
    // The right side (at meetFraction) is shared — interpolated from topIface/baseIface.
    const intervalLeftSpan = baseIface.leftDepth - topIface.leftDepth
    for (const p of leftPinches) {
      if (p.ownBaseDepth - p.ownTopDepth < EPS) continue
      // Sub-interface for this pinch: left side from the unit's own depths,
      // right side linearly interpolated from the interval's right progression.
      const tTop = intervalLeftSpan < EPS ? 0 : (p.ownTopDepth - topIface.leftDepth) / intervalLeftSpan
      const tBase = intervalLeftSpan < EPS ? 1 : (p.ownBaseDepth - topIface.leftDepth) / intervalLeftSpan
      const subTopRight = topIface.rightDepth + tTop * (baseIface.rightDepth - topIface.rightDepth)
      const subBaseRight = topIface.rightDepth + tBase * (baseIface.rightDepth - topIface.rightDepth)
      const subTop: Interface = { leftDepth: p.ownTopDepth, rightDepth: subTopRight }
      const subBase: Interface = { leftDepth: p.ownBaseDepth, rightDepth: subBaseRight }
      const polygon = buildLeftPinchPolygon(subTop, subBase, meetFraction, leftSurface, rightSurface)
      regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
    }
  }

  // Similarly for right pinches.
  if (rightPinches.length === 1) {
    const p = rightPinches[0]
    const polygon = buildRightPinchPolygon(topIface, baseIface, meetFraction, leftSurface, rightSurface)
    regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
  } else if (rightPinches.length > 1) {
    const intervalRightSpan = baseIface.rightDepth - topIface.rightDepth
    for (const p of rightPinches) {
      if (p.ownBaseDepth - p.ownTopDepth < EPS) continue
      const tTop = intervalRightSpan < EPS ? 0 : (p.ownTopDepth - topIface.rightDepth) / intervalRightSpan
      const tBase = intervalRightSpan < EPS ? 1 : (p.ownBaseDepth - topIface.rightDepth) / intervalRightSpan
      const subTopLeft = topIface.leftDepth + tTop * (baseIface.leftDepth - topIface.leftDepth)
      const subBaseLeft = topIface.leftDepth + tBase * (baseIface.leftDepth - topIface.leftDepth)
      const subTop: Interface = { leftDepth: subTopLeft, rightDepth: p.ownTopDepth }
      const subBase: Interface = { leftDepth: subBaseLeft, rightDepth: p.ownBaseDepth }
      const polygon = buildRightPinchPolygon(subTop, subBase, meetFraction, leftSurface, rightSurface)
      regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
    }
  }

  return regions
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Compute the partition fill for one adjacent column gap.
 *
 * Every point in the gap between ``left`` and ``right`` belongs to exactly one
 * region — no overlaps, no empty spaces.  The regions are ordered top→bottom.
 *
 * Parameters
 * ----------
 * left : MorphColumn
 *     The left column.  ``units`` must be gap-free, sorted by ``topDepthM``.
 * right : MorphColumn
 *     The right column, same constraints.
 *
 * Returns
 * -------
 * PartitionRegion[]
 *     Top-to-bottom ordered regions that tile the gap.  Empty when the left
 *     column has no units.
 */
export function computePartitionFill(left: MorphColumn, right: MorphColumn): PartitionRegion[] {
  if (left.units.length === 0) return []

  const leftUnits = left.units
  const rightUnits = right.units

  const leftSurface = left.surfaceElevM
  const rightSurface = right.surfaceElevM

  const leftTop = leftUnits[0].topDepthM
  const rightTop = rightUnits.length > 0 ? rightUnits[0].topDepthM : leftTop
  const leftFloor = leftUnits[leftUnits.length - 1].baseDepthM
  const rightFloor = rightUnits.length > 0 ? rightUnits[rightUnits.length - 1].baseDepthM : leftFloor

  // -------------------------------------------------------------------------
  // Step 1: Monotonic LCS alignment on bodyId.
  // -------------------------------------------------------------------------
  const leftIds = leftUnits.map((u) => u.bodyId)
  const rightIds = rightUnits.map((u) => u.bodyId)
  const matchedPairs = lcsAlignment(leftIds, rightIds)

  const leftMatched = new Set(matchedPairs.map(([li]) => li))
  const rightMatched = new Set(matchedPairs.map(([, ri]) => ri))

  // -------------------------------------------------------------------------
  // Step 2: Walk the matched pairs, collecting interval groups.
  //
  // Each "interval" is defined by its top and base interface:
  //   - top = previous quad's baseIface (or the surface interface).
  //   - base = next quad's topIface (or the floor interface).
  //
  // Within each interval we collect all unmatched left and right units, then
  // call emitInterval to tile them side-by-side.
  // -------------------------------------------------------------------------
  const surfaceIface: Interface = { leftDepth: leftTop, rightDepth: rightTop }
  const floorIface: Interface = { leftDepth: leftFloor, rightDepth: rightFloor }

  const regions: PartitionRegion[] = []

  // prevQuadBase: the base interface of the most recently emitted quad (or the
  // surface interface before any quads).
  let prevQuadBase: Interface = surfaceIface

  // Also track the left and right unit cursors so we can collect unmatched units.
  // For each inter-quad gap, unmatched left units are those between the previous
  // match's left index and the next match's left index (exclusive, left-unmatched),
  // and similarly for right.
  let prevMatchLi = -1 // last matched left index (-1 = before first)
  let prevMatchRi = -1 // last matched right index

  for (let pairIdx = 0; pairIdx <= matchedPairs.length; pairIdx++) {
    const isFloor = pairIdx === matchedPairs.length
    const nextMatchLi = isFloor ? leftUnits.length : matchedPairs[pairIdx][0]
    const nextMatchRi = isFloor ? rightUnits.length : matchedPairs[pairIdx][1]

    // Collect unmatched units in this interval.
    const pinches: PinchUnit[] = []
    for (let li = prevMatchLi + 1; li < nextMatchLi; li++) {
      if (leftMatched.has(li)) continue
      const lu = leftUnits[li]
      pinches.push({
        bodyId: lu.bodyId,
        formationId: lu.formationId,
        side: 'left',
        ownTopDepth: lu.topDepthM,
        ownBaseDepth: lu.baseDepthM,
      })
    }
    for (let ri = prevMatchRi + 1; ri < nextMatchRi; ri++) {
      if (rightMatched.has(ri)) continue
      const ru = rightUnits[ri]
      pinches.push({
        bodyId: ru.bodyId,
        formationId: ru.formationId,
        side: 'right',
        ownTopDepth: ru.topDepthM,
        ownBaseDepth: ru.baseDepthM,
      })
    }

    // Determine the interval's base interface.
    let intervalBase: Interface
    if (isFloor) {
      intervalBase = clampIface(floorIface, prevQuadBase)
    } else {
      const [mli, mri] = matchedPairs[pairIdx]
      intervalBase = clampIface(
        { leftDepth: leftUnits[mli].topDepthM, rightDepth: rightUnits[mri].topDepthM },
        prevQuadBase,
      )
    }

    // Emit the pinch regions for this interval.
    const intervalTop = prevQuadBase
    const intervalRegions = emitInterval(pinches, intervalTop, intervalBase, leftSurface, rightSurface)
    regions.push(...intervalRegions)

    // Emit the quad (if not the floor sentinel).
    if (!isFloor) {
      const [mli, mri] = matchedPairs[pairIdx]
      const lu = leftUnits[mli]
      const ru = rightUnits[mri]
      const quadTop = clampIface(
        { leftDepth: lu.topDepthM, rightDepth: ru.topDepthM },
        prevQuadBase,
      )
      const quadBase = clampIface(
        { leftDepth: lu.baseDepthM, rightDepth: ru.baseDepthM },
        quadTop,
      )
      const leftH = quadBase.leftDepth - quadTop.leftDepth
      const rightH = quadBase.rightDepth - quadTop.rightDepth
      if (leftH >= EPS || rightH >= EPS) {
        regions.push({
          formationId: lu.formationId,
          bodyId: lu.bodyId,
          kind: 'quad',
          polygon: buildQuadPolygon(quadTop, quadBase, leftSurface, rightSurface),
        })
        prevQuadBase = quadBase
      } else {
        prevQuadBase = quadTop
      }
      prevMatchLi = mli
      prevMatchRi = mri
    }
  }

  return regions
}
