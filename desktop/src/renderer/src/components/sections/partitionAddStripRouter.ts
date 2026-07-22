/**
 * Region-containment router for the partition freedraw add-strips.
 *
 * The litho partition overlay renders one transparent hit-strip per body edge
 * (matched-contact boundaries + lens upper/lower edges), each 14 px wide. Where
 * thin stacked pinch lenses converge — the GEO-10/170-S7 gap5 dogfeed — several
 * bodies' strips overlap vertically at a single click point. With each strip
 * firing its OWN ``onClick``, the winner was decided purely by SVG paint order
 * (the last-painted element under the cursor), so a click on the sand/silt
 * interface silently grabbed a DISTANT silt lens painted above it (~1 m away),
 * then moving that wrong body opened a gap.
 *
 * The S70 fix picked the candidate whose SEGMENT was physically nearest the
 * cursor. That is still fooled by a lens whose long diagonal flank sweeps NEAR
 * the click from far away: a full-gap diagonal strip can be nearer in
 * perpendicular distance than the band you actually clicked on (owner dogfeed
 * 2026-07-22 — "i clicked the sand lens on top" but it grabbed the silt band
 * above). The robust invariant is CONTAINMENT: a click grabs the body whose
 * partition REGION physically contains the cursor point (point-in-polygon over
 * the rendered regions). You grab what you clicked ON — a diagonal edge that
 * merely passes nearby can no longer win over the region under the cursor.
 *
 * The nearest-SEGMENT pick (``routeNearestAddStrip``) is retained as the
 * WITHIN-body edge tiebreak (which of a lens's two edges, or which of several
 * containing regions' shared edges) and as the fallback when the click lands
 * just outside every region polygon (e.g. on the strip's overhang past its
 * region). Region-containment first, nearest-segment second.
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
 *
 * ``regionPolygon`` is the screen-space ring of the body's PARTITION region (the
 * polygon the fill paints). When present, the router prefers candidates whose
 * region contains the click — the robust region-containment invariant. Absent
 * (or empty) → the candidate only participates in the nearest-segment fallback.
 */
export interface AddStripCandidate<T> {
  /** One or more screen-space segments the strip covers. */
  segments: [RouterPoint, RouterPoint][]
  /** Caller-defined payload identifying which handler to invoke. */
  dispatch: T
  /** Screen ring of the body's partition region (for containment targeting). */
  regionPolygon?: readonly RouterPoint[]
}

/**
 * Even-odd point-in-polygon test (ray casting) in screen coordinates.
 *
 * A point exactly on an edge is treated as inside for at least one incident
 * region — good enough for click targeting, where a shared contact click should
 * resolve to one of the two incident bands (the nearest-segment tiebreak then
 * decides which).
 *
 * @param p    The click position.
 * @param ring The polygon ring (>= 3 points); winding-agnostic.
 * @returns    ``true`` when ``p`` is inside ``ring``.
 */
export function pointInPolygon(p: RouterPoint, ring: readonly RouterPoint[]): boolean {
  if (ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i].x
    const yi = ring[i].y
    const xj = ring[j].x
    const yj = ring[j].y
    const intersects =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
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

/**
 * Pick the add-strip candidate the click physically lands ON (region containment),
 * falling back to nearest-segment when the click is outside every region.
 *
 * This is the robust invariant that replaces the plain nearest-segment pick: the
 * owner grabs the body whose partition region CONTAINS the cursor, never a
 * distant lens whose diagonal edge merely sweeps nearby. Steps:
 *
 *   1. Collect every candidate whose ``regionPolygon`` contains the click.
 *   2. If any do, pick the one whose EDGE is nearest the click among them — this
 *      is the within-body / shared-contact tiebreak (a shared contact click sits
 *      inside both incident bands; the nearer edge wins). ``nearerLensEdge`` in
 *      the caller then resolves upper-vs-lower for the winning lens.
 *   3. If NONE contain the click (it fell just outside all region rings, e.g. on
 *      a strip's overhang past its region), fall back to the global
 *      nearest-segment pick so an edge click still lands.
 *
 * @param click      The cursor position in SVG coordinates.
 * @param candidates All add-strip candidates whose hit areas may contain the click.
 * @returns          The chosen candidate's ``dispatch`` payload, or ``null`` when
 *                   the list is empty.
 */
export function routeAddStripByContainment<T>(
  click: RouterPoint,
  candidates: readonly AddStripCandidate<T>[],
): T | null {
  if (candidates.length === 0) return null
  const containing = candidates.filter(
    (c) => c.regionPolygon !== undefined && pointInPolygon(click, c.regionPolygon),
  )
  if (containing.length > 0) return routeNearestAddStrip(click, containing)
  // No region contains the click → nearest-segment fallback across ALL candidates.
  return routeNearestAddStrip(click, candidates)
}
