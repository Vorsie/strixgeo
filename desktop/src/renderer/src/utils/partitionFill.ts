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
 * 0.  **Enclosed-lens pre-pass.** Before alignment, extract any unit U on either
 *     column where (a) U.bodyId does not appear on the OTHER column (it is a
 *     one-test body in this gap), AND (b) the units immediately above AND below U
 *     on U's own column share the SAME bodyId (the enclosing matrix), AND (c) that
 *     matrix body IS present on the other column.  U is removed from its column and
 *     the two enclosing matrix units are merged into one contiguous unit.  The
 *     extraction repeats until no more enclosed lenses exist (a matrix can enclose
 *     several lenses).  Each extracted lens is stored for step 3.
 *
 *     Why horizontal apex: a one-test lens physically terminates AT ITS OWN
 *     ELEVATION inside the gap — it does not curve along the enclosing interfaces.
 *     The apex is at (e_top + e_base)/2 of the lens on its own column, so the
 *     pinch-out triangle has a flat horizontal top and flat horizontal base with
 *     an apex at the lens's own mid-elevation.  This is geometrically distinct from
 *     the interval-fraction mechanism (step 3), which slants along the enclosing
 *     interfaces.
 *
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
 * 5.  **Lens append.** Each extracted enclosed lens is appended to the region
 *     list AFTER the main partition regions.  The overlay draws regions in array
 *     order, so lenses paint on top of their enclosing matrix band — the standard
 *     geological nested-body representation.  These lens regions deliberately
 *     OVERLAY their matrix quad and are therefore excluded from ``assertTiles``.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 * The overlay maps ``fraction → screenX`` and ``elevation → screenY``.
 */

/** One unit (accepted litho layer) on a column, in depth-below-surface metres. */
export interface PartitionUnit {
  topDepthM: number
  baseDepthM: number
  /** Drives the fill colour (lithology). */
  formationId: string
  /** Resolver-stamped body — members sharing a body merge into one envelope. */
  bodyId: string | null
}

/** One column's placement + its gap-free unit stack (sorted by ``topDepthM``). */
export interface PartitionColumn {
  investigationId: string
  /** Surface elevation (mTAW) — converts depth → absolute elevation. */
  surfaceElevM: number
  units: readonly PartitionUnit[]
}

const EPS = 1e-9

/**
 * How far across the gap (fraction of the total column spacing) an enclosed
 * lens reaches before its pinch-out apex.  0.45 means the lens tapers to a
 * point at 45 % of the way across; the engineer can adjust this later via a
 * per-lens override.
 */
export const LENS_PINCH_FRACTION = 0.45

/**
 * Fraction of the gap at which a lone interior pinch tapers to its tip
 * (owner directive 2026-06-07). 0.5 = halfway on the interface dip — the unit
 * thins to a point mid-gap and the enclosing matrix closes up beyond it,
 * instead of running to the neighbour (the "drooping" pinch). Reshaped
 * afterward via the freedraw apex handle.
 */
export const INTERIOR_PINCH_FRACTION = 0.5

/**
 * A user override for a lens's pinch apex (shaping, dogfeed 2026-06-05).
 *
 * ``fraction`` is the apex's horizontal position 0 (left column) → 1 (right
 * column); ``elevation`` is its mTAW elevation. Replaces the auto default
 * (``LENS_PINCH_FRACTION`` / ``1 − LENS_PINCH_FRACTION`` at the lens's
 * mid-elevation) so the engineer can set how far a lens reaches + at what depth.
 */
export interface LensApexOverride {
  fraction: number
  elevation: number
}

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
   * ``lens``  = enclosed lens extracted in the pre-pass; horizontal pinch-out
   *             triangle that overlays its enclosing matrix quad.  Excluded
   *             from the tiling invariant (it deliberately overlaps its matrix).
   */
  kind: 'quad' | 'pinch' | 'lens'
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

/** A lens extracted during the pre-pass, with its column-side and depths. */
interface ExtractedLens {
  bodyId: string
  formationId: string
  side: 'left' | 'right'
  depthTopM: number
  depthBaseM: number
}

// ---------------------------------------------------------------------------
// Enclosed-lens pre-pass
// ---------------------------------------------------------------------------

