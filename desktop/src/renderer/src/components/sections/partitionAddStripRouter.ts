/**
 * Global nearest-boundary router for the partition freedraw add-strips.
 *
 * The litho partition overlay renders one transparent hit-strip per body edge
 * (matched-contact boundaries + lens upper/lower edges), each 14 px wide. Where
 * thin stacked pinch lenses converge — the GEO-10/170-S7 gap5 dogfeed — several
 * bodies' strips overlap vertically at a single click point. With each strip
 * firing its OWN ``onClick``, the winner is decided purely by SVG paint order
 * (the last-painted element under the cursor), so a click on the sand/silt
 * interface silently grabbed a DISTANT silt lens painted above it (~1 m away),
 * then moving that wrong body opened a gap.
 *
 * ``nearerLensEdge`` only disambiguates the two edges of ONE lens; it never
 * arbitrates ACROSS bodies. This module lifts that idea to a GLOBAL pick: on any
 * add-strip click, choose the candidate whose segment is physically nearest the
 * cursor across ALL bodies in the gap, then dispatch to that candidate's handler.
 * The owner clicking a boundary now grabs THAT boundary, never whichever strip
 * happened to be on top.
 */

/** A point in SVG screen coordinates. */
export interface RouterPoint {
  x: number
  y: number
}

/**
 * One clickable add-strip, described by its screen segment plus an opaque
 * ``dispatch`` payload the caller uses to route the click to the right handler.
 *
 * ``segments`` is a list (not a single pair) so a multi-node lens/boundary edge
 * that is a polyline of several sub-segments can report the true minimum
 * distance to any of its links, not just its overall endpoints.
 */
export interface AddStripCandidate<T> {
  /** One or more screen-space segments the strip covers. */
  segments: [RouterPoint, RouterPoint][]
  /** Caller-defined payload identifying which handler to invoke. */
  dispatch: T
}

/**
 * Squared distance from a point to a line segment (clamped to the segment).
 *
 * Squared, not rooted — only used for comparison, so the monotone square is
 * enough and avoids a needless ``Math.sqrt`` per candidate.
 *
 * @param p    The click position.
 * @param a, b The segment endpoints.
 * @returns    The squared Euclidean distance from ``p`` to the nearest point on
 *             ``[a, b]``.
 */
function distSqToSegment(p: RouterPoint, a: RouterPoint, b: RouterPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  const c = t < 0 ? 0 : t > 1 ? 1 : t
  const ex = p.x - (a.x + c * dx)
  const ey = p.y - (a.y + c * dy)
  return ex * ex + ey * ey
}

/**
 * The minimum squared distance from a click to any of a candidate's segments.
 *
 * @param click     The cursor position in SVG coordinates.
 * @param candidate The add-strip candidate.
 * @returns         The smallest squared distance to any of its segments
 *                  (``Infinity`` if the candidate has no segments).
 */
export function candidateDistSq<T>(click: RouterPoint, candidate: AddStripCandidate<T>): number {
  let best = Infinity
  for (const [a, b] of candidate.segments) {
    const d = distSqToSegment(click, a, b)
    if (d < best) best = d
  }
  return best
}

/**
 * Pick the add-strip candidate whose segment is nearest a click.
 *
 * This is the global arbitration that fixes the stacked-lens mis-targeting: with
 * every overlapping strip routed through this pick, the boundary the engineer
 * visually aimed at wins, regardless of SVG paint order.
 *
 * Ties resolve to the EARLIER candidate in the list (stable + deterministic) —
 * the caller orders candidates so the preferred one wins a tie (e.g. list the
 * shared contact before its coincident lens edge if both should be tie-preferred).
 *
 * @param click      The cursor position in SVG coordinates.
 * @param candidates All add-strip candidates whose hit areas may contain the click.
 * @returns          The nearest candidate's ``dispatch`` payload, or ``null`` when
 *                   the list is empty.
 */
export function routeNearestAddStrip<T>(
  click: RouterPoint,
  candidates: readonly AddStripCandidate<T>[],
): T | null {
  let best: AddStripCandidate<T> | null = null
  let bestDist = Infinity
  for (const cand of candidates) {
    const d = candidateDistSq(click, cand)
    if (d < bestDist) {
      bestDist = d
      best = cand
    }
  }
  return best ? best.dispatch : null
}
