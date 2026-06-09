/**
 * Pick which lens edge a ghost-node click belongs to.
 *
 * A pinch-out wedge has two add-strips (upper edge + lower edge) that converge at
 * the apex. On a thin wedge the two transparent hit-strips overlap, so relying on
 * SVG z-order silently routes every click to whichever strip is painted last (the
 * lower one) — the user perceives this as the node "grabbing the pinchout at both
 * sides". Routing the click to the edge whose segment is physically nearest the
 * cursor removes that ambiguity: aim near the top edge, the node lands on top.
 */

type Point = { x: number; y: number }
type Segment = [Point, Point]

/**
 * Squared distance from a point to a line segment.
 *
 * Squared (not the root) — we only compare two distances, so the monotonic square
 * is enough and avoids a needless ``Math.sqrt``.
 *
 * Parameters
 * ----------
 * p : Point
 *     The click position, in the same coordinate space as the segment.
 * a, b : Point
 *     The segment endpoints.
 *
 * Returns
 * -------
 * float
 *     The squared Euclidean distance from ``p`` to the closest point on ``[a, b]``.
 */
function distSqToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  // Degenerate segment (apex == source corner) → distance to the single point.
  const t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  const cx = a.x + clamped * dx
  const cy = a.y + clamped * dy
  const ex = p.x - cx
  const ey = p.y - cy
  return ex * ex + ey * ey
}

/**
 * Return the lens edge nearest a click.
 *
 * Parameters
 * ----------
 * click : Point
 *     The cursor position in SVG coordinates.
 * upper, lower : Segment
 *     The upper-edge and lower-edge add-strip segments.
 *
 * Returns
 * -------
 * 'upper' | 'lower'
 *     Which edge the new node should attach to. Ties resolve to ``'upper'`` so the
 *     choice is deterministic on a perfectly symmetric wedge.
 */
export function nearerLensEdge(
  click: Point,
  upper: Segment,
  lower: Segment,
): 'upper' | 'lower' {
  const dUpper = distSqToSegment(click, upper[0], upper[1])
  const dLower = distSqToSegment(click, lower[0], lower[1])
  return dLower < dUpper ? 'lower' : 'upper'
}