/**
 * Extract all enclosed lenses from a column's unit array, merging each lens's
 * enclosing matrix neighbours into one contiguous unit.
 *
 * A unit U at index i is an enclosed lens when:
 *   (a) U.bodyId does not appear anywhere in the OTHER column's units (one-test body).
 *   (b) The units immediately above (i-1) AND below (i+1) share the SAME bodyId
 *       (the enclosing matrix).
 *   (c) That matrix bodyId IS present in the OTHER column (it is a genuine matrix,
 *       not itself absent).
 *
 * The function iterates until no more lenses can be extracted (handles a matrix
 * that encloses several consecutive lenses — e.g. sand/silt/sand/clay/sand on
 * one column where silt and clay are both enclosed in sand).
 *
 * Parameters
 * ----------
 * units : PartitionUnit[]
 *     The mutable working copy of the column's units.
 * otherIds : Set<string>
 *     All bodyIds present in the OTHER column (non-null).
 *
 * Returns
 * -------
 * ExtractedLens[]
 *     Each extracted lens in the order it was removed (top-to-bottom reading
 *     order within the column, because we always scan top-to-bottom and restart
 *     after each extraction).
 */
function extractEnclosedLenses(
  units: PartitionUnit[],
  otherIds: Set<string>,
  side: 'left' | 'right',
): ExtractedLens[] {
  const lenses: ExtractedLens[] = []

  // Iterative scan: restart after each extraction because merging two neighbours
  // can create a new enclosed-lens opportunity (e.g. sand/silt/sand/clay/sand →
  // after silt extracted: sand[merged]/clay/sand → clay is now enclosed).
  let changed = true
  while (changed) {
    changed = false
    for (let i = 1; i < units.length - 1; i++) {
      const u = units[i]
      if (u.bodyId === null) continue
      // (a) One-test body: bodyId not present on the other column.
      if (otherIds.has(u.bodyId)) continue
      // (b) Immediate neighbours share the same bodyId.
      const above = units[i - 1]
      const below = units[i + 1]
      if (above.bodyId === null || below.bodyId === null) continue
      if (above.bodyId !== below.bodyId) continue
      // (c) The matrix bodyId IS present on the other column.
      if (!otherIds.has(above.bodyId)) continue

      // Extract this lens.
      lenses.push({
        bodyId: u.bodyId,
        formationId: u.formationId,
        side,
        depthTopM: u.topDepthM,
        depthBaseM: u.baseDepthM,
      })

      // Merge: replace the three units (above, u, below) with one merged unit
      // that spans above.topDepthM → below.baseDepthM.
      const merged: PartitionUnit = {
        topDepthM: above.topDepthM,
        baseDepthM: below.baseDepthM,
        formationId: above.formationId,
        bodyId: above.bodyId,
      }
      units.splice(i - 1, 3, merged)
      changed = true
      break // restart from the top of the while loop
    }
  }

  return lenses
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

/**
 * Build the horizontal triangle polygon for an enclosed LEFT lens.
 *
 * The apex is at the lens's OWN mid-elevation (not interpolated from the
 * enclosing interfaces), so the pinch-out is horizontal — geologically correct
 * because the lens terminates at its own stratigraphic level, not along the
 * dipping interfaces of the enclosing body.
 *
 * Polygon: base edge at fraction=0 (the source column), apex at fraction=LENS_PINCH_FRACTION.
 * Corner order: top-left → apex → base-left.
 *
 * Parameters
 * ----------
 * topElev : number
 *     Top elevation of the lens (mTAW) = leftSurface − depthTopM.
 * baseElev : number
 *     Base elevation of the lens (mTAW) = leftSurface − depthBaseM.
 */
function buildLeftLensPolygon(
  topElev: number,
  baseElev: number,
  apex?: LensApexOverride,
): PartitionPoint[] {
  const apexFraction = apex?.fraction ?? LENS_PINCH_FRACTION
  const apexElev = apex?.elevation ?? (topElev + baseElev) / 2
  return [
    { fraction: 0, elevation: topElev },
    { fraction: apexFraction, elevation: apexElev },
    { fraction: 0, elevation: baseElev },
  ]
}

/**
 * Build the horizontal triangle polygon for an enclosed RIGHT lens.
 *
 * Mirror of ``buildLeftLensPolygon``: base edge at fraction=1, apex at
 * fraction=1−LENS_PINCH_FRACTION.
 *
 * Corner order: top-right → apex → base-right.
 */
function buildRightLensPolygon(
  topElev: number,
  baseElev: number,
  apex?: LensApexOverride,
): PartitionPoint[] {
  const apexFraction = apex?.fraction ?? 1 - LENS_PINCH_FRACTION
  const apexElev = apex?.elevation ?? (topElev + baseElev) / 2
  return [
    { fraction: 1, elevation: topElev },
    { fraction: apexFraction, elevation: apexElev },
    { fraction: 1, elevation: baseElev },
  ]
}

/**
 * Emit a ONE-SIDED pinch interval as apex-sharing triangles (Thread A).
 *
 * Every pinch unit lives on ``side`` (the unit is absent on the opposite column,
 * so the interval converges there). One shared apex is placed at fraction ``f``
 * from the pinch side; each stacked pinch becomes a sub-triangle to the apex, and
 * the enclosing matrix (where present) closes the interval beyond the apex via
 * the merged contact apex→conv. This handles every one-sided case uniformly:
 *
 *   - interior (matrix above AND below) → apex at mid-elevation, 2 extensions;
 *   - surface (no matrix above)         → apex on the surface, 1 extension below;
 *   - floor   (no matrix below)         → apex on the floor, 1 extension above.
 *
 * The result tiles exactly (N pinch sub-triangles + up to 2 matrix triangles all
 * share the apex), so the pinch tips mid-gap (no droop to the neighbour) while
 * the fill stays hole-free. Two-sided (interfingering) intervals are NOT handled
 * here — the caller routes those to ``emitInterval``.
 *
 * Parameters
 * ----------
 * pinches : PinchUnit[]
 *     The unmatched units, all on ``side`` (sorted internally top→bottom).
 * side : 'left' | 'right'
 *     The column the pinches live on.
 * topIface, baseIface : Interface
 *     The interval's enclosing interfaces.
 * above, below : the matrix quad ABOVE / BELOW the interval, or ``null`` at the
 *     surface / floor respectively.
 * leftSurface, rightSurface : column surface elevations (mTAW).
 * f : tip fraction measured from the pinch side (``INTERIOR_PINCH_FRACTION``).
 *
 * Returns
 * -------
 * PartitionRegion[]
 *     ``[...pinch sub-triangles, above extension?, below extension?]``.
 */
function emitOneSidedPinch(
  pinches: PinchUnit[],
  side: 'left' | 'right',
  topIface: Interface,
  baseIface: Interface,
  above: { formationId: string; bodyId: string | null } | null,
  below: { formationId: string; bodyId: string | null } | null,
  leftSurface: number,
  rightSurface: number,
  f: number,
): PartitionRegion[] {
  const apexFraction = side === 'left' ? f : 1 - f
  // Apex elevation: mid of the interval when matrix exists on BOTH sides
  // (interior); ON the top interface when there is no matrix above (a surface
  // unit pinches by its base rising to the surface); ON the base interface when
  // there is no matrix below (a floor unit pinches by its top descending).
  let apexElev: number
  if (above && below) {
    apexElev =
      (ifaceElev(topIface, apexFraction, leftSurface, rightSurface) +
        ifaceElev(baseIface, apexFraction, leftSurface, rightSurface)) /
      2
  } else if (!above) {
    apexElev = ifaceElev(topIface, apexFraction, leftSurface, rightSurface)
  } else {
    apexElev = ifaceElev(baseIface, apexFraction, leftSurface, rightSurface)
  }
  const apex: PartitionPoint = { fraction: apexFraction, elevation: apexElev }

  const pinchFrac = side === 'left' ? 0 : 1
  const oppFrac = side === 'left' ? 1 : 0
  const pinchSurface = side === 'left' ? leftSurface : rightSurface
  const oppSurface = side === 'left' ? rightSurface : leftSurface
  const topOppDepth = side === 'left' ? topIface.rightDepth : topIface.leftDepth
  const baseOppDepth = side === 'left' ? baseIface.rightDepth : baseIface.leftDepth
  const topPinchDepth = side === 'left' ? topIface.leftDepth : topIface.rightDepth
  const basePinchDepth = side === 'left' ? baseIface.leftDepth : baseIface.rightDepth
  // The interval has zero thickness on the OPPOSITE column (the unit is absent
  // there) — the two interfaces meet at this convergence point.
  const conv: PartitionPoint = {
    fraction: oppFrac,
    elevation: oppSurface - (topOppDepth + baseOppDepth) / 2,
  }

  const out: PartitionRegion[] = []
  // Each stacked pinch → a sub-triangle from its own depth span on the pinch
  // edge to the SHARED apex (one apex for the whole stack), so N stacked units
  // tile the pinch block exactly.
  const sorted = [...pinches].sort((a, b) => a.ownTopDepth - b.ownTopDepth)
  for (const p of sorted) {
    const top: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - p.ownTopDepth }
    const base: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - p.ownBaseDepth }
    out.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon: [top, apex, base] })
  }
  // Matrix extensions close the interval beyond the apex (the merged contact
  // runs apex→conv). Present only on the side(s) that have a matrix quad.
  if (above) {
    const topCorner: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - topPinchDepth }
    out.push({ formationId: above.formationId, bodyId: above.bodyId, kind: 'quad', polygon: [topCorner, conv, apex] })
  }
  if (below) {
    const baseCorner: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - basePinchDepth }
    out.push({ formationId: below.formationId, bodyId: below.bodyId, kind: 'quad', polygon: [baseCorner, apex, conv] })
  }
  return out
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
 * MAIN region — no overlaps, no empty spaces.  Enclosed lenses are APPENDED
 * after the main regions as ``kind: 'lens'`` regions that overlay their
 * enclosing matrix quad.
 *
 * The main regions are ordered top→bottom.  The lens regions follow in
 * extraction order (top-to-bottom within each side).
 *
 * Parameters
 * ----------
 * left : PartitionColumn
 *     The left column.  ``units`` must be gap-free, sorted by ``topDepthM``.
 * right : PartitionColumn
 *     The right column, same constraints.
 *
 * Returns
 * -------
 * PartitionRegion[]
 *     Top-to-bottom ordered MAIN regions that tile the gap, followed by lens
 *     overlay regions.  Empty when the left column has no units.
 */
