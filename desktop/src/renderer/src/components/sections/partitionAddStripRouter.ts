/**
 * Edge-only router for the partition freedraw add-strips.
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
 * The S70 fix picked the nearest SEGMENT; the S71 fix replaced that with region
 * CONTAINMENT (grab the body the cursor is INSIDE). Containment cured the
 * distant-diagonal steal but introduced a worse bug (owner dogfeed 2026-07-24):
 * a click ANYWHERE inside a band interior grabbed that band's edge and dropped a
 * node ("i can literally click in the middle of a band"). The owner's model is
 * EDGE-ONLY: only the visible line between two litho fills is grabbable — an
 * interior click is a NO-OP.
 *
 * The invariant (``routeAddStripByEdgeProximity``): a click routes to the
 * candidate whose EDGE SEGMENT is nearest the cursor, but ONLY when that nearest
 * distance is within a hit tolerance (the strip's half-width in screen px). If
 * the nearest edge is farther than the tolerance — the click is in open band
 * interior — the router returns ``null`` (no grab). The line you click is the
 * line you grab: a lens diagonal you clicked ON wins because it is nearest to
 * WHERE you clicked, not because you are "inside" a band. The distant-diagonal
 * steal the S71 containment fixed cannot recur, because an interior click is
 * inert (a no-op) rather than a grab.
 *
 * ``pointInPolygon`` survives ONLY for the ghost barrier no-op: a press inside a
 * suppressed ghost region (its handle removed, §83) stays a no-op even when a
 * live candidate edge grazes the tolerance — the ghost has no reshape to offer.
 * The region-containment GRAB path is retired.
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
 * polygon the fill paints). The edge-only router no longer grabs by containment,
 * so this field is unused by grab targeting; it is retained on the type only for
 * callers that still carry the region ring (harmless, additive). Barrier no-op
 * regions are passed separately to ``routeAddStripByEdgeProximity``.
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
 * The point ON a segment at the click's ALONG-x — a VERTICAL projection: keep the
 * user's chosen x (the along position they aimed at) and read the edge's y there.
 *
 * Returns null when the segment does not span the click's x (the vertical through
 * the click misses this segment entirely) so the caller can prefer a segment the
 * click actually sits above/below. A vertical (constant-x) segment is treated as
 * spanning only its own x.
 *
 * @param p    The click position.
 * @param a, b The segment endpoints.
 * @returns    The on-edge point at ``p.x``, or ``null`` when ``p.x`` is outside
 *             the segment's x-span.
 */
function edgePointAtX(p: RouterPoint, a: RouterPoint, b: RouterPoint): RouterPoint | null {
  const dx = b.x - a.x
  // Vertical segment: the along-x projection is defined only exactly at its x.
  if (Math.abs(dx) < 1e-9) {
    if (Math.abs(p.x - a.x) > 1e-6) return null
    // Clamp y into the segment's y-range so the node stays on the strip.
    const yMin = Math.min(a.y, b.y)
    const yMax = Math.max(a.y, b.y)
    return { x: a.x, y: Math.max(yMin, Math.min(yMax, p.y)) }
  }
  const t = (p.x - a.x) / dx
  if (t < 0 || t > 1) return null
  return { x: p.x, y: a.y + t * (b.y - a.y) }
}

/**
 * Project a click onto a candidate's boundary — the point where a new node must
 * be STORED so it rides the boundary line at the user's chosen x, never floating
 * in the region interior (S72, owner dogfeed 2026-07-22 — "i managed to get a
 * point without grabbing a boundary").
 *
 * S71's containment router correctly grabs the body a click is INSIDE, but a
 * click deep in the interior is far from the target edge. Storing the raw cursor
 * ``(x, y)`` dropped the node in free space (the three floating blue dots). This
 * projects VERTICALLY onto the candidate's edge: the node keeps the click's x (the
 * along position the engineer aimed at) and takes its ELEVATION from the boundary
 * at that x — so the node sits exactly on a horizontal contact at the cursor x, or
 * on a sloping contact at the corresponding elevation. Among a candidate's several
 * segments (a lens's upper + lower edges), the one whose edge-y is NEAREST the
 * click wins (the edge the user aimed at); if no segment spans the click's x
 * (a click past the tip), fall back to the nearest point on any segment.
 *
 * @param click     The cursor position in SVG coordinates.
 * @param candidate The winning add-strip candidate (whose edge the node lands on).
 * @returns         The on-edge point, or ``null`` when the candidate has no segments.
 */
