// partitionFill/polygonBuilders.ts — extracted verbatim from partitionFill.ts
// (debt #201 round 2). See index.ts for the module-level doc.
import { EPS, INTERIOR_PINCH_FRACTION, LENS_PINCH_FRACTION, type Interface, type LensApexOverride, type PartitionPoint, type PinchUnit } from './types'

// Interface helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a candidate interface so it is not shallower than the previous one
 * on either side.
 */
export function clampIface(iface: Interface, prev: Interface): Interface {
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
export function ifaceElev(
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
export function buildQuadPolygon(
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
export function buildLeftPinchPolygon(
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
export function buildRightPinchPolygon(
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
/**
 * Build a multi-node freedraw lens outline anchored on column edge ``cornerFrac``
 * (0 = left, 1 = right): the upper edge runs from the top corner out along the
 * ``upper`` points (fraction-ascending), the lower edge returns along ``lower``
 * (fraction-descending) to the base corner. Same vertex order as the overlay's
 * legacy ``buildLensPolygon`` so a freedraw lens renders identically — but now in
 * the domain, where ``carveOverlays`` clips it to the matrix + cuts the notch.
 */
export function buildFreedrawLensOutline(
  cornerFrac: 0 | 1,
  topElev: number,
  baseElev: number,
  upper: { fraction: number; elevation: number }[],
  lower: { fraction: number; elevation: number }[],
): PartitionPoint[] {
  return [
    { fraction: cornerFrac, elevation: topElev },
    ...[...upper].sort((a, b) => a.fraction - b.fraction),
    ...[...lower].sort((a, b) => b.fraction - a.fraction),
    { fraction: cornerFrac, elevation: baseElev },
  ]
}

export function buildLeftLensPolygon(
  topElev: number,
  baseElev: number,
  apex?: LensApexOverride,
): PartitionPoint[] {
  if (apex?.upper?.length || apex?.lower?.length) {
    return buildFreedrawLensOutline(0, topElev, baseElev, apex.upper ?? [], apex.lower ?? [])
  }
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
export function buildRightLensPolygon(
  topElev: number,
  baseElev: number,
  apex?: LensApexOverride,
): PartitionPoint[] {
  if (apex?.upper?.length || apex?.lower?.length) {
    return buildFreedrawLensOutline(1, topElev, baseElev, apex.upper ?? [], apex.lower ?? [])
  }
  const apexFraction = apex?.fraction ?? 1 - LENS_PINCH_FRACTION
  const apexElev = apex?.elevation ?? (topElev + baseElev) / 2
  return [
    { fraction: 1, elevation: topElev },
    { fraction: apexFraction, elevation: apexElev },
    { fraction: 1, elevation: baseElev },
  ]
}

/**
 * Build the triangle polygon for an ONLAP — a minority that laps against one
 * bracket tie-line.
 *
 * The flat edge sits on the unit's source column (fraction 0 left / 1 right);
 * the unit tapers to a tip at ``INTERIOR_PINCH_FRACTION`` whose elevation is
 * taken from the BRACKET interface it laps against (``top`` → the top interface,
 * so the base laps UP; ``base`` → the base interface, so the top laps DOWN).
 * This is geometrically distinct from a lens (apex at the unit's OWN
 * mid-elevation) — the onlap is anchored on its correlated bracket.
 *
 * The onlap overlays the connected matrix band, so its region is emitted as
 * ``kind: 'lens'`` (excluded from the tiling invariant), like an enclosed lens.
 *
 * Parameters
 * ----------
 * unit : PinchUnit
 *     The onlap unit (carries its column side + own depth span).
 * edge : 'top' | 'base'
 *     The bracket the onlap laps against.
 * topIface, baseIface : Interface
 *     The interval's enclosing interfaces (the brackets).
 * leftSurface, rightSurface : number
 *     Column surface elevations (mTAW).
 */
export function buildOnlapPolygon(
  unit: PinchUnit,
  edge: 'top' | 'base',
  topIface: Interface,
  baseIface: Interface,
  leftSurface: number,
  rightSurface: number,
): PartitionPoint[] {
  const surface = unit.side === 'left' ? leftSurface : rightSurface
  const colFrac = unit.side === 'left' ? 0 : 1
  let tipFrac = unit.side === 'left' ? INTERIOR_PINCH_FRACTION : 1 - INTERIOR_PINCH_FRACTION
  const topElev = surface - unit.ownTopDepth
  const baseElev = surface - unit.ownBaseDepth
  const anchor = edge === 'top' ? topIface : baseIface
  let tipElev = ifaceElev(anchor, tipFrac, leftSurface, rightSurface)
  // Own-elevation clamp (owner rule 2, locked 2026-07-07): a gesture never
  // leaves the unit's own [base..top] band — the onlap terminates ON its tied
  // line WHERE that line passes through the band, not by following it beyond
  // (OG1 dogfeed: a silt lapping a clay-top line that rises above the silt's
  // own top must die where the line crosses that top, not climb to elev 9).
  // Solve the linear crossing between the anchor line and the exceeded bound
  // along the column→tip segment.
  if (tipElev > topElev || tipElev < baseElev) {
    const bound = tipElev > topElev ? topElev : baseElev
    const e0 = ifaceElev(anchor, colFrac, leftSurface, rightSurface)
    const denom = tipElev - e0
    // Degenerate (flat line entirely outside the band): keep a minimal wedge
    // at the column edge rather than dividing by ~0.
    const t = Math.abs(denom) < EPS ? 0 : Math.max(0, Math.min(1, (bound - e0) / denom))
    tipFrac = colFrac + t * (tipFrac - colFrac)
    tipElev = bound
  }
  return [
    { fraction: colFrac, elevation: topElev },
    { fraction: tipFrac, elevation: tipElev },
    { fraction: colFrac, elevation: baseElev },
  ]
}

// ---------------------------------------------------------------------------
