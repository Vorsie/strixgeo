// Inverse of the section's piecewise-linear horizontal "warp" (the Spacing
// slider + collision-nudge that move each column from its true projected X
// toward a packed position).
//
// The forward map lives inline in SectionPanel as ``warpedXToScreen``: it
// places along-distance content at the screen X interpolated through each
// placed column's ``(along, effX=nudgedX)`` anchor pair, extrapolating at
// true scale (``scaleH`` px per along-metre) outside the column range.
//
// This inverse answers the question the wheel-zoom needs: "the cursor is at
// screen pixel ``px`` — which along-distance is actually drawn there?".
// Without it, zoom-to-cursor inverts the LINEAR map instead and anchors on
// the wrong feature whenever spacing < 1 or columns collide, so the content
// drifts out from under the mouse.
//
// Pure module: no React, no DOM. Unit-tested in sectionWarp.test.ts.

/** One placed column's warp anchor: its true along-distance and the screen X
 *  it was actually drawn at (after spacing lerp + collision nudge). */
export interface WarpAnchor {
  /** True projected along-distance of the column (world metres). */
  along: number
  /** Screen X the column was drawn at (px) — ``nudgedX``. */
  effX: number
}

/**
 * Invert the section warp: screen X → along-distance.
 *
 * Mirrors the forward ``warpedXToScreen`` exactly so the round-trip is
 * stable. Anchors must be sorted ascending by ``along`` (the caller sorts
 * them); ``effX`` is non-decreasing because the packed layout preserves
 * left-to-right order, which makes the map invertible.
 *
 * @param px - Cursor screen X relative to the plot's coordinate origin (px).
 * @param anchors - Placed-column anchors, sorted ascending by ``along``.
 * @param scaleH - Horizontal scale outside the anchor range (px per metre).
 * @param fallbackAlong - Along-distance to return when there are no anchors
 *   (the caller passes the linear inverse so behaviour is unchanged then).
 * @returns The along-distance drawn under ``px``.
 */
export function warpedScreenXToAlong(
  px: number,
  anchors: readonly WarpAnchor[],
  scaleH: number,
  fallbackAlong: number,
): number {
  if (anchors.length === 0) return fallbackAlong

  const first = anchors[0]
  // Left of the first column — true-scale extrapolation (inverse of the
  // forward map's ``first.effX - (first.along - along) * scaleH``).
  if (px <= first.effX) {
    return first.along - (first.effX - px) / scaleH
  }
  const last = anchors[anchors.length - 1]
  // Right of the last column — same, mirrored.
  if (px >= last.effX) {
    return last.along + (px - last.effX) / scaleH
  }
  // Inside — find the segment whose effX range contains ``px`` and
  // linearly interpolate the along-distance.
  let i = 0
  while (i < anchors.length - 1 && anchors[i + 1].effX < px) i += 1
  const a = anchors[i]
  const b = anchors[i + 1]
  // Defensive against duplicate-effX anchors (two columns nudged to the
  // same X) — fall back to ``a``'s along rather than dividing by zero.
  if (b.effX === a.effX) return a.along
  const frac = (px - a.effX) / (b.effX - a.effX)
  return a.along + frac * (b.along - a.along)
}