export function projectClickToCandidate<T>(
  click: RouterPoint,
  candidate: AddStripCandidate<T>,
): RouterPoint | null {
  let best: RouterPoint | null = null
  let bestDy = Infinity
  // Prefer the segment the click sits above/below (its vertical hits the edge),
  // choosing the one whose y is nearest the click (the edge the cursor aimed at).
  for (const [a, b] of candidate.segments) {
    const q = edgePointAtX(click, a, b)
    if (!q) continue
    const dy = Math.abs(click.y - q.y)
    if (dy < bestDy) {
      bestDy = dy
      best = q
    }
  }
  if (best) return best
  // No segment spans the click's x (past a tapering tip) → nearest endpoint on any
  // segment, so the node still lands ON the boundary rather than in free space.
  let bestDist = Infinity
  for (const [a, b] of candidate.segments) {
    for (const end of [a, b]) {
      const ex = click.x - end.x
      const ey = click.y - end.y
      const d = ex * ex + ey * ey
      if (d < bestDist) {
        bestDist = d
        best = end
      }
    }
  }
  return best
}

/**
 * Apply the S72 visible-reach floor to an already-projected on-segment point WITHOUT
 * knocking it off the boundary (owner free-draw repair, Fact A).
 *
 * The reach floor keeps a lens's apex ≥ ``floorPx`` (a fraction of the gap) away from
 * its anchored source column so a click near the column face cannot pinch the lens to a
 * hairline. The pre-repair code clamped the along-x but KEPT the projected y — on a
 * SLOPING edge that puts the stored node OFF the segment (the floating blue handle).
 *
 * The fix: clamp the along-x to the floor, then RE-READ the segment's y at the clamped
 * x (``edgePointAtX``) so the node stays ON the boundary. When the clamped x still falls
 * within the segment's x-span this is exact; when the floor pushes x PAST the segment's
 * interior tip (a near-degenerate lens whose whole edge sits inside the floor band), snap
 * to the INTERIOR tip — the endpoint FARTHEST from the anchored source column — so the
 * reach stays maximised (never collapsed back onto the source, which the floor exists to
 * prevent) and the node stays ON the boundary, never at free cursor coords.
 *
 * @param projected The on-segment projected click (from ``projectClickToCandidate``).
 * @param seg       The selected boundary segment ``[a, b]`` (screen coords).
 * @param side      Which column the lens anchors on: ``'left'`` floors x up from
 *                  ``leftX + floorPx``; ``'right'`` caps x down from ``rightX − floorPx``.
 * @param leftX     The gap's left screen-x edge.
 * @param rightX    The gap's right screen-x edge.
 * @param floorPx   The minimum-visible-reach floor in screen px.
 * @returns         The reach-constrained point, still lying ON ``seg``.
 */