export function computePartitionFill(
  left: PartitionColumn,
  right: PartitionColumn,
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
): PartitionRegion[] {
  if (left.units.length === 0) return []

  const leftSurface = left.surfaceElevM
  const rightSurface = right.surfaceElevM

  // -------------------------------------------------------------------------
  // Step 0: Enclosed-lens pre-pass.
  //
  // Build mutable copies of each column's unit arrays.  Extract any unit U
  // where (a) U.bodyId is absent on the other column, (b) both immediate
  // neighbours on the SAME column share the same bodyId (the matrix), AND
  // (c) that matrix bodyId IS present on the other column.  Each extracted
  // lens has the two surrounding matrix units merged into one.
  //
  // WHY do this before LCS: without pre-extraction the sand that brackets a
  // silt lens appears as THREE separate entries (sand, silt, sand) in the left
  // column.  The LCS matches the FIRST sand to the right-column sand and the
  // THIRD sand to a different part of the right column (or not at all), so the
  // LCS treats the three-piece sand as an interrupted body, producing a spurious
  // pinch for the outer sand piece.  After extraction the two sand pieces are
  // merged into ONE entry that matches the right-column sand cleanly as a quad.
  // -------------------------------------------------------------------------
  const leftUnits: PartitionUnit[] = left.units.map((u) => ({ ...u }))
  const rightUnits: PartitionUnit[] = right.units.map((u) => ({ ...u }))

  const rightIdSet = new Set(rightUnits.map((u) => u.bodyId).filter((id): id is string => id !== null))
  const leftIdSet = new Set(leftUnits.map((u) => u.bodyId).filter((id): id is string => id !== null))

  const leftLenses = extractEnclosedLenses(leftUnits, rightIdSet, 'left')
  const rightLenses = extractEnclosedLenses(rightUnits, leftIdSet, 'right')

  // -------------------------------------------------------------------------
  // Step 1: Monotonic LCS alignment on bodyId (post-extraction units).
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
  const leftTop = leftUnits[0].topDepthM
  const rightTop = rightUnits.length > 0 ? rightUnits[0].topDepthM : leftTop
  const leftFloor = leftUnits[leftUnits.length - 1].baseDepthM
  const rightFloor = rightUnits.length > 0 ? rightUnits[rightUnits.length - 1].baseDepthM : leftFloor

  const surfaceIface: Interface = { leftDepth: leftTop, rightDepth: rightTop }
  const floorIface: Interface = { leftDepth: leftFloor, rightDepth: rightFloor }

  const regions: PartitionRegion[] = []

  // prevQuadBase: the base interface of the most recently emitted quad (or the
  // surface interface before any quads).
  let prevQuadBase: Interface = surfaceIface
  // Identity of the most recently emitted quad (the matrix ABOVE the next
  // interval) — fed to emitLoneInteriorPinch so the above-matrix extension is
  // coloured correctly (Slice 1).
  let prevQuadFormationId: string | null = null
  let prevQuadBodyId: string | null = null

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

    // Emit the pinch regions for this interval. A ONE-SIDED pinch interval (all
    // pinches on the same column) tips each unit at 50% with the matrix closing
    // beyond it (Thread A) — interior (apex mid), surface (apex on the surface),
    // or floor (apex on the floor). Two-sided (interfingering) intervals fall
    // back to emitInterval. In the floor interval, units below the shallower
    // column's floor first carry through full-width (Slice 2).
    const intervalTop = prevQuadBase
    const hasAbove = prevMatchLi >= 0 && prevQuadFormationId !== null
    const aboveMatrix = hasAbove
      ? { formationId: prevQuadFormationId!, bodyId: prevQuadBodyId }
      : null
    let belowMatrix: { formationId: string; bodyId: string | null } | null = null
    if (!isFloor) {
      const [mli] = matchedPairs[pairIdx]
      const u = leftUnits[mli]
      belowMatrix = { formationId: u.formationId, bodyId: u.bodyId }
    }

    let pinchPool = pinches
    if (isFloor) {
      // Too-shallow carry-through (Slice 2): a unit whose TOP is at/below the
      // shallower column's deepest data lies entirely in "no-neighbour-data"
      // depth — render it as a full-gap-width flat band (the deep data governs
      // the whole gap below the shallow test) instead of pinching to the
      // shallow neighbour. A data gap is not a pinch-out.
      const shallowFloor = Math.min(leftFloor, rightFloor)
      const carry: PinchUnit[] = []
      const rest: PinchUnit[] = []
      for (const p of pinches) {
        if (p.ownTopDepth >= shallowFloor - EPS) carry.push(p)
        else rest.push(p)
      }
      for (const p of carry) {
        const surface = p.side === 'left' ? leftSurface : rightSurface
        const top = surface - p.ownTopDepth
        const base = surface - p.ownBaseDepth
        regions.push({
          formationId: p.formationId,
          bodyId: p.bodyId,
          kind: 'quad',
          polygon: [
            { fraction: 0, elevation: top },
            { fraction: 1, elevation: top },
            { fraction: 1, elevation: base },
            { fraction: 0, elevation: base },
          ],
        })
      }
      pinchPool = rest
    }

    // "One-sided" when every remaining pinch is on the same column — only then
    // can the matrix close cleanly to a single apex.
    const pinchSides = new Set(pinchPool.map((p) => p.side))
    const oneSide = pinchSides.size === 1 ? pinchPool[0].side : null
    if (pinchPool.length > 0 && oneSide !== null && (aboveMatrix || belowMatrix)) {
      regions.push(
        ...emitOneSidedPinch(
          pinchPool,
          oneSide,
          intervalTop,
          intervalBase,
          aboveMatrix,
          belowMatrix,
          leftSurface,
          rightSurface,
          INTERIOR_PINCH_FRACTION,
        ),
      )
    } else {
      regions.push(...emitInterval(pinchPool, intervalTop, intervalBase, leftSurface, rightSurface))
    }

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
        prevQuadFormationId = lu.formationId
        prevQuadBodyId = lu.bodyId
      } else {
        prevQuadBase = quadTop
      }
      prevMatchLi = mli
      prevMatchRi = mri
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Append extracted lens regions.
  //
  // Each lens is a horizontal pinch-out triangle that overlays its enclosing
  // matrix quad.  The apex elevation is the lens's OWN mid-elevation so it
  // terminates at its own stratigraphic level (horizontal), not along the
  // dipping enclosing interfaces.  The overlay draws these on top of the main
  // regions (array order) so the lens colour is visible over the matrix.
  // These regions deliberately overlap their matrix and are excluded from the
  // tiling invariant.
  // -------------------------------------------------------------------------
  for (const lens of leftLenses) {
    const topElev = leftSurface - lens.depthTopM
    const baseElev = leftSurface - lens.depthBaseM
    const apex = lens.bodyId ? lensApexOverrides?.get(lens.bodyId) : undefined
    regions.push({
      formationId: lens.formationId,
      bodyId: lens.bodyId,
      kind: 'lens',
      polygon: buildLeftLensPolygon(topElev, baseElev, apex),
    })
  }
  for (const lens of rightLenses) {
    const topElev = rightSurface - lens.depthTopM
    const baseElev = rightSurface - lens.depthBaseM
    const apex = lens.bodyId ? lensApexOverrides?.get(lens.bodyId) : undefined
    regions.push({
      formationId: lens.formationId,
      bodyId: lens.bodyId,
      kind: 'lens',
      polygon: buildRightLensPolygon(topElev, baseElev, apex),
    })
  }

  return regions
}