export function applyReachFloorOnSegment(
  projected: RouterPoint,
  seg: [RouterPoint, RouterPoint],
  side: 'left' | 'right',
  leftX: number,
  rightX: number,
  floorPx: number,
): RouterPoint {
  const clampedX = side === 'left' ? Math.max(leftX + floorPx, projected.x) : Math.min(rightX - floorPx, projected.x)
  // No clamp needed → the projected point is already on-segment; return it unchanged.
  if (Math.abs(clampedX - projected.x) < 1e-9) return projected
  // Re-read the segment's y AT the clamped x so the node rides the (possibly sloped) edge.
  const onSeg = edgePointAtX({ x: clampedX, y: projected.y }, seg[0], seg[1])
  if (onSeg) return onSeg
  // ``edgePointAtX`` returned null → the clamped x is outside the segment's x-span. Two cases:
  //
  //  (a) VERTICAL / near-vertical segment (the projection landed on the anchored COLUMN FACE,
  //      not on a lens flank). Here the reach floor's whole job is to push the apex OFF that
  //      face INTO the gap — the node is MEANT to leave the vertical line. Keep the projected
  //      elevation and move x to the floor (the pre-repair reach behaviour, which was correct
  //      for the column-face case). This preserves the "a click near the column can't collapse
  //      the lens" contract (A1).
  //
  //  (b) SLOPING segment whose interior tip is INSIDE the floor band (a near-degenerate lens):
  //      snap to the tip — the endpoint FARTHEST from the source — so the reach stays maximised
  //      and the node stays ON the sloped edge, never collapsed back onto the source corner.
  const dx = Math.abs(seg[1].x - seg[0].x)
  if (dx < 1e-6) return { x: clampedX, y: projected.y } // (a) column-face reach into the gap
  const tip = side === 'left' ? (seg[0].x >= seg[1].x ? seg[0] : seg[1]) : seg[0].x <= seg[1].x ? seg[0] : seg[1]
  return { x: tip.x, y: tip.y } // (b) sloped-edge tip
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
 * Pick the add-strip candidate whose EDGE the click lands ON — and ONLY when it
 * lands within the hit tolerance. An interior click (far from every edge) is a
 * NO-OP.
 *
 * This is the edge-only invariant (owner dogfeed 2026-07-24): only the visible
 * litho line between two fills is grabbable. It replaces the S71 region-
 * containment grab, which let a click ANYWHERE in a band interior grab that
 * band's edge ("i can click in the middle of a band"). Steps:
 *
 *   1. Find the candidate whose nearest edge segment is nearest the click.
 *   2. If that nearest distance is FARTHER than the tolerance, the click is in
 *      open band interior → return ``null`` (no grab). The line you clicked ON is
 *      the line you grab; a distant diagonal that merely sweeps near a DIFFERENT
 *      interior point can no longer steal the click, because that interior click
 *      is inert, not a grab.
 *   3. If the click sits inside a ``barrierRegion`` (a suppressed GHOST region
 *      whose handle §83 removed), return ``null`` even when a live edge grazes the
 *      tolerance — the ghost owns the click and offers no reshape.
 *   4. Otherwise return the nearest candidate's ``dispatch``. ``nearerLensEdge`` in
 *      the caller then resolves upper-vs-lower for a winning lens.
 *
 * @param click          The cursor position in SVG coordinates.
 * @param candidates     All add-strip candidates whose hit areas may contain the click.
 * @param edgeToleranceSq The SQUARED hit tolerance in screen px (the strip's half-
 *                        width squared). A click whose nearest edge is farther than
 *                        this is in open interior → no grab.
 * @param barrierRegions Optional rings of suppressed GHOST regions. A click inside
 *                        one is a no-op even when an edge is within tolerance.
 * @returns              The chosen candidate's ``dispatch`` payload, or ``null`` when
 *                       the list is empty / the click is in open interior / inside a
 *                       suppressed ghost region.
 */
export function routeAddStripByEdgeProximity<T>(
  click: RouterPoint,
  candidates: readonly AddStripCandidate<T>[],
  edgeToleranceSq: number,
  barrierRegions?: readonly (readonly RouterPoint[])[],
): T | null {
  const best = nearestAddStripWithinTolerance(click, candidates, edgeToleranceSq, barrierRegions)
  return best ? best.dispatch : null
}

/**
 * The add-strip candidate whose EDGE the click lands ON within the hit tolerance,
 * or ``null`` when the click is in open interior / inside a suppressed ghost.
 *
 * Shared by the grab (``routeAddStripByEdgeProximity`` reads ``.dispatch``) and the
 * hover PREVIEW (which projects the cursor onto the returned candidate's edge so
 * the teal dot rides the litho line and hides in the interior). Keeping the
 * nearest-edge-within-tolerance test in ONE place keeps preview and grab in exact
 * agreement — the dot shows exactly where a click would grab.
 *
 * @param click           The cursor position in SVG coordinates.
 * @param candidates      All add-strip candidates whose hit areas may contain the click.
 * @param edgeToleranceSq The SQUARED hit tolerance in screen px (the strip's half-width²).
 * @param barrierRegions  Optional rings of suppressed GHOST regions (a click inside
 *                        one is inert even when an edge is within tolerance).
 * @returns               The nearest within-tolerance candidate, or ``null``.
 */
export function nearestAddStripWithinTolerance<T>(
  click: RouterPoint,
  candidates: readonly AddStripCandidate<T>[],
  edgeToleranceSq: number,
  barrierRegions?: readonly (readonly RouterPoint[])[],
): AddStripCandidate<T> | null {
  if (candidates.length === 0) return null
  let best: AddStripCandidate<T> | null = null
  let bestDist = Infinity
  for (const cand of candidates) {
    const d = candidateDistSq(click, cand)
    if (d < bestDist) {
      bestDist = d
      best = cand
    }
  }
  // Open band interior — the nearest edge is beyond the hit tolerance → NO grab.
  if (!best || bestDist > edgeToleranceSq) return null
  // A press inside a suppressed ghost region is a no-op (its handle is gone; no
  // reshape there), even when a live candidate edge grazes the tolerance (§83).
  if (barrierRegions?.some((ring) => pointInPolygon(click, ring))) return null
  return best
}
